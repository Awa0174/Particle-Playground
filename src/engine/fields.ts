import { simplex3 } from './noise';
import type { FlowFieldData } from './types';

/**
 * Curl-noise velocity field baked onto a grid once per simulation step.
 * Sampling the grid is ~20x cheaper than evaluating noise per particle and
 * the result is divergence free, which gives the typical "smoke-like" flow.
 */
export class CurlGrid {
  cols = 0;
  rows = 0;
  x0 = 0;
  y0 = 0;
  invCell = 1;
  vx = new Float32Array(0);
  vy = new Float32Array(0);
  private psi = new Float32Array(0);

  update(scale: number, time: number, octaves: number, seed: number, halfW: number, halfH: number): void {
    const margin = scale * 0.5;
    const w = (halfW + margin) * 2;
    const h = (halfH + margin) * 2;
    let cell = Math.max(0.5, scale / 3.5);
    // keep the grid bounded no matter how small the feature size is
    while ((w / cell) * (h / cell) > 9000) cell *= 1.15;
    const cols = Math.ceil(w / cell) + 1;
    const rows = Math.ceil(h / cell) + 1;
    if (cols * rows !== this.vx.length) {
      this.vx = new Float32Array(cols * rows);
      this.vy = new Float32Array(cols * rows);
      this.psi = new Float32Array(cols * rows);
    }
    this.cols = cols;
    this.rows = rows;
    this.x0 = -halfW - margin;
    this.y0 = -halfH - margin;
    this.invCell = 1 / cell;
    const oct = Math.max(1, Math.min(4, Math.round(octaves)));
    const inv = 1 / Math.max(0.5, scale);
    const psi = this.psi;
    for (let j = 0; j < rows; j++) {
      const y = this.y0 + j * cell;
      for (let i = 0; i < cols; i++) {
        const x = this.x0 + i * cell;
        let v = 0;
        let amp = 1;
        let f = inv;
        for (let o = 0; o < oct; o++) {
          v += amp * simplex3(x * f + seed * 0.131, y * f - seed * 0.071, time + o * 19.19);
          amp *= 0.5;
          f *= 2.03;
        }
        psi[j * cols + i] = v;
      }
    }
    // curl = (dψ/dy, -dψ/dx), normalised by the feature scale
    const k = scale / (2 * cell) / 1.6;
    for (let j = 0; j < rows; j++) {
      const jm = j > 0 ? j - 1 : j;
      const jp = j < rows - 1 ? j + 1 : j;
      for (let i = 0; i < cols; i++) {
        const im = i > 0 ? i - 1 : i;
        const ip = i < cols - 1 ? i + 1 : i;
        const idx = j * cols + i;
        this.vx[idx] = (psi[jp * cols + i] - psi[jm * cols + i]) * k;
        this.vy[idx] = -(psi[j * cols + ip] - psi[j * cols + im]) * k;
      }
    }
  }
}

/** Painted vector field covering the viewport. */
export class FlowGrid {
  cols: number;
  rows: number;
  data: Float32Array;
  src = '';

  constructor(cols = 64, rows = 36) {
    this.cols = cols;
    this.rows = rows;
    this.data = new Float32Array(cols * rows * 2);
  }

  static fromData(d: FlowFieldData | null): FlowGrid {
    const g = new FlowGrid(d?.cols ?? 64, d?.rows ?? 36);
    if (d?.data) {
      const bytes = base64ToBytes(d.data);
      const n = Math.min(bytes.length, g.data.length);
      for (let i = 0; i < n; i++) g.data[i] = ((bytes[i] << 24) >> 24) / 127;
      g.src = d.data;
    }
    return g;
  }

  toData(): FlowFieldData {
    const bytes = new Uint8Array(this.data.length);
    for (let i = 0; i < this.data.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round(this.data[i] * 127))) & 255;
    const data = bytesToBase64(bytes);
    this.src = data;
    return { cols: this.cols, rows: this.rows, data };
  }

  /** Paint a stroke: (x,y) in grid units, direction (dx,dy) normalised. */
  paint(gx: number, gy: number, dx: number, dy: number, radius: number, erase = false): void {
    const r = Math.max(1, radius);
    const x0 = Math.max(0, Math.floor(gx - r));
    const x1 = Math.min(this.cols - 1, Math.ceil(gx + r));
    const y0 = Math.max(0, Math.floor(gy - r));
    const y1 = Math.min(this.rows - 1, Math.ceil(gy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - gx, y - gy) / r;
        if (d >= 1) continue;
        const w = (1 - d * d) * 0.35;
        const i = (y * this.cols + x) * 2;
        if (erase) {
          this.data[i] *= 1 - w * 2;
          this.data[i + 1] *= 1 - w * 2;
        } else {
          this.data[i] += (dx - this.data[i]) * w;
          this.data[i + 1] += (dy - this.data[i + 1]) * w;
        }
      }
    }
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
