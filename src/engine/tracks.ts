import type { Ease, SceneConfig, Track } from './types';

/** Resolve a track target ("emitter:<id>:rate") to the owning object + property path. */
export function resolveTarget(scene: SceneConfig, target: string): { obj: any; path: string[] } | null {
  const [kind, a, b] = target.split(':');
  if (kind === 'render') return { obj: scene.render, path: a.split('.') };
  if (kind === 'scene') return { obj: scene, path: a.split('.') };
  if (kind === 'background') return { obj: scene.background, path: a.split('.') };
  if (kind === 'emitter') {
    const e = scene.emitters.find((x) => x.id === a);
    return e ? { obj: e, path: b.split('.') } : null;
  }
  if (kind === 'force') {
    const f = scene.forces.find((x) => x.id === a);
    return f ? { obj: f, path: b.split('.') } : null;
  }
  return null;
}

export function getPath(obj: any, path: string[]): any {
  let o = obj;
  for (const p of path) {
    if (o == null) return undefined;
    o = o[p];
  }
  return o;
}

export function setPath(obj: any, path: string[], value: any): void {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (o[path[i]] == null) return;
    o = o[path[i]];
  }
  o[path[path.length - 1]] = value;
}

export function applyEase(f: number, ease: Ease): number {
  switch (ease) {
    case 'step':
      return 0;
    case 'smooth':
      return f * f * (3 - 2 * f);
    case 'easeIn':
      return f * f * f;
    case 'easeOut':
      return 1 - Math.pow(1 - f, 3);
    default:
      return f;
  }
}

export function evalTrack(track: Track, t: number): number | null {
  const k = track.keys;
  if (k.length === 0) return null;
  if (t <= k[0].t) return k[0].v;
  if (t >= k[k.length - 1].t) return k[k.length - 1].v;
  let i = 0;
  while (i < k.length - 2 && k[i + 1].t <= t) i++;
  const a = k[i];
  const b = k[i + 1];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return a.v + (b.v - a.v) * applyEase(f, a.ease);
}

/** Write all track values at time t into the runtime scene. */
export function applyTracks(runtime: SceneConfig, tracks: Track[], t: number): void {
  for (const tr of tracks) {
    const v = evalTrack(tr, t);
    if (v === null) continue;
    const r = resolveTarget(runtime, tr.target);
    if (r) setPath(r.obj, r.path, v);
  }
}

export function sortKeys(track: Track): Track {
  return { ...track, keys: [...track.keys].sort((a, b) => a.t - b.t) };
}
