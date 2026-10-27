import { useEffect, useRef, useState } from 'react';
import { getStore, Tool, useStore } from './store';
import { engine } from './engine';
import { TopBar } from './panels/TopBar';
import { Outliner } from './panels/Outliner';
import { Inspector } from './panels/Inspector';
import { Timeline } from './panels/Timeline';
import { Viewport } from './panels/Viewport';
import { Modals, Toasts } from './panels/Modals';
import { toggleKeyframe } from './components/controls';
import { deleteSelected, duplicateSelected, mutate, redo, restart, saveToMyLibrary, setTool, toggleCompare, togglePlay, undo } from './actions';

const TOOL_KEYS: Record<string, Tool> = { v: 'select', a: 'attract', s: 'repel', w: 'swirl', b: 'paint', e: 'erase', p: 'emit' };

function usePanelSize(key: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(`pp-panel-${key}`);
      return s ? +s : initial;
    } catch {
      return initial;
    }
  });
  const set = (n: number) => {
    setV(n);
    try {
      localStorage.setItem(`pp-panel-${key}`, String(Math.round(n)));
    } catch {
      /* ignore */
    }
  };
  return [v, set];
}

function Splitter({ dir, onDrag }: { dir: 'x' | 'y'; onDrag: (delta: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className={`splitter ${dir}`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = dir === 'x' ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const cur = dir === 'x' ? e.clientX : e.clientY;
        onDrag(cur - last.current);
        last.current = cur;
      }}
      onPointerUp={() => (last.current = null)}
    />
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const store = getStore();
      const st = store.state;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (st.modal) store.set({ modal: null });
        else if (st.presentation) store.set({ presentation: false });
        else if (st.tool !== 'select') setTool('select');
        else if (st.selectedKey) store.set({ selectedKey: null });
        return;
      }
      if (mod && k === 'k') {
        e.preventDefault();
        store.set({ modal: st.modal === 'palette' ? null : 'palette' });
        return;
      }
      if (st.modal) return;
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && k === 's') {
        e.preventDefault();
        void saveToMyLibrary();
      } else if (mod && k === 'e') {
        e.preventDefault();
        store.set({ modal: 'export' });
      } else if (mod) {
        return;
      } else if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        store.set({ presentation: !st.presentation });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selectedKey) {
          const sk = st.selectedKey;
          store.update((d) => {
            const tr = d.tracks.find((x) => x.id === sk.track);
            if (!tr) return;
            tr.keys.splice(sk.index, 1);
            if (!tr.keys.length) d.tracks = d.tracks.filter((x) => x !== tr);
          });
          store.set({ selectedKey: null });
        } else deleteSelected();
      } else if (e.key === 'ArrowRight' && !st.playing) {
        engine().step();
      } else if (k === 'r') restart();
      else if (k === 'l') store.set({ modal: 'presets' });
      else if (k === 'm') mutate();
      else if (k === 'c') toggleCompare();
      else if (k === 'f') store.set({ showPerf: !st.showPerf });
      else if (k === 'g') store.set({ showGizmos: !st.showGizmos });
      else if (k === 'k' && (st.selection.kind === 'emitter' || st.selection.kind === 'force')) {
        const base = `${st.selection.kind}:${st.selection.id}:position`;
        toggleKeyframe(`${base}.x`);
        toggleKeyframe(`${base}.y`);
      } else if (e.key === '?') store.set({ modal: 'shortcuts' });
      else if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const presentation = useStore((s) => s.presentation);
  const [left, setLeft] = usePanelSize('left', 250);
  const [right, setRight] = usePanelSize('right', 330);
  const [bottom, setBottom] = usePanelSize('bottom', 150);
  useShortcuts();

  return (
    <div className={`app ${presentation ? 'presentation' : ''}`}>
      {!presentation && <TopBar />}
      <div className="workspace" style={{ gridTemplateColumns: presentation ? '1fr' : `${left}px 5px 1fr 5px ${right}px` }}>
        {!presentation && (
          <>
            <aside className="panel left">
              <Outliner />
            </aside>
            <Splitter dir="x" onDrag={(d) => setLeft(Math.min(420, Math.max(190, left + d)))} />
          </>
        )}
        <div className="center" style={{ gridTemplateRows: presentation ? '1fr' : `1fr 5px ${bottom}px` }}>
          <Viewport />
          {!presentation && (
            <>
              <Splitter dir="y" onDrag={(d) => setBottom(Math.min(420, Math.max(96, bottom - d)))} />
              <Timeline />
            </>
          )}
        </div>
        {!presentation && (
          <>
            <Splitter dir="x" onDrag={(d) => setRight(Math.min(520, Math.max(270, right - d)))} />
            <aside className="panel right">
              <Inspector />
            </aside>
          </>
        )}
      </div>
      {presentation && (
        <button className="exit-presentation" onClick={() => getStore().set({ presentation: false })}>
          Esc · Präsentationsmodus beenden
        </button>
      )}
      <Modals />
      <Toasts />
    </div>
  );
}
