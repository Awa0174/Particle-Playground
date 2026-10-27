import type { EmitterConfig, ForceConfig, SceneConfig } from './types';
import { WORLD_HEIGHT } from './types';
import { Rng, hash01, hashString } from './rng';
import { noise1 } from './noise';
import { LUT_SIZE, bakeCurve, bakeGradient } from './color';
import { applyTracks } from './tracks';
import { cloneScene } from './defaults';
import { Bolt, PointSet, generateBolt, getPointSet, makeSample, sampleShape } from './shapes';
import { CurlGrid, FlowGrid } from './fields';

/** Fixed simulation step – physics is independent from the display refresh rate. */
export const DT = 1 / 60;
export const RENDER_STRIDE = 10; // x y vx vy size rot r g b a
const MAX_STEPS_PER_FRAME = 4;
const DEG = Math.PI / 180;

/** Structure-of-arrays particle pool. Dead particles are swap-removed so the live range is dense. */
export class ParticlePool {
  readonly capacity: number;
  count = 0;
  px: Float32Array;
  py: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  ax: Float32Array;
  ay: Float32Array;
  age: Float32Array;
  life: Float32Array;
  size: Float32Array;
  rot: Float32Array;
  spin: Float32Array;
  rnd: Float32Array;
  cr: Float32Array;
  cg: Float32Array;
  cb: Float32Array;
  em: Uint16Array;
  home: Int32Array;
  flags: Uint8Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.vx = f();
    this.vy = f();
    this.ax = f();
    this.ay = f();
    this.age = f();
    this.life = f();
    this.size = f();
    this.rot = f();
    this.spin = f();
    this.rnd = f();
    this.cr = f();
    this.cg = f();
    this.cb = f();
    this.em = new Uint16Array(capacity);
    this.home = new Int32Array(capacity);
    this.flags = new Uint8Array(capacity);
  }

  /** Copy particle src into slot dst. */
  move(dst: number, src: number): void {
    this.px[dst] = this.px[src];
    this.py[dst] = this.py[src];
    this.vx[dst] = this.vx[src];
    this.vy[dst] = this.vy[src];
    this.ax[dst] = this.ax[src];
    this.ay[dst] = this.ay[src];
    this.age[dst] = this.age[src];
    this.life[dst] = this.life[src];
    this.size[dst] = this.size[src];
    this.rot[dst] = this.rot[src];
    this.spin[dst] = this.spin[src];
    this.rnd[dst] = this.rnd[src];
    this.cr[dst] = this.cr[src];
    this.cg[dst] = this.cg[src];
    this.cb[dst] = this.cb[src];
    this.em[dst] = this.em[src];
    this.home[dst] = this.home[src];
    this.flags[dst] = this.flags[src];
  }

  floatArrays(): Float32Array[] {
    return [this.px, this.py, this.vx, this.vy, this.age, this.life, this.size, this.rot, this.spin, this.rnd, this.cr, this.cg, this.cb];
  }
}

interface EmitterState {
  id: string;
  acc: number;
  burstNext: number[];
  homeCounter: number;
  bolt: Bolt | null;
  prevX: number;
  prevY: number;
  gradient: Float32Array;
  sizeLut: Float32Array;
  formSets: (PointSet | null)[];
  formK: number;
  subs: { trigger: string; target: number; count: number; rate: number; inherit: number; chance: number }[];
  rot: number;
  cos: number;
  sin: number;
}

interface PreparedForce {
  cfg: ForceConfig;
  mask: Uint8Array;
  all: boolean;
  strength: number;
  grid: CurlGrid | null;
  flow: FlowGrid | null;
  dirX: number;
  dirY: number;
  px: number;
  py: number;
  /** pointer forces are transient and not part of the deterministic history */
  transient: boolean;
}

interface Snapshot {
  frame: number;
  count: number;
  floats: Float32Array[];
  em: Uint16Array;
  home: Int32Array;
  flags: Uint8Array;
  rng: [number, number, number, number];
  emitters: { acc: number; burstNext: number[]; homeCounter: number; bolt: Bolt | null; prevX: number; prevY: number }[];
  bytes: number;
}

export interface RenderGroup {
  emitter: EmitterConfig;
  index: number;
  offset: number;
  count: number;
}

export interface PointerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  inside: boolean;
  down: boolean;
  /** temporary interaction tool driven by the editor */
  tool: 'none' | 'attract' | 'repel' | 'swirl';
  toolStrength: number;
  toolRadius: number;
}

export interface SimStats {
  stepMs: number;
  steps: number;
  count: number;
  snapshots: number;
  snapshotMB: number;
}

export class Simulation {
  scene: SceneConfig;
  rt: SceneConfig;
  pool: ParticlePool;
  rng = new Rng(1);
  frame = 0;
  aspect = 16 / 9;
  pointer: PointerState = { x: 0, y: 0, vx: 0, vy: 0, inside: false, down: false, tool: 'none', toolStrength: 150, toolRadius: 16 };
  stats: SimStats = { stepMs: 0, steps: 0, count: 0, snapshots: 0, snapshotMB: 0 };
  /** tau (internal time) of each step executed during the last advance() – consumed by the GPU swarm */
  lastStepTimes: number[] = [];
  /** set when the deterministic history changed (pointer, painting, audio) */
  diverged = false;
  /** live modulation hook (audio reactivity) – returns true if it changed anything */
  modulate: ((runtime: SceneConfig, authored: SceneConfig) => boolean) | null = null;

  private states: EmitterState[] = [];
  private forces: PreparedForce[] = [];
  private colliders: PreparedForce[] = [];
  private bounds: PreparedForce | null = null;
  private grids = new Map<string, CurlGrid>();
  private flows = new Map<string, FlowGrid>();
  private accumulator = 0;
  private snapshots = new Map<number, Snapshot>();
  private snapshotBytes = 0;
  private sample = makeSample();
  private emCount = new Int32Array(1024);
  private subQueue = new Float32Array(8192 * 6);
  private subQueueLen = 0;
  private hashCellStart = new Int32Array(0);
  private hashSorted = new Int32Array(0);
  private hashCellOf = new Int32Array(0);
  private pointerForce: PreparedForce;

