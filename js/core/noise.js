import { RNG } from './rng.js';

// Seeded improved-Perlin noise (2D/3D) + fbm + cellular (Worley) noise.
export function makeNoise(seed) {
  const rng = new RNG(seed);
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  rng.shuffle(base);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y, z) => {
    h &= 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  function n3(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
           lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
           lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  }

  const n2 = (x, y) => n3(x, y, 0.37);

  function fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * n2(x * f, y * f);
      norm += a; a *= gain; f *= lac;
    }
    return s / norm;
  }

  function fbm3(x, y, z, oct = 3, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * n3(x * f, y * f, z * f);
      norm += a; a *= gain; f *= lac;
    }
    return s / norm;
  }

  // Cellular noise: returns [F1, F2] distances to the two nearest feature points.
  const cellHash = (ix, iy, iz, k) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2147483647) ^ Math.imul(k + 1, 1274126177) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const out2 = [0, 0];
  function worley3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let d1 = 9, d2 = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const fx = cx + cellHash(cx, cy, cz, 0) - x;
      const fy = cy + cellHash(cx, cy, cz, 1) - y;
      const fz = cz + cellHash(cx, cy, cz, 2) - z;
      const d = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    out2[0] = d1; out2[1] = d2;
    return out2;
  }

  return { n2, n3, fbm2, fbm3, worley3 };
}
