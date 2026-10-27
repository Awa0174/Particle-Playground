import type { EmitterConfig, ForceConfig, ForceType, ShapeType } from '../engine/types';
import { cloneScene, makeEmitter, makeForce, makeShape, uid } from '../engine/defaults';
import { mutateScene } from '../engine/mutate';
import { PRESETS, starterScene } from '../presets';
import { decodeShare, encodeShare, migrateScene, serializeScene } from '../serialization/schema';
import { downloadBlob, saveToLibrary, slug } from '../serialization/storage';
import { engine } from './engine';
import { getStore, Tool } from './store';

const store = () => getStore();

export function selectEmitter(id: string): void {
  store().set({ selection: { kind: 'emitter', id } });
}

export function selectForce(id: string): void {
  store().set({ selection: { kind: 'force', id } });
}

export function addEmitter(shape: ShapeType = 'circle', backend: 'cpu' | 'gpu' = 'cpu'): void {
  const n = store().state.scene.emitters.length + 1;
  const e = makeEmitter({
    name: backend === 'gpu' ? `GPU Swarm ${n}` : `Emitter ${n}`,
    backend,
    shape: makeShape(shape, shape === 'text' ? { width: 120, height: 30 } : shape === 'ring' ? { radius: 20 } : {}),
    rate: backend === 'gpu' ? 0 : 300,
    gpuCount: 131072,
    size: backend === 'gpu' ? [0.15, 0.5] : [0.6, 1.4],
  });
  store().update((d) => d.emitters.push(e));
  selectEmitter(e.id);
  store().toast(`${e.name} hinzugefügt`);
}

export function addForce(type: ForceType): void {
  const f = makeForce(type);
  store().update((d) => d.forces.push(f));
  selectForce(f.id);
  if (type === 'flowfield') {
    store().set({ tool: 'paint' });
    store().toast('Pinsel aktiv – male Strömungen in den Viewport', 'info');
  }
}

export function duplicateSelected(): void {
  const { selection: sel, scene } = store().state;
  if (sel.kind === 'emitter') {
    const src = scene.emitters.find((e) => e.id === sel.id);
    if (!src) return;
    const copy: EmitterConfig = { ...cloneScene(src), id: uid('em'), name: `${src.name} Kopie`, position: { x: src.position.x + 8, y: src.position.y } };
    store().update((d) => d.emitters.splice(d.emitters.findIndex((e) => e.id === src.id) + 1, 0, copy));
    selectEmitter(copy.id);
  } else if (sel.kind === 'force') {
    const src = scene.forces.find((f) => f.id === sel.id);
    if (!src) return;
    const copy: ForceConfig = { ...cloneScene(src), id: uid('fx'), name: `${src.name} Kopie`, position: { x: src.position.x + 8, y: src.position.y } };
    store().update((d) => d.forces.splice(d.forces.findIndex((f) => f.id === src.id) + 1, 0, copy));
    selectForce(copy.id);
  }
}

export function deleteSelected(): void {
  const { selection: sel } = store().state;
  if (sel.kind === 'emitter') {
    store().update((d) => {
      d.emitters = d.emitters.filter((e) => e.id !== sel.id);
      d.tracks = d.tracks.filter((t) => !t.target.startsWith(`emitter:${sel.id}:`));
      d.forces.forEach((f) => (f.affects = f.affects.filter((a) => a !== sel.id)));
    });
  } else if (sel.kind === 'force') {
    store().update((d) => {
      d.forces = d.forces.filter((f) => f.id !== sel.id);
      d.tracks = d.tracks.filter((t) => !t.target.startsWith(`force:${sel.id}:`));
    });
  } else return;
  store().set({ selection: { kind: 'scene' } });
}

