import { RENDER_STRIDE } from '../engine/Simulation';
import { hexToLinear } from '../engine/color';
import type { BlendMode } from '../engine/types';
import { Program, Target, compile, createTarget, deleteTarget } from './gl';
import {
  COMPOSITE_FS,
  DOWN_FS,
  FADE_FS,
  FULLSCREEN_VS,
  LINE_FS,
  LINE_VS,
  PARTICLE_FS,
  PARTICLE_VS,
  PREFILTER_FS,
  SPRITE_INDEX,
  UP_FS,
} from './shaders';
import { GpuSwarm } from './GpuSwarm';
import type { FrameInput, IRenderer, RendererStats } from './types';

const MAX_MIPS = 7;

export class WebGLRenderer implements IRenderer {
  readonly kind = 'webgl2' as const;
  readonly canvas: HTMLCanvasElement;
  stats: RendererStats = { backend: 'webgl2', renderMs: 0, gpuParticles: 0, drawCalls: 0, hdr: true, width: 0, height: 0 };

  private gl: WebGL2RenderingContext;
  private hdr: boolean;
  private particle: Program;
  private line: Program;
  private fade: Program;
  private prefilter: Program;
  private down: Program;
  private up: Program;
  private composite: Program;
  private quad: WebGLBuffer;
  private instBuf: WebGLBuffer;
  private instCap = 0;
  private particleVao: WebGLVertexArrayObject;
  private lineBuf: WebGLBuffer;
  private lineCap = 0;
  private lineVao: WebGLVertexArrayObject;
  private emptyVao: WebGLVertexArrayObject;
  private scene: Target | null = null;
  private mips: Target[] = [];
  private view = new Float32Array(4);
  private swarm: GpuSwarm;
  private lost = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.stats.hdr = this.hdr;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });

    this.particle = compile(gl, PARTICLE_VS, PARTICLE_FS);
    this.line = compile(gl, LINE_VS, LINE_FS);
    this.fade = compile(gl, FULLSCREEN_VS, FADE_FS);
    this.prefilter = compile(gl, FULLSCREEN_VS, PREFILTER_FS);
    this.down = compile(gl, FULLSCREEN_VS, DOWN_FS);
    this.up = compile(gl, FULLSCREEN_VS, UP_FS);
    this.composite = compile(gl, FULLSCREEN_VS, COMPOSITE_FS);

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.instBuf = gl.createBuffer()!;
    this.particleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    for (let a = 1; a <= 3; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribDivisor(a, 1);
    }
    gl.bindVertexArray(null);

    this.lineBuf = gl.createBuffer()!;
    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);

    this.emptyVao = gl.createVertexArray()!;
    this.swarm = new GpuSwarm(gl, this.quad);
  }

  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    const w = Math.max(1, Math.round(cssWidth * pixelRatio));
    const h = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (this.scene && this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    deleteTarget(gl, this.scene);
    this.mips.forEach((m) => deleteTarget(gl, m));
    this.mips = [];
    this.scene = createTarget(gl, w, h, this.hdr);
    let mw = Math.max(1, w >> 1);
    let mh = Math.max(1, h >> 1);
    for (let i = 0; i < MAX_MIPS && mw >= 4 && mh >= 4; i++) {
      this.mips.push(createTarget(gl, mw, mh, this.hdr));
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
    }
    this.stats.width = w;
    this.stats.height = h;
  }

  private setBlend(mode: BlendMode): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (mode === 'additive') gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private fullscreen(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(f: FrameInput): void {
    if (this.lost || !this.scene) return;
    const t0 = performance.now();
    const gl = this.gl;
    const sim = f.sim;
    const sc = sim.rt;
    const R = sc.render;
    let draws = 0;

    // GPU swarm simulation (transform feedback) follows the CPU clock
    const reinit = this.swarm.sync(sim);
    if (f.steps > 0 || f.resync || reinit) this.swarm.simulate(sim, reinit && !f.resync ? [-1] : sim.lastStepTimes);
    this.stats.gpuParticles = this.swarm.totalParticles;

    // camera
    const zoom = f.camera.zoom;
    this.view[0] = zoom / sim.halfW;
    this.view[1] = zoom / sim.halfH;
    this.view[2] = -f.camera.x * this.view[0];
    this.view[3] = -f.camera.y * this.view[1];
    const pxWorld = (sim.halfH * 2) / zoom / this.scene.h;

    // ── particle pass into the HDR scene buffer ──
    const trails = Math.min(0.995, Math.max(0, R.trails));
    const drawParticles = f.steps > 0 || trails === 0 || f.resync || f.dirty;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.scene.w, this.scene.h);
    if (drawParticles) {
      if (trails === 0 || f.resync || (f.dirty && f.steps === 0)) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } else {
        gl.useProgram(this.fade.prog);
        gl.uniform1f(this.fade.u.u_keep, Math.pow(trails, f.steps));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
        this.fullscreen();
        draws++;
      }

      // upload CPU instances
      const floats = f.count * RENDER_STRIDE;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      if (floats > this.instCap) {
        this.instCap = Math.max(floats, Math.ceil(this.instCap * 1.5));
        gl.bufferData(gl.ARRAY_BUFFER, this.instCap * 4, gl.DYNAMIC_DRAW);
      }
      if (floats > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.instances, 0, floats);

      const groupsByIndex = new Map(f.groups.map((g) => [g.index, g] as const));
      const pu = this.particle.u;
      sc.emitters.forEach((e, ei) => {
        if (e.backend === 'gpu') {
          this.setBlend(e.blend);
          if (this.swarm.drawEmitter(e, this.view, pxWorld, SPRITE_INDEX[e.sprite] ?? 0, sim.frame)) draws++;
          return;
        }
        const g = groupsByIndex.get(ei);
        if (!g) return;
        gl.useProgram(this.particle.prog);
        gl.uniform4fv(pu.u_view, this.view);
        gl.uniform1f(pu.u_stretch, e.stretch);
        gl.uniform1f(pu.u_pxWorld, pxWorld);
        gl.uniform1f(pu.u_sizeMul, 1);
        gl.uniform1i(pu.u_sprite, SPRITE_INDEX[e.sprite] ?? 0);
        this.setBlend(e.blend);
        gl.bindVertexArray(this.particleVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
        const base = g.offset * RENDER_STRIDE * 4;
        const stride = RENDER_STRIDE * 4;
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, base);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, base + 16);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, base + 24);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, g.count);
        draws++;
      });
      gl.bindVertexArray(null);

      // plexus links
      if (f.links && f.links.lines > 0) {
        const floatsL = f.links.lines * 12;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
        if (floatsL > this.lineCap) {
          this.lineCap = Math.max(floatsL, Math.ceil(this.lineCap * 1.5));
          gl.bufferData(gl.ARRAY_BUFFER, this.lineCap * 4, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.links.data, 0, floatsL);
        gl.useProgram(this.line.prog);
        gl.uniform4fv(this.line.u.u_view, this.view);
        this.setBlend('additive');
        gl.bindVertexArray(this.lineVao);
        gl.drawArrays(gl.LINES, 0, f.links.lines * 2);
        gl.bindVertexArray(null);
        draws++;
      }
    }
    gl.disable(gl.BLEND);

    // ── bloom pyramid ──
    const bloomOn = R.bloom.intensity > 0 && this.mips.length > 0;
    if (bloomOn) {
      const th = R.bloom.threshold;
      const knee = Math.max(1e-4, th * R.bloom.knee);
      gl.useProgram(this.prefilter.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mips[0].fbo);
      gl.viewport(0, 0, this.mips[0].w, this.mips[0].h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
      gl.uniform1i(this.prefilter.u.u_src, 0);
      gl.uniform2f(this.prefilter.u.u_texel, 1 / this.scene.w, 1 / this.scene.h);
      gl.uniform4f(this.prefilter.u.u_threshold, th, th - knee, knee * 2, 0.25 / knee);
      this.fullscreen();
      gl.useProgram(this.down.prog);
      gl.uniform1i(this.down.u.u_src, 0);
      for (let i = 1; i < this.mips.length; i++) {
        const src = this.mips[i - 1];
        const dst = this.mips[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(this.down.u.u_texel, 1 / src.w, 1 / src.h);
        this.fullscreen();
      }
      gl.useProgram(this.up.prog);
      gl.uniform1i(this.up.u.u_src, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const weight = 0.35 + R.bloom.radius * 0.75;
      for (let i = this.mips.length - 1; i > 0; i--) {
        const src = this.mips[i];
        const dst = this.mips[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(this.up.u.u_texel, 1 / src.w, 1 / src.h);
        gl.uniform1f(this.up.u.u_weight, weight);
        this.fullscreen();
      }
      gl.disable(gl.BLEND);
      draws += this.mips.length * 2;
    }

    // ── composite to screen ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const cu = this.composite.u;
    gl.useProgram(this.composite.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    gl.uniform1i(cu.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomOn ? this.mips[0].tex : this.scene.tex);
    gl.uniform1i(cu.u_bloom, 1);
    const levels = this.mips.length;
    gl.uniform1f(cu.u_bloomIntensity, bloomOn ? (R.bloom.intensity * 1.6) / (1 + levels * (0.35 + R.bloom.radius * 0.75) * 0.6) : 0);
    gl.uniform1f(cu.u_exposure, R.exposure);
    gl.uniform1f(cu.u_chromatic, R.chromatic);
    gl.uniform1f(cu.u_vignette, R.vignette);
    gl.uniform1f(cu.u_grain, R.grain);
    gl.uniform1f(cu.u_saturation, R.saturation);
    gl.uniform1f(cu.u_contrast, R.contrast);
    gl.uniform1i(cu.u_tonemap, R.tonemap === 'aces' ? 0 : R.tonemap === 'agx' ? 1 : 2);
    gl.uniform3fv(cu.u_bgTop, hexToLinear(sc.background.top));
    gl.uniform3fv(cu.u_bgBottom, hexToLinear(sc.background.bottom));
    gl.uniform1f(cu.u_bgGlow, sc.background.glow);
    gl.uniform1f(cu.u_time, f.time);
    gl.uniform2f(cu.u_resolution, this.canvas.width, this.canvas.height);
    this.fullscreen();
    gl.activeTexture(gl.TEXTURE0);
    draws++;

    this.stats.drawCalls = draws;
    this.stats.renderMs = performance.now() - t0;
  }

  dispose(): void {
    const gl = this.gl;
    this.swarm.dispose();
    deleteTarget(gl, this.scene);
    this.mips.forEach((m) => deleteTarget(gl, m));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
