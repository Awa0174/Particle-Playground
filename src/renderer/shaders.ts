/**
 * GLSL ES 3.00 sources. The pipeline is fully HDR:
 *   particles (instanced, additive, RGBA16F) → trail feedback → bloom pyramid
 *   (13-tap down / tent up) → composite (background, chromatic aberration,
 *   ACES/AgX tonemap, grading, vignette, grain, dither).
 */

export const SPRITE_INDEX: Record<string, number> = {
  glow: 0,
  soft: 1,
  disc: 2,
  spark: 3,
  star: 4,
  ring: 5,
  bokeh: 6,
  smoke: 7,
};

const SPRITE_FN = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float spriteMask(vec2 uv, int type, float seed) {
  float r2 = dot(uv, uv);
  if (r2 >= 1.0) return 0.0;
  float edge = 1.0 - r2;
  if (type == 0) { // glow: gaussian halo + hot core
    return (exp(-r2 * 5.0) * 0.85 + exp(-r2 * 40.0) * 0.6) * edge;
  } else if (type == 1) { // soft
    return edge * edge;
  } else if (type == 2) { // anti-aliased disc
    float d = sqrt(r2);
    float w = max(fwidth(d), 0.02);
    return 1.0 - smoothstep(0.8 - w, 0.8 + w, d);
  } else if (type == 3) { // spark: thin bright core (quad is stretched along velocity)
    return (exp(-r2 * 9.0) + exp(-uv.y * uv.y * 60.0 - uv.x * uv.x * 2.0) * 0.8) * edge;
  } else if (type == 4) { // star flare
    float core = exp(-r2 * 18.0);
    float fx = exp(-abs(uv.y) * 38.0) * (1.0 - abs(uv.x));
    float fy = exp(-abs(uv.x) * 38.0) * (1.0 - abs(uv.y));
    return (core + (fx + fy) * 0.7 + exp(-r2 * 5.0) * 0.25) * edge;
  } else if (type == 5) { // ring
    float d = sqrt(r2);
    return exp(-pow((d - 0.7) * 9.0, 2.0)) * edge + exp(-r2 * 30.0) * 0.15;
  } else if (type == 6) { // bokeh: hexagonal aperture with bright rim
    vec2 q = abs(uv);
    float hex = max(q.x * 0.866 + q.y * 0.5, q.y);
    float w = max(fwidth(hex), 0.015);
    float body = 1.0 - smoothstep(0.82 - w, 0.82 + w, hex);
    return body * (0.45 + 0.55 * smoothstep(0.55, 0.82, hex));
  }
  // smoke: noisy soft blob, unique per particle
  float n = vnoise(uv * 2.6 + seed * 13.7) * 0.6 + vnoise(uv * 5.3 - seed * 7.1) * 0.4;
  return edge * edge * smoothstep(0.15, 0.85, n * (1.15 - r2 * 0.5));
}
`;

export const PARTICLE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_posvel;
layout(location = 2) in vec2 a_sizerot;
layout(location = 3) in vec4 a_color;
uniform vec4 u_view;      // scale.xy, offset.xy
uniform float u_stretch;
uniform float u_pxWorld;  // world units per pixel
uniform float u_sizeMul;
out vec2 v_uv;
out vec4 v_color;
out float v_seed;
void main() {
  vec2 pos = a_posvel.xy;
  vec2 vel = a_posvel.zw;
  float size = a_sizerot.x * u_sizeMul;
  float alpha = a_color.a;
  // sub-pixel energy conservation: tiny particles stay 1.5px and fade instead of shimmering
  float minS = u_pxWorld * 1.5;
  if (size < minS) { alpha *= (size * size) / (minS * minS); size = minS; }
  float speed = length(vel);
  vec2 dir = vec2(cos(a_sizerot.y), sin(a_sizerot.y));
  float halfL = size * 0.5;
  float halfW = size * 0.5;
  if (u_stretch > 0.0 && speed > 0.001) {
    dir = vel / speed;
    float extra = speed * u_stretch * 0.02;
    halfL += extra;
    // keep energy roughly constant when stretching
    alpha *= clamp(size / (size + extra), 0.25, 1.0);
  }
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 world = pos + dir * a_corner.x * halfL + perp * a_corner.y * halfW;
  gl_Position = vec4(world * u_view.xy + u_view.zw, 0.0, 1.0);
  v_uv = a_corner;
  v_color = vec4(a_color.rgb, alpha);
  v_seed = fract(a_sizerot.y * 0.1591);
}
`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in float v_seed;
uniform int u_sprite;
out vec4 o_color;
${SPRITE_FN}
void main() {
  float m = spriteMask(v_uv, u_sprite, v_seed) * v_color.a;
  if (m <= 0.0005) discard;
  o_color = vec4(v_color.rgb * m, m);
}
`;

export const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
uniform vec4 u_view;
out vec4 v_color;
void main() {
  gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);
  v_color = a_color;
}
`;

