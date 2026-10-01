import { makeNoise } from '../core/noise.js';
import { smoothstep, lerp } from '../core/util.js';
import { lin, mix3, resampleProfile, computeNormals2D } from './lathe.js';

// True morel (Morchella): honeycomb of pits and ridges, cap fused to the stem along its
// lower rim, and ONE continuous hollow from the cap tip to the stem base.

const PALETTES = {
  yellow: { ridge: lin('#d2ab4e'), pit: lin('#4d3517'), weight: 4.5 },
  blonde: { ridge: lin('#e3cb8a'), pit: lin('#7a5a2c'), weight: 1.5 },
  gray: { ridge: lin('#a5a08c'), pit: lin('#2e2b23'), weight: 2.5 },
  black: { ridge: lin('#575244'), pit: lin('#100f0b'), weight: 1.5 },
};
const STEM = lin('#efe6cf');
const STEM_DIRT = lin('#c2b08a');
const CAVITY = lin('#e9dcb8');
const CAVITY_DEEP = lin('#c2ae80');

export function makeMorelSpec(rng, opts = {}) {
  const palette = opts.palette || rng.weighted(Object.keys(PALETTES), (k) => PALETTES[k].weight);
  const pal = PALETTES[palette];
  const noise = makeNoise(rng.int(1, 1e9));
  const conical = rng.chance(0.45);

  const P = {
    palette,
    Rs: rng.range(0.13, 0.16),
    Rc: rng.range(0.25, 0.30),
    capY: rng.range(0.33, 0.41),
    tipY: rng.range(0.97, 1.0),
    cells: rng.range(9.8, 12.4),
    pitDepth: rng.range(0.024, 0.034),
    ox: rng.range(0, 50), oy: rng.range(0, 50), oz: rng.range(0, 50),
    conical,
  };

  const { Rs, Rc, capY, tipY } = P;
  const capH = tipY - capY;
  const shapeTable = conical
    ? [[0.10, 0.80], [0.30, 0.94], [0.52, 0.84], [0.72, 0.62], [0.88, 0.34], [0.96, 0.14]]
    : [[0.10, 0.86], [0.30, 1.0], [0.52, 0.97], [0.72, 0.82], [0.88, 0.55], [0.96, 0.26]];
  const controls = [
    [0, 0], [Rs * 0.7, 0.004], [Rs * 1.14, 0.035], [Rs * 1.02, 0.11], [Rs * 0.93, 0.24], [Rs * 0.97, capY - 0.02],
    [Rs * 0.92, capY + 0.004],
    ...shapeTable.map(([f, rf]) => [Rc * rf, capY + capH * f]),
    [0, tipY],
  ];
  const tmp = [0, 0, 0];
  const tmp2 = [0, 0, 0];
  const shade = (c, o) => {
    const y = c.y;
    const capMask = smoothstep(capY - 0.015, capY + 0.06, y);
    let d = 0;
    let pit = 0;
    if (capMask > 0.001) {
      const w = noise.worley3(c.x * P.cells + P.ox, y * P.cells * 0.58 + P.oy, c.z * P.cells + P.oz);
      const ridge = w[1] - w[0];
      pit = smoothstep(0.05, 0.3, ridge);
      const depthMod = smoothstep(capY, capY + 0.1, y) * (1 - smoothstep(0.92, 1.0, y) * 0.65);
      d = (-P.pitDepth * pit + 0.010 * (1 - pit)) * capMask * depthMod;
      pit *= depthMod;
    }
    d += noise.n3(c.x * 40, y * 11, c.z * 40) * 0.0035 * (1 - capMask);

    const tone = 0.9 + 0.2 * noise.n3(c.x * 9, y * 6, c.z * 9);
    mix3(pal.ridge, pal.pit, Math.pow(pit, 0.8), tmp);
    const tipDark = 1 - smoothstep(0.85, 1.0, y) * 0.25;
    const stemTone = 0.93 + 0.1 * noise.n3(c.x * 30, y * 8, c.z * 30);
    mix3(STEM, STEM_DIRT, (1 - smoothstep(0.0, 0.2, y)) * 0.8 + 0.1 * noise.n3(c.x * 6, y * 6, c.z * 6), tmp2);
    mix3([tmp2[0] * stemTone, tmp2[1] * stemTone, tmp2[2] * stemTone], [tmp[0] * tone * tipDark, tmp[1] * tone * tipDark, tmp[2] * tone * tipDark], capMask, tmp);
    o.d = d; o.r = tmp[0]; o.g = tmp[1]; o.b = tmp[2];
  };

  const outline = resampleProfile(controls, 130);

  // Hollow: offset the outline inward; one chamber from the cap tip to the stem base.
  const inner = [];
  for (const p of outline) {
    const wall = p.y < capY ? 0.034 : 0.044;
    const r = p.r - p.nr * wall, y = p.y - p.ny * wall;
    if (r > 0.014 && y > 0.045 && y < tipY - 0.03) inner.push({ r, y, nr: 1, ny: 0, s: 0 });
  }
  const cavity = [{ r: 0, y: inner[0].y, nr: 1, ny: 0, s: 0 }, ...inner, { r: 0, y: inner[inner.length - 1].y + 0.018, nr: 1, ny: 0, s: 0 }];
  computeNormals2D(cavity);
  const cavityShade = (c, o) => {
    const t = smoothstep(0.1, 0.95, c.y);
    const ridges = 0.5 + 0.5 * noise.n3(c.x * 14, c.y * 4, c.z * 14);
    mix3(CAVITY, CAVITY_DEEP, t * 0.6 + ridges * 0.25, tmp);
    o.d = noise.n3(c.x * 25, c.y * 9, c.z * 25) * 0.003;
    o.r = tmp[0]; o.g = tmp[1]; o.b = tmp[2];
  };

  return {
    id: 'morel', kind: 'true', palette, controls, outline, cavity, shade, cavityShade,
    flesh: 'hollow', worldHeight: 0.19,
  };
}