  constructor(scene: SceneConfig, aspect = 16 / 9) {
    this.scene = scene;
    this.aspect = aspect;
    this.pool = new ParticlePool(Math.max(1000, scene.maxParticles));
    this.rt = cloneScene(scene);
    this.pointerForce = {
      cfg: { type: 'pointer' } as ForceConfig,
      mask: new Uint8Array(0),
      all: true,
      strength: 0,
      grid: null,
      flow: null,
      dirX: 0,
      dirY: 0,
      px: 0,
      py: 0,
      transient: true,
    };
    this.rebuild();
    this.reset();
  }

  // ───────────────────────────── configuration ─────────────────────────────

  get halfW(): number {
    return (WORLD_HEIGHT * this.aspect) / 2;
  }

  get halfH(): number {
    return WORLD_HEIGHT / 2;
  }

  get prewarmFrames(): number {
    return Math.max(0, Math.round((this.scene.prewarm || 0) / DT));
  }

  /** Visible timeline time (excludes prewarm). */
  get time(): number {
    return (this.frame - this.prewarmFrames) * DT;
  }

  /** Internal time used for emission. */
  get tau(): number {
    return this.frame * DT;
  }

  setAspect(aspect: number): void {
    if (Math.abs(aspect - this.aspect) < 1e-4) return;
    this.aspect = aspect;
    this.invalidateSnapshots();
  }

  /**
   * Swap in a new scene. Live particles survive (so slider edits feel
   * immediate); particles of removed emitters are discarded.
   */
  setScene(scene: SceneConfig): void {
    const prev = this.scene;
    this.scene = scene;
    if (scene.maxParticles !== prev.maxParticles && scene.maxParticles > 0) {
      this.pool = new ParticlePool(Math.max(1000, scene.maxParticles));
      this.rt = cloneScene(scene);
      this.rebuild();
      this.reset();
      return;
    }
    // remap emitter indices of live particles
    const oldIds = prev.emitters.map((e) => e.id);
    const newIndex = new Map(scene.emitters.map((e, i) => [e.id, i] as const));
    const remap = oldIds.map((id) => newIndex.get(id) ?? -1);
    const oldStates = new Map(this.states.map((s) => [s.id, s] as const));
    const changedOrder = oldIds.length !== scene.emitters.length || remap.some((v, i) => v !== i);
    if (changedOrder) {
      const p = this.pool;
      for (let i = p.count - 1; i >= 0; i--) {
        const ni = remap[p.em[i]] ?? -1;
        if (ni < 0) {
          p.count--;
          if (i !== p.count) p.move(i, p.count);
        } else p.em[i] = ni;
      }
    }
    this.rt = cloneScene(scene);
    this.rebuild(oldStates);
    this.invalidateSnapshots();
    if (prev.seed !== scene.seed || prev.prewarm !== scene.prewarm) this.reset();
  }

  private rebuild(oldStates?: Map<string, EmitterState>): void {
    const sc = this.rt;
    this.states = sc.emitters.map((e) => {
      const old = oldStates?.get(e.id);
      const cr = Math.cos(e.rotation * DEG);
      const sr = Math.sin(e.rotation * DEG);
      const st: EmitterState = {
        id: e.id,
        acc: old?.acc ?? 0,
        burstNext: e.bursts.map((b, i) => old?.burstNext[i] ?? b.time),
        homeCounter: old?.homeCounter ?? 0,
        bolt: old?.bolt ?? null,
        prevX: old?.prevX ?? e.position.x,
        prevY: old?.prevY ?? e.position.y,
        gradient: bakeGradient(e.gradient),
        sizeLut: bakeCurve(e.sizeCurve),
        formSets: [],
        formK: Math.max(1, Math.min(e.maxParticles, 24000)),
        subs: [],
        rot: e.rotation,
        cos: cr,
        sin: sr,
      };
      return st;
    });
    // resolve sub-emitter targets
    sc.emitters.forEach((e, i) => {
      this.states[i].subs = e.subEmitters
        .map((s) => ({ ...s, target: sc.emitters.findIndex((x) => x.id === s.target) }))
        .filter((s) => s.target >= 0 && s.target !== i);
    });
    // flow grids are kept alive while painting
    const liveFlows = new Map<string, FlowGrid>();
    for (const f of sc.forces) {
      if (f.type !== 'flowfield') continue;
      const existing = this.flows.get(f.id);
      if (existing && (!f.field || existing.src === f.field.data)) liveFlows.set(f.id, existing);
      else liveFlows.set(f.id, FlowGrid.fromData(f.field));
    }
    this.flows = liveFlows;
  }

  private invalidateSnapshots(): void {
    this.snapshots.clear();
    this.snapshotBytes = 0;
  }

  reset(): void {
    this.pool.count = 0;
    this.frame = 0;
    this.accumulator = 0;
    this.rng.seed(this.scene.seed);
    this.diverged = false;
    this.rt = cloneScene(this.scene);
    this.rebuild();
    for (const st of this.states) {
      st.acc = 0;
      st.homeCounter = 0;
      st.bolt = null;
    }
    this.rt.emitters.forEach((e, i) => {
      this.states[i].burstNext = e.bursts.map((b) => b.time);
      this.states[i].prevX = e.position.x;
      this.states[i].prevY = e.position.y;
    });
    this.emCount.fill(0);
    const warm = this.prewarmFrames;
    for (let i = 0; i < warm; i++) this.step();
    this.captureSnapshot(true);
    this.lastStepTimes.length = 0;
    this.lastStepTimes.push(-1);
  }

  // ─────────────────────────────── time control ───────────────────────────────