export const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 o_color;
void main() { o_color = vec4(v_color.rgb * v_color.a, v_color.a); }
`;

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FADE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform float u_keep;
out vec4 o_color;
void main() { o_color = vec4(0.0, 0.0, 0.0, u_keep); }
`;

/** Bright-pass with soft knee + Karis average to tame fireflies. */
export const PREFILTER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform vec4 u_threshold; // threshold, threshold - knee, 2 * knee, 0.25 / knee
out vec4 o_color;
vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - u_threshold.y, 0.0, u_threshold.z);
  rq = u_threshold.w * rq * rq;
  c *= max(rq, br - u_threshold.x) / max(br, 1e-4);
  return c;
}
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
  vec2 t = u_texel;
  vec3 a = texture(u_src, v_uv + t * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(u_src, v_uv + t * vec2(1.0, -1.0)).rgb;
  vec3 c = texture(u_src, v_uv + t * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture(u_src, v_uv + t * vec2(1.0, 1.0)).rgb;
  float wa = karis(a), wb = karis(b), wc = karis(c), wd = karis(d);
  vec3 avg = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  o_color = vec4(prefilter(min(avg, vec3(64.0))), 1.0);
}
`;

/** 13-tap downsample (Jimenez, "Next Generation Post Processing in Call of Duty"). */
export const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
out vec4 o_color;
void main() {
  vec2 t = u_texel;
  vec3 a = texture(u_src, v_uv + t * vec2(-2, 2)).rgb;
  vec3 b = texture(u_src, v_uv + t * vec2(0, 2)).rgb;
  vec3 c = texture(u_src, v_uv + t * vec2(2, 2)).rgb;
  vec3 d = texture(u_src, v_uv + t * vec2(-2, 0)).rgb;
  vec3 e = texture(u_src, v_uv).rgb;
  vec3 f = texture(u_src, v_uv + t * vec2(2, 0)).rgb;
  vec3 g = texture(u_src, v_uv + t * vec2(-2, -2)).rgb;
  vec3 h = texture(u_src, v_uv + t * vec2(0, -2)).rgb;
  vec3 i = texture(u_src, v_uv + t * vec2(2, -2)).rgb;
  vec3 j = texture(u_src, v_uv + t * vec2(-1, 1)).rgb;
  vec3 k = texture(u_src, v_uv + t * vec2(1, 1)).rgb;
  vec3 l = texture(u_src, v_uv + t * vec2(-1, -1)).rgb;
  vec3 m = texture(u_src, v_uv + t * vec2(1, -1)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  o_color = vec4(col, 1.0);
}
`;

/** 9-tap tent upsample, blended additively onto the next larger mip. */
export const UP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_weight;
out vec4 o_color;
void main() {
  vec2 t = u_texel;
  vec3 s = texture(u_src, v_uv + t * vec2(-1, -1)).rgb;
  s += texture(u_src, v_uv + t * vec2(0, -1)).rgb * 2.0;
  s += texture(u_src, v_uv + t * vec2(1, -1)).rgb;
  s += texture(u_src, v_uv + t * vec2(-1, 0)).rgb * 2.0;
  s += texture(u_src, v_uv).rgb * 4.0;
  s += texture(u_src, v_uv + t * vec2(1, 0)).rgb * 2.0;
  s += texture(u_src, v_uv + t * vec2(-1, 1)).rgb;
  s += texture(u_src, v_uv + t * vec2(0, 1)).rgb * 2.0;
  s += texture(u_src, v_uv + t * vec2(1, 1)).rgb;
  o_color = vec4(s * (u_weight / 16.0), 1.0);
}
`;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomIntensity;
uniform float u_exposure;
uniform float u_chromatic;
uniform float u_vignette;
uniform float u_grain;
uniform float u_saturation;
uniform float u_contrast;
uniform int u_tonemap;
uniform vec3 u_bgTop;
uniform vec3 u_bgBottom;
uniform float u_bgGlow;
uniform float u_time;
uniform vec2 u_resolution;
out vec4 o_color;

vec3 aces(vec3 x) {
  // Narkowicz fit of the ACES RRT+ODT
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 inset = mat3(0.842479, 0.0423282, 0.0423756, 0.0784336, 0.878468, 0.0784336, 0.0792237, 0.0791661, 0.879142);
  const mat3 outset = mat3(1.19688, -0.0528969, -0.0529716, -0.0980209, 1.15190, -0.0980434, -0.0990297, -0.0989612, 1.15107);
  c = inset * c;
  c = clamp(log2(max(c, 1e-10)), -12.47393, 4.026069);
  c = (c + 12.47393) / 16.500999;
  c = agxContrast(c);
  c = outset * c;
  return clamp(pow(max(c, 0.0), vec3(2.2)), 0.0, 1.0);
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 uv = v_uv;
  vec2 dc = uv - 0.5;
  float r2 = dot(dc, dc);
  vec3 hdr;
  if (u_chromatic > 0.0) {
    vec2 off = dc * r2 * u_chromatic * 0.06;
    hdr.r = texture(u_scene, uv + off).r;
    hdr.g = texture(u_scene, uv).g;
    hdr.b = texture(u_scene, uv - off).b;
  } else {
    hdr = texture(u_scene, uv).rgb;
  }
  vec3 bloom = texture(u_bloom, uv).rgb;
  vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec3 bg = mix(u_bgBottom, u_bgTop, smoothstep(0.0, 1.0, uv.y));
  bg += u_bgBottom * u_bgGlow * 3.0 * exp(-dot(dc * asp, dc * asp) * 3.5);
  vec3 col = (bg + hdr + bloom * u_bloomIntensity) * u_exposure;
  if (u_tonemap == 0) col = aces(col);
  else if (u_tonemap == 1) col = agx(col);
  else col = clamp(col, 0.0, 1.0);
  // grading in display-linear space
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, u_saturation), 0.0);
  col = clamp((col - 0.18) * u_contrast + 0.18, 0.0, 1.0);
  col *= 1.0 - u_vignette * smoothstep(0.15, 0.85, r2 * 1.6);
  vec3 outc = linearToSrgb(col);
  float n = hash(gl_FragCoord.xy + fract(u_time * 7.13) * 917.0);
  outc += (n - 0.5) * u_grain;
  outc += (hash(gl_FragCoord.xy * 1.37 + 11.0) - 0.5) / 255.0; // dither against banding
  o_color = vec4(outc, 1.0);
}
`;

// ───────────────────────────── GPU swarm (transform feedback) ─────────────────────────────

const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const MAX_GPU_FORCES = 8;

export const GPU_UPDATE_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec4 a_pv;   // pos.xy, vel.xy
layout(location = 1) in vec4 a_al;   // age, life, seed, size
out vec4 o_pv;
out vec4 o_al;

uniform float u_dt;
uniform float u_tau;
uniform float u_frame;
uniform vec2 u_half;          // world half extents
uniform vec4 u_ptr;           // pointer pos.xy, vel.xy
// emitter
uniform vec4 u_ePos;          // pos.xy, cos, sin
uniform int u_shape;
uniform vec4 u_shapeA;        // radius, thickness, width, height
uniform vec4 u_shapeB;        // arms, turns, jitter, edgeOnly
uniform vec4 u_life;          // lifeMin, lifeMax, speedMin, speedMax
uniform vec4 u_dir;           // dirRad, spreadRad, velocityMode, orbital
uniform vec4 u_misc;          // sizeMin, sizeMax, drag, invMass
uniform int u_active;
// forces
uniform int u_fcount;
uniform int u_ftype[${MAX_GPU_FORCES}];
uniform vec4 u_fa[${MAX_GPU_FORCES}];   // px, py, strength, radius
uniform vec4 u_fb[${MAX_GPU_FORCES}];   // dirX, dirY, inward/kill, softening/scale
uniform vec4 u_fc[${MAX_GPU_FORCES}];   // falloff, time, octaves, mode/restitution

${NOISE_GLSL}

uint hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16;
  return x;
}
float rnd(inout uint s) { s = hashu(s); return float(s) / 4294967295.0; }

