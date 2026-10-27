import type { SceneConfig } from '../engine/types';
import { getPath, resolveTarget, setPath } from '../engine/tracks';

export type Band = 'bass' | 'mid' | 'high' | 'level';

export interface AudioMapping {
  id: string;
  band: Band;
  target: string;
  amount: number;
}

/**
 * Audio reactivity: microphone or audio file → FFT → four smoothed bands
 * that modulate any numeric scene parameter (multiplicatively, per step).
 */
export class AudioReactive {
  levels: [number, number, number, number] = [0, 0, 0, 0];
  mappings: AudioMapping[] = [];
  source = '';
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array = new Uint8Array(0);
  private stream: MediaStream | null = null;
  private element: HTMLAudioElement | null = null;
  private node: AudioNode | null = null;

  get active(): boolean {
    return !!this.analyser;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private connect(node: AudioNode, toSpeakers: boolean): void {
    const ctx = this.ensureCtx();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;
    node.connect(this.analyser);
    if (toSpeakers) this.analyser.connect(ctx.destination);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.node = node;
  }

  async startMic(): Promise<void> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
    this.connect(this.ensureCtx().createMediaStreamSource(this.stream), false);
    this.source = 'Mikrofon';
  }

  startFile(file: File): void {
    this.stop();
    const el = new Audio(URL.createObjectURL(file));
    el.loop = true;
    el.crossOrigin = 'anonymous';
    void el.play();
    this.element = el;
    this.connect(this.ensureCtx().createMediaElementSource(el), true);
    this.source = file.name;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.element) {
      this.element.pause();
      URL.revokeObjectURL(this.element.src);
      this.element = null;
    }
    this.node?.disconnect();
    this.node = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.levels = [0, 0, 0, 0];
    this.source = '';
  }

  /** Sample the spectrum – call once per rendered frame. */
  update(): void {
    if (!this.analyser || !this.ctx) return;
    this.analyser.getByteFrequencyData(this.data);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(this.data.length - 1, Math.ceil(hi / binHz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.data[i];
      return sum / ((b - a + 1) * 255);
    };
    const raw: [number, number, number, number] = [band(20, 160), band(160, 2000), band(2000, 10000), band(20, 10000)];
    // fast attack, slower release → punchy but smooth
    for (let i = 0; i < 4; i++) {
      const k = raw[i] > this.levels[i] ? 0.6 : 0.12;
      this.levels[i] += (raw[i] - this.levels[i]) * k;
    }
  }

  /** Apply mappings to the runtime scene (base values come from the authored scene). */
  apply(runtime: SceneConfig, authored: SceneConfig): boolean {
    if (!this.active || this.mappings.length === 0) return false;
    const idx: Record<Band, number> = { bass: 0, mid: 1, high: 2, level: 3 };
    for (const m of this.mappings) {
      const rt = resolveTarget(runtime, m.target);
      const base = resolveTarget(authored, m.target);
      if (!rt || !base) continue;
      const v = getPath(base.obj, base.path);
      if (typeof v !== 'number') continue;
      const lvl = Math.min(1, this.levels[idx[m.band]] * 1.6);
      setPath(rt.obj, rt.path, v * (1 + m.amount * lvl) + (v === 0 ? m.amount * lvl : 0));
    }
    return true;
  }
}
