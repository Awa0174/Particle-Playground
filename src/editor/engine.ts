import { RENDER_STRIDE, RenderGroup, Simulation } from '../engine/Simulation';
import type { SceneConfig } from '../engine/types';
import { LinkBuilder } from '../engine/links';
import { onShapeCacheChange } from '../engine/shapes';
import { WebGLRenderer } from '../renderer/WebGLRenderer';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import type { Camera, IRenderer } from '../renderer/types';
import { AudioReactive } from './audio';
import { getStore } from './store';

const QUALITY_SCALE: Record<string, number> = { low: 0.5, medium: 0.75, high: 1, ultra: 1.5 };

export interface PerfSample {
  fps: number;
  frameMs: number;
  simMs: number;
  renderMs: number;
  particles: number;
  gpuParticles: number;
  history: Float32Array;
  head: number;
}

/**
 * Owns the simulation + renderer and drives the frame loop. Lives outside
 * React so the hot path never triggers re-renders; the UI reads throttled
 * snapshots from the store or subscribes to onFrame for overlays.
 */
export class EngineHost {
  sim: Simulation;
  renderer: IRenderer | null = null;
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  audio = new AudioReactive();
  perf: PerfSample = { fps: 60, frameMs: 16, simMs: 0, renderMs: 0, particles: 0, gpuParticles: 0, history: new Float32Array(180), head: 0 };
  private instances = new Float32Array(0);
  private groups: RenderGroup[] = [];
  private links = new LinkBuilder();
  private raf = 0;
  private last = 0;
  private resyncFlag = true;
  private dirtyFlag = false;
  private frameListeners = new Set<() => void>();
  private captureQueue: ((b: Blob | null) => void)[] = [];
  private cssSize = { w: 1, h: 1 };
  private autoScale = 1;
  private slowFrames = 0;
  private fastFrames = 0;
  private lastStoreTime = 0;
  private recorder: MediaRecorder | null = null;
  private recordStart = 0;
  private recordTarget = 0;
  private recordChunks: Blob[] = [];
  private recordResolve: ((b: Blob) => void) | null = null;

  constructor(scene: SceneConfig) {
    this.sim = new Simulation(scene);
    this.sim.modulate = (rt, authored) => this.audio.apply(rt, authored);
    onShapeCacheChange(() => {
      // async image point clouds arrived → history changed
      this.sim.setScene(this.sim.scene);
      this.dirtyFlag = true;
    });
  }

  attach(canvas: HTMLCanvasElement): void {
    try {
      this.renderer = new WebGLRenderer(canvas);
    } catch (err) {
      console.warn('WebGL2 unavailable, falling back to Canvas 2D', err);
      this.renderer = new CanvasRenderer(canvas);
      getStore().toast('WebGL2 nicht verfügbar – Canvas-2D-Fallback aktiv', 'error');
    }
    getStore().set({ backend: this.renderer.kind === 'webgl2' ? (this.renderer.stats.hdr ? 'WebGL2 · HDR' : 'WebGL2 · LDR') : 'Canvas 2D' });
    this.last = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    this.renderer = null;
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  resize(w: number, h: number): void {
    this.cssSize = { w, h };
    this.sim.setAspect(w / Math.max(1, h));
    this.applyResolution();
    this.dirtyFlag = true;
  }

  private applyResolution(): void {
    if (!this.renderer) return;
    const st = getStore().state;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = st.quality === 'auto' ? this.autoScale : QUALITY_SCALE[st.quality];
    this.renderer.resize(this.cssSize.w, this.cssSize.h, dpr * scale);
    if (Math.abs(st.renderScale - scale) > 0.01) getStore().set({ renderScale: scale });
  }

  setQuality(): void {
    this.autoScale = 1;
    this.applyResolution();
    this.resyncFlag = true;
  }

  setScene(scene: SceneConfig): void {
    this.sim.setScene(scene);
    this.dirtyFlag = true;
  }

  restart(): void {
    this.sim.reset();
    this.resyncFlag = true;
  }

  seek(t: number): void {
    this.sim.seek(t);
    this.resyncFlag = true;
    this.pushTime(true);
  }

  step(): void {
    this.sim.stepOnce();
    this.pendingSteps = 1;
    this.pushTime(true);
  }

  markDirty(): void {
    this.dirtyFlag = true;
  }

  private pendingSteps = 0;

  /** Convert canvas-relative CSS pixels to world coordinates. */
  screenToWorld(px: number, py: number): { x: number; y: number } {
    const { w, h } = this.cssSize;
    return {
      x: this.camera.x + ((px / w) * 2 - 1) * (this.sim.halfW / this.camera.zoom),
      y: this.camera.y + (1 - (py / h) * 2) * (this.sim.halfH / this.camera.zoom),
    };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const { w, h } = this.cssSize;
    return {
      x: (((x - this.camera.x) * this.camera.zoom) / this.sim.halfW + 1) * 0.5 * w,
      y: (1 - ((y - this.camera.y) * this.camera.zoom) / this.sim.halfH) * 0.5 * h,
    };
  }

  /** world units per CSS pixel */
  get worldPerPixel(): number {
    return (this.sim.halfH * 2) / this.camera.zoom / this.cssSize.h;
  }

  private pushTime(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastStoreTime < 66) return;
    this.lastStoreTime = now;
    const t = this.sim.time;
    const store = getStore();
    const audio = this.audio;
    const patch: any = {};
    if (Math.abs(store.state.time - t) > 1e-4) patch.time = t;
    if (audio.active || store.state.audio.active) {
      patch.audio = { active: audio.active, levels: [...audio.levels], source: audio.source };
    }
    if (this.recorder) patch.recording = { active: true, elapsed: (now - this.recordStart) / 1000, target: this.recordTarget };
    if (Object.keys(patch).length) store.set(patch);
  }

