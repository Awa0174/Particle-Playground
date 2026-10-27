/**
 * Deterministic, seedable PRNG (sfc32). Small state that can be snapshotted,
 * fast enough for hundreds of thousands of calls per frame.
 */
export class Rng {
  a = 0;
  b = 0;
  c = 0;
  d = 0;

  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(seed: number): void {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = (seed | 0) ^ 0xdeadbeef;
    for (let i = 0; i < 15; i++) this.next();
  }

  next(): number {
    let a = this.a >>> 0;
    let b = this.b >>> 0;
    let c = this.c >>> 0;
    let d = this.d >>> 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    return (t >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Approximately normal distributed value (mean 0, sd ~1). */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }

  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  setState(s: [number, number, number, number]): void {
    this.a = s[0];
    this.b = s[1];
    this.c = s[2];
    this.d = s[3];
  }
}

/** Stateless integer hash → [0,1). Used for per-particle, per-frame variation. */
export function hash01(x: number, y = 0): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
