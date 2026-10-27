import type { ShapeConfig } from './types';
import { Rng, hashString } from './rng';

/** Reusable sample record – avoids allocations in the hot spawn loop. */
export interface ShapeSample {
  x: number;
  y: number;
  nx: number; // outward normal (local space)
  ny: number;
  r: number;
  g: number;
  b: number;
  colored: boolean;
}

export function makeSample(): ShapeSample {
  return { x: 0, y: 0, nx: 0, ny: 1, r: 1, g: 1, b: 1, colored: false };
}

/** A precomputed, shuffled set of points (local space, centred). */
export interface PointSet {
  count: number;
  xy: Float32Array;
  rgb: Float32Array | null;
  ready: boolean;
}

export interface Bolt {
  /** segments: x0,y0,x1,y1,weight */
  seg: Float32Array;
  count: number;
  cumulative: Float32Array;
  total: number;
}

const TAU = Math.PI * 2;
const pointSetCache = new Map<string, PointSet>();
const pending = new Set<string>();
let cacheListeners: (() => void)[] = [];

/** Notified when an async point set (image) finished loading. */
export function onShapeCacheChange(fn: () => void): () => void {
  cacheListeners.push(fn);
  return () => {
    cacheListeners = cacheListeners.filter((f) => f !== fn);
  };
}

function shapeKey(s: ShapeConfig, count: number): string {
  switch (s.type) {
    case 'text':
      return `text|${s.text}|${s.font}|${s.weight}|${s.width.toFixed(2)}|${s.height.toFixed(2)}|${count}`;
    case 'image':
      return `image|${hashString(s.image)}|${s.width.toFixed(2)}|${s.height.toFixed(2)}|${count}`;
    default:
      return `${s.type}|${s.radius}|${s.thickness}|${s.width}|${s.height}|${s.arms}|${s.turns}|${s.edgeOnly}|${s.jitter}|${count}`;
  }
}

function shuffleInPlace(arr: Float32Array, stride: number, rng: Rng, rgb: Float32Array | null): void {
  const n = arr.length / stride;
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    for (let k = 0; k < stride; k++) {
      const t = arr[i * stride + k];
      arr[i * stride + k] = arr[j * stride + k];
      arr[j * stride + k] = t;
    }
    if (rgb) {
      for (let k = 0; k < 3; k++) {
        const t = rgb[i * 3 + k];
        rgb[i * 3 + k] = rgb[j * 3 + k];
        rgb[j * 3 + k] = t;
      }
    }
  }
}

function canUseCanvas(): boolean {
  return typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
}

function createCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Rasterise text into a point cloud (world units, centred). */
function rasterText(s: ShapeConfig, count: number): PointSet {
  const pxPerUnit = Math.min(8, 1400 / Math.max(1, s.width));
  const W = Math.max(8, Math.round(s.width * pxPerUnit));
  const H = Math.max(8, Math.round(s.height * pxPerUnit));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return emptySet();
  const lines = (s.text || ' ').split('\\n').join('\n').split('\n');
  let fontSize = H / lines.length;
  ctx.font = `${s.weight} ${fontSize}px ${s.font}`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  fontSize = Math.min(fontSize * 0.86, (fontSize * W * 0.96) / widest);
  ctx.font = `${s.weight} ${fontSize}px ${s.font}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = fontSize * 1.08;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh));
  const data = ctx.getImageData(0, 0, W, H).data;
  const pts: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 110) pts.push((x + 0.5) / pxPerUnit - s.width / 2, s.height / 2 - (y + 0.5) / pxPerUnit);
    }
  }
  return finalizeRaster(pts, null, count, hashString(s.text), 1 / pxPerUnit);
}

function finalizeRaster(pts: number[], cols: number[] | null, count: number, seed: number, cell: number): PointSet {
  const n = pts.length / 2;
  if (n === 0) return emptySet();
  const xy = new Float32Array(pts);
  const rgb = cols ? new Float32Array(cols) : null;
  const rng = new Rng(seed);
  shuffleInPlace(xy, 2, rng, rgb);
  // expand / trim to requested count with sub-pixel jitter
  const out = new Float32Array(count * 2);
  const outRgb = rgb ? new Float32Array(count * 3) : null;
  for (let i = 0; i < count; i++) {
    const k = i % n;
    out[i * 2] = xy[k * 2] + (rng.next() - 0.5) * cell;
    out[i * 2 + 1] = xy[k * 2 + 1] + (rng.next() - 0.5) * cell;
    if (outRgb && rgb) {
      outRgb[i * 3] = rgb[k * 3];
      outRgb[i * 3 + 1] = rgb[k * 3 + 1];
      outRgb[i * 3 + 2] = rgb[k * 3 + 2];
    }
  }
  return { count, xy: out, rgb: outRgb, ready: true };
}

function emptySet(): PointSet {
  return { count: 1, xy: new Float32Array(2), rgb: null, ready: false };
}

function loadImageSet(s: ShapeConfig, count: number, key: string): void {
  if (pending.has(key) || typeof Image === 'undefined') return;
  pending.add(key);
  const img = new Image();
  img.onload = () => {
    const aspect = img.width / img.height;
    let w = s.width;
    let h = s.width / aspect;
    if (h > s.height) {
      h = s.height;
      w = h * aspect;
    }
    const pxPerUnit = Math.min(6, 360 / Math.max(w, h));
    const W = Math.max(4, Math.round(w * pxPerUnit));
    const H = Math.max(4, Math.round(h * pxPerUnit));
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const pts: number[] = [];
    const cols: number[] = [];
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const a = data[i + 3] / 255;
        const lum = (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255;
        // brighter pixels get more particles – gives a luminous, photographic result
        if (a > 0.4 && lum > 0.06 && (lum > 0.5 || ((x * 7 + y * 13) % 10) / 10 < lum * 2)) {
          pts.push((x + 0.5) / pxPerUnit - w / 2, h / 2 - (y + 0.5) / pxPerUnit);
          cols.push(lin(data[i]), lin(data[i + 1]), lin(data[i + 2]));
        }
      }
    }
    pointSetCache.set(key, finalizeRaster(pts, cols, count, hashString(s.image), 1 / pxPerUnit));
    pending.delete(key);
    cacheListeners.forEach((f) => f());
  };
  img.onerror = () => pending.delete(key);
  img.src = s.image;
}

/** Point cloud for a shape – used by text/image emission and formations. */
export function getPointSet(s: ShapeConfig, count = 4096): PointSet {
  const key = shapeKey(s, count);
  const hit = pointSetCache.get(key);
  if (hit) return hit;
  let set: PointSet;
  if (s.type === 'text') {
    if (!canUseCanvas()) return emptySet();
    set = rasterText(s, count);
  } else if (s.type === 'image') {
    if (!s.image) return emptySet();
    loadImageSet(s, count, key);
    return emptySet();
  } else {
    const rng = new Rng(hashString(key));
    const xy = new Float32Array(count * 2);
    const sm = makeSample();
    if (s.type === 'grid') {
      const cols = Math.max(1, Math.round(Math.sqrt((count * s.width) / Math.max(1, s.height))));
      const rows = Math.max(1, Math.ceil(count / cols));
      for (let i = 0; i < count; i++) {
        const cx = i % cols;
        const cy = Math.floor(i / cols);
        xy[i * 2] = (cols > 1 ? cx / (cols - 1) - 0.5 : 0) * s.width;
        xy[i * 2 + 1] = (rows > 1 ? cy / (rows - 1) - 0.5 : 0) * s.height;
      }
      shuffleInPlace(xy, 2, rng, null);
    } else {
      for (let i = 0; i < count; i++) {
        sampleGeometric(s, rng, sm);
        xy[i * 2] = sm.x;
        xy[i * 2 + 1] = sm.y;
      }
    }
    set = { count, xy, rgb: null, ready: true };
  }
  if (pointSetCache.size > 64) pointSetCache.clear();
  pointSetCache.set(key, set);
  return set;
}

function heartPoint(t: number, out: ShapeSample, scale: number): void {
  const st = Math.sin(t);
  out.x = 16 * st * st * st * scale;
  out.y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * scale + 2 * scale;
}

/** Sample a point (local space) on a geometric shape. */
export function sampleGeometric(s: ShapeConfig, rng: Rng, out: ShapeSample): void {
  out.colored = false;
  switch (s.type) {
    case 'point':
    case 'none': {
      out.x = 0;
      out.y = 0;
      const a = rng.next() * TAU;
      out.nx = Math.cos(a);
      out.ny = Math.sin(a);
      return;
    }
    case 'cone': {
      const r = s.radius * 0.15 * Math.sqrt(rng.next());
      const a = rng.next() * TAU;
      out.x = Math.cos(a) * r;
      out.y = Math.sin(a) * r;
      out.nx = 0;
      out.ny = 1;
      return;
    }
    case 'circle': {
      const a = rng.next() * TAU;
      const r = s.edgeOnly ? s.radius : s.radius * Math.sqrt(rng.next());
      out.nx = Math.cos(a);
      out.ny = Math.sin(a);
      out.x = out.nx * r;
      out.y = out.ny * r;
      return;
    }
    case 'ring': {
      const a = rng.next() * TAU;
      const inner = s.radius * (1 - Math.min(1, Math.max(0, s.thickness)));
      const r = Math.sqrt(inner * inner + rng.next() * (s.radius * s.radius - inner * inner));
      out.nx = Math.cos(a);
      out.ny = Math.sin(a);
      out.x = out.nx * r;
      out.y = out.ny * r;
      return;
    }
    case 'sphere': {
      // uniform on sphere surface, orthographic projection → shells look volumetric
      const z = rng.next() * 2 - 1;
      const a = rng.next() * TAU;
      const rr = Math.sqrt(1 - z * z);
      const shell = s.edgeOnly ? 1 : Math.cbrt(rng.next());
      out.nx = Math.cos(a) * rr;
      out.ny = Math.sin(a) * rr;
      out.x = out.nx * s.radius * shell;
      out.y = out.ny * s.radius * shell;
      const len = Math.hypot(out.nx, out.ny) || 1;
      out.nx /= len;
      out.ny /= len;
      return;
    }
    case 'rect': {
      if (s.edgeOnly) {
        const per = 2 * (s.width + s.height);
        let d = rng.next() * per;
        if (d < s.width) {
          out.x = d - s.width / 2;
          out.y = s.height / 2;
          out.nx = 0;
          out.ny = 1;
        } else if ((d -= s.width) < s.height) {
          out.x = s.width / 2;
          out.y = s.height / 2 - d;
          out.nx = 1;
          out.ny = 0;
        } else if ((d -= s.height) < s.width) {
          out.x = s.width / 2 - d;
          out.y = -s.height / 2;
          out.nx = 0;
          out.ny = -1;
        } else {
          d -= s.width;
          out.x = -s.width / 2;
          out.y = -s.height / 2 + d;
          out.nx = -1;
          out.ny = 0;
        }
      } else {
        out.x = (rng.next() - 0.5) * s.width;
        out.y = (rng.next() - 0.5) * s.height;
        out.nx = 0;
        out.ny = 1;
      }
      return;
    }
    case 'line': {
      // thickness doubles as wave amplitude (world units), turns = number of waves
      const u = rng.next() - 0.5;
      out.x = u * s.width;
      const k = s.turns * Math.PI * 2;
      out.y = s.thickness > 0.2 ? Math.sin(u * k) * s.thickness : 0;
      const slope = s.thickness > 0.2 ? (Math.cos(u * k) * s.thickness * k) / s.width : 0;
      const len = Math.hypot(slope, 1);
      out.nx = -slope / len;
      out.ny = 1 / len;
      return;
    }
    case 'spiral': {
      const arms = Math.max(1, Math.round(s.arms));
      const arm = rng.int(arms);
      const t = Math.pow(rng.next(), 0.75);
      const r = s.radius * t;
      const a = (arm / arms) * TAU + t * s.turns * TAU;
      const j = s.jitter * s.radius * (0.25 + t * 0.6);
      out.x = Math.cos(a) * r + rng.gauss() * j * 0.5;
      out.y = Math.sin(a) * r + rng.gauss() * j * 0.5;
      const len = Math.hypot(out.x, out.y) || 1;
      out.nx = out.x / len;
      out.ny = out.y / len;
      return;
    }
    case 'grid': {
      const cols = Math.max(2, Math.round(s.arms * 4));
      const rows = Math.max(2, Math.round((cols * s.height) / Math.max(1, s.width)));
      out.x = (rng.int(cols) / (cols - 1) - 0.5) * s.width;
      out.y = (rng.int(rows) / (rows - 1) - 0.5) * s.height;
      out.nx = 0;
      out.ny = 1;
      return;
    }
    case 'heart': {
      const scale = s.radius / 17;
      const t = rng.next() * TAU;
      heartPoint(t, out, scale);
      if (!s.edgeOnly) {
        const f = Math.sqrt(rng.next());
        out.x *= f;
        out.y = (out.y - 2 * scale) * f + 2 * scale * f;
      }
      const len = Math.hypot(out.x, out.y) || 1;
      out.nx = out.x / len;
      out.ny = out.y / len;
      return;
    }
    case 'star': {
      const points = Math.max(3, Math.round(s.arms));
      const inner = s.radius * Math.max(0.15, Math.min(0.95, s.thickness * 3));
      const seg = rng.int(points * 2);
      const f = rng.next();
      const a0 = (seg / (points * 2)) * TAU + Math.PI / 2;
      const a1 = ((seg + 1) / (points * 2)) * TAU + Math.PI / 2;
      const r0 = seg % 2 === 0 ? s.radius : inner;
      const r1 = seg % 2 === 0 ? inner : s.radius;
      let x = Math.cos(a0) * r0 * (1 - f) + Math.cos(a1) * r1 * f;
      let y = Math.sin(a0) * r0 * (1 - f) + Math.sin(a1) * r1 * f;
      if (!s.edgeOnly) {
        const k = Math.sqrt(rng.next());
        x *= k;
        y *= k;
      }
      out.x = x;
      out.y = y;
      const len = Math.hypot(x, y) || 1;
      out.nx = x / len;
      out.ny = y / len;
      return;
    }
    default: {
      out.x = 0;
      out.y = 0;
      out.nx = 0;
      out.ny = 1;
    }
  }
}

/** Sample any shape (including text / image / lightning). */
export function sampleShape(s: ShapeConfig, rng: Rng, out: ShapeSample, bolt: Bolt | null): void {
  if (s.type === 'text' || s.type === 'image') {
    const set = getPointSet(s, 8192);
    if (!set.ready) {
      sampleGeometric({ ...s, type: 'rect' }, rng, out);
      out.colored = false;
      return;
    }
    const k = rng.int(set.count);
    out.x = set.xy[k * 2];
    out.y = set.xy[k * 2 + 1];
    const a = rng.next() * TAU;
    out.nx = Math.cos(a);
    out.ny = Math.sin(a);
    if (set.rgb) {
      out.r = set.rgb[k * 3];
      out.g = set.rgb[k * 3 + 1];
      out.b = set.rgb[k * 3 + 2];
      out.colored = true;
    } else out.colored = false;
    return;
  }
  if (s.type === 'lightning') {
    out.colored = false;
    if (!bolt || bolt.count === 0) {
      out.x = 0;
      out.y = 0;
      out.nx = 0;
      out.ny = 1;
      return;
    }
    const target = rng.next() * bolt.total;
    // binary search cumulative lengths
    let lo = 0;
    let hi = bolt.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bolt.cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const o = lo * 5;
    const f = rng.next();
    out.x = bolt.seg[o] + (bolt.seg[o + 2] - bolt.seg[o]) * f;
    out.y = bolt.seg[o + 1] + (bolt.seg[o + 3] - bolt.seg[o + 1]) * f;
    const dx = bolt.seg[o + 2] - bolt.seg[o];
    const dy = bolt.seg[o + 3] - bolt.seg[o + 1];
    const len = Math.hypot(dx, dy) || 1;
    out.nx = -dy / len;
    out.ny = dx / len;
    return;
  }
  sampleGeometric(s, rng, out);
}

/**
 * Generate a branching lightning bolt by recursive midpoint displacement.
 * The bolt points "down" the local -y axis by default (rotation turns it).
 */
export function generateBolt(s: ShapeConfig, rng: Rng): Bolt {
  const segs: number[] = [];
  const rough = Math.max(0, s.roughness);
  const subdivide = (x0: number, y0: number, x1: number, y1: number, w: number, depth: number, branchBudget: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (depth <= 0 || len < 0.6) {
      segs.push(x0, y0, x1, y1, w);
      return;
    }
    const mx = (x0 + x1) / 2 - (dy / len) * rng.gauss() * len * rough * 0.18;
    const my = (y0 + y1) / 2 + (dx / len) * rng.gauss() * len * rough * 0.18;
    subdivide(x0, y0, mx, my, w, depth - 1, branchBudget);
    subdivide(mx, my, x1, y1, w, depth - 1, branchBudget);
    if (branchBudget > 0 && depth > 2 && rng.next() < 0.35) {
      const ang = Math.atan2(y1 - my, x1 - mx) + (rng.next() < 0.5 ? -1 : 1) * rng.range(0.35, 0.9);
      const bl = len * rng.range(0.35, 0.7);
      subdivide(mx, my, mx + Math.cos(ang) * bl, my + Math.sin(ang) * bl, w * 0.45, depth - 2, branchBudget - 1);
    }
  };
  const L = s.width;
  const ox = (rng.next() - 0.5) * s.jitter * L * 2;
  const endX = ox + rng.gauss() * L * 0.12;
  subdivide(ox, 0, endX, -L, 1, 7, Math.max(0, Math.round(s.branches)));
  const count = segs.length / 5;
  const seg = new Float32Array(segs);
  const cumulative = new Float32Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 5;
    total += Math.hypot(seg[o + 2] - seg[o], seg[o + 3] - seg[o + 1]) * (0.3 + seg[o + 4]);
    cumulative[i] = total;
  }
  return { seg, count, cumulative, total };
}
