import type { EmitterConfig, ForceConfig } from '../engine/types';
import { DT, Simulation } from '../engine/Simulation';
import { LUT_SIZE, bakeCurve, bakeGradient } from '../engine/color';
import { hashString } from '../engine/rng';
import { noise1 } from '../engine/noise';
import { GPU_RENDER_VS, GPU_UPDATE_FS, GPU_UPDATE_VS, MAX_GPU_FORCES, PARTICLE_FS } from './shaders';
import { Program, compile } from './gl';

const SHAPE_CODE: Record<string, number> = { point: 0, circle: 1, ring: 2, rect: 3, line: 4, spiral: 5, sphere: 6, cone: 7 };
const VMODE: Record<string, number> = { direction: 0, radial: 1, tangential: 2, inward: 3, normal: 4, explode: 1 };
const FALLOFF: Record<string, number> = { none: 0, linear: 1, smooth: 2, inverse: 3 };
const PMODE: Record<string, number> = { attract: 0, repel: 1, swirl: 2, stir: 3 };
const BMODE: Record<string, number> = { bounce: 0, wrap: 1, kill: 2 };
const FLOATS = 8;
const DEG = Math.PI / 180;

class GpuEmitter {
  count = 0;
  buffers: WebGLBuffer[] = [];
  updateVao: WebGLVertexArrayObject[] = [];
  renderVao: WebGLVertexArrayObject[] = [];
  cur = 0;
  lut: WebGLTexture;
  lutKey = '';

  constructor(private gl: WebGL2RenderingContext, private quad: WebGLBuffer) {
    this.lut = gl.createTexture()!;
  }

  init(count: number, lifeMax: number, seed: number): void {
    const gl = this.gl;
    this.dispose(false);
    this.count = count;
    const data = new Float32Array(count * FLOATS);
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      data[i * FLOATS + 4] = -rnd() * Math.min(lifeMax, 4); // staggered birth → smooth fill-in
      data[i * FLOATS + 5] = 0;
      data[i * FLOATS + 6] = rnd();
    }
    for (let k = 0; k < 2; k++) {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
      this.buffers.push(buf);
      // update VAO reads buffer k
      const uv = gl.createVertexArray()!;
      gl.bindVertexArray(uv);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, FLOATS * 4, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, 16);
      this.updateVao.push(uv);
      // render VAO: quad corners + instanced state
      const rv = gl.createVertexArray()!;
      gl.bindVertexArray(rv);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, 16);
      gl.vertexAttribDivisor(2, 1);
      this.renderVao.push(rv);
    }
    gl.bindVertexArray(null);
    this.cur = 0;
  }

  updateLut(e: EmitterConfig): void {
    const key = JSON.stringify([e.gradient, e.sizeCurve]);
    if (key === this.lutKey) return;
    this.lutKey = key;
    const gl = this.gl;
    const data = new Float32Array(LUT_SIZE * 2 * 4);
    data.set(bakeGradient(e.gradient), 0);
    const size = bakeCurve(e.sizeCurve);
    for (let i = 0; i < LUT_SIZE; i++) data[(LUT_SIZE + i) * 4] = size[i];
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LUT_SIZE, 2, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  dispose(all = true): void {
    const gl = this.gl;
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.updateVao.forEach((v) => gl.deleteVertexArray(v));
    this.renderVao.forEach((v) => gl.deleteVertexArray(v));
    this.buffers = [];
    this.updateVao = [];
    this.renderVao = [];
    if (all) gl.deleteTexture(this.lut);
  }
}

/**
 * GPU particle swarm: emitters with backend "gpu" are simulated entirely on
 * the GPU via WebGL2 transform feedback (ping-pong vertex buffers), which
 * scales to hundreds of thousands of particles. Supports the force subset that
 * can be evaluated per particle without neighbour information.
 */
export class GpuSwarm {
  private update: Program;
  private draw: Program;
  private tf: WebGLTransformFeedback;
  private systems = new Map<string, GpuEmitter>();
  private fType = new Int32Array(MAX_GPU_FORCES);
  private fA = new Float32Array(MAX_GPU_FORCES * 4);
  private fB = new Float32Array(MAX_GPU_FORCES * 4);
  private fC = new Float32Array(MAX_GPU_FORCES * 4);
  totalParticles = 0;

  constructor(private gl: WebGL2RenderingContext, private quad: WebGLBuffer) {
    this.update = compile(gl, GPU_UPDATE_VS, GPU_UPDATE_FS, ['o_pv', 'o_al']);
    this.draw = compile(gl, GPU_RENDER_VS, PARTICLE_FS);
    this.tf = gl.createTransformFeedback()!;
  }

