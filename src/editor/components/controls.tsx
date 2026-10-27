import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { CurvePoint, GradientStop, SceneConfig } from '../../engine/types';
import { evalTrack, getPath, resolveTarget, setPath } from '../../engine/tracks';
import { gradientCss, evalGradient, rgbToHex } from '../../engine/color';
import { uid } from '../../engine/defaults';
import { getStore, useStore } from '../store';
import { IconChevron, IconKeyframe, IconTrash } from './icons';

// ───────────────────────────── target binding ─────────────────────────────

const KEY_EPS = 1 / 120;

/** Read a value; animated targets show the evaluated keyframe value at the playhead. */
export function readTarget(scene: SceneConfig, target: string, time: number): any {
  const tr = scene.tracks.find((t) => t.target === target);
  if (tr && tr.keys.length) return evalTrack(tr, Math.max(0, time));
  const r = resolveTarget(scene, target);
  return r ? getPath(r.obj, r.path) : undefined;
}

/**
 * Central edit entry point. If the target is animated, the edit becomes a
 * keyframe at the playhead ("auto-key"), otherwise it changes the base value.
 */
export function editTarget(target: string, value: any, coalesce = true): void {
  const store = getStore();
  const { scene, time } = store.state;
  const track = scene.tracks.find((t) => t.target === target);
  if (track && typeof value === 'number') {
    store.update((d) => {
      const tr = d.tracks.find((t) => t.target === target)!;
      const k = tr.keys.find((k) => Math.abs(k.t - time) < KEY_EPS);
      if (k) k.v = value;
      else {
        tr.keys.push({ t: Math.max(0, time), v: value, ease: 'smooth' });
        tr.keys.sort((a, b) => a.t - b.t);
      }
    }, coalesce ? `key:${target}` : undefined);
    return;
  }
  store.update((d) => {
    const r = resolveTarget(d, target);
    if (r) setPath(r.obj, r.path, value);
  }, coalesce ? target : undefined);
}

export function toggleKeyframe(target: string): void {
  const store = getStore();
  const { scene, time } = store.state;
  const value = readTarget(scene, target, time);
  if (typeof value !== 'number') return;
  store.update((d) => {
    let tr = d.tracks.find((t) => t.target === target);
    if (!tr) {
      tr = { id: uid('tr'), target, keys: [] };
      d.tracks.push(tr);
    }
    const idx = tr.keys.findIndex((k) => Math.abs(k.t - time) < KEY_EPS);
    if (idx >= 0) {
      tr.keys.splice(idx, 1);
      if (tr.keys.length === 0) d.tracks = d.tracks.filter((t) => t !== tr);
    } else {
      tr.keys.push({ t: Math.max(0, time), v: value, ease: 'smooth' });
      tr.keys.sort((a, b) => a.t - b.t);
    }
  });
}

function KeyButton({ target }: { target: string }) {
  const state = useStore((s) => {
    const tr = s.scene.tracks.find((t) => t.target === target);
    if (!tr) return 0;
    return tr.keys.some((k) => Math.abs(k.t - s.time) < KEY_EPS) ? 2 : 1;
  });
  return (
    <button
      className={`key-btn ${state === 2 ? 'on' : state === 1 ? 'anim' : ''}`}
      title={state === 2 ? 'Keyframe entfernen' : 'Keyframe setzen (Auto-Key aktiv, sobald animiert)'}
      onClick={() => toggleKeyframe(target)}
    >
      <IconKeyframe size={11} />
    </button>
  );
}

// ───────────────────────────── primitives ─────────────────────────────

function fmt(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '∞';
  if (Math.abs(v) >= 10000) return v.toFixed(0);
  return v.toFixed(decimals).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m)) || '0';
}

interface ScrubProps {
  value: number;
  onChange: (v: number, final: boolean) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  unit?: string;
  className?: string;
  title?: string;
}

