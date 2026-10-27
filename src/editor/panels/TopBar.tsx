import { useRef } from 'react';
import { getStore, Quality, Tool, useStore } from '../store';
import { engine } from '../engine';
import { importFile, mutate, redo, setTool, toggleCompare, togglePlay, undo } from '../actions';
import {
  IconBrush,
  IconChart,
  IconCommand,
  IconCompare,
  IconCursor,
  IconDna,
  IconDownload,
  IconEraser,
  IconGrid,
  IconMagnet,
  IconMaximize,
  IconPause,
  IconPlay,
  IconRecord,
  IconRedo,
  IconSpray,
  IconSwirl,
  IconUndo,
  IconUpload,
  IconBurst,
} from '../components/icons';

const TOOLS: { id: Tool; icon: JSX.Element; label: string; key: string }[] = [
  { id: 'select', icon: <IconCursor size={15} />, label: 'Auswählen', key: 'V' },
  { id: 'attract', icon: <IconMagnet size={15} />, label: 'Anziehen', key: 'A' },
  { id: 'repel', icon: <IconBurst size={15} />, label: 'Abstoßen', key: 'S' },
  { id: 'swirl', icon: <IconSwirl size={15} />, label: 'Wirbeln', key: 'W' },
  { id: 'paint', icon: <IconBrush size={15} />, label: 'Kraftfeld malen', key: 'B' },
  { id: 'erase', icon: <IconEraser size={15} />, label: 'Kraftfeld radieren', key: 'E' },
  { id: 'emit', icon: <IconSpray size={15} />, label: 'Partikel sprühen', key: 'P' },
];

/** Tool buttons plus radius/strength options; used in the top bar and in the phone tool sheet. */
export function ToolStrip({ showLabels = false }: { showLabels?: boolean }) {
  const tool = useStore((s) => s.tool);
  const toolRadius = useStore((s) => s.toolRadius);
  const toolStrength = useStore((s) => s.toolStrength);
  return (
    <>
      <div className="tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? 'on' : ''}`} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
            {t.icon}
            {showLabels && <span className="tool-label">{t.label}</span>}
          </button>
        ))}
      </div>
      {tool !== 'select' && (
        <div className="tool-opts">
          <label>
            Radius
            <input type="range" min={2} max={50} step={0.5} value={toolRadius} onChange={(e) => getStore().set({ toolRadius: +e.target.value })} />
          </label>
          {tool !== 'paint' && tool !== 'erase' && (
            <label>
              Stärke
              <input type="range" min={20} max={800} step={5} value={toolStrength} onChange={(e) => getStore().set({ toolStrength: +e.target.value })} />
            </label>
          )}
        </div>
      )}
    </>
  );
}

export function TopBar() {
  const playing = useStore((s) => s.playing);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const name = useStore((s) => s.scene.name);
  const showPerf = useStore((s) => s.showPerf);
  const quality = useStore((s) => s.quality);
  const compare = useStore((s) => s.compare);
  const recording = useStore((s) => s.recording);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <div className="brand" onClick={() => getStore().set({ modal: 'about' })} title="Über Particle Playground">
        <div className="logo">
          <span />
        </div>
        <div className="brand-text">
          <b>Particle Playground</b>
          <small>VFX Studio</small>
        </div>
      </div>

      <button className="btn primary" onClick={() => getStore().set({ modal: 'presets' })} title="Effektbibliothek (L)">
        <IconGrid size={14} /> <span className="lbl">Bibliothek</span>
      </button>
      <div className="scene-name" title={name}>
        {name}
      </div>

      <div className="divider" />
      <div className="btn-group">
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Rückgängig (Strg+Z)">
          <IconUndo size={15} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Wiederholen (Strg+Y)">
          <IconRedo size={15} />
        </button>
      </div>
      <button className="play-btn" onClick={togglePlay} title="Play / Pause (Leertaste)">
        {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
      </button>

      <div className="divider" />
      <div className="topbar-tools">
        <ToolStrip />
      </div>

      <div className="grow" />

      <button className="btn ghost" onClick={() => mutate()} title="Evolve: Variation erzeugen (M)">
        <IconDna size={14} /> <span className="lbl">Evolve</span>
      </button>
      <button
        className={`btn ghost ab-btn ${compare.a && compare.b ? 'ab-ready' : ''}`}
        onClick={toggleCompare}
        title="A/B-Vergleich: 1. Klick speichert A, 2. Klick speichert B, danach umschalten (C)"
      >
        <IconCompare size={14} />
        {compare.a && compare.b ? <span className="ab">{compare.active?.toUpperCase()}</span> : compare.a ? 'B merken' : 'A/B'}
      </button>

      <div className="divider" />
      <select
        className="select compact"
        value={quality}
        onChange={(e) => {
          getStore().set({ quality: e.target.value as Quality });
          engine().setQuality();
        }}
        title="Renderqualität"
      >
        <option value="auto">Qualität: Auto</option>
        <option value="low">Low (50%)</option>
        <option value="medium">Medium (75%)</option>
        <option value="high">High (100%)</option>
        <option value="ultra">Ultra (150%)</option>
      </select>
      <button className={`icon-btn perf-btn ${showPerf ? 'on' : ''}`} onClick={() => getStore().set({ showPerf: !showPerf })} title="Performance-Overlay (F)">
        <IconChart size={15} />
      </button>
      <button className="icon-btn import-btn" onClick={() => fileRef.current?.click()} title="Importieren (JSON oder Bild)">
        <IconUpload size={15} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json,image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
      />
      <button className={`btn ${recording.active ? 'rec' : ''}`} onClick={() => getStore().set({ modal: 'export' })} title="Export (Strg+E)">
        {recording.active ? <IconRecord size={12} /> : <IconDownload size={14} />}
        <span className="lbl">{recording.active ? `REC ${recording.elapsed.toFixed(1)}s` : 'Export'}</span>
      </button>
      <button className="icon-btn palette-btn" onClick={() => getStore().set({ modal: 'palette' })} title="Befehlspalette (Strg+K)">
        <IconCommand size={15} />
      </button>
      <button className="icon-btn" onClick={() => getStore().set({ presentation: true })} title="Präsentationsmodus (Tab)">
        <IconMaximize size={15} />
      </button>
    </header>
  );
}
