import { useEffect, useRef, useState } from 'react';
import type { ForceType, ShapeType } from '../../engine/types';
import { useStore, getStore } from '../store';
import { addEmitter, addForce, duplicateSelected, deleteSelected, selectEmitter, selectForce, toggleEnabled } from '../actions';
import { engine } from '../engine';
import { IconCopy, IconEmitter, IconEye, IconEyeOff, IconForce, IconPlus, IconScene, IconSparkle, IconTrash } from '../components/icons';

const EMITTER_SHAPES: { value: ShapeType; label: string; gpu?: boolean }[] = [
  { value: 'point', label: 'Point' },
  { value: 'circle', label: 'Circle' },
  { value: 'ring', label: 'Ring' },
  { value: 'rect', label: 'Rectangle' },
  { value: 'line', label: 'Line' },
  { value: 'cone', label: 'Cone' },
  { value: 'spiral', label: 'Spiral' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'star', label: 'Star' },
  { value: 'heart', label: 'Heart' },
  { value: 'text', label: 'Text' },
  { value: 'lightning', label: 'Lightning' },
];

const FORCES: { value: ForceType; label: string; desc: string }[] = [
  { value: 'gravity', label: 'Gravity', desc: 'Konstante Beschleunigung' },
  { value: 'attractor', label: 'Attractor', desc: 'Anziehung / Abstoßung zu einem Punkt' },
  { value: 'vortex', label: 'Vortex', desc: 'Rotierende Wirbel' },
  { value: 'turbulence', label: 'Turbulence', desc: 'Curl-Noise-Strömung' },
  { value: 'wind', label: 'Wind', desc: 'Böiger Wind' },
  { value: 'drag', label: 'Drag', desc: 'Luftwiderstand' },
  { value: 'pointer', label: 'Pointer Field', desc: 'Reagiert auf die Maus' },
  { value: 'flowfield', label: 'Painted Flow', desc: 'Kraftfeld mit dem Pinsel malen' },
  { value: 'fluid', label: 'Fluid (SPH-lite)', desc: 'Druck + Viskosität zwischen Nachbarn' },
  { value: 'collider', label: 'Collider', desc: 'Kreis- oder Ebenenhindernis' },
  { value: 'bounds', label: 'Bounds', desc: 'Abprallen / Wrap an den Rändern' },
];

function AddMenu({ items, onPick, label }: { items: { value: string; label: string; desc?: string }[]; onPick: (v: string, gpu?: boolean) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="add-menu" ref={ref}>
      <button className="icon-btn" title={label} onClick={() => setOpen(!open)}>
        <IconPlus size={14} />
      </button>
      {open && (
        <div className="menu">
          {items.map((it) => (
            <button
              key={it.value}
              className="menu-item"
              onClick={() => {
                onPick(it.value);
                setOpen(false);
              }}
            >
              <span>{it.label}</span>
              {it.desc && <small>{it.desc}</small>}
            </button>
          ))}
          {label.includes('Emitter') && (
            <button
              className="menu-item gpu"
              onClick={() => {
                onPick('circle', true);
                setOpen(false);
              }}
            >
              <span>
                <IconSparkle size={12} /> GPU Swarm
              </span>
              <small>130k+ Partikel per Transform Feedback</small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CountBadge({ index }: { index: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    return engine().onFrame(() => {
      if (++frame % 15 || !ref.current) return;
      const n = engine().sim.emitterCount(index);
      ref.current.textContent = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    });
  }, [index]);
  return <span className="count" ref={ref} />;
}

export function Outliner() {
  const emitters = useStore((s) => s.scene.emitters);
  const forces = useStore((s) => s.scene.forces);
  const sel = useStore((s) => s.selection);
  const name = useStore((s) => s.scene.name);

  return (
    <div className="outliner">
      <div className="panel-title">Szene</div>
      <button className={`row ${sel.kind === 'scene' ? 'sel' : ''}`} onClick={() => getStore().set({ selection: { kind: 'scene' } })}>
        <IconScene size={14} className="row-icon" />
        <span className="row-name">{name}</span>
      </button>
      <button className={`row ${sel.kind === 'render' ? 'sel' : ''}`} onClick={() => getStore().set({ selection: { kind: 'render' } })}>
        <IconSparkle size={14} className="row-icon" />
        <span className="row-name">Rendering & Post-FX</span>
      </button>

      <div className="panel-title">
        <span>Emitter</span>
        <AddMenu label="Emitter hinzufügen" items={EMITTER_SHAPES} onPick={(v, gpu) => addEmitter(v as ShapeType, gpu ? 'gpu' : 'cpu')} />
      </div>
      {emitters.map((e, i) => (
        <div
          key={e.id}
          className={`row ${sel.kind === 'emitter' && sel.id === e.id ? 'sel' : ''} ${e.enabled ? '' : 'disabled'}`}
          onClick={() => selectEmitter(e.id)}
          role="button"
          tabIndex={0}
        >
          <IconEmitter size={14} className="row-icon" />
          <span className="row-name">{e.name}</span>
          {e.backend === 'gpu' ? <span className="badge gpu">GPU</span> : <CountBadge index={i} />}
          <button
            className="row-action"
            title={e.enabled ? 'Deaktivieren' : 'Aktivieren'}
            onClick={(ev) => {
              ev.stopPropagation();
              toggleEnabled('emitter', e.id);
            }}
          >
            {e.enabled ? <IconEye size={13} /> : <IconEyeOff size={13} />}
          </button>
        </div>
      ))}
      {emitters.length === 0 && <div className="empty">Noch keine Emitter – füge einen mit + hinzu.</div>}

      <div className="panel-title">
        <span>Kräfte</span>
        <AddMenu label="Kraft hinzufügen" items={FORCES.map((f) => ({ value: f.value, label: f.label, desc: f.desc }))} onPick={(v) => addForce(v as ForceType)} />
      </div>
      {forces.map((f) => (
        <div
          key={f.id}
          className={`row ${sel.kind === 'force' && sel.id === f.id ? 'sel' : ''} ${f.enabled ? '' : 'disabled'}`}
          onClick={() => selectForce(f.id)}
          role="button"
          tabIndex={0}
        >
          <IconForce size={14} className="row-icon force" />
          <span className="row-name">{f.name}</span>
          <span className="badge">{f.type}</span>
          <button
            className="row-action"
            title={f.enabled ? 'Deaktivieren' : 'Aktivieren'}
            onClick={(ev) => {
              ev.stopPropagation();
              toggleEnabled('force', f.id);
            }}
          >
            {f.enabled ? <IconEye size={13} /> : <IconEyeOff size={13} />}
          </button>
        </div>
      ))}
      {forces.length === 0 && <div className="empty">Keine Kräfte aktiv.</div>}

      {(sel.kind === 'emitter' || sel.kind === 'force') && (
        <div className="outliner-actions">
          <button className="btn ghost small" onClick={duplicateSelected} title="Duplizieren (Strg+D)">
            <IconCopy size={13} /> Duplizieren
          </button>
          <button className="btn ghost small danger" onClick={deleteSelected} title="Löschen (Entf)">
            <IconTrash size={13} /> Löschen
          </button>
        </div>
      )}
    </div>
  );
}