/** Number input with click-to-type and drag-to-scrub (Shift = fine, Ctrl = coarse). */
export function ScrubNumber({ value, onChange, step = 0.1, min = -Infinity, max = Infinity, decimals = 2, unit, className, title }: ScrubProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 2) d.moved = true;
    if (!d.moved) return;
    const mul = e.shiftKey ? 0.1 : e.ctrlKey || e.metaKey ? 10 : 1;
    onChange(clamp(+(d.v + Math.round(dx / 2) * step * mul).toFixed(6)), false);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      setText(fmt(value, decimals));
      setEditing(true);
    } else if (d) onChange(value, true);
  };
  if (editing) {
    return (
      <input
        className={`scrub-input ${className ?? ''}`}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          setEditing(false);
          const v = parseFloat(text.replace(',', '.'));
          if (Number.isFinite(v)) onChange(clamp(v), true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <span className={`scrub ${className ?? ''}`} title={title ?? 'Ziehen zum Ändern · Klicken zum Eingeben'} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {fmt(value, decimals)}
      {unit && <em>{unit}</em>}
    </span>
  );
}

interface NumProps {
  label: string;
  target: string;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  unit?: string;
  pow?: number;
  hardMin?: number;
  hardMax?: number;
  keyable?: boolean;
  hint?: string;
}

/** Labelled slider + scrubbable value + keyframe diamond, bound to a scene target. */
export function Num({ label, target, min, max, step, decimals = 2, unit, pow = 1, hardMin, hardMax, keyable = true, hint }: NumProps) {
  const value = useStore((s) => readTarget(s.scene, target, s.time)) as number;
  const st = step ?? (max - min) / 200;
  const trackRef = useRef<HTMLDivElement>(null);
  const toT = (v: number) => Math.pow(Math.min(1, Math.max(0, (v - min) / (max - min))), 1 / pow);
  const fromT = (t: number) => min + Math.pow(Math.min(1, Math.max(0, t)), pow) * (max - min);
  const snap = (v: number) => +(Math.round(v / st) * st).toFixed(6);
  const lo = hardMin ?? (min >= 0 ? 0 : -Infinity);
  const hi = hardMax ?? Infinity;

  const setFromEvent = (e: React.PointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect();
    editTarget(target, snap(fromT((e.clientX - r.left) / r.width)));
  };
  return (
    <div className="field" title={hint}>
      <label>{label}</label>
      <div
        className="slider"
        ref={trackRef}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setFromEvent(e);
        }}
        onPointerMove={(e) => e.buttons & 1 && setFromEvent(e)}
      >
        <div className="slider-fill" style={{ width: `${toT(value ?? 0) * 100}%` }} />
        <div className="slider-thumb" style={{ left: `${toT(value ?? 0) * 100}%` }} />
      </div>
      <ScrubNumber value={value ?? 0} step={st} decimals={decimals} unit={unit} min={lo} max={hi} onChange={(v) => editTarget(target, v)} />
      {keyable ? <KeyButton target={target} /> : <span className="key-spacer" />}
    </div>
  );
}

/** Min/max pair (each end is individually keyable). */
export function RangeNum({ label, target, step = 0.1, decimals = 2, unit, min = 0, max = Infinity }: { label: string; target: string; step?: number; decimals?: number; unit?: string; min?: number; max?: number }) {
  const a = useStore((s) => readTarget(s.scene, `${target}.0`, s.time)) as number;
  const b = useStore((s) => readTarget(s.scene, `${target}.1`, s.time)) as number;
  return (
    <div className="field range-field">
      <label>{label}</label>
      <div className="range-pair">
        <ScrubNumber value={a} step={step} decimals={decimals} unit={unit} min={min} max={max} onChange={(v) => editTarget(`${target}.0`, v)} />
        <span className="range-sep">–</span>
        <ScrubNumber value={b} step={step} decimals={decimals} unit={unit} min={min} max={max} onChange={(v) => editTarget(`${target}.1`, v)} />
      </div>
      <span className="key-spacer" />
    </div>
  );
}

