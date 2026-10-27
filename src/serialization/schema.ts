import type { SceneConfig } from '../engine/types';
import { SCENE_VERSION } from '../engine/types';
import { makeScene } from '../engine/defaults';

/**
 * Versioned migrations. Each step upgrades a raw object by exactly one
 * version, so old presets and share links keep working forever.
 */
const MIGRATIONS: Record<number, (raw: any) => any> = {
  // v1 → v2: render.trails was a boolean, emitters had a single "color"
  1: (raw) => {
    if (raw.render && typeof raw.render.trails === 'boolean') raw.render.trails = raw.render.trails ? 0.85 : 0;
    for (const e of raw.emitters ?? []) {
      if (e.color && !e.gradient) e.gradient = [{ t: 0, color: e.color, alpha: 1 }, { t: 1, color: e.color, alpha: 0 }];
      delete e.color;
    }
    return { ...raw, version: 2 };
  },
  // v2 → v3: prewarm + formations were introduced
  2: (raw) => {
    raw.prewarm = raw.prewarm ?? 0;
    for (const e of raw.emitters ?? []) e.formation = e.formation ?? undefined;
    return { ...raw, version: 3 };
  },
};

export function migrateScene(input: unknown): SceneConfig {
  if (!input || typeof input !== 'object') throw new Error('Ungültige Szenendatei');
  let raw: any = JSON.parse(JSON.stringify(input));
  if (raw.format === 'particle-playground' && raw.scene) raw = raw.scene;
  let v = typeof raw.version === 'number' ? raw.version : 1;
  if (v > SCENE_VERSION) throw new Error(`Szene stammt aus einer neueren Version (v${v})`);
  while (v < SCENE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) break;
    raw = m(raw);
    v = raw.version;
  }
  // fill defaults for anything missing → robust against partial files
  return makeScene({ ...raw, version: SCENE_VERSION });
}

export function serializeScene(scene: SceneConfig): string {
  return JSON.stringify({ format: 'particle-playground', exportedAt: new Date().toISOString(), scene }, null, 2);
}

// ───────────────────────────── share links ─────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Deflate-compressed, URL-safe scene encoding – a complete effect fits in a link. */
export async function encodeShare(scene: SceneConfig): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(scene));
  if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(json);
  return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeShare(code: string): Promise<SceneConfig> {
  const kind = code[0];
  const bytes = fromBase64Url(code.slice(1));
  const json = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return migrateScene(JSON.parse(new TextDecoder().decode(json)));
}