export function moveSelected(dir: -1 | 1): void {
  const { selection: sel } = store().state;
  store().update((d) => {
    const list: any[] = sel.kind === 'emitter' ? d.emitters : sel.kind === 'force' ? d.forces : [];
    const i = list.findIndex((x) => x.id === sel.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  });
}

export function toggleEnabled(kind: 'emitter' | 'force', id: string): void {
  store().update((d) => {
    const list: any[] = kind === 'emitter' ? d.emitters : d.forces;
    const x = list.find((y) => y.id === id);
    if (x) x.enabled = !x.enabled;
  });
}

export function loadPreset(id: string): void {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  store().replaceScene(p.build());
  engine().restart();
  engine().camera = { x: 0, y: 0, zoom: 1 };
  store().set({ modal: null, playing: true, compare: { a: null, b: null, active: null } });
  store().toast(`Preset „${p.name}“ geladen`, 'success');
}

export function newScene(): void {
  store().replaceScene(starterScene());
  engine().restart();
  store().set({ modal: null, playing: true });
}

export function togglePlay(): void {
  store().set({ playing: !store().state.playing });
}

export function restart(): void {
  engine().restart();
  store().set({ time: engine().sim.time });
}

export function setTool(tool: Tool): void {
  store().set({ tool });
}

export function undo(): void {
  store().undo();
}

export function redo(): void {
  store().redo();
}

export function mutate(amount = 0.35): void {
  const s = store().state.scene;
  const next = mutateScene(s, amount, Math.floor(Math.random() * 1e9));
  store().replaceScene(next);
  engine().restart();
  store().toast('Variation erzeugt – Strg+Z kehrt zurück', 'success');
}

export function randomizeSeed(): void {
  store().update((d) => (d.seed = Math.floor(Math.random() * 1e6)));
  engine().restart();
}

// ───────────────────────────── A/B compare ─────────────────────────────

export function storeCompare(slot: 'a' | 'b'): void {
  const st = store().state;
  store().set({ compare: { ...st.compare, [slot]: cloneScene(st.scene), active: slot } });
  store().toast(`Aktueller Zustand in Slot ${slot.toUpperCase()} gespeichert`);
}

export function toggleCompare(): void {
  const { compare } = store().state;
  if (!compare.a || !compare.b) {
    if (!compare.a) storeCompare('a');
    else storeCompare('b');
    return;
  }
  const next = compare.active === 'a' ? 'b' : 'a';
  const scene = compare[next]!;
  store().replaceScene(cloneScene(scene), false);
  store().set({ compare: { ...compare, active: next } });
}

// ───────────────────────────── import / export ─────────────────────────────

export function exportJson(): void {
  const s = store().state.scene;
  downloadBlob(new Blob([serializeScene(s)], { type: 'application/json' }), `${slug(s.name)}.particle.json`);
  store().toast('Preset als JSON exportiert', 'success');
}

export async function importFile(file: File): Promise<void> {
  try {
    if (file.type.startsWith('image/')) {
      await importImageEmitter(file);
      return;
    }
    const scene = migrateScene(JSON.parse(await file.text()));
    store().replaceScene(scene);
    engine().restart();
    store().toast(`„${scene.name}“ importiert`, 'success');
  } catch (err) {
    store().toast(`Import fehlgeschlagen: ${(err as Error).message}`, 'error');
  }
}

/** Downscale an image and turn it into an image-mask emitter. */
export async function importImageEmitter(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const max = 360;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const dataUrl = c.toDataURL('image/png');
  const e = makeEmitter({
    name: file.name.replace(/\.[^.]+$/, ''),
    shape: makeShape('image', { image: dataUrl, width: 90, height: 80 }),
    rate: 6000,
    maxParticles: 30000,
    lifetime: [1.5, 3],
    speed: [0, 1.5],
    size: [0.35, 0.7],
    sizeCurve: [{ t: 0, v: 0 }, { t: 0.15, v: 1 }, { t: 1, v: 0 }],
    colorMode: 'source',
    gradient: [
      { t: 0, color: '#ffffff', alpha: 0 },
      { t: 0.15, color: '#ffffff', alpha: 1 },
      { t: 1, color: '#ffffff', alpha: 0 },
    ],
    intensity: 1.4,
  });
  store().update((d) => d.emitters.push(e));
  selectEmitter(e.id);
  store().toast('Bild-Emitter erstellt – Partikel entstehen entlang der Pixel', 'success');
}

export async function copyShareLink(): Promise<void> {
  try {
    const code = await encodeShare(store().state.scene);
    const url = `${location.origin}${location.pathname}#s=${code}`;
    history.replaceState(null, '', `#s=${code}`);
    await navigator.clipboard.writeText(url);
    store().toast(`Share-Link kopiert (${(url.length / 1024).toFixed(1)} KB)`, 'success');
  } catch (err) {
    store().toast(`Link konnte nicht kopiert werden: ${(err as Error).message}`, 'error');
  }
}

export async function loadFromHash(): Promise<boolean> {
  const m = location.hash.match(/#s=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try {
    const scene = await decodeShare(m[1]);
    store().replaceScene(scene, false);
    engine().restart();
    store().toast(`Geteilter Effekt „${scene.name}“ geladen`, 'success');
    return true;
  } catch {
    store().toast('Share-Link ist ungültig', 'error');
    return false;
  }
}

export async function screenshot(): Promise<void> {
  const blob = await engine().capturePng();
  if (!blob) return;
  downloadBlob(blob, `${slug(store().state.scene.name)}-${Date.now()}.png`);
  store().toast('Screenshot gespeichert', 'success');
}

export async function recordVideo(seconds: number, fromStart: boolean): Promise<void> {
  const host = engine();
  if (host.recording) {
    host.stopRecording();
    return;
  }
  if (fromStart) {
    host.seek(0);
    store().set({ playing: true });
  }
  const blob = await host.startRecording(seconds);
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  downloadBlob(blob, `${slug(store().state.scene.name)}.${ext}`);
  store().toast(`Video gespeichert (${(blob.size / 1048576).toFixed(1)} MB)`, 'success');
}

export async function saveToMyLibrary(): Promise<void> {
  const s = store().state.scene;
  const blob = await engine().capturePng();
  let thumb = '';
  if (blob) {
    // shrink to a jpeg thumbnail
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = 384;
    c.height = Math.round((384 * bmp.height) / bmp.width);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    thumb = c.toDataURL('image/jpeg', 0.8);
  }
  await saveToLibrary({ id: uid('lib'), name: s.name, savedAt: Date.now(), thumbnail: thumb, scene: cloneScene(s) });
  store().toast(`„${s.name}“ in „Meine Effekte“ gespeichert`, 'success');
}