  /** Advance by real elapsed seconds using a fixed-step accumulator. */
  advance(realDt: number, speed = 1): number {
    this.lastStepTimes.length = 0;
    this.accumulator += Math.min(0.25, realDt) * speed;
    let steps = 0;
    const t0 = performance.now();
    while (this.accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= DT;
      this.lastStepTimes.push(this.tau);
      this.step();
      steps++;
      if (this.scene.loop && this.time >= this.scene.duration) {
        this.reset();
        this.lastStepTimes.length = 0;
        this.lastStepTimes.push(-1); // signals a reset to the GPU swarm
      }
      if (this.frame % 60 === 0) this.captureSnapshot(false);
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = Math.min(this.accumulator, DT);
    this.stats.stepMs = steps ? (performance.now() - t0) / steps : this.stats.stepMs;
    this.stats.steps = steps;
    this.stats.count = this.pool.count;
    return steps;
  }

  /** Single step forward (used by the step button). */
  stepOnce(): void {
    this.lastStepTimes.length = 0;
    this.lastStepTimes.push(this.tau);
    this.step();
  }

  /** Deterministic seek: restore nearest snapshot ≤ t and re-simulate. */
  seek(time: number): void {
    const target = Math.max(0, Math.round(time / DT) + this.prewarmFrames);
    this.lastStepTimes.length = 0;
    this.lastStepTimes.push(-2); // full re-sync signal for the GPU swarm
    if (target === this.frame && !this.diverged) return;
    const canContinue = !this.diverged && target >= this.frame;
    if (!(canContinue && target - this.frame < 90)) {
      let best: Snapshot | null = null;
      for (const s of this.snapshots.values()) if (s.frame <= target && (!best || s.frame > best.frame)) best = s;
      if (canContinue && (!best || best.frame <= this.frame)) {
        // current state is the closest valid starting point
      } else if (best) this.restore(best);
      else this.reset();
    }
    this.diverged = false;
    let guard = 0;
    while (this.frame < target && guard++ < 20000) {
      this.step();
      if (this.frame % 60 === 0) this.captureSnapshot(false);
    }
    this.accumulator = 0;
  }

  private captureSnapshot(force: boolean): void {
    // interaction makes the history non-reproducible – never store tainted states
    if (this.diverged) return;
    if (!force && this.snapshots.has(this.frame)) return;
    const p = this.pool;
    const n = p.count;
    const bytes = n * (13 * 4 + 2 + 4 + 1);
    if (!force && this.snapshotBytes + bytes > 160 * 1024 * 1024) return;
    const snap: Snapshot = {
      frame: this.frame,
      count: n,
      floats: p.floatArrays().map((a) => a.slice(0, n)),
      em: p.em.slice(0, n),
      home: p.home.slice(0, n),
      flags: p.flags.slice(0, n),
      rng: this.rng.getState(),
      emitters: this.states.map((s) => ({ acc: s.acc, burstNext: [...s.burstNext], homeCounter: s.homeCounter, bolt: s.bolt, prevX: s.prevX, prevY: s.prevY })),
      bytes,
    };
    const old = this.snapshots.get(this.frame);
    if (old) this.snapshotBytes -= old.bytes;
    this.snapshots.set(this.frame, snap);
    this.snapshotBytes += bytes;
    this.stats.snapshots = this.snapshots.size;
    this.stats.snapshotMB = this.snapshotBytes / 1048576;
  }

  private restore(s: Snapshot): void {
    const p = this.pool;
    const arrays = p.floatArrays();
    const n = Math.min(s.count, p.capacity);
    arrays.forEach((a, i) => a.set(s.floats[i].subarray(0, n)));
    p.em.set(s.em.subarray(0, n));
    p.home.set(s.home.subarray(0, n));
    p.flags.set(s.flags.subarray(0, n));
    p.count = n;
    this.frame = s.frame;
    this.rng.setState(s.rng);
    this.rt = cloneScene(this.scene);
    applyTracks(this.rt, this.scene.tracks, this.time);
    s.emitters.forEach((e, i) => {
      const st = this.states[i];
      if (!st) return;
      st.acc = e.acc;
      st.burstNext = [...e.burstNext];
      st.homeCounter = e.homeCounter;
      st.bolt = e.bolt;
      st.prevX = e.prevX;
      st.prevY = e.prevY;
    });
    this.recount();
  }

  private recount(): void {
    this.emCount.fill(0);
    const p = this.pool;
    for (let i = 0; i < p.count; i++) this.emCount[p.em[i]]++;
  }

  // ───────────────────────────────── stepping ─────────────────────────────────

  private step(): void {
    const tau = this.tau;
    const sc = this.rt;
    if (this.scene.tracks.length) applyTracks(sc, this.scene.tracks, Math.max(0, this.time));
    if (this.modulate && this.modulate(sc, this.scene)) this.diverged = true;
    // effective rotation (keyframes + continuous spin)
    for (let i = 0; i < sc.emitters.length; i++) {
      const e = sc.emitters[i];
      const st = this.states[i];
      st.rot = e.rotation + e.rotationSpeed * tau;
      st.cos = Math.cos(st.rot * DEG);
      st.sin = Math.sin(st.rot * DEG);
    }
    this.prepareForces(tau);

    // emission
    for (let ei = 0; ei < sc.emitters.length; ei++) {
      const e = sc.emitters[ei];
      const st = this.states[ei];
      if (e.enabled && e.backend === 'cpu' && tau >= e.start && (e.end < 0 || tau < e.end)) this.emit(ei, e, st, tau);
      st.prevX = e.position.x;
      st.prevY = e.position.y;
    }

    this.accumulateForces(tau);
    this.integrate(tau);
    this.flushSubQueue();
    this.frame++;
  }

  private emit(ei: number, e: EmitterConfig, st: EmitterState, tau: number): void {
    // bursts
    for (let b = 0; b < e.bursts.length; b++) {
      const burst = e.bursts[b];
      let guard = 0;
      while (tau >= st.burstNext[b] && guard++ < 8) {
        if (e.shape.type === 'lightning') st.bolt = generateBolt(e.shape, this.rng);
        this.spawn(ei, burst.count, NaN, NaN, 0, 0, false);
        if (burst.interval > 0) {
          const j = 1 + burst.jitter * (this.rng.next() * 2 - 1);
          st.burstNext[b] += Math.max(DT, burst.interval * j);
        } else st.burstNext[b] = Infinity;
      }
    }
    // continuous emission with sub-frame distribution
    if (e.rate > 0) {
      if (e.shape.type === 'lightning' && !st.bolt) st.bolt = generateBolt(e.shape, this.rng);
      st.acc += e.rate * DT;
      const n = Math.floor(st.acc);
      st.acc -= n;
      if (n > 0) this.spawn(ei, n, NaN, NaN, 0, 0, true);
    }
  }

  /**
   * Spawn particles for emitter ei. If ox/oy are numbers the shape is centred
   * there (sub-emitters, brush), otherwise at the emitter position.
   */
  spawn(ei: number, n: number, ox: number, oy: number, ivx: number, ivy: number, subFrame: boolean): void {
    const e = this.rt.emitters[ei];
    const st = this.states[ei];
    if (!e || !st) return;
    const p = this.pool;
    const rng = this.rng;
    const S = this.sample;
    const useOrigin = !Number.isNaN(ox);
    const cr = st.cos;
    const sr = st.sin;
    const dirBase = (e.direction + st.rot) * DEG;
    const spread = e.spread * DEG;
    const form = e.formation.enabled && e.formation.shapes.length > 0;
    const formSet = form ? this.formationSet(e, st, this.tau) : null;
    const formOffX = e.position.x;
    const formOffY = e.position.y;
    for (let k = 0; k < n; k++) {
      if (p.count >= p.capacity || this.emCount[ei] >= e.maxParticles) break;
      const i = p.count++;
      this.emCount[ei]++;
      const tauFrac = subFrame ? (k + 0.5) / n : 0;
      sampleShape(e.shape, rng, S, st.bolt);
      // rotate into world
      const lx = S.x * cr - S.y * sr;
      const ly = S.x * sr + S.y * cr;
      const nx = S.nx * cr - S.ny * sr;
      const ny = S.nx * sr + S.ny * cr;
      let bx: number;
      let by: number;
      if (useOrigin) {
        bx = ox;
        by = oy;
      } else {
        bx = st.prevX + (e.position.x - st.prevX) * tauFrac;
        by = st.prevY + (e.position.y - st.prevY) * tauFrac;
      }
      let x = bx + lx;
      let y = by + ly;
      // velocity
      const speed = e.speed[0] + (e.speed[1] - e.speed[0]) * rng.next();
      const jitter = (rng.next() - 0.5) * spread;
      let dx: number;
      let dy: number;
      switch (e.velocityMode) {
        case 'explode': {
          const r = Math.max(1e-3, e.shape.radius);
          dx = lx / r;
          dy = ly / r;
          break;
        }
        case 'radial':
        case 'inward':
        case 'normal':
        case 'tangential': {
          let rx = e.velocityMode === 'normal' ? nx : lx;
          let ry = e.velocityMode === 'normal' ? ny : ly;
          const len = Math.hypot(rx, ry);
          if (len < 1e-5) {
            rx = nx;
            ry = ny;
          } else {
            rx /= len;
            ry /= len;
          }
          if (e.velocityMode === 'inward') {
            rx = -rx;
            ry = -ry;
          } else if (e.velocityMode === 'tangential') {
            const t = rx;
            rx = -ry;
            ry = t;
          }
          const c = Math.cos(jitter);
          const s = Math.sin(jitter);
          dx = rx * c - ry * s;
          dy = rx * s + ry * c;
          break;
        }
        default: {
          const a = dirBase + jitter;
          dx = Math.cos(a);
          dy = Math.sin(a);
        }
      }
      let vx = dx * speed + ivx;
      let vy = dy * speed + ivy;
      if (e.orbital !== 0) {
        const len = Math.hypot(lx, ly) || 1;
        vx += (-ly / len) * e.orbital;
        vy += (lx / len) * e.orbital;
      }
      const home = st.homeCounter++ % st.formK;
      if (formSet && e.formation.spawnAtTarget) {
        x = formOffX + formSet.xy[(home % formSet.count) * 2] * cr - formSet.xy[(home % formSet.count) * 2 + 1] * sr;
        y = formOffY + formSet.xy[(home % formSet.count) * 2] * sr + formSet.xy[(home % formSet.count) * 2 + 1] * cr;
      }
      // back-shift so particles born "later" in this step travel less
      p.px[i] = x - vx * DT * tauFrac;
      p.py[i] = y - vy * DT * tauFrac;
      p.vx[i] = vx;
      p.vy[i] = vy;
      p.ax[i] = 0;
      p.ay[i] = 0;
      p.age[i] = -DT * tauFrac;
      p.life[i] = Math.max(DT, e.lifetime[0] + (e.lifetime[1] - e.lifetime[0]) * rng.next());
      p.size[i] = e.size[0] + (e.size[1] - e.size[0]) * rng.next();
      p.spin[i] = (e.spin[0] + (e.spin[1] - e.spin[0]) * rng.next()) * DEG;
      p.rot[i] = rng.next() * Math.PI * 2;
      p.rnd[i] = rng.next();
      p.em[i] = ei;
      p.home[i] = home;
      if (S.colored) {
        p.cr[i] = S.r;
        p.cg[i] = S.g;
        p.cb[i] = S.b;
        p.flags[i] = 1;
      } else p.flags[i] = 0;
      if (st.subs.length) {
        for (const sub of st.subs) {
          if (sub.trigger === 'birth' && rng.next() < sub.chance) this.queueSub(sub.target, x, y, vx * sub.inherit, vy * sub.inherit, sub.count);
        }
      }
    }
  }

  /** Spawn from the editor brush (non-deterministic interaction). */
  emitAt(emitterId: string, x: number, y: number, n: number, vx = 0, vy = 0): void {
    const ei = this.rt.emitters.findIndex((e) => e.id === emitterId);
    if (ei < 0) return;
    this.spawn(ei, n, x, y, vx, vy, false);
    this.diverged = true;
  }

  private formationSet(e: EmitterConfig, st: EmitterState, tau: number): PointSet | null {
    const shapes = e.formation.shapes;
    const idx = Math.floor(Math.max(0, tau - e.start) / Math.max(0.1, e.formation.hold)) % shapes.length;
    if (shapes[idx].type === 'none') return null;
    let set = st.formSets[idx];
    if (!set || !set.ready) {
      set = getPointSet(shapes[idx], st.formK);
      st.formSets[idx] = set;
    }
    return set.ready ? set : null;
  }

  private queueSub(target: number, x: number, y: number, vx: number, vy: number, count: number): void {
    if (this.subQueueLen >= this.subQueue.length / 6) return;
    const o = this.subQueueLen * 6;
    this.subQueue[o] = x;
    this.subQueue[o + 1] = y;
    this.subQueue[o + 2] = vx;
    this.subQueue[o + 3] = vy;
    this.subQueue[o + 4] = target;
    this.subQueue[o + 5] = count;
    this.subQueueLen++;
  }

  private flushSubQueue(): void {
    const q = this.subQueue;
    const n = this.subQueueLen;
    this.subQueueLen = 0;
    for (let k = 0; k < n; k++) {
      const o = k * 6;
      const target = q[o + 4];
      const e = this.rt.emitters[target];
      if (!e || !e.enabled) continue;
      this.spawn(target, q[o + 5], q[o], q[o + 1], q[o + 2], q[o + 3], false);
    }
  }

  // ───────────────────────────────── forces ─────────────────────────────────

  private prepareForces(tau: number): void {
    const sc = this.rt;
    const ne = sc.emitters.length;
    this.forces.length = 0;
    this.colliders.length = 0;
    this.bounds = null;
    for (const f of sc.forces) {
      if (!f.enabled) continue;
      const mask = new Uint8Array(Math.max(1, ne));
      const all = f.affects.length === 0;
      if (!all) sc.emitters.forEach((e, i) => (mask[i] = f.affects.includes(e.id) ? 1 : 0));
      const pulse = f.pulse ? 1 + f.pulse * Math.sin(tau * f.pulseFreq * Math.PI * 2) : 1;
      const pf: PreparedForce = {
        cfg: f,
        mask,
        all,
        strength: f.strength * pulse,
        grid: null,
        flow: null,
        dirX: Math.cos(f.direction * DEG),
        dirY: Math.sin(f.direction * DEG),
        px: f.position.x,
        py: f.position.y,
        transient: false,
      };
      if (f.type === 'turbulence') {
        let g = this.grids.get(f.id);
        if (!g) {
          g = new CurlGrid();
          this.grids.set(f.id, g);
        }
        g.update(f.scale, tau * f.speed, f.octaves, hashString(f.id) % 1000, this.halfW, this.halfH);
        pf.grid = g;
      } else if (f.type === 'flowfield') {
        pf.flow = this.flows.get(f.id) ?? null;
      } else if (f.type === 'pointer') {
        const ptr = this.pointer;
        if (!ptr.inside || (!f.hoverActive && !ptr.down)) continue;
        pf.px = ptr.x;
        pf.py = ptr.y;
        pf.transient = true;
      } else if (f.type === 'wind') {
        pf.strength *= 1 + f.gust * noise1(tau * 0.6, hashString(f.id) % 97);
      }
      if (f.type === 'collider') this.colliders.push(pf);
      else if (f.type === 'bounds') this.bounds = pf;
      else this.forces.push(pf);
    }
    // editor interaction tool (attract / repel / swirl brush)
    const ptr = this.pointer;
    if (ptr.tool !== 'none' && ptr.down && ptr.inside) {
      const pf = this.pointerForce;
      pf.cfg = {
        ...(pf.cfg as ForceConfig),
        type: 'pointer',
        pointerMode: ptr.tool,
        radius: ptr.toolRadius,
        falloff: 'smooth',
        affects: [],
      } as ForceConfig;
      pf.strength = ptr.toolStrength;
      pf.px = ptr.x;
      pf.py = ptr.y;
      this.forces.push(pf);
    }
  }

  private accumulateForces(tau: number): void {
    const p = this.pool;
    const n = p.count;
    const ax = p.ax;
    const ay = p.ay;
    ax.fill(0, 0, n);
    ay.fill(0, 0, n);
    const px = p.px;
    const py = p.py;
    const vx = p.vx;
    const vy = p.vy;
    const em = p.em;
    for (const pf of this.forces) {
      const f = pf.cfg;
      const s = pf.strength;
      const mask = pf.mask;
      const all = pf.all;
      if (pf.transient) this.diverged = true;
      switch (f.type) {
        case 'gravity':
        case 'wind': {
          const gx = pf.dirX * s;
          const gy = pf.dirY * s;
          for (let i = 0; i < n; i++) {
            if (!all && !mask[em[i]]) continue;
            ax[i] += gx;
            ay[i] += gy;
          }
          break;
        }
        case 'drag': {
          for (let i = 0; i < n; i++) {
            if (!all && !mask[em[i]]) continue;
            ax[i] -= vx[i] * s;
            ay[i] -= vy[i] * s;
          }
          break;
        }
        case 'attractor': {
          const cx = pf.px;
          const cy = pf.py;
          const R = f.radius;
          const soft2 = f.softening * f.softening;
          const kill2 = f.killRadius * f.killRadius;
          const fall = f.falloff;
          for (let i = 0; i < n; i++) {
            if (!all && !mask[em[i]]) continue;
            const dx = cx - px[i];
            const dy = cy - py[i];
            const d2 = dx * dx + dy * dy;
            if (kill2 > 0 && d2 < kill2) {
              p.age[i] = p.life[i] + 1;
              continue;
            }
            const d = Math.sqrt(d2) + 1e-4;
            let mag: number;
            if (fall === 'inverse') mag = (s * 100) / (d2 + soft2);
            else if (R > 0) {
              if (d > R) continue;
              const q = 1 - d / R;
              mag = fall === 'linear' ? s * q : fall === 'smooth' ? s * q * q : s;
            } else mag = s;
            ax[i] += (dx / d) * mag;
            ay[i] += (dy / d) * mag;
          }
          break;
        }
        case 'vortex': {
          const cx = pf.px;
          const cy = pf.py;
          const R = f.radius;
          const inward = f.inward;
          const fall = f.falloff;
          for (let i = 0; i < n; i++) {
            if (!all && !mask[em[i]]) continue;
            const dx = px[i] - cx;
            const dy = py[i] - cy;
            const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
            let w = 1;
            if (R > 0) {
              if (d > R) continue;
              const q = 1 - d / R;
              w = fall === 'linear' ? q : fall === 'smooth' ? q * q : fall === 'inverse' ? Math.min(4, R / (d * 4 + 1)) : 1;
            }
            ax[i] += ((-dy / d) * s - (dx / d) * inward) * w;
            ay[i] += ((dx / d) * s - (dy / d) * inward) * w;
          }
          break;
        }
        case 'turbulence': {
          const g = pf.grid!;
          const cols = g.cols;
          const rows = g.rows;
          const gvx = g.vx;
          const gvy = g.vy;
          const inv = g.invCell;
          const x0 = g.x0;
          const y0 = g.y0;
          for (let i = 0; i < n; i++) {
            if (!all && !mask[em[i]]) continue;
            let fx = (px[i] - x0) * inv;
            let fy = (py[i] - y0) * inv;
            if (fx < 0) fx = 0;
            else if (fx > cols - 1.001) fx = cols - 1.001;
            if (fy < 0) fy = 0;
            else if (fy > rows - 1.001) fy = rows - 1.001;
            const ix = fx | 0;
            const iy = fy | 0;
            const tx = fx - ix;
            const ty = fy - iy;
            const a = iy * cols + ix;
            const b = a + cols;
            const w00 = (1 - tx) * (1 - ty);
            const w10 = tx * (1 - ty);
            const w01 = (1 - tx) * ty;
            const w11 = tx * ty;
            ax[i] += (gvx[a] * w00 + gvx[a + 1] * w10 + gvx[b] * w01 + gvx[b + 1] * w11) * s;
            ay[i] += (gvy[a] * w00 + gvy[a + 1] * w10 + gvy[b] * w01 + gvy[b + 1] * w11) * s;
          }
          break;
        }
        case 'flowfield': {
          const g = pf.flow;
          if (!g) break;
          const cols = g.cols;
          const rows = g.rows;
          const data = g.data;
          const sx = (cols - 1) / (this.halfW * 2);
          const sy = (rows - 1) / (this.halfH * 2);
          const hw = this.halfW;
          const hh = this.halfH;
          for (let i = 0; i < n; i++) {
            if (!all && !mask[em[i]]) continue;
            const fx = (px[i] + hw) * sx;
            const fy = (py[i] + hh) * sy;
            if (fx < 0 || fy < 0 || fx >= cols - 1 || fy >= rows - 1) continue;
            const ix = fx | 0;
            const iy = fy | 0;
            const tx = fx - ix;
            const ty = fy - iy;
            const a = (iy * cols + ix) * 2;
            const b = a + cols * 2;
            ax[i] += (data[a] * (1 - tx) * (1 - ty) + data[a + 2] * tx * (1 - ty) + data[b] * (1 - tx) * ty + data[b + 2] * tx * ty) * s;
            ay[i] += (data[a + 1] * (1 - tx) * (1 - ty) + data[a + 3] * tx * (1 - ty) + data[b + 1] * (1 - tx) * ty + data[b + 3] * tx * ty) * s;
          }
          break;
        }
        case 'pointer': {
          const cx = pf.px;
          const cy = pf.py;
          const R = Math.max(0.5, f.radius);
          const R2 = R * R;
          const mode = f.pointerMode;
          const pvx = this.pointer.vx;
          const pvy = this.pointer.vy;
          for (let i = 0; i < n; i++) {
            if (!all && !mask[em[i]]) continue;
            const dx = px[i] - cx;
            const dy = py[i] - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 > R2) continue;
            const d = Math.sqrt(d2) + 1e-3;
            const q = 1 - d / R;
            const w = q * q * s;
            if (mode === 'attract') {
              ax[i] -= (dx / d) * w;
              ay[i] -= (dy / d) * w;
            } else if (mode === 'repel') {
              ax[i] += (dx / d) * w;
              ay[i] += (dy / d) * w;
            } else if (mode === 'swirl') {
              ax[i] += (-dy / d) * w - (dx / d) * w * 0.15;
              ay[i] += (dx / d) * w - (dy / d) * w * 0.15;
            } else {
              ax[i] += (pvx - vx[i]) * q * s * 0.05;
              ay[i] += (pvy - vy[i]) * q * s * 0.05;
            }
          }
          break;
        }
        case 'fluid':
          this.applyFluid(pf);
          break;
      }
    }
    void tau;
  }

