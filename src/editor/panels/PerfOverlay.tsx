import { useEffect, useRef } from 'react';
import { engine } from '../engine';
import { useStore } from '../store';

/** Live performance HUD: frame-time graph + simulation / render split. */
export function PerfOverlay() {
  const graphRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const backend = useStore((s) => s.backend);
  const renderScale = useStore((s) => s.renderScale);
  const quality = useStore((s) => s.quality);

  useEffect(() => {
    let frame = 0;
    return engine().onFrame(() => {
      const host = engine();
      const p = host.perf;
      const cv = graphRef.current;
      if (cv) {
        const ctx = cv.getContext('2d')!;
        const W = cv.width;
        const H = cv.height;
        ctx.clearRect(0, 0, W, H);
        // 16.7ms / 33ms guide lines
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        const y16 = H - (16.7 / 50) * H;
        const y33 = H - (33.3 / 50) * H;
        ctx.moveTo(0, y16);
        ctx.lineTo(W, y16);
        ctx.moveTo(0, y33);
        ctx.lineTo(W, y33);
        ctx.stroke();
        const n = p.history.length;
        const bw = W / n;
        for (let i = 0; i < n; i++) {
          const v = p.history[(p.head + i) % n];
          const h = Math.min(H, (v / 50) * H);
          ctx.fillStyle = v > 33 ? '#ff5a7a' : v > 18 ? '#ffc35a' : '#5ef0c4';
          ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.3), h);
        }
      }
      if (++frame % 10 || !textRef.current) return;
      const r = host.renderer?.stats;
      const sim = host.sim.stats;
      const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
      textRef.current.innerHTML = `
        <div class="perf-big"><b>${p.fps.toFixed(0)}</b><span>FPS</span><em>${p.frameMs.toFixed(1)} ms</em></div>
        <div class="perf-row"><span>CPU-Partikel</span><b>${fmt(p.particles)}</b></div>
        <div class="perf-row"><span>GPU-Partikel</span><b>${fmt(p.gpuParticles)}</b></div>
        <div class="perf-row"><span>Simulation</span><b>${p.simMs.toFixed(2)} ms</b></div>
        <div class="perf-row"><span>Render (CPU)</span><b>${p.renderMs.toFixed(2)} ms</b></div>
        <div class="perf-row"><span>Draw Calls</span><b>${r?.drawCalls ?? 0}</b></div>
        <div class="perf-row"><span>Auflösung</span><b>${r?.width ?? 0}×${r?.height ?? 0}</b></div>
        <div class="perf-row"><span>Snapshots</span><b>${sim.snapshots} · ${sim.snapshotMB.toFixed(1)} MB</b></div>`;
    });
  }, []);

  return (
    <div className="perf-overlay">
      <div className="perf-head">
        <span>{backend}</span>
        <span className="dim">
          {quality === 'auto' ? 'Auto' : quality} · {Math.round(renderScale * 100)}%
        </span>
      </div>
      <canvas ref={graphRef} width={220} height={44} className="perf-graph" />
      <div ref={textRef} />
    </div>
  );
}
