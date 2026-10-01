import { makeNoise } from '../core/noise.js';
import { smoothstep, lerp } from '../core/util.js';
import { lin, mix3, resampleProfile } from './lathe.js';

// False morel (Gyromitra): reddish-brown brain-folded cap that hangs like a skirt, joined to a
// thick ribbed stem only near the top. Inside: cottony, chambered flesh - not a clean hollow.

const CAPS = [
  { base: lin('#8f4220'), crease: lin('#27100a'), hi: lin('#b46a35') },
  { base: lin('#7b3419'), crease: lin('#220c06'), hi: lin('#a05a2c') },
  { base: lin('#a85d2a'), crease: lin('#35170a'), hi: lin('#c98445') },
  { base: lin('#5e2a14'), crease: lin('#1b0a05'), hi: lin('#8a4a26') },
];
const STEM = lin('#f0e1d2');
const STEM_SHADE = lin('#cdb7a4');

export function makeGyromitraSpec(rng) {
  const cap = rng.pick(CAPS);
  const noise = makeNoise(rng.int(1, 1e9));
  const P = {
    Rs: rng.range(0.15, 0.19),
    Rc: rng.range(0.38, 0.46),
    rimY: rng.range(0.27, 0.34),
    yTop: rng.range(0.92, 0.98),
    fold: rng.range(0.034, 0.05),
    ox: rng.range(0, 60), oy: rng.range(0, 60), oz: rng.range(0, 60),
  };
  const { Rs, Rc, rimY, yTop } = P;
  const A = rimY + 0.2;

  const controls = [
    [0, 0], [Rs * 0.7, 0.004], [Rs * 1.3, 0.05], [Rs * 1.2, 0.14], [Rs * 1.0, 0.3], [Rs * 0.94, 0.42], [Rs * 0.9, A],
    [lerp(Rs, Rc, 0.38), A - 0.004], [lerp(Rs, Rc, 0.6), A - 0.07], [lerp(Rs, Rc, 0.83), rimY + 0.05], [Rc * 0.98, rimY],
    [Rc * 1.06, rimY + 0.08], [Rc * 1.06, rimY + 0.22], [Rc * 0.92, rimY + 0.37], [Rc * 0.68, yTop - 0.14],
    [Rc * 0.36, yTop - 0.05], [0, yTop],
  ];
  const outline = resampleProfile(controls, 150);

  // arc-length parameter where the stem ends and the (free-hanging) cap begins
  let sCap = 0.4, best = 1e9;
  for (const p of outline) {
    const dd = Math.hypot(p.r - Rs * 0.9, p.y - A);
    if (dd < best) { best = dd; sCap = p.s; }
  }

  const tmp = [0, 0, 0];
  const tmp2 = [0, 0, 0];
  const shade = (c, o) => {
    const capMask = smoothstep(sCap - 0.012, sCap + 0.045, c.s);
    let d = 0;

    // stem: flutes, lumps, chalky surface
    const flute = Math.sin(c.th * 6 + noise.n3(c.x * 4, c.y * 3, c.z * 4) * 2.4);
    const stemD = 0.012 * flute + 0.012 * noise.n3(c.x * 7, c.y * 5, c.z * 7);

    // cap: low-frequency lobes + domain-warped brain folds
    const f = 7.0;
    const px = c.x * f + P.ox, py = c.y * f + P.oy, pz = c.z * f + P.oz;
    const wx = noise.n3(px * 0.45 + 11, py * 0.45, pz * 0.45) * 1.1;
    const wy = noise.n3(px * 0.45, py * 0.45 + 17, pz * 0.45) * 1.1;
    const wz = noise.n3(px * 0.45, py * 0.45, pz * 0.45 + 23) * 1.1;
    const v = noise.n3(px + wx, py + wy, pz + wz);
    const crease = 1 - smoothstep(0.0, 0.17, Math.abs(v));
    const lobes = noise.n3(c.x * 2.3 + 5, c.y * 2.3, c.z * 2.3);
    const capD = -P.fold * crease + 0.012 * (1 - crease) * noise.n3(px * 1.7, py * 1.7, pz * 1.7) + 0.05 * lobes;

    d = lerp(stemD, capD, capMask);

    // colour
    const tone = 0.92 + 0.16 * noise.n3(c.x * 12, c.y * 8, c.z * 12);
    mix3(cap.base, cap.hi, smoothstep(-0.2, 0.5, v) * 0.6, tmp);
    mix3(tmp, cap.crease, Math.pow(crease, 0.9), tmp);
    const stemTone = 0.95 + 0.08 * noise.n3(c.x * 20, c.y * 6, c.z * 20);
    mix3(STEM, STEM_SHADE, 0.35 * (1 - smoothstep(0, 0.25, c.y)) + 0.1 * (flute * 0.5 + 0.5), tmp2);
    o.d = d;
    o.r = lerp(tmp2[0] * stemTone, tmp[0] * tone, capMask);
    o.g = lerp(tmp2[1] * stemTone, tmp[1] * tone, capMask);
    o.b = lerp(tmp2[2] * stemTone, tmp[2] * tone, capMask);
  };

  return {
    id: 'gyromitra', kind: 'false', controls, outline, cavity: null, shade, cavityShade: null,
    flesh: 'chambered', worldHeight: 0.2,
  };
}
