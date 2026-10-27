import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { PRESETS } from '../../presets';
import { getStore, useStore } from '../store';
import { engine } from '../engine';
import {
  addEmitter,
  addForce,
  copyShareLink,
  duplicateSelected,
  deleteSelected,
  exportJson,
  loadPreset,
  mutate,
  newScene,
  recordVideo,
  restart,
  saveToMyLibrary,
  screenshot,
  setTool,
  toggleCompare,
  togglePlay,
  undo,
  redo,
} from '../actions';
import { renderThumbnail, cachedThumbnail } from '../thumbnails';
import { LibraryEntry, deleteFromLibrary, listLibrary } from '../../serialization/storage';
import { migrateScene } from '../../serialization/schema';
import { hashString } from '../../engine/rng';
import { IconCamera, IconDownload, IconLink, IconRecord, IconSave, IconSearch, IconStop, IconTrash, IconX } from '../components/icons';

function Modal({ children, wide, onClose }: { children: ReactNode; wide?: boolean; onClose?: () => void }) {
  const close = onClose ?? (() => getStore().set({ modal: null }));
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog">
        <button className="icon-btn modal-close" onClick={close} title="Schließen (Esc)">
          <IconX size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

function PresetCard({ id, name, description, tags, accent, index, onClick }: { id: string; name: string; description: string; tags: string[]; accent: string; index: number; onClick: () => void }) {
  // the cache key contains a hash of the preset, so tuning a preset invalidates its thumbnail
  const key = useMemo(() => `preset:${id}:${hashString(JSON.stringify(PRESETS.find((x) => x.id === id)!.build()))}`, [id]);
  const [src, setSrc] = useState<string | null>(() => cachedThumbnail(key));
  useEffect(() => {
    if (src) return;
    let alive = true;
    const p = PRESETS.find((x) => x.id === id)!;
    renderThumbnail(key, p.build())
      .then((url) => alive && setSrc(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, key, src]);
  return (
    <button className="preset-card" onClick={onClick} style={{ ['--accent' as any]: accent }}>
      <div className="preset-thumb">
        {src ? <img src={src} alt={name} /> : <div className="thumb-loading"><span /></div>}
        <span className="preset-index">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="preset-info">
        <b>{name}</b>
        <p>{description}</p>
        <div className="tags">
          {tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    </button>
  );
}

function PresetBrowser() {
  const [tab, setTab] = useState<'presets' | 'mine'>('presets');
  const [q, setQ] = useState('');
  const [lib, setLib] = useState<LibraryEntry[]>([]);
  useEffect(() => {
    void listLibrary().then(setLib);
  }, []);
  const ql = q.toLowerCase();
  const presets = PRESETS.filter((p) => !ql || (p.name + p.description + p.tags.join(' ')).toLowerCase().includes(ql));
  const mine = lib.filter((e) => !ql || e.name.toLowerCase().includes(ql));
  return (
    <Modal wide>
      <div className="modal-head">
        <h2>Effektbibliothek</h2>
        <div className="tabs">
          <button className={tab === 'presets' ? 'on' : ''} onClick={() => setTab('presets')}>
            Presets <span>{PRESETS.length}</span>
          </button>
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
            Meine Effekte <span>{lib.length}</span>
          </button>
        </div>
        <div className="search">
          <IconSearch size={14} />
          <input autoFocus placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
      </div>
      {tab === 'presets' ? (
        <div className="preset-grid">
          {presets.map((p) => (
            <PresetCard key={p.id} {...p} index={PRESETS.indexOf(p)} onClick={() => loadPreset(p.id)} />
          ))}
          <button className="preset-card new" onClick={newScene}>
            <div className="preset-thumb plus">+</div>
            <div className="preset-info">
              <b>Leerer Effekt</b>
              <p>Starte mit einer einfachen Fontäne und baue deinen eigenen Effekt.</p>
            </div>
          </button>
        </div>
      ) : (
        <div className="preset-grid">
          {mine.map((e) => (
            <div className="preset-card" key={e.id}>
              <button
                className="preset-thumb"
                onClick={() => {
                  getStore().replaceScene(migrateScene(e.scene));
                  engine().restart();
                  getStore().set({ modal: null, playing: true });
                }}
              >
                {e.thumbnail ? <img src={e.thumbnail} alt={e.name} /> : <div className="thumb-loading" />}
              </button>
              <div className="preset-info">
                <b>{e.name}</b>
                <p>{new Date(e.savedAt).toLocaleString('de-DE')}</p>
                <button
                  className="icon-btn"
                  title="Löschen"
                  onClick={async () => {
                    await deleteFromLibrary(e.id);
                    setLib(await listLibrary());
                  }}
                >
                  <IconTrash size={13} />
                </button>
              </div>
            </div>
          ))}
          {mine.length === 0 && <div className="empty big">Noch nichts gespeichert. Mit Strg+S landet der aktuelle Effekt hier.</div>}
        </div>
      )}
    </Modal>
  );
}

function ExportDialog() {
  const recording = useStore((s) => s.recording);
  const duration = useStore((s) => s.scene.duration);
  const [seconds, setSeconds] = useState(Math.min(10, duration));
  const [fromStart, setFromStart] = useState(true);
  const canRecord = typeof MediaRecorder !== 'undefined';
  return (
    <Modal>
      <div className="modal-head">
        <h2>Export & Teilen</h2>
      </div>
      <div className="export-grid">
        <button className="export-card" onClick={() => void screenshot()}>
          <IconCamera size={22} />
          <b>Screenshot</b>
          <span>PNG in aktueller Renderauflösung</span>
        </button>
        <button className="export-card" onClick={exportJson}>
          <IconDownload size={22} />
          <b>Preset (JSON)</b>
          <span>Versioniertes Schema, jederzeit importierbar</span>
        </button>
        <button className="export-card" onClick={() => void copyShareLink()}>
          <IconLink size={22} />
          <b>Share-Link</b>
          <span>Kompletter Effekt komprimiert in der URL</span>
        </button>
        <button className="export-card" onClick={() => void saveToMyLibrary()}>
          <IconSave size={22} />
          <b>In Bibliothek</b>
          <span>Lokal in IndexedDB mit Vorschaubild</span>
        </button>
      </div>
      <div className="video-export">
        <h3>Video aufnehmen</h3>
        {!canRecord && <div className="hint">MediaRecorder wird von diesem Browser nicht unterstützt.</div>}
        <div className="field">
          <label>Länge</label>
          <input className="range-input" type="range" min={0} max={60} step={1} value={seconds} onChange={(e) => setSeconds(+e.target.value)} />
          <span className="mono">{seconds === 0 ? 'manuell' : `${seconds}s`}</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={fromStart} onChange={(e) => setFromStart(e.target.checked)} /> Ab Timeline-Anfang (deterministisch reproduzierbar)
        </label>
        <button className={`btn ${recording.active ? 'rec' : 'primary'}`} disabled={!canRecord} onClick={() => void recordVideo(seconds, fromStart)}>
          {recording.active ? <IconStop size={13} /> : <IconRecord size={13} />}
          {recording.active ? `Aufnahme stoppen (${recording.elapsed.toFixed(1)}s)` : 'Aufnahme starten'}
        </button>
        <div className="hint">WebM (VP9/VP8) oder MP4 – je nach Browser-Codec. 60 fps, 18 Mbit/s.</div>
      </div>
    </Modal>
  );
}

interface Command {
  id: string;
  label: string;
  group: string;
  keys?: string;
  run: () => void;
}

function useCommands(): Command[] {
  return useMemo(
    () => [
      ...PRESETS.map((p) => ({ id: `preset:${p.id}`, label: `Preset laden: ${p.name}`, group: 'Presets', run: () => loadPreset(p.id) })),
      { id: 'play', label: 'Play / Pause', group: 'Wiedergabe', keys: 'Space', run: togglePlay },
      { id: 'restart', label: 'Neustart', group: 'Wiedergabe', keys: 'R', run: restart },
      { id: 'undo', label: 'Rückgängig', group: 'Bearbeiten', keys: 'Ctrl+Z', run: undo },
      { id: 'redo', label: 'Wiederholen', group: 'Bearbeiten', keys: 'Ctrl+Y', run: redo },
      { id: 'dup', label: 'Auswahl duplizieren', group: 'Bearbeiten', keys: 'Ctrl+D', run: duplicateSelected },
      { id: 'del', label: 'Auswahl löschen', group: 'Bearbeiten', keys: 'Del', run: deleteSelected },
      { id: 'evolve', label: 'Evolve: Variation erzeugen', group: 'Kreativ', keys: 'M', run: () => mutate() },
      { id: 'evolve-wild', label: 'Evolve: wilde Mutation', group: 'Kreativ', run: () => mutate(0.8) },
      { id: 'ab', label: 'A/B-Vergleich umschalten', group: 'Kreativ', keys: 'C', run: toggleCompare },
      { id: 'new', label: 'Neuer leerer Effekt', group: 'Datei', run: newScene },
      { id: 'save', label: 'In „Meine Effekte“ speichern', group: 'Datei', keys: 'Ctrl+S', run: () => void saveToMyLibrary() },
      { id: 'json', label: 'Als JSON exportieren', group: 'Datei', run: exportJson },
      { id: 'share', label: 'Share-Link kopieren', group: 'Datei', run: () => void copyShareLink() },
      { id: 'png', label: 'Screenshot (PNG)', group: 'Datei', run: () => void screenshot() },
      { id: 'video', label: 'Video aufnehmen (10s)', group: 'Datei', run: () => void recordVideo(10, true) },
      { id: 'em-circle', label: 'Emitter hinzufügen: Circle', group: 'Hinzufügen', run: () => addEmitter('circle') },
      { id: 'em-text', label: 'Emitter hinzufügen: Text', group: 'Hinzufügen', run: () => addEmitter('text') },
      { id: 'em-gpu', label: 'GPU-Swarm hinzufügen (130k)', group: 'Hinzufügen', run: () => addEmitter('circle', 'gpu') },
      { id: 'em-bolt', label: 'Emitter hinzufügen: Lightning', group: 'Hinzufügen', run: () => addEmitter('lightning') },
      { id: 'fx-vortex', label: 'Kraft hinzufügen: Vortex', group: 'Hinzufügen', run: () => addForce('vortex') },
      { id: 'fx-turb', label: 'Kraft hinzufügen: Turbulence', group: 'Hinzufügen', run: () => addForce('turbulence') },
      { id: 'fx-flow', label: 'Kraft hinzufügen: Painted Flow', group: 'Hinzufügen', run: () => addForce('flowfield') },
      { id: 'fx-fluid', label: 'Kraft hinzufügen: Fluid (SPH-lite)', group: 'Hinzufügen', run: () => addForce('fluid') },
      { id: 'fx-attr', label: 'Kraft hinzufügen: Attractor', group: 'Hinzufügen', run: () => addForce('attractor') },
      { id: 'tool-paint', label: 'Werkzeug: Kraftfeld malen', group: 'Werkzeuge', keys: 'B', run: () => setTool('paint') },
      { id: 'tool-emit', label: 'Werkzeug: Partikel sprühen', group: 'Werkzeuge', keys: 'P', run: () => setTool('emit') },
      { id: 'perf', label: 'Performance-Overlay umschalten', group: 'Ansicht', keys: 'F', run: () => getStore().set({ showPerf: !getStore().state.showPerf }) },
      { id: 'gizmos', label: 'Gizmos umschalten', group: 'Ansicht', keys: 'G', run: () => getStore().set({ showGizmos: !getStore().state.showGizmos }) },
      { id: 'present', label: 'Präsentationsmodus', group: 'Ansicht', keys: 'Tab', run: () => getStore().set({ presentation: true }) },
      { id: 'shortcuts', label: 'Tastenkürzel anzeigen', group: 'Hilfe', keys: '?', run: () => getStore().set({ modal: 'shortcuts' }) },
    ],
    [],
  );
}

function CommandPalette() {
  const cmds = useCommands();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return cmds.filter((c) => words.every((w) => (c.label + ' ' + c.group).toLowerCase().includes(w)));
  }, [q, cmds]);
  const run = (c: Command | undefined) => {
    if (!c) return;
    getStore().set({ modal: null });
    c.run();
  };
  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);
  return (
    <Modal>
      <div className="palette">
        <div className="search big">
          <IconSearch size={16} />
          <input
            autoFocus
            placeholder="Befehl oder Preset suchen…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'ArrowDown') setIdx((i) => Math.min(filtered.length - 1, i + 1));
              else if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1));
              else if (e.key === 'Enter') run(filtered[idx]);
              else if (e.key === 'Escape') getStore().set({ modal: null });
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.map((c, i) => (
            <button key={c.id} className={`palette-item ${i === idx ? 'sel' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => run(c)}>
              <span className="group">{c.group}</span>
              <span className="label">{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </button>
          ))}
          {filtered.length === 0 && <div className="empty">Nichts gefunden.</div>}
        </div>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Leertaste', 'Play / Pause'],
  ['R', 'Neustart'],
  ['→', 'Einzelschritt (pausiert)'],
  ['Strg + Z / Strg + Y', 'Rückgängig / Wiederholen'],
  ['Strg + D', 'Duplizieren'],
  ['Entf', 'Auswahl / Keyframe löschen'],
  ['Strg + K', 'Befehlspalette'],
  ['Strg + S', 'In Bibliothek speichern'],
  ['Strg + E', 'Export-Dialog'],
  ['L', 'Effektbibliothek'],
  ['V A S W B E P', 'Werkzeuge: Auswahl, Anziehen, Abstoßen, Wirbel, Malen, Radieren, Sprühen'],
  ['M', 'Evolve (Variation)'],
  ['C', 'A/B-Vergleich'],
  ['K', 'Positions-Keyframe für Auswahl setzen'],
  ['F / G', 'Performance-Overlay / Gizmos'],
  ['Tab', 'Präsentationsmodus'],
  ['Mausrad / Mitteltaste', 'Zoom / Pan im Viewport'],
  ['Doppelklick', 'Kamera zurücksetzen'],
];

function Shortcuts() {
  return (
    <Modal>
      <div className="modal-head">
        <h2>Tastenkürzel</h2>
      </div>
      <div className="shortcut-list">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="shortcut">
            <kbd>{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function About() {
  return (
    <Modal>
      <div className="about">
        <div className="logo big">
          <span />
        </div>
        <h2>Particle Playground</h2>
        <p>Ein browserbasiertes VFX-Studio mit hybrider CPU/GPU-Partikel-Engine.</p>
        <ul>
          <li>
            <b>Deterministische Zeitreise</b> – fester Zeitschritt, Seed-RNG und Snapshot-Cache machen die Timeline vor- und rückwärts scrubbar.
          </li>
          <li>
            <b>Hybride Engine</b> – SoA-Typed-Arrays auf der CPU (Sub-Emitter, Formationen, SPH-lite) plus GPU-Swarm per WebGL2 Transform Feedback.
          </li>
          <li>
            <b>HDR-Pipeline</b> – RGBA16F, physikalisch motivierter Bloom (13-Tap-Pyramide), ACES/AgX, chromatische Aberration, Filmkorn.
          </li>
          <li>
            <b>Kreativwerkzeuge</b> – Kraftfelder malen, Evolve-Mutationen, A/B-Vergleich, Audio-Reaktivität, Keyframes mit Auto-Key.
          </li>
          <li>
            <b>Teilen</b> – Effekte als komprimierter Link, versioniertes JSON, PNG und Video.
          </li>
        </ul>
        <button className="btn ghost" onClick={() => getStore().set({ modal: 'shortcuts' })}>
          Tastenkürzel anzeigen
        </button>
      </div>
    </Modal>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  if (modal === 'presets') return <PresetBrowser />;
  if (modal === 'export') return <ExportDialog />;
  if (modal === 'palette') return <CommandPalette />;
  if (modal === 'shortcuts') return <Shortcuts />;
  if (modal === 'about') return <About />;
  return null;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
