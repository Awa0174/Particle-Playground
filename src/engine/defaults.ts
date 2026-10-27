import type {
  EmitterConfig,
  ForceConfig,
  ForceType,
  RenderConfig,
  SceneConfig,
  ShapeConfig,
  ShapeType,
} from './types';
import { SCENE_VERSION } from './types';

let uidCounter = 0;
export function uid(prefix = 'id'): string {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1e6).toString(36)}${uidCounter.toString(36)}`;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function merge<T>(base: T, patch?: DeepPartial<T>): T {
  if (!patch) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const k of Object.keys(patch) as (keyof T)[]) {
    const pv: any = (patch as any)[k];
    const bv: any = (base as any)[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = merge(bv, pv);
    } else if (pv !== undefined) {
      out[k] = pv;
    }
  }
  return out;
}

export function makeShape(type: ShapeType = 'point', patch?: Partial<ShapeConfig>): ShapeConfig {
  return {
    type,
    radius: 10,
    thickness: 0.15,
    width: 40,
    height: 20,
    arms: 3,
    turns: 1.2,
    edgeOnly: false,
    jitter: 0.1,
    text: 'PARTICLE',
    font: 'Inter, system-ui, sans-serif',
    weight: 800,
    image: '',
    branches: 4,
    roughness: 0.5,
    ...patch,
  };
}

export function makeEmitter(patch?: DeepPartial<EmitterConfig>): EmitterConfig {
  const base: EmitterConfig = {
    id: uid('em'),
    name: 'Emitter',
    enabled: true,
    backend: 'cpu',
    gpuCount: 131072,
    position: { x: 0, y: 0 },
    rotation: 0,
    rotationSpeed: 0,
    shape: makeShape('point'),
    rate: 200,
    maxParticles: 20000,
    bursts: [],
    start: 0,
    end: -1,
    lifetime: [1.5, 3],
    speed: [8, 20],
    direction: 90,
    spread: 360,
    velocityMode: 'direction',
    orbital: 0,
    size: [0.6, 1.4],
    sizeCurve: [
      { t: 0, v: 0 },
      { t: 0.1, v: 1 },
      { t: 1, v: 0 },
    ],
    spin: [0, 0],
    gradient: [
      { t: 0, color: '#ffffff', alpha: 1 },
      { t: 0.35, color: '#7cf0ff', alpha: 1 },
      { t: 1, color: '#5b3cff', alpha: 0 },
    ],
    colorMode: 'life',
    speedRef: 30,
    intensity: 1.5,
    flicker: 0,
    sprite: 'glow',
    blend: 'additive',
    stretch: 0,
    drag: 0,
    mass: 1,
    collide: true,
    subEmitters: [],
    formation: {
      enabled: false,
      strength: 12,
      damping: 3,
      hold: 4,
      spawnAtTarget: false,
      shapes: [],
    },
  };
  const out = merge(base, patch);
  // ensure nested shapes are complete
  out.shape = makeShape(out.shape.type, out.shape);
  out.formation = { ...base.formation, ...out.formation, shapes: (out.formation.shapes || []).map((s) => makeShape(s.type, s)) };
  return out;
}

const FORCE_NAMES: Record<ForceType, string> = {
  gravity: 'Gravity',
  wind: 'Wind',
  attractor: 'Attractor',
  vortex: 'Vortex',
  turbulence: 'Turbulence',
  drag: 'Drag',
  bounds: 'Bounds',
  collider: 'Collider',
  pointer: 'Pointer Field',
  flowfield: 'Painted Flow',
  fluid: 'Fluid (SPH-lite)',
};

export function makeForce(type: ForceType, patch?: DeepPartial<ForceConfig>): ForceConfig {
  const defaults: Partial<Record<ForceType, Partial<ForceConfig>>> = {
    gravity: { strength: 20, direction: -90 },
    wind: { strength: 10, direction: 0, gust: 0.5 },
    attractor: { strength: 30, radius: 0, falloff: 'inverse', softening: 2 },
    vortex: { strength: 25, radius: 40, falloff: 'smooth', inward: 0 },
    turbulence: { strength: 30, scale: 25, speed: 0.25, octaves: 2 },
    drag: { strength: 0.5 },
    bounds: { mode: 'bounce', restitution: 0.6, friction: 0.05, radius: 0 },
    collider: { shape: 'circle', radius: 10, restitution: 0.5, friction: 0.1 },
    pointer: { strength: 120, radius: 18, pointerMode: 'repel', hoverActive: true, falloff: 'smooth' },
    flowfield: { strength: 40 },
    fluid: { strength: 60, radius: 2.5, viscosity: 0.2 },
  };
  const base: ForceConfig = {
    id: uid('fx'),
    name: FORCE_NAMES[type],
    enabled: true,
    type,
    position: { x: 0, y: 0 },
    strength: 10,
    radius: 30,
    falloff: 'none',
    direction: -90,
    inward: 0,
    killRadius: 0,
    softening: 1,
    scale: 20,
    speed: 0.2,
    octaves: 2,
    mode: 'bounce',
    restitution: 0.5,
    friction: 0.05,
    shape: 'circle',
    pointerMode: 'repel',
    hoverActive: true,
    gust: 0,
    viscosity: 0.1,
    pulse: 0,
    pulseFreq: 0.5,
    affects: [],
    field: null,
    ...(defaults[type] as Partial<ForceConfig>),
  };
  return merge(base, patch);
}

export function makeRender(patch?: DeepPartial<RenderConfig>): RenderConfig {
  return merge<RenderConfig>(
    {
      exposure: 1,
      bloom: { intensity: 0.9, threshold: 0.6, knee: 0.5, radius: 0.75 },
      trails: 0,
      chromatic: 0.15,
      vignette: 0.35,
      grain: 0.04,
      saturation: 1.05,
      contrast: 1.02,
      tonemap: 'aces',
      links: { enabled: false, distance: 6, opacity: 0.35, maxParticles: 2500 },
    },
    patch,
  );
}

export function makeScene(patch?: DeepPartial<SceneConfig>): SceneConfig {
  const base: SceneConfig = {
    version: SCENE_VERSION,
    name: 'Untitled Effect',
    description: '',
    seed: 1337,
    duration: 12,
    loop: false,
    prewarm: 0,
    maxParticles: 60000,
    cullOutside: true,
    background: { top: '#05060a', bottom: '#0b0d16', glow: 0.25 },
    render: makeRender(),
    emitters: [],
    forces: [],
    tracks: [],
  };
  const out = merge(base, patch as any);
  out.render = makeRender(out.render as any);
  out.emitters = (out.emitters || []).map((e) => makeEmitter(e as any));
  out.forces = (out.forces || []).map((f) => makeForce(f.type, f as any));
  return out;
}

export function cloneScene<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