const float TAU = 6.28318530718;

vec4 spawnShape(inout uint s) {
  // returns local position.xy and normal.xy
  float radius = u_shapeA.x;
  float a = rnd(s) * TAU;
  vec2 n = vec2(cos(a), sin(a));
  if (u_shape == 1) { // circle
    float r = u_shapeB.w > 0.5 ? radius : radius * sqrt(rnd(s));
    return vec4(n * r, n);
  } else if (u_shape == 2) { // ring
    float inner = radius * (1.0 - clamp(u_shapeA.y, 0.0, 1.0));
    float r = sqrt(inner * inner + rnd(s) * (radius * radius - inner * inner));
    return vec4(n * r, n);
  } else if (u_shape == 3) { // rect
    return vec4((rnd(s) - 0.5) * u_shapeA.z, (rnd(s) - 0.5) * u_shapeA.w, 0.0, 1.0);
  } else if (u_shape == 4) { // line (optionally a sine wave: thickness = amplitude, turns = waves)
    float u = rnd(s) - 0.5;
    float k = u_shapeB.y * TAU;
    float amp = u_shapeA.y > 0.2 ? u_shapeA.y : 0.0;
    float slope = cos(u * k) * amp * k / max(u_shapeA.z, 1e-3);
    return vec4(u * u_shapeA.z, sin(u * k) * amp, normalize(vec2(-slope, 1.0)));
  } else if (u_shape == 5) { // spiral
    float arms = max(1.0, floor(u_shapeB.x + 0.5));
    float arm = floor(rnd(s) * arms);
    float t = pow(rnd(s), 0.75);
    float ang = arm / arms * TAU + t * u_shapeB.y * TAU;
    float j = u_shapeB.z * radius * (0.25 + t * 0.6) * 0.5;
    float g1 = (rnd(s) + rnd(s) + rnd(s) + rnd(s) - 2.0) * 1.732;
    float g2 = (rnd(s) + rnd(s) + rnd(s) + rnd(s) - 2.0) * 1.732;
    vec2 p = vec2(cos(ang), sin(ang)) * radius * t + vec2(g1, g2) * j;
    return vec4(p, normalize(p + 1e-5));
  } else if (u_shape == 6) { // sphere (projected shell)
    float z = rnd(s) * 2.0 - 1.0;
    float rr = sqrt(1.0 - z * z);
    float shell = u_shapeB.w > 0.5 ? 1.0 : pow(rnd(s), 1.0 / 3.0);
    vec2 p = n * rr * radius * shell;
    return vec4(p, n);
  } else if (u_shape == 7) { // cone base
    float r = radius * 0.15 * sqrt(rnd(s));
    return vec4(n * r, 0.0, 1.0);
  }
  return vec4(0.0, 0.0, n);
}

