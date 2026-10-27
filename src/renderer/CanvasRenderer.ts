import { RENDER_STRIDE } from '../engine/Simulation';
import type { FrameInput, IRenderer, RendererStats } from './types';

const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255)));

/**
 * Canvas 2D fallback for devices without WebGL2. Proves the renderer
 * abstraction: the simulation is untouched, only the presentation differs.
 * No HDR, bloom or GPU swarm – but additive blending and trails still work.
 */
export class CanvasRenderer implements IRenderer {
  readonly kind = 'canvas2d' as const;
  readonly canvas: HTMLCanvasElement;
  stats: RendererStats = { backend: 'canvas2d', renderMs: 0, gpuParticles: 0, drawCalls: 0, hdr: false, width: 0, height: 0 };
  private ctx: CanvasRenderingContext2D;
  private sprite: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.sprite = document.createElement('canvas');
    this.sprite.width = this.sprite.height = 64;
    const s = this.sprite.getContext('2d')!;
    const g = s.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    s.fillStyle = g;
    s.fillRect(0, 0, 64, 64);
  }

  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    const r = Math.min(pixelRatio, 1.5);
    this.canvas.width = Math.max(1, Math.round(cssWidth * r));
    this.canvas.height = Math.max(1, Math.round(cssHeight * r));
    this.stats.width = this.canvas.width;
    this.stats.height = this.canvas.height;
  }

  render(f: FrameInput): void {
    const t0 = performance.now();
    const ctx = this.ctx;
    const { width: W, height: H } = this.canvas;
    const sim = f.sim;
    const bg = sim.rt.background;
    const trails = sim.rt.render.trails;
    ctx.globalCompositeOperation = 'source-over';
    if (trails > 0 && f.steps > 0 && !f.resync) {
      ctx.globalAlpha = 1 - Math.pow(trails, f.steps);
      ctx.fillStyle = bg.bottom;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    } else if (trails === 0 || f.resync || f.dirty) {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, bg.top);
      grad.addColorStop(1, bg.bottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    const scale = (H / (sim.halfH * 2)) * f.camera.zoom;
    const cx = W / 2 - f.camera.x * scale;
    const cy = H / 2 + f.camera.y * scale;
    ctx.globalCompositeOperation = 'lighter';
    const d = f.instances;
    for (const g of f.groups) {
      ctx.globalCompositeOperation = g.emitter.blend === 'normal' ? 'source-over' : 'lighter';
      for (let k = 0; k < g.count; k++) {
        const o = (g.offset + k) * RENDER_STRIDE;
        const a = d[o + 9];
        if (a < 0.01) continue;
        const size = Math.max(1, d[o + 4] * scale * 1.6);
        const x = cx + d[o] * scale;
        const y = cy - d[o + 1] * scale;
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillStyle = `rgb(${toByte(d[o + 6])},${toByte(d[o + 7])},${toByte(d[o + 8])})`;
        if (size < 4) ctx.fillRect(x - size / 2, y - size / 2, size, size);
        else {
          ctx.beginPath();
          ctx.arc(x, y, size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.stats.drawCalls = f.count;
    this.stats.renderMs = performance.now() - t0;
  }

  dispose(): void {
    /* nothing to release */
  }
}