export function Vec2({ label, target, step = 0.5 }: { label: string; target: string; step?: number }) {
  const x = useStore((s) => readTarget(s.scene, `${target}.x`, s.time)) as number;
  const y = useStore((s) => readTarget(s.scene, `${target}.y`, s.time)) as number;
  return (
    <div className="field range-field">
      <label>{label}</label>
      <div className="range-pair">
        <span className="axis">X</span>
        <ScrubNumber value={x} step={step} decimals={1} onChange={(v) => editTarget(`${target}.x`, v)} />
        <span className="axis">Y</span>
        <ScrubNumber value={y} step={step} decimals={1} onChange={(v) => editTarget(`${target}.y`, v)} />
      </div>
      <KeyButton target={`${target}.x`} />
    </div>
  );
}

export function Select<T extends string>({ label, target, options }: { label: string; target: string; options: { value: T; label: string }[] }) {
  const value = useStore((s) => readTarget(s.scene, target, s.time)) as T;
  return (
    <div className="field">
      <label>{label}</label>
      <select className="select" value={value} onChange={(e) => editTarget(target, e.target.value, false)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="key-spacer" />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, target, hint }: { label: string; target: string; hint?: string }) {
  const value = useStore((s) => readTarget(s.scene, target, s.time)) as boolean;
  return (
    <div className="field" title={hint}>
      <label>{label}</label>
      <button className={`switch ${value ? 'on' : ''}`} onClick={() => editTarget(target, !value, false)} aria-pressed={!!value}>
        <span />
      </button>
      <span className="key-spacer" />
    </div>
  );
}

export function TextField({ label, target, multiline }: { label: string; target: string; multiline?: boolean }) {
  const value = useStore((s) => readTarget(s.scene, target, s.time)) as string;
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  const commit = () => local !== value && editTarget(target, local, false);
  return (
    <div className="field text-field">
      <label>{label}</label>
      {multiline ? (
        <textarea className="text-input" value={local} rows={2} onChange={(e) => setLocal(e.target.value)} onBlur={commit} onKeyDown={(e) => e.stopPropagation()} />
      ) : (
        <input
          className="text-input"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      )}
    </div>
  );
}

export function ColorField({ label, target }: { label: string; target: string }) {
  const value = useStore((s) => readTarget(s.scene, target, s.time)) as string;
  return (
    <div className="field">
      <label>{label}</label>
      <label className="color-swatch" style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => editTarget(target, e.target.value)} />
      </label>
      <span className="color-hex">{value}</span>
      <span className="key-spacer" />
    </div>
  );
}

export function Section({ id, title, children, right, defaultOpen = true }: { id: string; title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(`pp-sec-${id}`);
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(`pp-sec-${id}`, open ? '0' : '1');
    } catch {
      /* ignore */
    }
  };
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header onClick={toggle}>
        <IconChevron size={12} className="chev" />
        <span>{title}</span>
        <div className="section-right" onClick={(e) => e.stopPropagation()}>
          {right}
        </div>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

// ───────────────────────────── gradient editor ─────────────────────────────

