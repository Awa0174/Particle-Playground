import { useEffect, useRef, useState } from 'react';
import type { Ease, SceneConfig, Track } from '../../engine/types';
import { getStore, useStore } from '../store';
import { engine } from '../engine';
import { restart, togglePlay } from '../actions';
import { ScrubNumber } from '../components/controls';
import { IconKeyframe, IconPause, IconPlay, IconRestart, IconStep, IconTrash } from '../components/icons';

function trackLabel(scene: SceneConfig, target: string): { owner: string; prop: string } {
  const [kind, a, b] = target.split(':');
  if (kind === 'emitter') return { owner: scene.emitters.find((e) => e.id === a)?.name ?? '?', prop: b };
  if (kind === 'force') return { owner: scene.forces.find((f) => f.id === a)?.name ?? '?', prop: b };
  return { owner: kind === 'render' ? 'Render' : kind === 'background' ? 'Hintergrund' : 'Szene', prop: a };
}

function formatTime(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s % 1) * 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

const EASES: Ease[] = ['linear', 'smooth', 'easeIn', 'easeOut', 'step'];

export function Timeline() {
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const duration = useStore((s) => s.scene.duration);
  const loop = useStore((s) => s.scene.loop);
  const tracks = useStore((s) => s.scene.tracks);
  const scene = useStore((s) => s.scene);
  const sel = useStore((s) => s.selection);
  const selectedKey = useStore((s) => s.selectedKey);
  const laneRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(600);
  const scrub = useRef<{ wasPlaying: boolean } | null>(null);
  const keyDrag = useRef<{ track: string; index: number } | null>(null);

  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // smooth playhead via direct DOM updates
  useEffect(
    () =>
      engine().onFrame(() => {
        const t = engine().sim.time;
        const w = laneRef.current?.clientWidth ?? 1;
        const x = Math.min(1, Math.max(0, t / duration)) * w;
        if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
        if (timeRef.current) timeRef.current.textContent = formatTime(t) + (t > duration + 0.02 ? ' ∞' : '');
      }),
    [duration],
  );

  const tAt = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };
  const seekTo = (clientX: number) => {
    const t = Math.round(tAt(clientX) * 60) / 60;
    engine().seek(t);
  };

  const ticks: number[] = [];
  const stepT = duration > 30 ? 5 : duration > 12 ? 2 : 1;
  for (let t = 0; t <= duration + 1e-6; t += stepT) ticks.push(t);
  const minor: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += stepT / 4) minor.push(t);

  const selEmitter = sel.kind === 'emitter' ? scene.emitters.find((e) => e.id === sel.id) : undefined;
  const burstMarks: number[] = [];
  if (selEmitter) {
    for (const b of selEmitter.bursts) {
      if (b.interval > 0) for (let t = b.time; t <= duration && burstMarks.length < 200; t += b.interval) burstMarks.push(t);
      else burstMarks.push(b.time);
    }
  }

  const curKey = selectedKey ? tracks.find((t) => t.id === selectedKey.track)?.keys[selectedKey.index] : undefined;

  const updateTrack = (trackId: string, fn: (t: Track) => void, coalesce?: string) =>
    getStore().update((d) => {
      const tr = d.tracks.find((t) => t.id === trackId);
      if (tr) fn(tr);
    }, coalesce);

  return (
    <div className="timeline">
      <div className="timeline-bar">
        <div className="transport">
          <button className="icon-btn" onClick={restart} title="Neustart (R)">
            <IconRestart size={15} />
          </button>
          <button className="play-btn" onClick={togglePlay} title="Play / Pause (Leertaste)">
            {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
          </button>
          <button className="icon-btn" onClick={() => engine().step()} disabled={playing} title="Einzelschritt (→)">
            <IconStep size={15} />
          </button>
        </div>
        <span className="timecode" ref={timeRef}>
          00:00.00
        </span>
        <span className="timecode dim">/ {formatTime(duration)}</span>
        <div className="speed">
          {[0.25, 0.5, 1, 2].map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => getStore().set({ speed: s })}>
              {s}×
            </button>
          ))}
        </div>
        <button className={`chip ${loop ? 'on' : ''}`} onClick={() => getStore().update((d) => (d.loop = !d.loop))} title="Am Ende neu starten">
          Loop
        </button>
        <div className="grow" />
        {curKey && selectedKey && (
          <div className="key-editor">
            <IconKeyframe size={12} />
            <span className="mini-label">t</span>
            <ScrubNumber
              value={curKey.t}
              step={1 / 60}
              min={0}
              max={duration}
              decimals={2}
              unit="s"
              onChange={(v) =>
                updateTrack(
                  selectedKey.track,
                  (tr) => {
                    tr.keys[selectedKey.index].t = v;
                  },
                  'keyt',
                )
              }
            />
            <span className="mini-label">Wert</span>
            <ScrubNumber
              value={curKey.v}
              step={Math.max(0.01, Math.abs(curKey.v) / 100)}
              decimals={2}
              onChange={(v) =>
                updateTrack(
                  selectedKey.track,
                  (tr) => {
                    tr.keys[selectedKey.index].v = v;
                  },
                  'keyv',
                )
              }
            />
            <select
              className="select tiny"
              value={curKey.ease}
              onChange={(e) =>
                updateTrack(selectedKey.track, (tr) => {
                  tr.keys[selectedKey.index].ease = e.target.value as Ease;
                })
              }
            >
              {EASES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <button
              className="icon-btn"
              title="Keyframe löschen (Entf)"
              onClick={() => {
                getStore().update((d) => {
                  const tr = d.tracks.find((t) => t.id === selectedKey.track);
                  if (!tr) return;
                  tr.keys.splice(selectedKey.index, 1);
                  if (!tr.keys.length) d.tracks = d.tracks.filter((t) => t !== tr);
                });
                getStore().set({ selectedKey: null });
              }}
            >
              <IconTrash size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="timeline-body">
        <div className="track-names">
          <div className="ruler-spacer">Spuren</div>
          {tracks.map((tr) => {
            const l = trackLabel(scene, tr.target);
            return (
              <div className="track-name" key={tr.id} title={tr.target}>
                <span className="owner">{l.owner}</span>
                <span className="prop">{l.prop}</span>
                <button
                  className="icon-btn tiny"
                  title="Spur löschen"
                  onClick={() => {
                    getStore().update((d) => (d.tracks = d.tracks.filter((t) => t.id !== tr.id)));
                    getStore().set({ selectedKey: null });
                  }}
                >
                  <IconTrash size={11} />
                </button>
              </div>
            );
          })}
          {tracks.length === 0 && <div className="track-empty">Setze Keyframes mit ◆ neben jedem Parameter.</div>}
        </div>
        <div className="lanes" ref={laneRef}>
          <div
            className="ruler"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              scrub.current = { wasPlaying: getStore().state.playing };
              getStore().set({ playing: false });
              seekTo(e.clientX);
            }}
            onPointerMove={(e) => scrub.current && seekTo(e.clientX)}
            onPointerUp={() => {
              if (scrub.current?.wasPlaying) getStore().set({ playing: true });
              scrub.current = null;
            }}
          >
            {minor.map((t) => (
              <div key={`m${t}`} className="tick minor" style={{ left: (t / duration) * width }} />
            ))}
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: (t / duration) * width }}>
                <span>{t}s</span>
              </div>
            ))}
            {burstMarks.map((t, i) => (
              <div key={`b${i}`} className="burst-mark" style={{ left: (t / duration) * width }} title="Burst" />
            ))}
          </div>
          {tracks.map((tr) => (
            <div
              className="lane"
              key={tr.id}
              onPointerMove={(e) => {
                const d = keyDrag.current;
                if (!d || d.track !== tr.id) return;
                const t = Math.round(tAt(e.clientX) * 60) / 60;
                updateTrack(
                  tr.id,
                  (x) => {
                    x.keys[d.index].t = t;
                  },
                  `drag:${tr.id}`,
                );
              }}
              onPointerUp={() => {
                if (keyDrag.current) {
                  // keep keys sorted after a drag
                  const id = keyDrag.current.track;
                  getStore().update((d) => {
                    const x = d.tracks.find((t) => t.id === id);
                    if (x) x.keys.sort((a, b) => a.t - b.t);
                  }, `drag:${id}`);
                }
                keyDrag.current = null;
              }}
            >
              <svg className="lane-curve" width={width} height={26}>
                {tr.keys.length > 1 && (
                  <polyline
                    points={tr.keys
                      .map((k) => {
                        const vs = tr.keys.map((x) => x.v);
                        const lo = Math.min(...vs);
                        const hi = Math.max(...vs);
                        const y = hi > lo ? 22 - ((k.v - lo) / (hi - lo)) * 18 : 13;
                        return `${(k.t / duration) * width},${y}`;
                      })
                      .join(' ')}
                  />
                )}
              </svg>
              {tr.keys.map((k, i) => (
                <div
                  key={i}
                  className={`key ${selectedKey?.track === tr.id && selectedKey.index === i ? 'sel' : ''}`}
                  style={{ left: (k.t / duration) * width }}
                  title={`${k.t.toFixed(2)}s → ${k.v.toFixed(2)} (${k.ease})`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                    keyDrag.current = { track: tr.id, index: i };
                    getStore().set({ selectedKey: { track: tr.id, index: i } });
                  }}
                  onDoubleClick={() => engine().seek(k.t)}
                />
              ))}
            </div>
          ))}
          <div className="playhead" ref={playheadRef}>
            <div className="playhead-head" />
          </div>
        </div>
      </div>
    </div>
  );
}
