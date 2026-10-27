import { RENDER_STRIDE } from './Simulation';

/**
 * "Plexus" connections: links nearby particles with lines whose opacity
 * fades with distance. Uses a uniform hash grid over the render buffer.
 * Output vertices: x y r g b a (two per line).
 */
export class LinkBuilder {
  private cellStart = new Int32Array(0);
  private sorted = new Int32Array(0);
  private cellOf = new Int32Array(0);
  out = new Float32Array(0);

  build(inst: Float32Array, count: number, maxDist: number, opacity: number, maxLines = 60000): number {
    const n = count;
    if (n < 2 || maxDist <= 0) return 0;
    if (this.out.length < maxLines * 12) this.out = new Float32Array(maxLines * 12);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = inst[i * RENDER_STRIDE];
      const y = inst[i * RENDER_STRIDE + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const h = maxDist;
    const cols = Math.min(512, Math.max(1, Math.ceil((maxX - minX) / h) + 1));
    const rows = Math.min(512, Math.max(1, Math.ceil((maxY - minY) / h) + 1));
    const cells = cols * rows;
    if (this.cellStart.length < cells + 1) this.cellStart = new Int32Array(cells + 1);
    if (this.sorted.length < n) {
      this.sorted = new Int32Array(n);
      this.cellOf = new Int32Array(n);
    }
    const start = this.cellStart;
    start.fill(0, 0, cells + 1);
    const inv = 1 / h;
    for (let i = 0; i < n; i++) {
      const cx = Math.min(cols - 1, ((inst[i * RENDER_STRIDE] - minX) * inv) | 0);
      const cy = Math.min(rows - 1, ((inst[i * RENDER_STRIDE + 1] - minY) * inv) | 0);
      const c = cy * cols + cx;
      this.cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const cursor = start.slice(0, cells);
    for (let i = 0; i < n; i++) this.sorted[cursor[this.cellOf[i]]++] = i;

    const out = this.out;
    const h2 = h * h;
    let lines = 0;
    for (let i = 0; i < n && lines < maxLines; i++) {
      const oi = i * RENDER_STRIDE;
      const xi = inst[oi];
      const yi = inst[oi + 1];
      const ai = inst[oi + 9];
      if (ai < 0.02) continue;
      const c = this.cellOf[i];
      const cx = c % cols;
      const cy = (c / cols) | 0;
      // only look "forward" (half the neighbourhood) to avoid duplicate pairs
      for (let k = 0; k < 5 && lines < maxLines; k++) {
        const ox = k === 0 ? 0 : k === 1 ? 1 : k === 2 ? -1 : k === 3 ? 0 : 1;
        const oy = k === 0 ? 0 : k === 1 ? 0 : 1;
        const xx = cx + ox;
        const yy = cy + oy;
        if (xx < 0 || xx >= cols || yy >= rows) continue;
        const cc = yy * cols + xx;
        for (let s = start[cc]; s < start[cc + 1] && lines < maxLines; s++) {
          const j = this.sorted[s];
          if (k === 0 && j <= i) continue;
          const oj = j * RENDER_STRIDE;
          const dx = inst[oj] - xi;
          const dy = inst[oj + 1] - yi;
          const d2 = dx * dx + dy * dy;
          if (d2 >= h2) continue;
          const f = 1 - Math.sqrt(d2) / h;
          const a = f * f * opacity * Math.min(ai, inst[oj + 9]);
          const o = lines * 12;
          out[o] = xi;
          out[o + 1] = yi;
          out[o + 2] = inst[oi + 6];
          out[o + 3] = inst[oi + 7];
          out[o + 4] = inst[oi + 8];
          out[o + 5] = a;
          out[o + 6] = inst[oj];
          out[o + 7] = inst[oj + 1];
          out[o + 8] = inst[oj + 6];
          out[o + 9] = inst[oj + 7];
          out[o + 10] = inst[oj + 8];
          out[o + 11] = a;
          lines++;
        }
      }
    }
    return lines;
  }
}