export function GradientEditor({ target }: { target: string }) {
  const stops = useStore((s) => readTarget(s.scene, target, 0)) as GradientStop[];
  const [sel, setSel] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const sorted = stops.map((s, i) => ({ ...s, i }));
  const cur = stops[Math.min(sel, stops.length - 1)];

  const write = useCallback(
    (next: GradientStop[], coalesce = true) => editTarget(target, next, coalesce),
    [target],
  );
  const tAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  return (
    <div className="gradient-editor">
      <div
        className="gradient-bar checker"
        ref={barRef}
        onDoubleClick={(e) => {
          const t = tAt(e.clientX);
          const c = evalGradient(stops, t);
          const toS = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
          const next = [...stops, { t, color: rgbToHex(toS(c[0]), toS(c[1]), toS(c[2])), alpha: c[3] }];
          write(next, false);
          setSel(next.length - 1);
        }}
        title="Doppelklick: Farbstopp hinzufügen"
      >
        <div className="gradient-fill" style={{ background: gradientCss(stops, 0) }} />
        {sorted.map((s) => (
          <div
            key={s.i}
            className={`gradient-stop ${s.i === sel ? 'sel' : ''}`}
            style={{ left: `${s.t * 100}%`, background: s.color }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = s.i;
              setSel(s.i);
            }}
            onPointerMove={(e) => {
              if (drag.current !== s.i) return;
              const next = stops.map((x, i) => (i === s.i ? { ...x, t: +tAt(e.clientX).toFixed(3) } : x));
              write(next);
            }}
            onPointerUp={() => (drag.current = null)}
          />
        ))}
      </div>
      {cur && (
        <div className="gradient-controls">
          <label className="color-swatch small" style={{ background: cur.color }}>
            <input type="color" value={cur.color} onChange={(e) => write(stops.map((x, i) => (i === sel ? { ...x, color: e.target.value } : x)))} />
          </label>
          <span className="mini-label">α</span>
          <ScrubNumber value={cur.alpha} step={0.01} min={0} max={1} decimals={2} onChange={(v) => write(stops.map((x, i) => (i === sel ? { ...x, alpha: v } : x)))} />
          <span className="mini-label">Pos</span>
          <ScrubNumber value={cur.t} step={0.005} min={0} max={1} decimals={3} onChange={(v) => write(stops.map((x, i) => (i === sel ? { ...x, t: v } : x)))} />
          <button
            className="icon-btn"
            disabled={stops.length <= 1}
            title="Stopp entfernen"
            onClick={() => {
              write(
                stops.filter((_, i) => i !== sel),
                false,
              );
              setSel(0);
            }}
          >
            <IconTrash size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── curve editor ─────────────────────────────

export function CurveEditor({ target, maxValue = 1.5, label }: { target: string; maxValue?: number; label?: string }) {
  const points = useStore((s) => readTarget(s.scene, target, 0)) as CurvePoint[];
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const W = 260;
  const H = 86;
  const top = Math.max(maxValue, ...points.map((p) => p.v)) * 1.05;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const px = (t: number) => 6 + t * (W - 12);
  const py = (v: number) => H - 6 - (v / top) * (H - 12);
  // sample the smoothed curve for the preview path
  const path: string[] = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    let v = sorted[0]?.v ?? 1;
    if (sorted.length > 1) {
      if (t <= sorted[0].t) v = sorted[0].v;
      else if (t >= sorted[sorted.length - 1].t) v = sorted[sorted.length - 1].v;
      else {
        let k = 0;
        while (k < sorted.length - 2 && sorted[k + 1].t < t) k++;
        const f = (t - sorted[k].t) / Math.max(1e-6, sorted[k + 1].t - sorted[k].t);
        v = sorted[k].v + (sorted[k + 1].v - sorted[k].v) * f * f * (3 - 2 * f);
      }
    }
    path.push(`${i ? 'L' : 'M'}${px(t).toFixed(1)},${py(v).toFixed(1)}`);
  }
  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width) * (W / (W - 12)) - 6 / (W - 12)));
    const v = Math.max(0, ((H - 6 - ((e.clientY - r.top) / r.height) * H) / (H - 12)) * top);
    return { t: +t.toFixed(3), v: +v.toFixed(3) };
  };
  return (
    <div className="curve-editor">
      {label && <div className="curve-label">{label}</div>}
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        onDoubleClick={(e) => {
          const p = toLocal(e);
          editTarget(target, [...points, p], false);
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const p = toLocal(e);
          editTarget(
            target,
            points.map((x, i) => (i === drag.current ? p : x)),
          );
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <title>Doppelklick: Punkt hinzufügen · Entf: Punkt löschen</title>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={px(g)} x2={px(g)} y1={4} y2={H - 4} className="curve-grid" />
        ))}
        <line x1={6} x2={W - 6} y1={py(1)} y2={py(1)} className="curve-grid one" />
        <path d={`${path.join('')} L${px(1)},${H - 6} L${px(0)},${H - 6} Z`} className="curve-area" />
        <path d={path.join('')} className="curve-line" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={px(p.t)}
            cy={py(p.v)}
            r={sel === i ? 5 : 4}
            className={`curve-point ${sel === i ? 'sel' : ''}`}
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === 'Delete' || e.key === 'Backspace') && points.length > 1) {
                e.stopPropagation();
                editTarget(
                  target,
                  points.filter((_, j) => j !== i),
                  false,
                );
                setSel(null);
              }
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              (e.currentTarget as SVGCircleElement).focus();
              drag.current = i;
              setSel(i);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
