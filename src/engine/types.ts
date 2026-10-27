/**
 * Versioned scene schema. Everything that defines an effect lives in a plain,
 * JSON-serialisable SceneConfig. The simulation never mutates it – it reads a
 * runtime copy that keyframe tracks are evaluated into.
 *
 * World space: the viewport is always 100 units tall, centred on (0,0), y up.
 * The width follows the aspect ratio (100 * aspect).
 */

export const SCENE_VERSION = 3;
export const WORLD_HEIGHT = 100;

export interface Vec2 {
  x: number;
  y: number;
}

export type Range = [number, number];

export interface GradientStop {
  t: number;
  color: string; // sRGB hex
  alpha: number;
}

export interface CurvePoint {
  t: number;
  v: number;
}

export type ShapeType =
  | 'point'
  | 'circle'
  | 'ring'
  | 'rect'
  | 'line'
  | 'cone'
  | 'spiral'
  | 'sphere'
  | 'grid'
  | 'heart'
  | 'star'
  | 'text'
  | 'image'
  | 'lightning'
  | 'none';

export interface ShapeConfig {
  type: ShapeType;
  radius: number;
  thickness: number; // ring: 0..1 (fraction of radius)
  width: number; // rect, line length, text/image box, lightning length
  height: number;
  arms: number; // spiral arms / star points
  turns: number; // spiral turns
  edgeOnly: boolean;
  jitter: number;
  text: string;
  font: string;
  weight: number;
  image: string; // data URL
  branches: number; // lightning
  roughness: number; // lightning
}

/** explode: velocity ∝ local offset / radius – a sphere shell projects to a perfect 3D burst */
export type VelocityMode = 'direction' | 'radial' | 'tangential' | 'inward' | 'normal' | 'explode';
export type SpriteType = 'glow' | 'soft' | 'disc' | 'spark' | 'star' | 'ring' | 'bokeh' | 'smoke';
export type BlendMode = 'additive' | 'normal' | 'screen';
export type ColorMode = 'life' | 'speed' | 'random' | 'source';
export type Backend = 'cpu' | 'gpu';

export interface BurstConfig {
  time: number;
  count: number;
  interval: number; // 0 = fire once
  jitter: number; // 0..1 random variation of the interval
}

export interface SubEmitterConfig {
  trigger: 'death' | 'trail' | 'birth';
  target: string; // emitter id
  count: number; // particles per event (death/birth)
  rate: number; // particles / second / particle (trail)
  inherit: number; // velocity inheritance 0..1
  chance: number; // probability 0..1
}

export interface FormationConfig {
  enabled: boolean;
  strength: number;
  damping: number;
  hold: number; // seconds per target shape
  spawnAtTarget: boolean;
  shapes: ShapeConfig[];
}

export interface EmitterConfig {
  id: string;
  name: string;
  enabled: boolean;
  backend: Backend;
  gpuCount: number;
  position: Vec2;
  rotation: number; // degrees
  rotationSpeed: number; // degrees / second (continuous spin of the emitter)
  shape: ShapeConfig;
  rate: number;
  maxParticles: number;
  bursts: BurstConfig[];
  start: number;
  end: number; // -1 = forever
  lifetime: Range;
  speed: Range;
  direction: number; // degrees, 90 = up
  spread: number; // degrees (full cone)
  velocityMode: VelocityMode;
  orbital: number; // extra tangential velocity
  size: Range;
  sizeCurve: CurvePoint[];
  spin: Range; // degrees / second
  gradient: GradientStop[];
  colorMode: ColorMode;
  speedRef: number;
  intensity: number;
  flicker: number;
  sprite: SpriteType;
  blend: BlendMode;
  stretch: number;
  drag: number;
  mass: number;
  collide: boolean;
  subEmitters: SubEmitterConfig[];
  formation: FormationConfig;
}

export type ForceType =
  | 'gravity'
  | 'wind'
  | 'attractor'
  | 'vortex'
  | 'turbulence'
  | 'drag'
  | 'bounds'
  | 'collider'
  | 'pointer'
  | 'flowfield'
  | 'fluid';

export type Falloff = 'none' | 'linear' | 'smooth' | 'inverse';

export interface FlowFieldData {
  cols: number;
  rows: number;
  /** base64 of Int8Array, interleaved x/y, scaled by 127 */
  data: string;
}

export interface ForceConfig {
  id: string;
  name: string;
  enabled: boolean;
  type: ForceType;
  position: Vec2;
  strength: number;
  radius: number;
  falloff: Falloff;
  direction: number; // degrees (gravity, wind, plane collider)
  inward: number; // vortex inward pull
  killRadius: number; // attractor event horizon
  softening: number;
  scale: number; // turbulence feature size
  speed: number; // turbulence evolution speed
  octaves: number;
  mode: 'bounce' | 'wrap' | 'kill';
  restitution: number;
  friction: number;
  shape: 'circle' | 'plane';
  pointerMode: 'attract' | 'repel' | 'swirl' | 'stir';
  hoverActive: boolean;
  gust: number;
  viscosity: number;
  pulse: number; // strength modulation depth 0..1
  pulseFreq: number; // Hz
  affects: string[]; // emitter ids, empty = all
  field: FlowFieldData | null;
}

export interface BloomConfig {
  intensity: number;
  threshold: number;
  knee: number;
  radius: number; // 0..1 spread of the upsample chain
}

export interface LinksConfig {
  enabled: boolean;
  distance: number;
  opacity: number;
  maxParticles: number;
}

export interface RenderConfig {
  exposure: number;
  bloom: BloomConfig;
  trails: number; // 0..0.99 persistence per 1/60s
  chromatic: number;
  vignette: number;
  grain: number;
  saturation: number;
  contrast: number;
  tonemap: 'aces' | 'agx' | 'linear';
  links: LinksConfig;
}

export interface BackgroundConfig {
  top: string;
  bottom: string;
  glow: number; // centre glow amount
}

export type Ease = 'linear' | 'smooth' | 'step' | 'easeIn' | 'easeOut';

export interface Keyframe {
  t: number;
  v: number;
  ease: Ease;
}

export interface Track {
  id: string;
  /** "emitter:<id>:path.to.prop" | "force:<id>:path" | "render:path" */
  target: string;
  keys: Keyframe[];
}

export interface SceneConfig {
  version: number;
  name: string;
  description: string;
  seed: number;
  duration: number;
  loop: boolean;
  /** seconds simulated invisibly before t=0 so effects start in steady state */
  prewarm: number;
  maxParticles: number;
  cullOutside: boolean;
  background: BackgroundConfig;
  render: RenderConfig;
  emitters: EmitterConfig[];
  forces: ForceConfig[];
  tracks: Track[];
}
