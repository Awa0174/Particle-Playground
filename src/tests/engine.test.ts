import { describe, expect, it } from 'vitest';
import { Rng } from '../engine/rng';
import { Simulation, DT } from '../engine/Simulation';
import { makeEmitter, makeForce, makeScene, makeShape } from '../engine/defaults';
import { bakeCurve, bakeGradient, evalGradient, LUT_SIZE } from '../engine/color';
import { applyTracks, evalTrack } from '../engine/tracks';
import { mutateScene } from '../engine/mutate';
import { CurlGrid } from '../engine/fields';
import { PRESETS } from '../presets';

function fountain(seed = 7) {
  return makeScene({
    seed,
    emitters: [
      makeEmitter({ id: 'a', rate: 500, shape: makeShape('circle', { radius: 3 }), speed: [10, 30], lifetime: [1, 2] }),
      makeEmitter({ id: 'b', rate: 0, bursts: [{ time: 0.5, count: 300, interval: 0.7, jitter: 0.5 }] }),
    ],
    forces: [makeForce('gravity', { strength: 20 }), makeForce('turbulence', { strength: 15 }), makeForce('bounds', { mode: 'bounce' })],
  });
}

function fingerprint(sim: Simulation): number {
  const p = sim.pool;
  let h = p.count;
  for (let i = 0; i < p.count; i++) h = (h * 31 + Math.round(p.px[i] * 1000) + Math.round(p.py[i] * 1000) * 7) | 0;
  return h;
}

describe('Rng', () => {
  it('is reproducible for a seed and different across seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 10 }, () => a.next());
    expect(sa).toEqual(Array.from({ length: 10 }, () => b.next()));
    expect(sa).not.toEqual(Array.from({ length: 10 }, () => c.next()));
    sa.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    sa.forEach((v) => expect(v).toBeLessThan(1));
  });

  it('can snapshot and restore its state', () => {
    const r = new Rng(9);
    r.next();
    const s = r.getState();
    const x = r.next();
    r.setState(s);
    expect(r.next()).toBe(x);
  });
});

