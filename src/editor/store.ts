import { useSyncExternalStore } from 'react';
import type { SceneConfig } from '../engine/types';
import { cloneScene } from '../engine/defaults';

export type Tool = 'select' | 'attract' | 'repel' | 'swirl' | 'paint' | 'erase' | 'emit';
export type Selection = { kind: 'scene' | 'render' | 'emitter' | 'force'; id?: string };
export type Modal = null | 'presets' | 'export' | 'shortcuts' | 'palette' | 'about';
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface EditorState {
  scene: SceneConfig;
  selection: Selection;
  playing: boolean;
  speed: number;
  time: number;
  tool: Tool;
  toolRadius: number;
  toolStrength: number;
  showGizmos: boolean;
  showPerf: boolean;
  presentation: boolean;
  quality: Quality;
  renderScale: number;
  modal: Modal;
  toasts: Toast[];
  canUndo: boolean;
  canRedo: boolean;
  compare: { a: SceneConfig | null; b: SceneConfig | null; active: 'a' | 'b' | null };
  recording: { active: boolean; elapsed: number; target: number };
  selectedKey: { track: string; index: number } | null;
  audio: { active: boolean; levels: [number, number, number, number]; source: string };
  backend: string;
}

type Listener = () => void;

const HISTORY_LIMIT = 120;

class Store {
  state: EditorState;
  private listeners = new Set<Listener>();
  private past: SceneConfig[] = [];
  private future: SceneConfig[] = [];
  private lastCoalesce: { key: string; at: number } | null = null;
  private toastId = 0;

  constructor(initial: EditorState) {
    this.state = initial;
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = () => this.state;

  set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /**
   * Apply an edit to the scene. Consecutive edits with the same coalesce key
   * (e.g. one slider drag) collapse into a single undo step.
   */
  update(mutate: (draft: SceneConfig) => void, coalesce?: string): void {
    const now = performance.now();
    const merge = coalesce && this.lastCoalesce && this.lastCoalesce.key === coalesce && now - this.lastCoalesce.at < 900;
    if (!merge) {
      this.past.push(this.state.scene);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
    this.lastCoalesce = coalesce ? { key: coalesce, at: now } : null;
    const draft = cloneScene(this.state.scene);
    mutate(draft);
    this.set({ scene: draft, canUndo: this.past.length > 0, canRedo: false });
  }

  /** Replace the scene entirely (preset load, import). */
  replaceScene(scene: SceneConfig, undoable = true): void {
    if (undoable) {
      this.past.push(this.state.scene);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
    this.lastCoalesce = null;
    const sel = this.state.selection;
    const stillThere =
      sel.kind === 'scene' ||
      sel.kind === 'render' ||
      (sel.kind === 'emitter' && scene.emitters.some((e) => e.id === sel.id)) ||
      (sel.kind === 'force' && scene.forces.some((f) => f.id === sel.id));
    this.set({
      scene,
      selection: stillThere ? sel : scene.emitters[0] ? { kind: 'emitter', id: scene.emitters[0].id } : { kind: 'scene' },
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      selectedKey: null,
    });
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state.scene);
    this.lastCoalesce = null;
    this.set({ scene: prev, canUndo: this.past.length > 0, canRedo: true });
    this.fixSelection();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.scene);
    this.lastCoalesce = null;
    this.set({ scene: next, canUndo: true, canRedo: this.future.length > 0 });
    this.fixSelection();
  }

  private fixSelection(): void {
    const { selection: sel, scene } = this.state;
    if (sel.kind === 'emitter' && !scene.emitters.some((e) => e.id === sel.id)) this.set({ selection: { kind: 'scene' } });
    if (sel.kind === 'force' && !scene.forces.some((f) => f.id === sel.id)) this.set({ selection: { kind: 'scene' } });
  }

  toast(text: string, kind: Toast['kind'] = 'info'): void {
    const id = ++this.toastId;
    this.set({ toasts: [...this.state.toasts, { id, text, kind }] });
    setTimeout(() => this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) }), 3200);
  }
}

let store: Store;

export function createStore(initial: EditorState): Store {
  store = new Store(initial);
  return store;
}

export function getStore(): Store {
  return store;
}

export function useStore<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.state));
}
