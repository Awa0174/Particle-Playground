import type { CurvePoint, GradientStop } from './types';

export const LUT_SIZE = 128;

export function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || '#ffffff').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/** Evaluate a gradient at t (linear light RGB + alpha). */
export function evalGradient(stops: GradientStop[], t: number): [number, number, number, number] {
  const s = [...stops].sort((a, b) => a.t - b.t);
  if (s.length === 0) return [1, 1, 1, 1];
  if (t <= s[0].t) {
    const c = hexToLinear(s[0].color);
    return [c[0], c[1], c[2], s[0].alpha];
  }
  const last = s[s.length - 1];
  if (t >= last.t) {
    const c = hexToLinear(last.color);
    return [c[0], c[1], c[2], last.alpha];
  }
  let k = 0;
  while (k < s.length - 2 && s[k + 1].t < t) k++;
  const a = s[k];
  const b = s[k + 1];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const ca = hexToLinear(a.color);
  const cb = hexToLinear(b.color);
  return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f, a.alpha + (b.alpha - a.alpha) * f];
}

/** Bake a gradient into a linear-light RGBA lookup table. */
export function bakeGradient(stops: GradientStop[], out = new Float32Array(LUT_SIZE * 4)): Float32Array {
  for (let i = 0; i < LUT_SIZE; i++) {
    const c = evalGradient(stops, i / (LUT_SIZE - 1));
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = c[3];
  }
  return out;
}

export function evalCurve(points: CurvePoint[], t: number): number {
  const p = points.length ? [...points].sort((a, b) => a.t - b.t) : [{ t: 0, v: 1 }];
  if (t <= p[0].t) return p[0].v;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  let k = 0;
  while (k < p.length - 2 && p[k + 1].t < t) k++;
  const a = p[k];
  const b = p[k + 1];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const sf = f * f * (3 - 2 * f); // smooth segments for organic curves
  return a.v + (b.v - a.v) * sf;
}

/** Bake a curve (t in 0..1) into a lookup table. */
export function bakeCurve(points: CurvePoint[], out = new Float32Array(LUT_SIZE)): Float32Array {
  for (let i = 0; i < LUT_SIZE; i++) out[i] = evalCurve(points, i / (LUT_SIZE - 1));
  return out;
}

export function gradientCss(stops: GradientStop[], minAlpha = 0.08): string {
  const s = [...stops].sort((a, b) => a.t - b.t);
  if (s.length === 1) s.push({ ...s[0], t: 1 });
  return `linear-gradient(90deg, ${s
    .map((st) => {
      const [r, g, b] = hexToRgb(st.color);
      return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${Math.max(minAlpha, st.alpha)}) ${(st.t * 100).toFixed(1)}%`;
    })
    .join(', ')})`;
}
