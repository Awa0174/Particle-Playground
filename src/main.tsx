import { createRoot } from 'react-dom/client';
import type { SceneConfig } from './engine/types';
import { createStore, getStore } from './editor/store';
import { createEngine, engine } from './editor/engine';
import { App } from './editor/App';
import { PRESETS } from './presets';
import { decodeShare } from './serialization/schema';
import { loadAutosave, saveAutosave } from './serialization/storage';
import './styles.css';

async function boot() {
  let scene: SceneConfig | null = null;
  let source = '';
  const m = location.hash.match(/#s=([A-Za-z0-9_-]+)/);
  if (m) {
    try {
      scene = await decodeShare(m[1]);
      source = 'share';
    } catch {
      /* fall through */
    }
  }
  if (!scene) {
    scene = await loadAutosave();
    if (scene) source = 'autosave';
  }
  if (!scene) {
    scene = PRESETS[0].build();
    source = 'welcome';
  }

  createStore({
    scene,
    selection: scene.emitters[0] ? { kind: 'emitter', id: scene.emitters[0].id } : { kind: 'scene' },
    playing: true,
    speed: 1,
    time: 0,
    tool: 'select',
    toolRadius: 14,
    toolStrength: 220,
    showGizmos: true,
    showPerf: false,
    presentation: false,
    quality: 'auto',
    renderScale: 1,
    modal: null,
    toasts: [],
    canUndo: false,
    canRedo: false,
    compare: { a: null, b: null, active: null },
    recording: { active: false, elapsed: 0, target: 0 },
    selectedKey: null,
    audio: { active: false, levels: [0, 0, 0, 0], source: '' },
    backend: '',
  });
  createEngine(scene);

  // store → engine sync + debounced autosave
  const store = getStore();
  let lastScene = store.state.scene;
  let saveTimer = 0;
  store.subscribe(() => {
    const s = store.state.scene;
    if (s === lastScene) return;
    lastScene = s;
    engine().setScene(s);
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveAutosave(s), 800);
  });

  // no StrictMode: the engine owns a WebGL context with an imperative lifecycle
  createRoot(document.getElementById('root')!).render(<App />);

  if (import.meta.env.DEV) {
    // debugging hook for the dev server only
    const actions = await import('./editor/actions');
    (window as any).__pp = { store, engine, actions };
  }

  if (source === 'share') store.toast(`Geteilter Effekt „${scene.name}“ geladen`, 'success');
  else if (source === 'autosave') store.toast('Letzte Sitzung wiederhergestellt', 'info');
  else {
    const touch = window.matchMedia('(max-width: 820px)').matches;
    const hello = touch
      ? 'Willkommen! Tippe oben auf die Bibliothek oder probiere unten die Werkzeuge.'
      : 'Willkommen! Öffne die Bibliothek (L) oder drücke Strg+K für alle Befehle.';
    setTimeout(() => store.toast(hello, 'info'), 600);
  }
}

void boot();
