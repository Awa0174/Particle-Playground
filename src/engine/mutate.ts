import type { GradientStop, SceneConfig } from './types';
import { Rng } from './rng';
import { hexToRgb, rgbToHex } from './color';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
}

export function hueShift(stops: GradientStop[], shift: number): GradientStop[] {
  return stops.map((s) => {
    const [h, sat, l] = rgbToHsl(...hexToRgb(s.color));
    const [r, g, b] = hslToRgb((h + shift + 1) % 1, sat, l);
    return { ...s, color: rgbToHex(r, g, b) };
  });
}

/**
 * "Evolve": derive a related variation of a scene. Numeric parameters are
 * jittered multiplicatively, palettes are hue-rotated as a whole so the
 * colour harmony survives, and structural choices occasionally flip.
 */
export function mutateScene(scene: SceneConfig, amount: number, seed: number): SceneConfig {
  const rng = new Rng(seed);
  const s: SceneConfig = JSON.parse(JSON.stringify(scene));
  const jit = (v: number, k = 1) => v * (1 + (rng.next() * 2 - 1) * amount * k);
  const hue = (rng.next() * 2 - 1) * amount * 0.5;
  s.seed = Math.floor(rng.next() * 1e6);
  s.name = scene.name.replace(/ · Var\. \d+$/, '') + ` · Var. ${Math.floor(rng.next() * 900 + 100)}`;
  for (const e of s.emitters) {
    e.rate = Math.max(0, jit(e.rate, 0.6));
    e.speed = [jit(e.speed[0]), jit(e.speed[1])];
    e.lifetime = [Math.max(0.05, jit(e.lifetime[0], 0.5)), Math.max(0.05, jit(e.lifetime[1], 0.5))];
    e.size = [Math.max(0.05, jit(e.size[0], 0.7)), Math.max(0.05, jit(e.size[1], 0.7))];
    e.spread = Math.min(360, Math.max(0, jit(e.spread, 0.5)));
    e.intensity = Math.max(0.1, jit(e.intensity, 0.4));
    e.stretch = Math.max(0, e.stretch + (rng.next() - 0.4) * amount);
    e.orbital = jit(e.orbital) + (rng.next() < amount * 0.2 ? (rng.next() - 0.5) * 20 : 0);
    e.rotationSpeed = jit(e.rotationSpeed);
    e.gradient = hueShift(e.gradient, hue + (rng.next() - 0.5) * amount * 0.1);
    if (rng.next() < amount * 0.15) {
      const sprites = ['glow', 'soft', 'spark', 'star', 'ring', 'bokeh'] as const;
      e.sprite = sprites[rng.int(sprites.length)];
    }
  }
  for (const f of s.forces) {
    f.strength = jit(f.strength, 0.8);
    f.radius = Math.max(0, jit(f.radius, 0.4));
    f.scale = Math.max(1, jit(f.scale, 0.5));
    f.speed = Math.max(0, jit(f.speed, 0.5));
    if (f.type === 'vortex' && rng.next() < amount * 0.3) f.strength *= -1;
  }
  s.render.bloom.intensity = Math.max(0, jit(s.render.bloom.intensity, 0.4));
  s.render.trails = Math.min(0.95, Math.max(0, s.render.trails + (rng.next() - 0.5) * amount * 0.6));
  s.render.chromatic = Math.max(0, jit(s.render.chromatic, 0.5));
  return s;
}
