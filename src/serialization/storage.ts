import type { SceneConfig } from '../engine/types';
import { migrateScene } from './schema';

/** Minimal promise wrapper around IndexedDB (autosave + user library). */
const DB_NAME = 'particle-playground';
const DB_VERSION = 1;

export interface LibraryEntry {
  id: string;
  name: string;
  savedAt: number;
  thumbnail: string;
  scene: SceneConfig;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('library')) d.createObjectStore('library', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(storeName, mode);
        const req = fn(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveAutosave(scene: SceneConfig): Promise<void> {
  try {
    await tx('kv', 'readwrite', (s) => s.put({ scene, at: Date.now() }, 'autosave'));
  } catch {
    /* storage unavailable – autosave is best effort */
  }
}

export async function loadAutosave(): Promise<SceneConfig | null> {
  try {
    const v: any = await tx('kv', 'readonly', (s) => s.get('autosave'));
    return v?.scene ? migrateScene(v.scene) : null;
  } catch {
    return null;
  }
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  try {
    const all = await tx<LibraryEntry[]>('library', 'readonly', (s) => s.getAll() as IDBRequest<LibraryEntry[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function saveToLibrary(entry: LibraryEntry): Promise<void> {
  await tx('library', 'readwrite', (s) => s.put(entry));
}

export async function deleteFromLibrary(id: string): Promise<void> {
  await tx('library', 'readwrite', (s) => s.delete(id));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'effect'
  );
}
