import type { RenderGroup, Simulation } from '../engine/Simulation';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface FrameInput {
  sim: Simulation;
  instances: Float32Array;
  count: number;
  groups: RenderGroup[];
  /** fixed simulation steps executed this frame (0 while paused) */
  steps: number;
  /** history jumped (seek / reset / loop) – trail buffers must be cleared */
  resync: boolean;
  /** config changed while paused – redraw without trails */
  dirty: boolean;
  camera: Camera;
  links: { data: Float32Array; lines: number } | null;
  time: number;
}

export interface RendererStats {
  backend: 'webgl2' | 'canvas2d';
  renderMs: number;
  gpuParticles: number;
  drawCalls: number;
  hdr: boolean;
  width: number;
  height: number;
}

export interface IRenderer {
  readonly kind: 'webgl2' | 'canvas2d';
  readonly canvas: HTMLCanvasElement;
  stats: RendererStats;
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  render(frame: FrameInput): void;
  dispose(): void;
}