describe('Simulation', () => {
  it('is deterministic for identical scenes and seeds', () => {
    const scene = fountain();
    const a = new Simulation(scene);
    const b = new Simulation(structuredClone(scene));
    for (let i = 0; i < 240; i++) {
      a.stepOnce();
      b.stepOnce();
    }
    expect(a.pool.count).toBeGreaterThan(100);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('produces a different history for a different seed', () => {
    const a = new Simulation(fountain(1));
    const b = new Simulation(fountain(2));
    for (let i = 0; i < 120; i++) {
      a.stepOnce();
      b.stepOnce();
    }
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('seeking backwards reproduces the exact state (snapshot time travel)', () => {
    const live = new Simulation(fountain());
    for (let i = 0; i < 150; i++) live.stepOnce();
    const at150 = fingerprint(live);
    for (let i = 0; i < 200; i++) live.stepOnce(); // move on
    live.seek(150 * DT);
    expect(live.frame).toBe(150);
    expect(fingerprint(live)).toBe(at150);
  });

  it('runs at a fixed timestep independent of the frame rate', () => {
    const scene = fountain();
    const a = new Simulation(scene);
    const b = new Simulation(structuredClone(scene));
    for (let i = 0; i < 60; i++) a.advance(1 / 60); // 60 Hz display
    for (let i = 0; i < 30; i++) b.advance(1 / 30); // 30 Hz display
    expect(a.frame).toBe(b.frame);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('respects per-emitter limits and pool capacity', () => {
    const s = makeScene({ maxParticles: 2000, emitters: [makeEmitter({ rate: 0, maxParticles: 500, bursts: [{ time: 0, count: 5000, interval: 0, jitter: 0 }], lifetime: [10, 10] })] });
    const sim = new Simulation(s);
    sim.stepOnce();
    expect(sim.pool.count).toBe(500);
  });

  it('fires death sub-emitters', () => {
    const s = makeScene({
      emitters: [
        makeEmitter({ id: 'rocket', rate: 0, bursts: [{ time: 0, count: 10, interval: 0, jitter: 0 }], lifetime: [0.2, 0.2], subEmitters: [{ trigger: 'death', target: 'spark', count: 20, rate: 0, inherit: 0, chance: 1 }] }),
        makeEmitter({ id: 'spark', rate: 0, lifetime: [5, 5] }),
      ],
    });
    const sim = new Simulation(s);
    for (let i = 0; i < 30; i++) sim.stepOnce();
    expect(sim.emitterCount(0)).toBe(0);
    expect(sim.emitterCount(1)).toBe(200);
  });

  it('attractor event horizon removes particles', () => {
    const s = makeScene({
      emitters: [makeEmitter({ rate: 0, bursts: [{ time: 0, count: 200, interval: 0, jitter: 0 }], shape: makeShape('circle', { radius: 2 }), speed: [0, 0], lifetime: [100, 100] })],
      forces: [makeForce('attractor', { killRadius: 5, strength: 10 })],
    });
    const sim = new Simulation(s);
    sim.stepOnce();
    sim.stepOnce();
    expect(sim.pool.count).toBe(0);
  });

  it('keeps live particles when parameters change (non-destructive editing)', () => {
    const scene = fountain();
    const sim = new Simulation(scene);
    for (let i = 0; i < 60; i++) sim.stepOnce();
    const n = sim.pool.count;
    sim.setScene({ ...scene, emitters: scene.emitters.map((e) => ({ ...e, intensity: 3 })) });
    expect(sim.pool.count).toBe(n);
    // removing an emitter drops exactly its particles
    const bCount = sim.emitterCount(1);
    sim.setScene({ ...scene, emitters: [scene.emitters[0]] });
    expect(sim.pool.count).toBe(n - bCount);
  });

  it('every built-in preset simulates without NaNs', () => {
    for (const p of PRESETS) {
      const sim = new Simulation(p.build());
      for (let i = 0; i < 90; i++) sim.stepOnce();
      const px = sim.pool.px.subarray(0, sim.pool.count);
      expect(px.every((v) => Number.isFinite(v)), p.id).toBe(true);
    }
  });
});

describe('colour & curves', () => {
  it('bakes gradients in linear light', () => {
    const lut = bakeGradient([
      { t: 0, color: '#000000', alpha: 0 },
      { t: 1, color: '#ffffff', alpha: 1 },
    ]);
    expect(lut.length).toBe(LUT_SIZE * 4);
    expect(lut[0]).toBe(0);
    expect(lut[(LUT_SIZE - 1) * 4]).toBeCloseTo(1, 5);
    expect(lut[(LUT_SIZE - 1) * 4 + 3]).toBeCloseTo(1, 5);
    const mid = evalGradient([{ t: 0, color: '#808080', alpha: 1 }], 0.5);
    expect(mid[0]).toBeCloseTo(0.2159, 3); // sRGB 0.5 → linear ≈ 0.216
  });

  it('bakes curves with clamped ends', () => {
    const c = bakeCurve([
      { t: 0.2, v: 0 },
      { t: 0.8, v: 2 },
    ]);
    expect(c[0]).toBe(0);
    expect(c[LUT_SIZE - 1]).toBe(2);
  });
});

describe('keyframe tracks', () => {
  it('evaluates eased keys and writes them into the runtime scene', () => {
    const scene = makeScene({ emitters: [makeEmitter({ id: 'e1', rate: 10 })] });
    const track = {
      id: 't',
      target: 'emitter:e1:rate',
      keys: [
        { t: 0, v: 0, ease: 'linear' as const },
        { t: 2, v: 100, ease: 'linear' as const },
      ],
    };
    expect(evalTrack(track, 1)).toBe(50);
    expect(evalTrack(track, 5)).toBe(100);
    applyTracks(scene, [track], 1.5);
    expect(scene.emitters[0].rate).toBe(75);
  });
});

describe('curl noise', () => {
  it('produces a bounded, non-zero divergence-free field', () => {
    const g = new CurlGrid();
    g.update(20, 0.5, 2, 1, 80, 50);
    let max = 0;
    let div = 0;
    for (let j = 1; j < g.rows - 1; j++)
      for (let i = 1; i < g.cols - 1; i++) {
        const k = j * g.cols + i;
        max = Math.max(max, Math.hypot(g.vx[k], g.vy[k]));
        div += Math.abs(g.vx[k + 1] - g.vx[k - 1] + g.vy[k + g.cols] - g.vy[k - g.cols]);
      }
    expect(max).toBeGreaterThan(0.1);
    expect(max).toBeLessThan(10);
    // central-difference divergence of a discrete curl is ~0
    expect(div / (g.rows * g.cols)).toBeLessThan(0.05);
  });
});

describe('mutation', () => {
  it('creates a valid, different variation deterministically', () => {
    const base = PRESETS[0].build();
    const a = mutateScene(base, 0.4, 123);
    const b = mutateScene(base, 0.4, 123);
    expect(a).toEqual(b);
    expect(a.seed).not.toBe(base.seed);
    expect(a.emitters.length).toBe(base.emitters.length);
    a.emitters.forEach((e) => e.gradient.forEach((s) => expect(s.color).toMatch(/^#[0-9a-f]{6}$/)));
  });
});
