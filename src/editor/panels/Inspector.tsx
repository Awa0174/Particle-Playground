import { useRef, useState } from 'react';
import type { EmitterConfig, ForceConfig, ShapeConfig, ShapeType } from '../../engine/types';
import { makeShape, uid } from '../../engine/defaults';
import { getStore, useStore } from '../store';
import { engine } from '../engine';
import {
  ColorField,
  CurveEditor,
  GradientEditor,
  Num,
  RangeNum,
  Section,
  Segmented,
  Select,
  TextField,
  Toggle,
  Vec2,
  editTarget,
} from '../components/controls';
import { IconDice, IconMic, IconMusic, IconPlus, IconTrash, IconX } from '../components/icons';
import { deleteSelected, randomizeSeed } from '../actions';
import type { Band } from '../audio';

const SHAPES: { value: ShapeType; label: string }[] = [
  { value: 'point', label: 'Point' },
  { value: 'circle', label: 'Circle' },
  { value: 'ring', label: 'Ring' },
  { value: 'rect', label: 'Rectangle' },
  { value: 'line', label: 'Line' },
  { value: 'cone', label: 'Cone' },
  { value: 'spiral', label: 'Spiral' },
  { value: 'sphere', label: 'Sphere (3D-Shell)' },
  { value: 'grid', label: 'Grid' },
  { value: 'star', label: 'Star' },
  { value: 'heart', label: 'Heart' },
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image Mask' },
  { value: 'lightning', label: 'Lightning' },
];
const GPU_SHAPES = new Set(['point', 'circle', 'ring', 'rect', 'line', 'spiral', 'sphere', 'cone']);

function ShapeFields({ base, shape, formation }: { base: string; shape: ShapeConfig; formation?: boolean }) {
  const t = shape.type;
  const fileRef = useRef<HTMLInputElement>(null);
  const has = (...types: ShapeType[]) => types.includes(t);
  return (
    <>
      {has('circle', 'ring', 'spiral', 'sphere', 'star', 'heart', 'cone') && <Num label="Radius" target={`${base}.radius`} min={0} max={80} step={0.5} decimals={1} />}
      {has('ring', 'star') && <Num label={t === 'star' ? 'Innenradius' : 'Dicke'} target={`${base}.thickness`} min={0} max={1} step={0.01} />}
      {has('line') && (
        <>
          <Num label="Wellenhöhe" target={`${base}.thickness`} min={0} max={30} step={0.1} decimals={1} />
          <Num label="Wellen" target={`${base}.turns`} min={0} max={8} step={0.05} />
        </>
      )}
      {has('rect', 'line', 'text', 'image', 'grid', 'lightning') && (
        <Num label={t === 'line' || t === 'lightning' ? 'Länge' : 'Breite'} target={`${base}.width`} min={0} max={240} step={0.5} decimals={1} />
      )}
      {has('rect', 'text', 'image', 'grid') && <Num label="Höhe" target={`${base}.height`} min={0} max={140} step={0.5} decimals={1} />}
      {has('spiral', 'star') && <Num label={t === 'star' ? 'Zacken' : 'Arme'} target={`${base}.arms`} min={1} max={12} step={1} decimals={0} />}
      {has('spiral') && <Num label="Windungen" target={`${base}.turns`} min={0} max={4} step={0.05} />}
      {has('spiral', 'lightning') && <Num label={t === 'lightning' ? 'Versatz' : 'Streuung'} target={`${base}.jitter`} min={0} max={1.5} step={0.01} />}
      {has('lightning') && (
        <>
          <Num label="Äste" target={`${base}.branches`} min={0} max={12} step={1} decimals={0} />
          <Num label="Rauheit" target={`${base}.roughness`} min={0} max={1.5} step={0.01} />
        </>
      )}
      {has('circle', 'rect', 'sphere', 'heart', 'star') && <Toggle label="Nur Kontur" target={`${base}.edgeOnly`} />}
      {has('text') && (
        <>
          <TextField label="Text" target={`${base}.text`} />
          <Num label="Gewicht" target={`${base}.weight`} min={100} max={900} step={100} decimals={0} keyable={false} />
        </>
      )}
      {has('image') && (
        <div className="field">
          <label>Bild</label>
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            {shape.image ? 'Bild ersetzen…' : 'Bild wählen…'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const img = await createImageBitmap(file);
              const k = Math.min(1, 360 / Math.max(img.width, img.height));
              const c = document.createElement('canvas');
              c.width = Math.round(img.width * k);
              c.height = Math.round(img.height * k);
              c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
              editTarget(`${base}.image`, c.toDataURL('image/png'), false);
            }}
          />
        </div>
      )}
      {formation && t === 'none' && <div className="hint">Freie Phase – Partikel folgen nur den Kräften.</div>}
    </>
  );
}