float falloffW(float d, float R, float mode) {
  if (R <= 0.0) return 1.0;
  if (d > R) return 0.0;
  float q = 1.0 - d / R;
  if (mode < 0.5) return 1.0;
  if (mode < 1.5) return q;
  return q * q;
}

void main() {
  vec2 pos = a_pv.xy;
  vec2 vel = a_pv.zw;
  float age = a_al.x;
  float life = a_al.y;
  float seed = a_al.z;
  float size = a_al.w;
  uint s = hashu(uint(gl_VertexID) * 1973u + uint(u_frame) * 9277u + 26699u);

  age += u_dt;
  bool dead = life <= 0.0 ? age >= 0.0 : age >= life;
  if (dead) {
    if (u_active == 0) {
      o_pv = vec4(pos, vel);
      o_al = vec4(-0.01, 0.0, seed, size);
      return;
    }
    vec4 sh = spawnShape(s);
    vec2 lp = vec2(sh.x * u_ePos.z - sh.y * u_ePos.w, sh.x * u_ePos.w + sh.y * u_ePos.z);
    vec2 ln = vec2(sh.z * u_ePos.z - sh.w * u_ePos.w, sh.z * u_ePos.w + sh.w * u_ePos.z);
    pos = u_ePos.xy + lp;
    float speed = mix(u_life.z, u_life.w, rnd(s));
    float jit = (rnd(s) - 0.5) * u_dir.y;
    vec2 d;
    int vm = int(u_dir.z + 0.5);
    if (vm == 0) {
      float ang = u_dir.x + jit;
      d = vec2(cos(ang), sin(ang));
    } else {
      vec2 r = vm == 4 ? ln : (length(lp) > 1e-4 ? normalize(lp) : ln);
      if (vm == 3) r = -r;
      if (vm == 2) r = vec2(-r.y, r.x);
      d = vec2(r.x * cos(jit) - r.y * sin(jit), r.x * sin(jit) + r.y * cos(jit));
    }
    vel = d * speed;
    if (u_dir.w != 0.0) {
      vec2 rn = length(lp) > 1e-4 ? normalize(lp) : vec2(1.0, 0.0);
      vel += vec2(-rn.y, rn.x) * u_dir.w;
    }
    age = 0.0;
    life = mix(u_life.x, u_life.y, rnd(s));
    seed = rnd(s);
    size = mix(u_misc.x, u_misc.y, rnd(s));
  }

  if (life > 0.0 && age >= 0.0) {
    vec2 acc = vec2(0.0);
    for (int i = 0; i < ${MAX_GPU_FORCES}; i++) {
      if (i >= u_fcount) break;
      int t = u_ftype[i];
      vec4 A = u_fa[i];
      vec4 B = u_fb[i];
      vec4 C = u_fc[i];
      if (t == 0) { // gravity / wind
        acc += B.xy * A.z;
      } else if (t == 1) { // drag
        acc -= vel * A.z;
      } else if (t == 2) { // attractor
        vec2 dd = A.xy - pos;
        float d2 = dot(dd, dd);
        if (B.z > 0.0 && d2 < B.z * B.z) { age = life; }
        float dl = sqrt(d2) + 1e-4;
        float mag = C.x > 2.5 ? A.z * 100.0 / (d2 + B.w * B.w) : A.z * falloffW(dl, A.w, C.x);
        acc += dd / dl * mag;
      } else if (t == 3) { // vortex
        vec2 dd = pos - A.xy;
        float dl = length(dd) + 1e-4;
        float w = falloffW(dl, A.w, min(C.x, 2.0));
        acc += (vec2(-dd.y, dd.x) / dl * A.z - dd / dl * B.z) * w;
      } else if (t == 4) { // curl turbulence
        float sc = max(0.5, B.w);
        vec3 q = vec3(pos / sc, C.y);
        float e = 0.08;
        float n1 = snoise(q + vec3(0.0, e, 0.0));
        float n2 = snoise(q - vec3(0.0, e, 0.0));
        float n3 = snoise(q + vec3(e, 0.0, 0.0));
        float n4 = snoise(q - vec3(e, 0.0, 0.0));
        vec2 curl = vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
        if (C.z > 1.5) {
          vec3 q2 = vec3(pos / sc * 2.03, C.y + 19.19);
          curl += vec2(snoise(q2 + vec3(0.0, e, 0.0)) - snoise(q2 - vec3(0.0, e, 0.0)), -(snoise(q2 + vec3(e, 0.0, 0.0)) - snoise(q2 - vec3(e, 0.0, 0.0)))) / (2.0 * e) * 0.5;
        }
        acc += curl * A.z * 0.35;
      } else if (t == 5) { // pointer
        vec2 dd = pos - A.xy;
        float dl = length(dd) + 1e-3;
        if (dl < A.w) {
          float q = 1.0 - dl / A.w;
          float w = q * q * A.z;
          int m = int(C.w + 0.5);
          if (m == 0) acc -= dd / dl * w;
          else if (m == 1) acc += dd / dl * w;
          else if (m == 2) acc += vec2(-dd.y, dd.x) / dl * w - dd / dl * w * 0.15;
          else acc += (u_ptr.zw - vel) * q * A.z * 0.05;
        }
      }
    }
    vel += acc * u_misc.w * u_dt;
    vel *= 1.0 / (1.0 + u_misc.z * u_dt);
    pos += vel * u_dt;
    // colliders & bounds (types 6, 7, 8)
    for (int i = 0; i < ${MAX_GPU_FORCES}; i++) {
      if (i >= u_fcount) break;
      int t = u_ftype[i];
      vec4 A = u_fa[i];
      vec4 B = u_fb[i];
      vec4 C = u_fc[i];
      if (t == 6) { // circle collider
        vec2 dd = pos - A.xy;
        float dl = length(dd);
        if (dl < A.w) {
          vec2 nn = dd / max(dl, 1e-5);
          pos = A.xy + nn * A.w;
          float vn = dot(vel, nn);
          if (vn < 0.0) vel = (vel - vn * nn) * (1.0 - B.z) - vn * C.w * nn;
        }
      } else if (t == 7) { // plane collider
        float dist = dot(pos - A.xy, B.xy);
        if (dist < 0.0) {
          pos -= B.xy * dist;
          float vn = dot(vel, B.xy);
          if (vn < 0.0) vel = (vel - vn * B.xy) * (1.0 - B.z) - vn * C.w * B.xy;
        }
      } else if (t == 8) { // bounds
        vec2 lo = -u_half + A.w;
        vec2 hi = u_half - A.w;
        int m = int(C.x + 0.5);
        if (m == 0) {
          if (pos.x < lo.x) { pos.x = lo.x; vel.x = abs(vel.x) * C.w; }
          if (pos.x > hi.x) { pos.x = hi.x; vel.x = -abs(vel.x) * C.w; }
          if (pos.y < lo.y) { pos.y = lo.y; vel.y = abs(vel.y) * C.w; }
          if (pos.y > hi.y) { pos.y = hi.y; vel.y = -abs(vel.y) * C.w; }
        } else if (m == 1) {
          vec2 sz = hi - lo;
          if (pos.x < lo.x) pos.x += sz.x;
          if (pos.x > hi.x) pos.x -= sz.x;
          if (pos.y < lo.y) pos.y += sz.y;
          if (pos.y > hi.y) pos.y -= sz.y;
        } else if (any(lessThan(pos, lo)) || any(greaterThan(pos, hi))) {
          age = life;
        }
      }
    }
    if (abs(pos.x) > u_half.x * 2.5 || abs(pos.y) > u_half.y * 2.5) age = life;
  }
  o_pv = vec4(pos, vel);
  o_al = vec4(age, life, seed, size);
}
`;

export const GPU_UPDATE_FS = /* glsl */ `#version 300 es
precision lowp float;
out vec4 o;
void main() { o = vec4(0.0); }
`;

export const GPU_RENDER_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_pv;
layout(location = 2) in vec4 a_al;
uniform vec4 u_view;
uniform float u_stretch;
uniform float u_pxWorld;
uniform float u_sizeMul;
uniform sampler2D u_lut;     // row 0: gradient rgba, row 1: size curve
uniform int u_colorMode;
uniform float u_speedRef;
uniform float u_intensity;
uniform float u_flicker;
uniform float u_frame;
out vec2 v_uv;
out vec4 v_color;
out float v_seed;
vec4 lut(float t, int row) {
  float x = clamp(t, 0.0, 1.0) * 127.0;
  int i = int(floor(x));
  int j = min(i + 1, 127);
  return mix(texelFetch(u_lut, ivec2(i, row), 0), texelFetch(u_lut, ivec2(j, row), 0), fract(x));
}
void main() {
  float age = a_al.x;
  float life = a_al.y;
  if (life <= 0.0 || age < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float t = clamp(age / life, 0.0, 1.0);
  vec4 g = lut(t, 0);
  vec3 rgb = g.rgb;
  if (u_colorMode == 1) rgb = lut(length(a_pv.zw) / max(u_speedRef, 0.01), 0).rgb;
  else if (u_colorMode == 2) rgb = lut(a_al.z, 0).rgb;
  float alpha = g.a;
  if (u_flicker > 0.0) alpha *= 1.0 - u_flicker * fract(sin(a_al.z * 9137.0 + u_frame * 12.9898) * 43758.5453);
  float size = a_al.w * lut(t, 1).r * u_sizeMul;
  float minS = u_pxWorld * 1.5;
  if (size < minS) { alpha *= (size * size) / (minS * minS); size = minS; }
  vec2 vel = a_pv.zw;
  float speed = length(vel);
  vec2 dir = vec2(1.0, 0.0);
  float halfL = size * 0.5;
  if (u_stretch > 0.0 && speed > 0.001) {
    dir = vel / speed;
    float extra = speed * u_stretch * 0.02;
    halfL += extra;
    alpha *= clamp(size / (size + extra), 0.25, 1.0);
  }
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 world = a_pv.xy + dir * a_corner.x * halfL + perp * a_corner.y * size * 0.5;
  gl_Position = vec4(world * u_view.xy + u_view.zw, 0.0, 1.0);
  v_uv = a_corner;
  v_color = vec4(rgb * u_intensity, alpha);
  v_seed = a_al.z;
}
`;
