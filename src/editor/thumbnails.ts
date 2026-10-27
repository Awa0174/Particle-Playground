import { RENDER_STRIDE, RenderGroup, Simulation } from '../engine/Simulation';
import type { SceneConfig } from '../engine/types';
import { LinkBuilder } from '../engine/links';
import { WebGLRenderer } from '../renderer/WebGLRenderer';

/**
 * Renders real preview images of scenes with the actual engine: a dedicated
 * offscreen renderer simulates each scene for a few seconds and captures one
 * frame. Results are cached in memory and localStorage.
 */
const CACHE_PREFIX = 'pp-thumb-v4:';
const memory = new Map<string, string>();
let renderer: WebGLRenderer | null = null;
let canvas: HTMLCanvasElement | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function cachedThumbnail(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const v = localStorage.getItem(CACHE_PREFIX + key);
    if (v) memory.set(key, v);
    return v;
  } catch {
    return null;
  }
}

function idle(): Promise<void> {
  return new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 16)));
}

export function renderThumbnail(key: string, scene: SceneConfig, seconds = 3.2, w = 384, h = 216): Promise<string> {
  const hit = cachedThumbnail(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    await idle();
    if (!canvas) {
      canvas = document.createElement('canvas');
      renderer = new WebGLRenderer(canvas);
    }
    const r = renderer!;
    r.resize(w, h, 1);
    const sim = new Simulation(scene, w / h);
    const steps = Math.round(seconds * 60);
    // simulate in slices so the UI stays responsive
    for (let i = 0; i < steps; i += 30) {
      for (let k = 0; k < 30 && i + k < steps; k++) sim.stepOnce();
      await idle();
    }
    const inst = new Float32Array(sim.pool.capacity * RENDER_STRIDE);
    const groups: RenderGroup[] = [];
    const count = sim.writeRenderData(inst, groups);
    const L = sim.rt.render.links;
    const lb = new LinkBuilder();
    const lines = L.enabled ? lb.build(inst, Math.min(count, L.maxParticles), L.distance, L.opacity) : 0;
    sim.lastStepTimes.length = 0;
    sim.lastStepTimes.push(-1);
    const trailsBackup = sim.rt.render.trails;
    sim.rt.render.trails = 0;
    r.render({ sim, instances: inst, count, groups, steps: 1, resync: true, dirty: true, camera: { x: 0, y: 0, zoom: 1 }, links: lines ? { data: lb.out, lines } : null, time: 0 });
    sim.rt.render.trails = trailsBackup;
    const url = canvas!.toDataURL('image/jpeg', 0.82);
    memory.set(key, url);
    try {
      localStorage.setItem(CACHE_PREFIX + key, url);
    } catch {
      /* quota – memory cache only */
    }
    return url;
  });
  queue = job.catch(() => undefined);
  return job;
}