function EmitterInspector({ e }: { e: EmitterConfig }) {
  const p = `emitter:${e.id}:`;
  const emitters = useStore((s) => s.scene.emitters);
  const gpu = e.backend === 'gpu';
  const update = (fn: (em: EmitterConfig) => void) =>
    getStore().update((d) => {
      const em = d.emitters.find((x) => x.id === e.id);
      if (em) fn(em);
    });

  return (
    <>
      <div className="inspector-head">
        <TextField label="Name" target={`${p}name`} />
        <div className="field">
          <label>Backend</label>
          <Segmented
            value={e.backend}
            options={[
              { value: 'cpu', label: 'CPU', title: 'Volle Feature-Tiefe: Sub-Emitter, Formationen, Fluid, Text/Bild' },
              { value: 'gpu', label: 'GPU', title: 'Transform-Feedback-Swarm: 100k+ Partikel' },
            ]}
            onChange={(v) => editTarget(`${p}backend`, v, false)}
          />
        </div>
        {gpu && (
          <div className="hint">
            GPU-Swarm: Simulation komplett auf der Grafikkarte. Unterstützt Gravity, Wind, Drag, Attractor, Vortex, Turbulence, Pointer, Collider und Bounds.
            {!GPU_SHAPES.has(e.shape.type) && <b> Form „{e.shape.type}“ wird auf der GPU als Kreis emittiert.</b>}
          </div>
        )}
      </div>

      <Section id="em-emission" title="Emission">
        {gpu ? (
          <Num label="Partikel" target={`${p}gpuCount`} min={1024} max={1048576} pow={2.5} step={1024} decimals={0} keyable={false} hint="Feste Anzahl GPU-Partikel; sterbende Partikel werden sofort neu geboren." />
        ) : (
          <>
            <Num label="Rate /s" target={`${p}rate`} min={0} max={8000} pow={2.2} step={1} decimals={0} />
            <Num label="Maximum" target={`${p}maxParticles`} min={1} max={60000} pow={2} step={100} decimals={0} keyable={false} />
          </>
        )}
        <Num label="Start" target={`${p}start`} min={0} max={20} step={0.05} unit="s" keyable={false} />
        <Num label="Ende" target={`${p}end`} min={-1} max={20} step={0.05} unit="s" keyable={false} hint="-1 = endlos" />
        {!gpu && (
          <div className="sub-list">
            <div className="sub-list-head">
              <span>Bursts</span>
              <button className="icon-btn" title="Burst hinzufügen" onClick={() => update((em) => em.bursts.push({ time: 0, count: 200, interval: 0, jitter: 0 }))}>
                <IconPlus size={13} />
              </button>
            </div>
            {e.bursts.map((_b, i) => (
              <div className="sub-card" key={i}>
                <button className="icon-btn corner" onClick={() => update((em) => em.bursts.splice(i, 1))} title="Entfernen">
                  <IconX size={12} />
                </button>
                <Num label="Zeit" target={`${p}bursts.${i}.time`} min={0} max={20} step={0.05} unit="s" keyable={false} />
                <Num label="Anzahl" target={`${p}bursts.${i}.count`} min={1} max={20000} pow={2} step={1} decimals={0} />
                <Num label="Intervall" target={`${p}bursts.${i}.interval`} min={0} max={10} step={0.05} unit="s" keyable={false} hint="0 = einmalig" />
                <Num label="Zufall" target={`${p}bursts.${i}.jitter`} min={0} max={1} step={0.01} keyable={false} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section id="em-transform" title="Transform">
        <Vec2 label="Position" target={`${p}position`} />
        <Num label="Rotation" target={`${p}rotation`} min={-180} max={180} step={1} unit="°" decimals={0} />
        <Num label="Drehung /s" target={`${p}rotationSpeed`} min={-180} max={180} step={1} unit="°" decimals={0} />
      </Section>

      <Section id="em-shape" title="Form">
        <Select label="Typ" target={`${p}shape.type`} options={SHAPES} />
        <ShapeFields base={`${p}shape`} shape={e.shape} />
      </Section>

      <Section id="em-velocity" title="Geschwindigkeit">
        <Select
          label="Modus"
          target={`${p}velocityMode`}
          options={[
            { value: 'direction', label: 'Richtung' },
            { value: 'radial', label: 'Radial (nach außen)' },
            { value: 'inward', label: 'Nach innen' },
            { value: 'tangential', label: 'Tangential (Orbit)' },
            { value: 'normal', label: 'Formnormale' },
            { value: 'explode', label: 'Explosion (3D-Schale)' },
          ]}
        />
        <RangeNum label="Tempo" target={`${p}speed`} step={0.25} decimals={1} />
        {e.velocityMode === 'direction' && <Num label="Richtung" target={`${p}direction`} min={-180} max={180} step={1} unit="°" decimals={0} />}
        <Num label="Streuung" target={`${p}spread`} min={0} max={360} step={1} unit="°" decimals={0} />
        <Num label="Orbital" target={`${p}orbital`} min={-60} max={60} step={0.5} decimals={1} />
      </Section>

      <Section id="em-life" title="Lebensdauer & Größe">
        <RangeNum label="Lebensdauer" target={`${p}lifetime`} step={0.05} unit="s" />
        <RangeNum label="Größe" target={`${p}size`} step={0.05} />
        <CurveEditor target={`${p}sizeCurve`} label="Größe über Lebensdauer" />
        <RangeNum label="Spin" target={`${p}spin`} step={5} unit="°/s" decimals={0} min={-1440} />
      </Section>

      <Section id="em-color" title="Farbe & Licht">
        <GradientEditor target={`${p}gradient`} />
        <Select
          label="Farbquelle"
          target={`${p}colorMode`}
          options={[
            { value: 'life', label: 'Über Lebensdauer' },
            { value: 'speed', label: 'Nach Tempo' },
            { value: 'random', label: 'Zufall aus Verlauf' },
            { value: 'source', label: 'Bildpixel (Image Mask)' },
          ]}
        />
        {e.colorMode === 'speed' && <Num label="Tempo-Referenz" target={`${p}speedRef`} min={1} max={150} step={1} decimals={0} />}
        <Num label="Intensität (HDR)" target={`${p}intensity`} min={0} max={8} step={0.05} hint="Werte > 1 erzeugen Bloom" />
        <Num label="Flackern" target={`${p}flicker`} min={0} max={1} step={0.01} />
      </Section>

      <Section id="em-render" title="Darstellung">
        <Select
          label="Sprite"
          target={`${p}sprite`}
          options={[
            { value: 'glow', label: 'Glow' },
            { value: 'soft', label: 'Soft' },
            { value: 'disc', label: 'Disc' },
            { value: 'spark', label: 'Spark' },
            { value: 'star', label: 'Star Flare' },
            { value: 'ring', label: 'Ring' },
            { value: 'bokeh', label: 'Bokeh' },
            { value: 'smoke', label: 'Smoke' },
          ]}
        />
        <Select
          label="Blending"
          target={`${p}blend`}
          options={[
            { value: 'additive', label: 'Additiv (Licht)' },
            { value: 'screen', label: 'Screen' },
            { value: 'normal', label: 'Normal (deckend)' },
          ]}
        />
        <Num label="Motion Stretch" target={`${p}stretch`} min={0} max={5} step={0.05} hint="Partikel entlang der Geschwindigkeit strecken (Bewegungsunschärfe)" />
      </Section>

      <Section id="em-physics" title="Physik">
        <Num label="Masse" target={`${p}mass`} min={0.05} max={20} step={0.05} pow={2} />
        <Num label="Drag" target={`${p}drag`} min={0} max={10} step={0.05} />
        <Toggle label="Kollision" target={`${p}collide`} hint="Reagiert auf Collider und Bounds" />
      </Section>

      {!gpu && (
        <Section id="em-sub" title="Sub-Emitter" defaultOpen={e.subEmitters.length > 0}>
          {e.subEmitters.map((s, i) => (
            <div className="sub-card" key={i}>
              <button className="icon-btn corner" onClick={() => update((em) => em.subEmitters.splice(i, 1))} title="Entfernen">
                <IconX size={12} />
              </button>
              <Select
                label="Auslöser"
                target={`${p}subEmitters.${i}.trigger`}
                options={[
                  { value: 'death', label: 'Beim Tod' },
                  { value: 'birth', label: 'Bei Geburt' },
                  { value: 'trail', label: 'Spur (kontinuierlich)' },
                ]}
              />
              <Select label="Ziel" target={`${p}subEmitters.${i}.target`} options={emitters.filter((x) => x.id !== e.id).map((x) => ({ value: x.id, label: x.name }))} />
              {s.trigger === 'trail' ? (
                <Num label="Rate /s" target={`${p}subEmitters.${i}.rate`} min={0} max={300} step={1} decimals={0} />
              ) : (
                <Num label="Anzahl" target={`${p}subEmitters.${i}.count`} min={1} max={2000} pow={2} step={1} decimals={0} />
              )}
              <Num label="Erbt Tempo" target={`${p}subEmitters.${i}.inherit`} min={0} max={1} step={0.01} />
              <Num label="Chance" target={`${p}subEmitters.${i}.chance`} min={0} max={1} step={0.01} />
            </div>
          ))}
          <button
            className="btn small ghost"
            disabled={emitters.length < 2}
            onClick={() => {
              const target = emitters.find((x) => x.id !== e.id);
              if (target) update((em) => em.subEmitters.push({ trigger: 'death', target: target.id, count: 40, rate: 30, inherit: 0.3, chance: 1 }));
            }}
          >
            <IconPlus size={13} /> Sub-Emitter
          </button>
          {emitters.length < 2 && <div className="hint">Lege zuerst einen zweiten Emitter an (z. B. mit Rate 0), der ausgelöst werden soll.</div>}
        </Section>
      )}

      {!gpu && (
        <Section id="em-formation" title="Formation / Morphing" defaultOpen={e.formation.enabled}>
          <Toggle label="Aktiv" target={`${p}formation.enabled`} hint="Partikel werden per Feder zu Zielpunkten gezogen" />
          <Num label="Federkraft" target={`${p}formation.strength`} min={0} max={60} step={0.1} />
          <Num label="Dämpfung" target={`${p}formation.damping`} min={0} max={15} step={0.05} />
          <Num label="Haltezeit" target={`${p}formation.hold`} min={0.2} max={20} step={0.1} unit="s" />
          <Toggle label="Am Ziel spawnen" target={`${p}formation.spawnAtTarget`} />
          {e.formation.shapes.map((s, i) => (
            <div className="sub-card" key={i}>
              <button className="icon-btn corner" onClick={() => update((em) => em.formation.shapes.splice(i, 1))} title="Entfernen">
                <IconX size={12} />
              </button>
              <Select
                label={`Ziel ${i + 1}`}
                target={`${p}formation.shapes.${i}.type`}
                options={[{ value: 'none', label: '— frei (auflösen) —' }, ...SHAPES.filter((x) => !['point', 'line', 'cone', 'lightning'].includes(x.value))]}
              />
              <ShapeFields base={`${p}formation.shapes.${i}`} shape={s} formation />
            </div>
          ))}
          <button className="btn small ghost" onClick={() => update((em) => em.formation.shapes.push(makeShape('text', { text: 'HELLO', width: 120, height: 30 })))}>
            <IconPlus size={13} /> Zielform
          </button>
        </Section>
      )}
    </>
  );
}

function AffectsField({ f }: { f: ForceConfig }) {
  const emitters = useStore((s) => s.scene.emitters);
  const all = f.affects.length === 0;
  const toggle = (id: string) =>
    getStore().update((d) => {
      const ff = d.forces.find((x) => x.id === f.id)!;
      const cur = ff.affects.length === 0 ? emitters.map((e) => e.id) : [...ff.affects];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      ff.affects = next.length === emitters.length ? [] : next;
    });
  return (
    <div className="chips">
      {emitters.map((e) => (
        <button key={e.id} className={`chip ${all || f.affects.includes(e.id) ? 'on' : ''}`} onClick={() => toggle(e.id)}>
          {e.name}
        </button>
      ))}
    </div>
  );
}

function ForceInspector({ f }: { f: ForceConfig }) {
  const p = `force:${f.id}:`;
  const t = f.type;
  const positional = ['attractor', 'vortex', 'collider'].includes(t);
  return (
    <>
      <div className="inspector-head">
        <TextField label="Name" target={`${p}name`} />
        <div className="hint type-hint">Typ: {t}</div>
      </div>
      <Section id={`fx-main`} title="Parameter">
        {positional && <Vec2 label="Position" target={`${p}position`} />}
        {t === 'collider' && f.shape === 'plane' && null}
        {t !== 'bounds' && t !== 'collider' && (
          <Num
            label={t === 'fluid' ? 'Druck' : 'Stärke'}
            target={`${p}strength`}
            min={t === 'attractor' || t === 'vortex' ? -150 : 0}
            max={t === 'pointer' ? 1500 : t === 'drag' ? 5 : 150}
            step={t === 'drag' ? 0.01 : 0.5}
            pow={t === 'pointer' ? 2 : 1}
          />
        )}
        {(t === 'gravity' || t === 'wind') && <Num label="Richtung" target={`${p}direction`} min={-180} max={180} step={1} unit="°" decimals={0} />}
        {t === 'wind' && <Num label="Böen" target={`${p}gust`} min={0} max={3} step={0.01} />}
        {(t === 'attractor' || t === 'vortex' || t === 'pointer') && (
          <Num label="Radius" target={`${p}radius`} min={0} max={150} step={0.5} decimals={1} hint={t === 'attractor' ? '0 = unendlich' : undefined} />
        )}
        {(t === 'attractor' || t === 'vortex') && (
          <Select
            label="Falloff"
            target={`${p}falloff`}
            options={[
              { value: 'none', label: 'Konstant' },
              { value: 'linear', label: 'Linear' },
              { value: 'smooth', label: 'Weich' },
              { value: 'inverse', label: 'Invers-quadratisch (Gravitation)' },
            ]}
          />
        )}
        {t === 'attractor' && (
          <>
            <Num label="Softening" target={`${p}softening`} min={0} max={20} step={0.1} />
            <Num label="Ereignishorizont" target={`${p}killRadius`} min={0} max={30} step={0.1} hint="Partikel innerhalb dieses Radius werden vernichtet" />
          </>
        )}
        {t === 'vortex' && <Num label="Sog nach innen" target={`${p}inward`} min={-40} max={40} step={0.1} />}
        {t === 'turbulence' && (
          <>
            <Num label="Skalierung" target={`${p}scale`} min={2} max={120} step={0.5} decimals={1} />
            <Num label="Evolution" target={`${p}speed`} min={0} max={3} step={0.01} />
            <Num label="Oktaven" target={`${p}octaves`} min={1} max={4} step={1} decimals={0} keyable={false} />
          </>
        )}
        {t === 'pointer' && (
          <>
            <Select
              label="Modus"
              target={`${p}pointerMode`}
              options={[
                { value: 'repel', label: 'Abstoßen' },
                { value: 'attract', label: 'Anziehen' },
                { value: 'swirl', label: 'Wirbeln' },
                { value: 'stir', label: 'Mitreißen' },
              ]}
            />
            <Toggle label="Schon beim Hovern" target={`${p}hoverActive`} hint="Aus: nur bei gedrückter Maustaste" />
          </>
        )}
        {t === 'fluid' && (
          <>
            <Num label="Glättungsradius" target={`${p}radius`} min={0.5} max={8} step={0.05} />
            <Num label="Viskosität" target={`${p}viscosity`} min={0} max={1} step={0.01} />
            <div className="hint">SPH-lite mit räumlichem Hash-Grid – ideal für bis zu ~15k Partikel.</div>
          </>
        )}
        {t === 'bounds' && (
          <>
            <Select
              label="Modus"
              target={`${p}mode`}
              options={[
                { value: 'bounce', label: 'Abprallen' },
                { value: 'wrap', label: 'Umlaufen (Wrap)' },
                { value: 'kill', label: 'Vernichten' },
              ]}
            />
            <Num label="Innenabstand" target={`${p}radius`} min={-20} max={40} step={0.5} />
          </>
        )}
        {t === 'collider' && (
          <>
            <Select
              label="Form"
              target={`${p}shape`}
              options={[
                { value: 'circle', label: 'Kreis' },
                { value: 'plane', label: 'Ebene' },
              ]}
            />
            {f.shape === 'circle' ? (
              <Num label="Radius" target={`${p}radius`} min={0.5} max={60} step={0.5} />
            ) : (
              <Num label="Normale" target={`${p}direction`} min={-180} max={180} step={1} unit="°" decimals={0} />
            )}
          </>
        )}
        {(t === 'bounds' || t === 'collider') && (
          <>
            <Num label="Elastizität" target={`${p}restitution`} min={0} max={1.2} step={0.01} />
            <Num label="Reibung" target={`${p}friction`} min={0} max={1} step={0.01} />
          </>
        )}
        {t === 'flowfield' && (
          <>
            <div className="hint">Wähle Pinsel (B) oder Radierer (E) in der Werkzeugleiste und male Strömungen direkt in den Viewport.</div>
            <div className="field">
              <label>Feld</label>
              <button
                className="btn small"
                onClick={() => {
                  getStore().update((d) => {
                    const ff = d.forces.find((x) => x.id === f.id);
                    if (ff) ff.field = null;
                  });
                  const g = engine().sim.getFlowGrid(f.id);
                  g?.data.fill(0);
                }}
              >
                Leeren
              </button>
            </div>
          </>
        )}
      </Section>
      {t !== 'bounds' && t !== 'collider' && t !== 'drag' && (
        <Section id="fx-pulse" title="Modulation" defaultOpen={f.pulse > 0}>
          <Num label="Puls-Tiefe" target={`${p}pulse`} min={0} max={1} step={0.01} />
          <Num label="Puls-Frequenz" target={`${p}pulseFreq`} min={0} max={6} step={0.01} unit="Hz" />
        </Section>
      )}
      <Section id="fx-affects" title="Wirkt auf">
        <AffectsField f={f} />
      </Section>
    </>
  );
}

function AudioSection() {
  const audio = useStore((s) => s.audio);
  const scene = useStore((s) => s.scene);
  const [mappings, setMappings] = useState(() => engine().audio.mappings);
  const fileRef = useRef<HTMLInputElement>(null);
  const sync = (m: typeof mappings) => {
    engine().audio.mappings = m;
    setMappings([...m]);
  };
  const targets: { value: string; label: string }[] = [
    { value: 'render:bloom.intensity', label: 'Bloom' },
    { value: 'render:exposure', label: 'Belichtung' },
    { value: 'render:chromatic', label: 'Chromatic Aberration' },
    ...scene.emitters.flatMap((e) => [
      { value: `emitter:${e.id}:rate`, label: `${e.name} · Rate` },
      { value: `emitter:${e.id}:intensity`, label: `${e.name} · Intensität` },
      { value: `emitter:${e.id}:size.1`, label: `${e.name} · Größe` },
    ]),
    ...scene.forces.map((f) => ({ value: `force:${f.id}:strength`, label: `${f.name} · Stärke` })),
  ];
  const bands: Band[] = ['bass', 'mid', 'high', 'level'];
  return (
    <Section id="sc-audio" title="Audio-Reaktivität" defaultOpen={false}>
      <div className="audio-buttons">
        <button
          className={`btn small ${audio.active && audio.source === 'Mikrofon' ? 'primary' : ''}`}
          onClick={async () => {
            try {
              await engine().audio.startMic();
              if (mappings.length === 0) sync([{ id: uid('am'), band: 'bass', target: 'render:bloom.intensity', amount: 1.5 }]);
              getStore().set({ audio: { active: true, levels: [0, 0, 0, 0], source: 'Mikrofon' } });
            } catch {
              getStore().toast('Kein Mikrofonzugriff', 'error');
            }
          }}
        >
          <IconMic size={13} /> Mikrofon
        </button>
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          <IconMusic size={13} /> Audiodatei
        </button>
        {audio.active && (
          <button
            className="btn small ghost"
            onClick={() => {
              engine().audio.stop();
              getStore().set({ audio: { active: false, levels: [0, 0, 0, 0], source: '' } });
            }}
          >
            Stopp
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            engine().audio.startFile(file);
            if (mappings.length === 0) sync([{ id: uid('am'), band: 'bass', target: 'render:bloom.intensity', amount: 1.5 }]);
            getStore().set({ audio: { active: true, levels: [0, 0, 0, 0], source: file.name } });
          }}
        />
      </div>
      <div className="meters">
        {bands.map((b, i) => (
          <div className="meter" key={b}>
            <div className="meter-bar">
              <div style={{ height: `${Math.min(100, audio.levels[i] * 160)}%` }} />
            </div>
            <span>{b}</span>
          </div>
        ))}
      </div>
      {mappings.map((m, i) => (
        <div className="sub-card" key={m.id}>
          <button className="icon-btn corner" onClick={() => sync(mappings.filter((_, j) => j !== i))}>
            <IconX size={12} />
          </button>
          <div className="field">
            <label>Band</label>
            <select className="select" value={m.band} onChange={(e) => sync(mappings.map((x, j) => (j === i ? { ...x, band: e.target.value as Band } : x)))}>
              {bands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <span className="key-spacer" />
          </div>
          <div className="field">
            <label>Ziel</label>
            <select className="select" value={m.target} onChange={(e) => sync(mappings.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}>
              {targets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="key-spacer" />
          </div>
          <div className="field">
            <label>Stärke</label>
            <input
              className="range-input"
              type="range"
              min={-2}
              max={6}
              step={0.05}
              value={m.amount}
              onChange={(e) => sync(mappings.map((x, j) => (j === i ? { ...x, amount: +e.target.value } : x)))}
            />
            <span className="mono small">{m.amount.toFixed(2)}</span>
          </div>
        </div>
      ))}
      <button className="btn small ghost" onClick={() => sync([...mappings, { id: uid('am'), band: 'mid', target: targets[0].value, amount: 1 }])}>
        <IconPlus size={13} /> Zuordnung
      </button>
      <div className="hint">Audio moduliert Parameter live (nicht deterministisch – Snapshots pausieren währenddessen).</div>
    </Section>
  );
}

function SceneInspector() {
  return (
    <>
      <Section id="sc-meta" title="Effekt">
        <TextField label="Name" target="scene:name" />
        <TextField label="Beschreibung" target="scene:description" multiline />
        <Num label="Seed" target="scene:seed" min={0} max={999999} step={1} decimals={0} keyable={false} />
        <button className="btn small ghost" onClick={randomizeSeed}>
          <IconDice size={13} /> Neuer Seed
        </button>
      </Section>
      <Section id="sc-time" title="Zeit & Simulation">
        <Num label="Dauer" target="scene:duration" min={1} max={60} step={0.5} unit="s" keyable={false} />
        <Toggle label="Loop (Neustart)" target="scene:loop" hint="Aus: Simulation läuft nach dem Ende frei weiter" />
        <Num label="Vorlauf" target="scene:prewarm" min={0} max={15} step={0.5} unit="s" keyable={false} hint="Unsichtbar vorsimulierte Zeit – Effekt startet im eingeschwungenen Zustand" />
        <Num label="CPU-Kapazität" target="scene:maxParticles" min={1000} max={200000} pow={2} step={1000} decimals={0} keyable={false} />
        <Toggle label="Außerhalb entfernen" target="scene:cullOutside" />
      </Section>
      <Section id="sc-bg" title="Hintergrund">
        <ColorField label="Oben" target="background:top" />
        <ColorField label="Unten" target="background:bottom" />
        <Num label="Zentrumsglühen" target="background:glow" min={0} max={2} step={0.01} />
      </Section>
      <AudioSection />
    </>
  );
}

function RenderInspector() {
  return (
    <>
      <Section id="rd-tone" title="Belichtung & Tonemapping">
        <Num label="Belichtung" target="render:exposure" min={0} max={4} step={0.01} />
        <Select
          label="Tonemapper"
          target="render:tonemap"
          options={[
            { value: 'aces', label: 'ACES Filmic' },
            { value: 'agx', label: 'AgX' },
            { value: 'linear', label: 'Linear (Clamp)' },
          ]}
        />
        <Num label="Sättigung" target="render:saturation" min={0} max={2} step={0.01} />
        <Num label="Kontrast" target="render:contrast" min={0.5} max={1.6} step={0.01} />
      </Section>
      <Section id="rd-bloom" title="Bloom">
        <Num label="Intensität" target="render:bloom.intensity" min={0} max={4} step={0.01} />
        <Num label="Schwelle" target="render:bloom.threshold" min={0} max={3} step={0.01} />
        <Num label="Knie" target="render:bloom.knee" min={0} max={1} step={0.01} />
        <Num label="Radius" target="render:bloom.radius" min={0} max={1} step={0.01} />
      </Section>
      <Section id="rd-fx" title="Kamera-Effekte">
        <Num label="Trails" target="render:trails" min={0} max={0.98} step={0.005} hint="Nachleuchten: Anteil, der pro Frame (1/60 s) erhalten bleibt" />
        <Num label="Chromatic Ab." target="render:chromatic" min={0} max={2} step={0.01} />
        <Num label="Vignette" target="render:vignette" min={0} max={1} step={0.01} />
        <Num label="Filmkorn" target="render:grain" min={0} max={0.25} step={0.005} decimals={3} />
      </Section>
      <Section id="rd-links" title="Plexus-Verbindungen">
        <Toggle label="Aktiv" target="render:links.enabled" />
        <Num label="Distanz" target="render:links.distance" min={0.5} max={20} step={0.05} />
        <Num label="Deckkraft" target="render:links.opacity" min={0} max={2} step={0.01} />
        <Num label="Max. Partikel" target="render:links.maxParticles" min={100} max={12000} step={100} decimals={0} keyable={false} />
      </Section>
    </>
  );
}

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const emitter = useStore((s) => (sel.kind === 'emitter' ? s.scene.emitters.find((e) => e.id === sel.id) : undefined));
  const force = useStore((s) => (sel.kind === 'force' ? s.scene.forces.find((f) => f.id === sel.id) : undefined));
  return (
    <div className="inspector">
      <div className="panel-title">
        <span>{sel.kind === 'emitter' ? 'Emitter' : sel.kind === 'force' ? 'Kraft' : sel.kind === 'render' ? 'Rendering' : 'Szene'}</span>
        {(emitter || force) && (
          <button
            className="icon-btn"
            title="Entfernen"
            onClick={deleteSelected}
          >
            <IconTrash size={13} />
          </button>
        )}
      </div>
      <div className="inspector-scroll">
        {emitter && <EmitterInspector key={emitter.id} e={emitter} />}
        {force && <ForceInspector key={force.id} f={force} />}
        {sel.kind === 'scene' && <SceneInspector />}
        {sel.kind === 'render' && <RenderInspector />}
      </div>
    </div>
  );
}