  private frame(): void {
    const r = this.renderer;
    if (!r) return;
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const st = getStore().state;
    const sim = this.sim;

    // interaction tool
    const tool = st.tool;
    sim.pointer.tool = tool === 'attract' || tool === 'repel' || tool === 'swirl' ? tool : 'none';
    sim.pointer.toolRadius = st.toolRadius;
    sim.pointer.toolStrength = st.toolStrength;

    this.audio.update();
    const t0 = performance.now();
    let steps = this.pendingSteps;
    this.pendingSteps = 0;
    if (st.playing) steps += sim.advance(dt, st.speed);
    const simMs = performance.now() - t0;
    const resync = this.resyncFlag || sim.lastStepTimes.some((t) => t < 0);
    this.resyncFlag = false;

    const need = sim.pool.capacity * RENDER_STRIDE;
    if (this.instances.length < need) this.instances = new Float32Array(need);
    const count = sim.writeRenderData(this.instances, this.groups);
    const L = sim.rt.render.links;
    let links: { data: Float32Array; lines: number } | null = null;
    if (L.enabled && count > 1) {
      const lines = this.links.build(this.instances, Math.min(count, L.maxParticles), L.distance, L.opacity);
      links = { data: this.links.out, lines };
    }
    r.render({
      sim,
      instances: this.instances,
      count,
      groups: this.groups,
      steps,
      resync,
      dirty: this.dirtyFlag,
      camera: this.camera,
      links,
      time: now / 1000,
    });
    sim.lastStepTimes.length = 0;
    this.dirtyFlag = false;

    // screenshots must be read in the same task as the draw
    if (this.captureQueue.length) {
      const q = this.captureQueue;
      this.captureQueue = [];
      r.canvas.toBlob((b) => q.forEach((fn) => fn(b)), 'image/png');
    }

    // perf bookkeeping
    const p = this.perf;
    const frameMs = dt * 1000;
    p.frameMs += (frameMs - p.frameMs) * 0.1;
    p.fps = 1000 / Math.max(1, p.frameMs);
    p.simMs += (simMs - p.simMs) * 0.1;
    p.renderMs += (r.stats.renderMs - p.renderMs) * 0.1;
    p.particles = count;
    p.gpuParticles = r.stats.gpuParticles;
    p.history[p.head] = frameMs;
    p.head = (p.head + 1) % p.history.length;
    this.governQuality(frameMs);

    // recording
    if (this.recorder && (now - this.recordStart) / 1000 >= this.recordTarget && this.recordTarget > 0) this.stopRecording();

    this.pushTime();
    this.frameListeners.forEach((fn) => fn());
  }

  /** Adaptive resolution: trade pixels for frame rate on slower GPUs. */
  private governQuality(frameMs: number): void {
    if (getStore().state.quality !== 'auto' || document.hidden) return;
    if (frameMs > 24) {
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (frameMs < 14) {
      this.fastFrames++;
      this.slowFrames = Math.max(0, this.slowFrames - 1);
    }
    if (this.slowFrames > 45 && this.autoScale > 0.5) {
      this.autoScale = Math.max(0.5, this.autoScale - 0.125);
      this.slowFrames = 0;
      this.applyResolution();
      this.resyncFlag = true;
    } else if (this.fastFrames > 240 && this.autoScale < 1) {
      this.autoScale = Math.min(1, this.autoScale + 0.125);
      this.fastFrames = 0;
      this.applyResolution();
      this.resyncFlag = true;
    }
  }

  capturePng(): Promise<Blob | null> {
    return new Promise((resolve) => this.captureQueue.push(resolve));
  }

  get recording(): boolean {
    return !!this.recorder;
  }

  /** Record the canvas with MediaRecorder. seconds=0 records until stopped. */
  startRecording(seconds: number, fps = 60): Promise<Blob> {
    const canvas = this.renderer!.canvas;
    const stream = canvas.captureStream(fps);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 18_000_000 });
    this.recordChunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.recordChunks.push(e.data);
    this.recordStart = performance.now();
    this.recordTarget = seconds;
    const done = new Promise<Blob>((resolve) => (this.recordResolve = resolve));
    this.recorder.onstop = () => {
      const blob = new Blob(this.recordChunks, { type: mimeType || 'video/webm' });
      this.recordResolve?.(blob);
      this.recordResolve = null;
      getStore().set({ recording: { active: false, elapsed: 0, target: 0 } });
    };
    this.recorder.start(250);
    getStore().set({ recording: { active: true, elapsed: 0, target: seconds } });
    return done;
  }

  stopRecording(): void {
    const r = this.recorder;
    this.recorder = null;
    if (r && r.state !== 'inactive') r.stop();
  }
}

let host: EngineHost | null = null;

export function createEngine(scene: SceneConfig): EngineHost {
  host = new EngineHost(scene);
  return host;
}

export function engine(): EngineHost {
  if (!host) throw new Error('engine not created');
  return host;
}
