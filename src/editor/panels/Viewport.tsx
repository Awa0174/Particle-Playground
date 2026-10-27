import { useEffect, useMemo, useRef, useState } from 'react';
import type { EmitterConfig, ForceConfig } from '../../engine/types';
import { makeForce } from '../../engine/defaults';
import { getStore, useStore } from '../store';
import { engine } from '../engine';
import { importFile, selectEmitter, selectForce } from '../actions';
import { PerfOverlay } from './PerfOverlay';

interface DragState {
  kind: 'emitter' | 'force' | 'pan' | 'tool';
  id?: string;
  startX: number;
  startY: number;
  origin: { x: number; y: number };
  last: { x: number; y: number };
}

const TOOL_HINT: Record<string, string> = {
  select: 'Auswählen & Gizmos ziehen · Mausrad: Zoom · Mittlere Taste / Leertaste: Pan',
  attract: 'Klicken & ziehen: Partikel anziehen',
  repel: 'Klicken & ziehen: Partikel abstoßen',
  swirl: 'Klicken & ziehen: Wirbel erzeugen',
  paint: 'Strömungen malen – Partikel folgen dem Pinselstrich',
  erase: 'Gemalte Strömung radieren',
  emit: 'Mit dem ausgewählten Emitter sprühen',
};

export function Viewport() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const brushRef = useRef<SVGCircleElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [camTick, setCamTick] = useState(0);
  const [dropping, setDropping] = useState(false);
  const drag = useRef<DragState | null>(null);
  const spaceDown = useRef(false);
  const scene = useStore((s) => s.scene);
  const sel = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const toolRadius = useStore((s) => s.toolRadius);
  const showGizmos = useStore((s) => s.showGizmos);
  const showPerf = useStore((s) => s.showPerf);
  const presentation = useStore((s) => s.presentation);

  // mount engine
  useEffect(() => {
    const host = engine();
    host.attach(canvasRef.current!);
    const ro = new ResizeObserver(() => {
      const el = wrapRef.current!;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize({ w, h });
      host.resize(w, h);
    });
    ro.observe(wrapRef.current!);
    const kd = (e: KeyboardEvent) => e.code === 'Space' && (spaceDown.current = true);
    const ku = (e: KeyboardEvent) => e.code === 'Space' && (spaceDown.current = false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      ro.disconnect();
      host.detach();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  // flow-field visualisation while painting
  const flowForce = scene.forces.find((f) => f.type === 'flowfield' && (sel.kind === 'force' ? f.id === sel.id : true));
  const showFlow = (tool === 'paint' || tool === 'erase' || (sel.kind === 'force' && flowForce?.id === sel.id)) && !presentation;
  useEffect(() => {
    const cv = overlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    if (!showFlow) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      return;
    }
    let frame = 0;
    return engine().onFrame(() => {
      if (++frame % 3) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      const host = engine();
      const id = flowForce?.id;
      const g = id ? host.sim.getFlowGrid(id) : undefined;
      if (!g) return;
      ctx.strokeStyle = 'rgba(124, 240, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 0; y < g.rows; y += 2) {
        for (let x = 0; x < g.cols; x += 2) {
          const i = (y * g.cols + x) * 2;
          const vx = g.data[i];
          const vy = g.data[i + 1];
          const m = Math.hypot(vx, vy);
          if (m < 0.04) continue;
          const wx = (x / (g.cols - 1)) * host.sim.halfW * 2 - host.sim.halfW;
          const wy = (y / (g.rows - 1)) * host.sim.halfH * 2 - host.sim.halfH;
          const p = host.worldToScreen(wx, wy);
          const len = 9 * Math.min(1, m);
          const ex = p.x + (vx / m) * len;
          const ey = p.y - (vy / m) * len;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(ex, ey);
          const a = Math.atan2(-(vy / m), vx / m);
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - Math.cos(a - 0.5) * 3, ey - Math.sin(a - 0.5) * 3);
        }
      }
      ctx.stroke();
    });
  }, [showFlow, size, flowForce?.id]);

  const toLocal = (e: React.PointerEvent | React.WheelEvent | React.DragEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const ensureFlowForce = (): string => {
    const st = getStore().state;
    const sel = st.selection;
    const selected = sel.kind === 'force' ? st.scene.forces.find((f) => f.id === sel.id && f.type === 'flowfield') : undefined;
    const existing = selected ?? st.scene.forces.find((f) => f.type === 'flowfield');
    if (existing) return existing.id;
    const f = makeForce('flowfield');
    getStore().update((d) => d.forces.push(f));
    return f.id;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const host = engine();
    const p = toLocal(e);
    const w = host.screenToWorld(p.x, p.y);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    wrapRef.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceDown.current || (e.button === 0 && e.altKey)) {
      drag.current = { kind: 'pan', startX: p.x, startY: p.y, origin: { x: host.camera.x, y: host.camera.y }, last: w };
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'select') return;
    host.sim.pointer.down = true;
    drag.current = { kind: 'tool', startX: p.x, startY: p.y, origin: w, last: w };
    if (tool === 'paint' || tool === 'erase') drag.current.id = ensureFlowForce();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const host = engine();
    const p = toLocal(e);
    const w = host.screenToWorld(p.x, p.y);
    const ptr = host.sim.pointer;
    // pointer velocity in world units / s (smoothed)
    const dt = 1 / 60;
    ptr.vx += ((w.x - ptr.x) / dt - ptr.vx) * 0.35;
    ptr.vy += ((w.y - ptr.y) / dt - ptr.vy) * 0.35;
    ptr.x = w.x;
    ptr.y = w.y;
    ptr.inside = true;
    if (brushRef.current) {
      brushRef.current.setAttribute('cx', String(p.x));
      brushRef.current.setAttribute('cy', String(p.y));
    }
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const k = host.worldPerPixel;
      host.camera.x = d.origin.x - (p.x - d.startX) * k;
      host.camera.y = d.origin.y + (p.y - d.startY) * k;
      host.markDirty();
      setCamTick((t) => t + 1);
      return;
    }
    if (d.kind === 'emitter' || d.kind === 'force') {
      const nx = +(d.origin.x + (w.x - d.last.x)).toFixed(2);
      const ny = +(d.origin.y + (w.y - d.last.y)).toFixed(2);
      const id = d.id!;
      getStore().update((s) => {
        const list: (EmitterConfig | ForceConfig)[] = d.kind === 'emitter' ? s.emitters : s.forces;
        const obj = list.find((x) => x.id === id);
        if (obj) obj.position = { x: nx, y: ny };
      }, `gizmo:${id}`);
      return;
    }
    if (d.kind === 'tool') {
      const st = getStore().state;
      if (tool === 'paint' || tool === 'erase') {
        const dx = w.x - d.last.x;
        const dy = w.y - d.last.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.3 || tool === 'erase') {
          host.sim.paintFlow(d.id!, w.x, w.y, len ? dx / len : 0, len ? dy / len : 0, st.toolRadius, tool === 'erase');
          d.last = w;
        }
      } else if (tool === 'emit') {
        const em = st.selection.kind === 'emitter' ? st.selection.id : st.scene.emitters.find((x) => x.backend === 'cpu')?.id;
        if (em) host.sim.emitAt(em, w.x, w.y, Math.max(1, Math.round(st.toolStrength / 25)), ptr.vx * 0.3, ptr.vy * 0.3);
        d.last = w;
      }
    }
  };

  const onPointerUp = () => {
    const host = engine();
    const d = drag.current;
    drag.current = null;
    host.sim.pointer.down = false;
    if (d?.kind === 'tool' && (tool === 'paint' || tool === 'erase') && d.id) {
      const g = host.sim.getFlowGrid(d.id);
      if (g) {
        const data = g.toData();
        getStore().update((s) => {
          const f = s.forces.find((x) => x.id === d.id);
          if (f) f.field = data;
        });
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const host = engine();
    const p = toLocal(e);
    const before = host.screenToWorld(p.x, p.y);
    const z = Math.min(8, Math.max(0.25, host.camera.zoom * Math.exp(-e.deltaY * 0.0012)));
    host.camera.zoom = z;
    const after = host.screenToWorld(p.x, p.y);
    host.camera.x += before.x - after.x;
    host.camera.y += before.y - after.y;
    host.markDirty();
    setCamTick((t) => t + 1);
  };

  const startGizmoDrag = (e: React.PointerEvent, kind: 'emitter' | 'force', id: string, pos: { x: number; y: number }) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    const host = engine();
    const p = toLocal(e);
    wrapRef.current!.setPointerCapture(e.pointerId);
    drag.current = { kind, id, startX: p.x, startY: p.y, origin: { ...pos }, last: host.screenToWorld(p.x, p.y) };
    if (kind === 'emitter') selectEmitter(id);
    else selectForce(id);
  };

  // ── gizmos ──
  const gizmos = useMemo(() => {
    if (!showGizmos || presentation || size.w < 2) return null;
    const host = engine();
    const k = 1 / host.worldPerPixel;
    const out: JSX.Element[] = [];
    scene.emitters.forEach((e) => {
      const isSel = sel.kind === 'emitter' && sel.id === e.id;
      const c = host.worldToScreen(e.position.x, e.position.y);
      const s = e.shape;
      const cls = `gz ${isSel ? 'sel' : ''} ${e.enabled ? '' : 'off'}`;
      const rot = -e.rotation;
      let outline: JSX.Element | null = null;
      if (['circle', 'ring', 'spiral', 'sphere', 'star', 'heart'].includes(s.type)) outline = <circle cx={c.x} cy={c.y} r={s.radius * k} className="gz-outline" />;
      else if (['rect', 'text', 'image', 'grid'].includes(s.type))
        outline = <rect x={c.x - (s.width * k) / 2} y={c.y - (s.height * k) / 2} width={s.width * k} height={s.height * k} className="gz-outline" transform={`rotate(${rot} ${c.x} ${c.y})`} />;
      else if (s.type === 'line') outline = <line x1={c.x - (s.width * k) / 2} x2={c.x + (s.width * k) / 2} y1={c.y} y2={c.y} className="gz-outline" transform={`rotate(${rot} ${c.x} ${c.y})`} />;
      else if (s.type === 'lightning') outline = <line x1={c.x} x2={c.x} y1={c.y} y2={c.y + s.width * k} className="gz-outline" transform={`rotate(${rot} ${c.x} ${c.y})`} />;
      const dirA = ((e.direction + e.rotation) * Math.PI) / 180;
      out.push(
        <g key={e.id} className={cls}>
          {isSel && outline}
          {isSel && e.velocityMode === 'direction' && (
            <line x1={c.x} y1={c.y} x2={c.x + Math.cos(dirA) * 34} y2={c.y - Math.sin(dirA) * 34} className="gz-dir" markerEnd="url(#gz-arrow)" />
          )}
          <circle cx={c.x} cy={c.y} r={isSel ? 8 : 6} className="gz-handle emitter" onPointerDown={(ev) => startGizmoDrag(ev, 'emitter', e.id, e.position)} />
          {isSel && (
            <text x={c.x + 12} y={c.y - 10} className="gz-label">
              {e.name}
            </text>
          )}
        </g>,
      );
    });
    scene.forces.forEach((f) => {
      if (!['attractor', 'vortex', 'collider'].includes(f.type)) return;
      const isSel = sel.kind === 'force' && sel.id === f.id;
      const c = host.worldToScreen(f.position.x, f.position.y);
      const cls = `gz force ${isSel ? 'sel' : ''} ${f.enabled ? '' : 'off'}`;
      let extra: JSX.Element | null = null;
      if (f.type === 'collider' && f.shape === 'plane') {
        const a = (f.direction * Math.PI) / 180;
        const tx = -Math.sin(a);
        const ty = Math.cos(a);
        extra = (
          <>
            <line x1={c.x - tx * 2000} y1={c.y + ty * 2000} x2={c.x + tx * 2000} y2={c.y - ty * 2000} className="gz-outline plane" />
            <line x1={c.x} y1={c.y} x2={c.x + Math.cos(a) * 26} y2={c.y - Math.sin(a) * 26} className="gz-dir" markerEnd="url(#gz-arrow)" />
          </>
        );
      } else if (f.radius > 0 && (isSel || f.type === 'collider')) extra = <circle cx={c.x} cy={c.y} r={f.radius * k} className="gz-outline" />;
      out.push(
        <g key={f.id} className={cls}>
          {extra}
          {f.type === 'attractor' && f.killRadius > 0 && isSel && <circle cx={c.x} cy={c.y} r={f.killRadius * k} className="gz-outline kill" />}
          <rect x={c.x - 6} y={c.y - 6} width={12} height={12} rx={3} className="gz-handle force" transform={`rotate(45 ${c.x} ${c.y})`} onPointerDown={(ev) => startGizmoDrag(ev, 'force', f.id, f.position)} />
          {isSel && (
            <text x={c.x + 12} y={c.y - 10} className="gz-label">
              {f.name}
            </text>
          )}
        </g>,
      );
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, sel, showGizmos, presentation, size, camTick, tool]);

  const hasPointer = scene.forces.some((f) => f.type === 'pointer' && f.enabled);

  return (
    <div
      ref={wrapRef}
      className={`viewport tool-${tool} ${dropping ? 'dropping' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        engine().sim.pointer.inside = false;
      }}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        if (tool !== 'select' || e.target !== overlayRef.current) return;
        engine().camera = { x: 0, y: 0, zoom: 1 };
        engine().markDirty();
        setCamTick((t) => t + 1);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (file) void importFile(file);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="gl-canvas" />
      <canvas ref={overlayRef} className="overlay-canvas" style={{ width: size.w, height: size.h }} />
      <svg className="gizmos" width={size.w} height={size.h}>
        <defs>
          <marker id="gz-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="gz-arrow" />
          </marker>
        </defs>
        {gizmos}
        {tool !== 'select' && !presentation && <circle ref={brushRef} r={toolRadius / engine().worldPerPixel} className="brush" cx={-100} cy={-100} />}
      </svg>
      {showPerf && !presentation && <PerfOverlay />}
      {!presentation && (
        <div className="viewport-hint">
          {TOOL_HINT[tool]}
          {hasPointer && tool === 'select' && <span className="pulse-dot"> · Dieser Effekt reagiert auf deine Maus</span>}
        </div>
      )}
      {dropping && <div className="drop-zone">Bild oder .particle.json hier ablegen</div>}
    </div>
  );
}