  has(id: string): boolean {
    return this.systems.has(id);
  }

  /** Create / destroy systems to match the scene; returns true if anything was (re)initialised. */
  sync(sim: Simulation): boolean {
    const want = sim.rt.emitters.filter((e) => e.backend === 'gpu');
    let changed = false;
    for (const [id, sys] of this.systems) {
      if (!want.find((e) => e.id === id)) {
        sys.dispose();
        this.systems.delete(id);
      }
    }
    this.totalParticles = 0;
    for (const e of want) {
      let sys = this.systems.get(e.id);
      const count = Math.max(1024, Math.min(1 << 21, Math.round(e.gpuCount)));
      if (!sys) {
        sys = new GpuEmitter(this.gl, this.quad);
        this.systems.set(e.id, sys);
      }
      if (sys.count !== count) {
        sys.init(count, Math.max(0.1, e.lifetime[1]), hashString(e.id) ^ sim.scene.seed);
        changed = true;
      }
      sys.updateLut(e);
      this.totalParticles += count;
    }
    return changed;
  }

  reinitAll(sim: Simulation): void {
    for (const e of sim.rt.emitters) {
      const sys = this.systems.get(e.id);
      if (sys) sys.init(sys.count, Math.max(0.1, e.lifetime[1]), hashString(e.id) ^ sim.scene.seed);
    }
  }

  /** Run the GPU simulation for the steps the CPU clock executed. */
  simulate(sim: Simulation, stepTimes: number[]): void {
    if (this.systems.size === 0) return;
    let resync = false;
    for (const t of stepTimes) if (t < 0) resync = true;
    if (resync) {
      this.reinitAll(sim);
      // fast-forward deterministically to the current frame (bounded)
      const steps = Math.min(sim.frame, 900);
      for (let k = steps; k > 0; k--) this.stepAll(sim, (sim.frame - k) * DT, sim.frame - k);
      return;
    }
    for (const t of stepTimes) this.stepAll(sim, t, Math.round(t / DT));
  }

  private stepAll(sim: Simulation, tau: number, frame: number): void {
    const gl = this.gl;
    const u = this.update.u;
    gl.useProgram(this.update.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.uniform1f(u.u_dt, DT);
    gl.uniform1f(u.u_tau, tau);
    gl.uniform1f(u.u_frame, frame);
    gl.uniform2f(u.u_half, sim.halfW, sim.halfH);
    gl.uniform4f(u.u_ptr, sim.pointer.x, sim.pointer.y, sim.pointer.vx, sim.pointer.vy);
    sim.rt.emitters.forEach((e) => {
      const sys = this.systems.get(e.id);
      if (!sys || sys.buffers.length < 2) return;
      const active = e.enabled && tau >= e.start && (e.end < 0 || tau < e.end);
      const rotDeg = e.rotation + e.rotationSpeed * tau;
      const rot = rotDeg * DEG;
      gl.uniform4f(u.u_ePos, e.position.x, e.position.y, Math.cos(rot), Math.sin(rot));
      gl.uniform1i(u.u_shape, SHAPE_CODE[e.shape.type] ?? 1);
      gl.uniform4f(u.u_shapeA, e.shape.radius, e.shape.thickness, e.shape.width, e.shape.height);
      gl.uniform4f(u.u_shapeB, e.shape.arms, e.shape.turns, e.shape.jitter, e.shape.edgeOnly ? 1 : 0);
      gl.uniform4f(u.u_life, e.lifetime[0], e.lifetime[1], e.speed[0], e.speed[1]);
      gl.uniform4f(u.u_dir, (e.direction + rotDeg) * DEG, e.spread * DEG, VMODE[e.velocityMode] ?? 0, e.orbital);
      gl.uniform4f(u.u_misc, e.size[0], e.size[1], e.drag, 1 / Math.max(0.05, e.mass));
      gl.uniform1i(u.u_active, active ? 1 : 0);
      const n = this.packForces(sim, e, tau);
      gl.uniform1i(u.u_fcount, n);
      gl.uniform1iv(u.u_ftype, this.fType);
      gl.uniform4fv(u.u_fa, this.fA);
      gl.uniform4fv(u.u_fb, this.fB);
      gl.uniform4fv(u.u_fc, this.fC);

      const src = sys.cur;
      const dst = 1 - src;
      gl.bindVertexArray(sys.updateVao[src]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, sys.buffers[dst]);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, sys.count);
      gl.endTransformFeedback();
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      sys.cur = dst;
    });
    gl.bindVertexArray(null);
    gl.disable(gl.RASTERIZER_DISCARD);
  }

