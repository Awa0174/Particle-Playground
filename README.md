# Particle Playground

Ein browserbasiertes VFX-Studio: Partikeleffekte erstellen, simulieren, animieren, vergleichen, teilen und exportieren – mit einer selbst entwickelten hybriden CPU/GPU-Partikel-Engine und einer HDR-Renderpipeline.

```bash
npm install
npm run dev      # http://localhost:5199
npm test         # Vitest: Determinismus, Zeitreise, Schema, LUTs, Curl-Noise
npm run build    # statischer Build in dist/ (relative Pfade, überall hostbar)
```

## Highlights

| Bereich | Was es kann |
| --- | --- |
| **Deterministische Zeitreise** | Fester Zeitschritt (1/60 s), Seed-RNG (sfc32) und ein Snapshot-Cache machen die Timeline vor- *und* rückwärts scrubbar. Gleicher Seed → bitgleiches Ergebnis, unabhängig von der Bildwiederholrate (per Test abgesichert). |
| **Hybride Engine** | CPU: Structure-of-Arrays in Typed Arrays, Swap-Remove-Pool, Sub-Frame-Emission. GPU: „GPU Swarm“-Emitter simulieren 100k–1M Partikel per WebGL2 Transform Feedback (Ping-Pong-Buffer, Curl-Noise im Shader). |
| **Physik** | Gravity, Wind mit Böen, Attractor (inkl. Ereignishorizont), Vortex, Curl-Noise-Turbulenz, Drag, Kreis-/Ebenen-Collider, Bounds, Pointer-Felder, **gemalte Kraftfelder**, **SPH-lite-Fluid** (Spatial Hash), Puls-Modulation. |
| **Emitter** | Point, Circle, Ring, Rect, Line (inkl. Sinuswelle), Cone, Spiral, Sphere-Shell, Grid, Star, Heart, **Text**, **Image Mask** (Pixelfarben), **prozedurale Blitze** (rekursive Midpoint-Displacement-Verästelung). Bursts mit Intervall/Jitter, Sub-Emitter (Geburt/Tod/Spur), Formationen/Morphing mit Federphysik. |
| **HDR-Rendering** | RGBA16F-Szene, prozedurale Sprites (Glow, Spark, Star-Flare, Bokeh, Smoke …), Motion-Stretch, Trails per Feedback-Buffer, 13-Tap-Bloom-Pyramide (Jimenez/CoD), ACES/AgX-Tonemapping, chromatische Aberration, Vignette, Filmkorn, Dithering, Plexus-Verbindungen, Sub-Pixel-Energieerhaltung. Canvas-2D-Fallback über dieselbe Renderer-Schnittstelle. |
| **Editor** | Verschiebbare Panels, Outliner, Inspector mit Scrub-Feldern, Gradient- und Kurveneditor, Viewport-Gizmos, Zoom/Pan, Werkzeuge (Anziehen, Abstoßen, Wirbeln, Malen, Radieren, Sprühen), Undo/Redo mit Gesten-Zusammenfassung, Befehlspalette (Strg+K), Präsentationsmodus. |
| **Timeline** | Keyframes für *jeden* numerischen Parameter (◆ neben dem Feld), **Auto-Key** sobald animiert, Easing-Kurven, Burst-Marker, Wiedergabegeschwindigkeit, Loop/Free-Run, Vorlauf (Prewarm). |
| **Kreativ** | **Evolve** (harmonie-erhaltende Mutationen), **A/B-Vergleich**, **Audio-Reaktivität** (Mikrofon/Datei → FFT-Bänder → beliebige Parameter). |
| **Speichern & Teilen** | Autosave (IndexedDB), „Meine Effekte“ mit Vorschaubild, versioniertes JSON-Schema mit Migrationen, **komprimierte Share-Links** (deflate-raw in der URL), PNG-Screenshot, Video (WebM/MP4 via MediaRecorder), Drag & Drop von Bildern/JSON. |
| **Performance** | Live-Overlay (Frame-Time-Graph, Sim/Render-Split, CPU/GPU-Partikel, Draw Calls, Snapshot-Speicher) und adaptive Auflösung („Qualität: Auto“). |

## 12 Presets

Galaxy · Black Hole · Magic Orb · Fireworks · Electric Storm · Northern Lights · Fire & Embers · Snowfall · Quantum Field · Text Formation · Energy Portal · Particle Morphing – die Vorschaubilder der Bibliothek werden von der Engine selbst gerendert.

## Architektur

```
src/
├── engine/          # reine Simulation, kein DOM-Zwang
│   ├── types.ts         versioniertes Szenen-Schema (World: 100 Einheiten hoch, y nach oben)
│   ├── Simulation.ts    Pool (SoA), Fixed Step, Emission, Kräfte, Integration, Snapshots, Render-Output
│   ├── shapes.ts        Formen, Text/Bild-Rasterung, Blitzgenerator
│   ├── fields.ts        Curl-Noise-Grid, gemalte Flow-Grids
│   ├── tracks.ts        Keyframe-Auswertung
│   ├── links.ts         Plexus-Verbindungen (Hash-Grid)
│   ├── mutate.ts        Evolve
│   └── rng.ts, noise.ts, color.ts
├── renderer/        # austauschbar über IRenderer
│   ├── WebGLRenderer.ts HDR-Pipeline + Bloom + Composite
│   ├── GpuSwarm.ts      Transform-Feedback-Simulation
│   ├── CanvasRenderer.ts Fallback
│   └── shaders.ts
├── editor/          # React-UI, Store (Undo/Redo), EngineHost (Frame-Loop), Audio, Thumbnails
├── presets/         # die 12 Effekte
├── serialization/   # Schema-Migration, Share-Links, IndexedDB
└── tests/           # Vitest
```

**Wichtige Entscheidungen**

- *Simulation ≠ Rendering*: Die Engine schreibt einen nach Emittern gruppierten Instanz-Buffer; jeder Renderer kann ihn darstellen. Emitter-Reihenfolge = Ebenenreihenfolge, Blend-Modus pro Emitter.
- *Runtime-Kopie*: Die Simulation liest eine Kopie der Szene, in die Keyframes und Audio-Modulation pro Schritt geschrieben werden – die autorisierte Szene bleibt unverändert und undo-fähig.
- *Zerstörungsfreies Editieren*: Parameteränderungen behalten lebende Partikel; nur Partikel gelöschter Emitter verschwinden.
- *Interaktion vs. Determinismus*: Maus, Pinsel und Audio markieren die Historie als „divergiert“ – solche Zustände werden nie als Snapshot gespeichert; ein Seek stellt den reproduzierbaren Verlauf wieder her.

## Tastenkürzel (Auswahl)

`Leertaste` Play/Pause · `R` Neustart · `→` Einzelschritt · `Strg+Z/Y` Undo/Redo · `Strg+K` Befehlspalette · `L` Bibliothek · `M` Evolve · `C` A/B · `K` Positions-Keyframe · `V A S W B E P` Werkzeuge · `F` Performance · `Tab` Präsentation · `?` alle Kürzel

## Hinweise

- Leistungswerte hängen stark von GPU, Auflösung und Effekt ab; das Overlay (`F`) zeigt die tatsächlichen Messwerte.
- GPU-Swarm-Emitter unterstützen keine Sub-Emitter, Formationen, Fluid- oder Flow-Field-Kräfte und keine Text/Bild/Blitz-Formen (diese laufen auf dem CPU-Backend).
- Video-Export nutzt `MediaRecorder` und zeichnet in Echtzeit auf; Codec je nach Browser.