  /** SPH-lite: pressure + viscosity between neighbours via a uniform spatial hash. */
  private applyFluid(pf: PreparedForce): void {
    const p = this.pool;
    const n = p.count;
    if (n < 2) return;
    const h = Math.max(0.3, pf.cfg.radius);
    const h2 = h * h;
    const stiff = pf.strength;
    const visc = pf.cfg.viscosity;
    const margin = h * 2;
    const minX = -this.halfW * 1.5 - margin;
    const minY = -this.halfH * 1.5 - margin;
    const cols = Math.max(1, Math.ceil((this.halfW * 3 + margin * 2) / h));
    const rows = Math.max(1, Math.ceil((this.halfH * 3 + margin * 2) / h));
    const cells = cols * rows;
    if (this.hashCellStart.length < cells + 1) this.hashCellStart = new Int32Array(cells + 1);
    if (this.hashSorted.length < n) {
      this.hashSorted = new Int32Array(p.capacity);
      this.hashCellOf = new Int32Array(p.capacity);
    }
    const start = this.hashCellStart;
    const sorted = this.hashSorted;
    const cellOf = this.hashCellOf;
    start.fill(0, 0, cells + 1);
    const inv = 1 / h;
    for (let i = 0; i < n; i++) {
      if (!pf.all && !pf.mask[p.em[i]]) {
        cellOf[i] = -1;
        continue;
      }
      let cx = ((p.px[i] - minX) * inv) | 0;
      let cy = ((p.py[i] - minY) * inv) | 0;
      cx = cx < 0 ? 0 : cx >= cols ? cols - 1 : cx;
      cy = cy < 0 ? 0 : cy >= rows ? rows - 1 : cy;
      const c = cy * cols + cx;
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    // fill using a cursor copy stored in the upper half of the start array
    const cursor = new Int32Array(start.subarray(0, cells));
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c >= 0) sorted[cursor[c]++] = i;
    }
    const px = p.px;
    const py = p.py;
    const vx = p.vx;
    const vy = p.vy;
    const ax = p.ax;
    const ay = p.ay;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c < 0) continue;
      const cx = c % cols;
      const cy = (c / cols) | 0;
      const xi = px[i];
      const yi = py[i];
      let fx = 0;
      let fy = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = cy + oy;
        if (yy < 0 || yy >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = cx + ox;
          if (xx < 0 || xx >= cols) continue;
          const cc = yy * cols + xx;
          for (let k = start[cc]; k < start[cc + 1]; k++) {
            const j = sorted[k];
            if (j === i) continue;
            const dx = xi - px[j];
            const dy = yi - py[j];
            const d2 = dx * dx + dy * dy;
            if (d2 >= h2 || d2 < 1e-8) continue;
            const d = Math.sqrt(d2);
            const q = 1 - d / h;
            const press = q * q * stiff;
            fx += (dx / d) * press + (vx[j] - vx[i]) * q * visc * 10;
            fy += (dy / d) * press + (vy[j] - vy[i]) * q * visc * 10;
          }
        }
      }
      ax[i] += fx;
      ay[i] += fy;
    }
  }

  // ─────────────────────────────── integration ───────────────────────────────

  private integrate(tau: number): void {
    const p = this.pool;
    const sc = this.rt;
    const emitters = sc.emitters;
    const states = this.states;
    const hw = this.halfW;
    const hh = this.halfH;
    const cullX = hw * 2.5;
    const cullY = hh * 2.5;
    const cull = sc.cullOutside;
    const colliders = this.colliders;
    const bounds = this.bounds;
    const rng = this.rng;
    // per-emitter formation lookup for this step
    const formSets: (PointSet | null)[] = emitters.map((e, i) =>
      e.formation.enabled && e.formation.shapes.length ? this.formationSet(e, states[i], tau) : null,
    );
    for (let i = p.count - 1; i >= 0; i--) {
      const ei = p.em[i];
      const e = emitters[ei];
      p.age[i] += DT;
      let dead = p.age[i] >= p.life[i] || !e;
      if (!dead) {
        let ax = p.ax[i];
        let ay = p.ay[i];
        const fs = formSets[ei];
        if (fs) {
          const st = states[ei];
          const h = (p.home[i] % fs.count) * 2;
          const lx = fs.xy[h];
          const ly = fs.xy[h + 1];
          const tx = e.position.x + lx * st.cos - ly * st.sin;
          const ty = e.position.y + lx * st.sin + ly * st.cos;
          ax += (tx - p.px[i]) * e.formation.strength - p.vx[i] * e.formation.damping;
          ay += (ty - p.py[i]) * e.formation.strength - p.vy[i] * e.formation.damping;
        }
        const invMass = 1 / Math.max(0.05, e.mass);
        let vx = p.vx[i] + ax * invMass * DT;
        let vy = p.vy[i] + ay * invMass * DT;
        if (e.drag > 0) {
          const k = 1 / (1 + e.drag * DT);
          vx *= k;
          vy *= k;
        }
        let x = p.px[i] + vx * DT;
        let y = p.py[i] + vy * DT;
        if (e.collide) {
          for (let c = 0; c < colliders.length; c++) {
            const cf = colliders[c];
            if (!cf.all && !cf.mask[ei]) continue;
            const f = cf.cfg;
            if (f.shape === 'circle') {
              const dx = x - cf.px;
              const dy = y - cf.py;
              const d2 = dx * dx + dy * dy;
              if (d2 < f.radius * f.radius) {
                const d = Math.sqrt(d2) + 1e-5;
                const nx = dx / d;
                const ny = dy / d;
                x = cf.px + nx * f.radius;
                y = cf.py + ny * f.radius;
                const vn = vx * nx + vy * ny;
                if (vn < 0) {
                  const tx = vx - vn * nx;
                  const ty = vy - vn * ny;
                  vx = tx * (1 - f.friction) - vn * f.restitution * nx;
                  vy = ty * (1 - f.friction) - vn * f.restitution * ny;
                }
              }
            } else {
              const nx = cf.dirX;
              const ny = cf.dirY;
              const dist = (x - cf.px) * nx + (y - cf.py) * ny;
              if (dist < 0) {
                x -= nx * dist;
                y -= ny * dist;
                const vn = vx * nx + vy * ny;
                if (vn < 0) {
                  const tx = vx - vn * nx;
                  const ty = vy - vn * ny;
                  vx = tx * (1 - f.friction) - vn * f.restitution * nx;
                  vy = ty * (1 - f.friction) - vn * f.restitution * ny;
                }
              }
            }
          }
          if (bounds) {
            const f = bounds.cfg;
            const pad = f.radius;
            const L = -hw + pad;
            const R = hw - pad;
            const B = -hh + pad;
            const T = hh - pad;
            if (f.mode === 'bounce') {
              const rest = f.restitution;
              const fr = 1 - f.friction;
              if (x < L) {
                x = L + (L - x) * rest;
                vx = Math.abs(vx) * rest;
                vy *= fr;
              } else if (x > R) {
                x = R - (x - R) * rest;
                vx = -Math.abs(vx) * rest;
                vy *= fr;
              }
              if (y < B) {
                y = B + (B - y) * rest;
                vy = Math.abs(vy) * rest;
                vx *= fr;
              } else if (y > T) {
                y = T - (y - T) * rest;
                vy = -Math.abs(vy) * rest;
                vx *= fr;
              }
            } else if (f.mode === 'wrap') {
              const w = R - L;
              const h = T - B;
              if (x < L) x += w;
              else if (x > R) x -= w;
              if (y < B) y += h;
              else if (y > T) y -= h;
            } else if (x < L || x > R || y < B || y > T) dead = true;
          }
        }
        if (cull && (x < -cullX || x > cullX || y < -cullY || y > cullY)) {
          p.age[i] = -1e9; // mark: culled, no death event
          dead = true;
        }
        p.px[i] = x;
        p.py[i] = y;
        p.vx[i] = vx;
        p.vy[i] = vy;
        p.rot[i] += p.spin[i] * DT;
        // trail sub-emitters
        const st = states[ei];
        if (!dead && st.subs.length) {
          for (const sub of st.subs) {
            if (sub.trigger !== 'trail') continue;
            if (rng.next() < sub.rate * DT * sub.chance) this.queueSub(sub.target, x, y, vx * sub.inherit, vy * sub.inherit, Math.max(1, sub.count));
          }
        }
      }
      if (dead) {
        const st = states[ei];
        if (st && st.subs.length && p.age[i] > -1e8) {
          for (const sub of st.subs) {
            if (sub.trigger === 'death' && rng.next() < sub.chance) {
              this.queueSub(sub.target, p.px[i], p.py[i], p.vx[i] * sub.inherit, p.vy[i] * sub.inherit, sub.count);
            }
          }
        }
        this.emCount[ei]--;
        p.count--;
        if (i !== p.count) p.move(i, p.count);
      }
    }
  }

  // ─────────────────────────────── interaction ───────────────────────────────

  /** Paint into a flow-field force. World coordinates in, direction normalised. */
  paintFlow(forceId: string, x: number, y: number, dx: number, dy: number, radius: number, erase = false): void {
    let g = this.flows.get(forceId);
    if (!g) {
      const rows = 40;
      g = new FlowGrid(Math.round(rows * this.aspect), rows);
      this.flows.set(forceId, g);
    }
    const gx = ((x + this.halfW) / (this.halfW * 2)) * (g.cols - 1);
    const gy = ((y + this.halfH) / (this.halfH * 2)) * (g.rows - 1);
    const gr = (radius / (this.halfH * 2)) * (g.rows - 1);
    g.paint(gx, gy, dx, dy, gr, erase);
    this.diverged = true;
  }

  getFlowGrid(forceId: string): FlowGrid | undefined {
    return this.flows.get(forceId);
  }

  // ───────────────────────────────── output ─────────────────────────────────

  emitterCount(index: number): number {
    return this.emCount[index] ?? 0;
  }

  /**
   * Write instance data for the renderer, grouped by emitter so every group
   * can use its own sprite and blend mode (emitter order = layer order).
   */
  writeRenderData(out: Float32Array, groups: RenderGroup[]): number {
    groups.length = 0;
    const p = this.pool;
    const sc = this.rt;
    const n = p.count;
    const ne = sc.emitters.length;
    const offsets = new Int32Array(ne + 1);
    for (let e = 0; e < ne; e++) offsets[e + 1] = offsets[e] + this.emCount[e];
    const cursor = offsets.slice(0, ne);
    const frame = this.frame;
    for (let i = 0; i < n; i++) {
      const ei = p.em[i];
      const e = sc.emitters[ei];
      const st = this.states[ei];
      if (!e || !st) continue;
      const slot = cursor[ei]++;
      if (slot >= offsets[ei + 1]) continue;
      const o = slot * RENDER_STRIDE;
      const lifeT = p.age[i] <= 0 ? 0 : Math.min(1, p.age[i] / p.life[i]);
      const li = (lifeT * (LUT_SIZE - 1)) | 0;
      const lut = st.gradient;
      let ci = li;
      if (e.colorMode === 'speed') {
        const sp = Math.sqrt(p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i]) / Math.max(0.01, e.speedRef);
        ci = (Math.min(1, sp) * (LUT_SIZE - 1)) | 0;
      } else if (e.colorMode === 'random') ci = (p.rnd[i] * (LUT_SIZE - 1)) | 0;
      let r: number;
      let g: number;
      let b: number;
      if (e.colorMode === 'source' && p.flags[i] & 1) {
        r = p.cr[i];
        g = p.cg[i];
        b = p.cb[i];
      } else {
        r = lut[ci * 4];
        g = lut[ci * 4 + 1];
        b = lut[ci * 4 + 2];
      }
      let a = lut[li * 4 + 3];
      if (e.flicker > 0) a *= 1 - e.flicker * hash01((p.rnd[i] * 1e7) | 0, frame);
      const k = e.intensity;
      out[o] = p.px[i];
      out[o + 1] = p.py[i];
      out[o + 2] = p.vx[i];
      out[o + 3] = p.vy[i];
      out[o + 4] = p.size[i] * st.sizeLut[li];
      out[o + 5] = p.rot[i];
      out[o + 6] = r * k;
      out[o + 7] = g * k;
      out[o + 8] = b * k;
      out[o + 9] = a;
    }
    for (let e = 0; e < ne; e++) {
      const count = offsets[e + 1] - offsets[e];
      if (count > 0) groups.push({ emitter: sc.emitters[e], index: e, offset: offsets[e], count });
    }
    return n;
  }

  /** Current runtime config of an emitter (tracks applied). */
  runtimeEmitter(id: string): EmitterConfig | undefined {
    return this.rt.emitters.find((e) => e.id === id);
  }
}