  private packForces(sim: Simulation, e: EmitterConfig, tau: number): number {
    let n = 0;
    const put = (type: number, a: number[], b: number[], c: number[]) => {
      if (n >= MAX_GPU_FORCES) return;
      this.fType[n] = type;
      this.fA.set(a, n * 4);
      this.fB.set(b, n * 4);
      this.fC.set(c, n * 4);
      n++;
    };
    const ptr = sim.pointer;
    for (const f of sim.rt.forces as ForceConfig[]) {
      if (!f.enabled) continue;
      if (f.affects.length && !f.affects.includes(e.id)) continue;
      let s = f.strength * (f.pulse ? 1 + f.pulse * Math.sin(tau * f.pulseFreq * Math.PI * 2) : 1);
      const dx = Math.cos(f.direction * DEG);
      const dy = Math.sin(f.direction * DEG);
      switch (f.type) {
        case 'gravity':
          put(0, [0, 0, s, 0], [dx, dy, 0, 0], [0, 0, 0, 0]);
          break;
        case 'wind':
          s *= 1 + f.gust * noise1(tau * 0.6, hashString(f.id) % 97);
          put(0, [0, 0, s, 0], [dx, dy, 0, 0], [0, 0, 0, 0]);
          break;
        case 'drag':
          put(1, [0, 0, s, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
          break;
        case 'attractor':
          put(2, [f.position.x, f.position.y, s, f.radius], [0, 0, f.killRadius, f.softening], [FALLOFF[f.falloff], 0, 0, 0]);
          break;
        case 'vortex':
          put(3, [f.position.x, f.position.y, s, f.radius], [0, 0, f.inward, 0], [FALLOFF[f.falloff], 0, 0, 0]);
          break;
        case 'turbulence':
          put(4, [0, 0, s, 0], [0, 0, 0, f.scale], [0, tau * f.speed + (hashString(f.id) % 1000) * 0.01, f.octaves, 0]);
          break;
        case 'pointer':
          if (!ptr.inside || (!f.hoverActive && !ptr.down)) break;
          put(5, [ptr.x, ptr.y, s, f.radius], [0, 0, 0, 0], [0, 0, 0, PMODE[f.pointerMode]]);
          break;
        case 'collider':
          if (!e.collide) break;
          if (f.shape === 'circle') put(6, [f.position.x, f.position.y, 0, f.radius], [0, 0, f.friction, 0], [0, 0, 0, f.restitution]);
          else put(7, [f.position.x, f.position.y, 0, 0], [dx, dy, f.friction, 0], [0, 0, 0, f.restitution]);
          break;
        case 'bounds':
          if (!e.collide) break;
          put(8, [0, 0, 0, f.radius], [0, 0, 0, 0], [BMODE[f.mode], 0, 0, f.restitution]);
          break;
      }
    }
    if (ptr.tool !== 'none' && ptr.down && ptr.inside) {
      put(5, [ptr.x, ptr.y, ptr.toolStrength, ptr.toolRadius], [0, 0, 0, 0], [0, 0, 0, PMODE[ptr.tool]]);
    }
    return n;
  }

  /** Draw one GPU emitter (caller sets framebuffer, blend and viewport). */
  drawEmitter(e: EmitterConfig, view: Float32Array, pxWorld: number, sprite: number, frame: number): boolean {
    const sys = this.systems.get(e.id);
    if (!sys || sys.buffers.length < 2 || !e.enabled) return false;
    const gl = this.gl;
    const u = this.draw.u;
    gl.useProgram(this.draw.prog);
    gl.uniform4fv(u.u_view, view);
    gl.uniform1f(u.u_stretch, e.stretch);
    gl.uniform1f(u.u_pxWorld, pxWorld);
    gl.uniform1f(u.u_sizeMul, 1);
    gl.uniform1i(u.u_sprite, sprite);
    gl.uniform1i(u.u_colorMode, e.colorMode === 'speed' ? 1 : e.colorMode === 'random' ? 2 : 0);
    gl.uniform1f(u.u_speedRef, e.speedRef);
    gl.uniform1f(u.u_intensity, e.intensity);
    gl.uniform1f(u.u_flicker, e.flicker);
    gl.uniform1f(u.u_frame, frame);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sys.lut);
    gl.uniform1i(u.u_lut, 0);
    gl.bindVertexArray(sys.renderVao[sys.cur]);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sys.count);
    gl.bindVertexArray(null);
    return true;
  }

  dispose(): void {
    for (const s of this.systems.values()) s.dispose();
    this.systems.clear();
    this.gl.deleteTransformFeedback(this.tf);
  }
}
