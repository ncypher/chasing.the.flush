import * as THREE from 'three';
import { lin } from '../mushrooms/lathe.js';

// Procedural trees: tapered-tube trunks/limbs merged per chunk + leaf-cluster cards.

export class GeomBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.idx = []; this.n = 0; }

  tube(a, b, ra, rb, radial, ca, cb, v0 = 0) {
    const axis = new THREE.Vector3().subVectors(b, a);
    const len = axis.length();
    if (len < 1e-5) return v0;
    axis.divideScalar(len);
    const helper = Math.abs(axis.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const v1 = v0 + len / 1.4;
    const base = this.n;
    for (let ring = 0; ring < 2; ring++) {
      const p = ring ? b : a, r = ring ? rb : ra, c = ring ? cb : ca, vv = ring ? v1 : v0;
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        const cx = Math.cos(ang), sy = Math.sin(ang);
        const dx = u.x * cx + v.x * sy, dy = u.y * cx + v.y * sy, dz = u.z * cx + v.z * sy;
        this.pos.push(p.x + dx * r, p.y + dy * r, p.z + dz * r);
        this.nor.push(dx, dy, dz);
        this.col.push(c[0], c[1], c[2]);
        this.uv.push(k / radial * 1.4, vv);
        this.n++;
      }
    }
    for (let k = 0; k < radial; k++) {
      const i0 = base + k, i1 = base + k + 1, i2 = base + radial + 1 + k, i3 = base + radial + 2 + k;
      this.idx.push(i0, i2, i1, i1, i2, i3);
    }
    return v1;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export const TREE_SPECS = {
  elm_dying: { kind: 'vase', h: [13, 18], r: [0.30, 0.42], trunkFrac: 0.36, limbs: [4, 6], limbAng: [20, 38], limbLen: [0.62, 0.9], depth: 3, dead: true, bark: '#7a7568', up: 0.18, wobble: 0.16, childN: [3, 5], host: 'elm_dying' },
  ash_dying: { kind: 'column', h: [15, 21], r: [0.22, 0.31], trunkFrac: 0.78, limbs: [8, 12], limbStart: 0.5, limbAng: [34, 58], limbLen: [0.22, 0.32], depth: 3, dead: true, bark: '#6e6a5e', up: 0.1, wobble: 0.1, childN: [2, 4], host: 'ash_dying' },
  elm_live: { kind: 'vase', h: [11, 15], r: [0.22, 0.32], trunkFrac: 0.42, limbs: [4, 5], limbAng: [22, 40], limbLen: [0.6, 0.85], depth: 3, dead: false, bark: '#625c50', up: 0.15, wobble: 0.14, childN: [3, 4], leaf: 'newgreen', leafN: 22, host: null },
  oak: { kind: 'spread', h: [10, 15], r: [0.34, 0.52], trunkFrac: 0.4, limbs: [4, 6], limbAng: [48, 72], limbLen: [0.55, 0.85], depth: 3, dead: false, bark: '#4f473c', up: 0.02, wobble: 0.2, childN: [3, 4], leaf: 'oak', leafN: 30, host: null },
  maple: { kind: 'spread', h: [10, 14], r: [0.28, 0.42], trunkFrac: 0.45, limbs: [4, 6], limbAng: [40, 62], limbLen: [0.5, 0.78], depth: 3, dead: false, bark: '#5c554a', up: 0.08, wobble: 0.16, childN: [3, 4], leaf: 'newgreen', leafN: 28, host: null },
  tulip_poplar: { kind: 'column', h: [26, 34], r: [0.42, 0.62], trunkFrac: 0.9, limbStart: 0.6, limbs: [8, 11], limbAng: [34, 58], limbLen: [0.16, 0.24], depth: 2, dead: false, bark: '#6d6659', up: 0.12, wobble: 0.06, childN: [2, 3], leaf: 'poplar', leafN: 64, host: 'tulip_poplar' },
  apple_old: { kind: 'gnarled', h: [3.8, 5.4], r: [0.2, 0.3], trunkFrac: 0.42, limbs: [4, 6], limbStart: 0.7, limbAng: [38, 82], limbLen: [0.7, 1.1], depth: 3, dead: false, bark: '#4c4237', up: 0.05, wobble: 0.34, childN: [3, 5], leaf: 'apple', leafN: 30, host: 'apple_old' },
};

const UP = new THREE.Vector3(0, 1, 0);

function jitterColor(hex, rng, amt = 0.1) {
  const c = lin(hex);
  const k = 1 + rng.range(-amt, amt);
  return [c[0] * k, c[1] * k, c[2] * k];
}

const MOSS = lin('#4f6b2c');
function mossed(col, y, mossAmt) {
  const t = Math.max(0, 1 - y / 0.9) * mossAmt;
  return [col[0] + (MOSS[0] - col[0]) * t, col[1] + (MOSS[1] - col[1]) * t, col[2] + (MOSS[2] - col[2]) * t];
}

// Grow one tree at `base`. Returns { height, trunkR, tips }.
export function growTree(spec, rng, base, builder, leafSink) {
  const H = rng.range(spec.h[0], spec.h[1]);
  const R0 = rng.range(spec.r[0], spec.r[1]);
  const Ht = H * spec.trunkFrac;
  const barkCol = jitterColor(spec.bark, rng, 0.08);
  const mossAmt = rng.range(0.15, 0.7);
  const tips = [];

  const lean = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).multiplyScalar(spec.kind === 'gnarled' ? 0.3 : 0.08);
  const segs = Math.max(3, Math.round(Ht / 1.6));
  const trunkPts = [base.clone()];
  const trunkR = [R0 * 1.35];
  const dir = new THREE.Vector3(0, 1, 0).add(lean).normalize();
  let p = base.clone();
  for (let i = 0; i < segs; i++) {
    dir.x += rng.range(-1, 1) * spec.wobble * 0.5;
    dir.z += rng.range(-1, 1) * spec.wobble * 0.5;
    dir.y = Math.max(0.55, dir.y);
    dir.normalize();
    p = p.clone().addScaledVector(dir, Ht / segs);
    trunkPts.push(p);
    const t = (i + 1) / segs;
    trunkR.push(R0 * (1 - 0.52 * t) * (i === 0 ? 1.15 : 1));
  }
  let v = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const c0 = mossed(barkCol, trunkPts[i].y - base.y, mossAmt);
    const c1 = mossed(barkCol, trunkPts[i + 1].y - base.y, mossAmt);
    v = builder.tube(trunkPts[i], trunkPts[i + 1], trunkR[i], trunkR[i + 1], 8, c0, c1, v);
    void t0; void t1;
  }
  // buttress roots
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, Math.PI * 2);
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const s = base.clone().addScaledVector(out, R0 * 0.5).add(new THREE.Vector3(0, 0.45, 0));
    const e = base.clone().addScaledVector(out, R0 * 2.4 + 0.3).add(new THREE.Vector3(0, -0.15, 0));
    builder.tube(s, e, R0 * 0.42, R0 * 0.1, 5, mossed(barkCol, 0.1, mossAmt), mossed(barkCol, 0.0, mossAmt));
  }

  const trunkRadiusAt = (t) => R0 * (1 - 0.52 * t);
  const pointOnTrunk = (t) => {
    const f = t * segs;
    const i = Math.min(segs - 1, Math.floor(f));
    return trunkPts[i].clone().lerp(trunkPts[i + 1], f - i);
  };

  function branch(origin, d0, len, r0, depth, rIn) {
    const n = Math.max(2, Math.round(len / (depth === 1 ? 1.5 : 1.0)));
    const d = d0.clone().normalize();
    let pos = origin.clone();
    let r = r0;
    let vv = 0;
    const radial = depth <= 1 ? 6 : depth === 2 ? 4 : 3;
    const col = barkCol.map((x) => x * (spec.dead ? 1.0 : 0.95));
    for (let i = 0; i < n; i++) {
      d.x += rng.range(-1, 1) * spec.wobble;
      d.z += rng.range(-1, 1) * spec.wobble;
      d.y += rng.range(-0.5, 1) * spec.wobble + spec.up * 0.35;
      d.normalize();
      const step = len / n;
      const next = pos.clone().addScaledVector(d, step);
      const r1 = r0 * Math.max(0.12, 1 - (i + 1) / n * 0.82);
      vv = builder.tube(pos, next, r, r1, radial, col, col, vv);
      if (depth < spec.depth && i > 0 && i < n && rng.chance(spec.dead ? 0.9 : 0.62)) {
        const cd = d.clone();
        const axis = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 0.3), rng.range(-1, 1)).normalize();
        cd.applyAxisAngle(axis, rng.range(0.55, 1.05));
        if (cd.y < -0.2) cd.y = -cd.y * 0.5;
        const frac = i / n;
        branch(next, cd, len * rng.range(0.32, 0.55) * (1 - frac * 0.5), r1 * rng.range(0.55, 0.8), depth + 1);
      }
      pos = next;
      r = r1;
    }
    tips.push({ x: pos.x, y: pos.y, z: pos.z, depth });
    // a mid-limb leaf anchor so foliage covers the whole limb
    if (depth === 1) tips.push({ x: origin.x + (pos.x - origin.x) * 0.6, y: origin.y + (pos.y - origin.y) * 0.6, z: origin.z + (pos.z - origin.z) * 0.6, depth });
  }

  const nLimbs = rng.int(spec.limbs[0], spec.limbs[1]);
  const az0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < nLimbs; i++) {
    let t;
    if (spec.kind === 'vase') t = 0.96 + rng.range(-0.04, 0.02);
    else {
      const ls = spec.limbStart ?? 0.55;
      t = ls + (1 - ls) * ((i + rng.range(0, 0.6)) / nLimbs);
    }
    t = Math.min(1, t);
    const at = pointOnTrunk(t);
    const az = az0 + i * 2.399963 + rng.range(-0.3, 0.3);
    const ang = THREE.MathUtils.degToRad(rng.range(spec.limbAng[0], spec.limbAng[1]));
    const d = new THREE.Vector3(Math.sin(ang) * Math.cos(az), Math.cos(ang), Math.sin(ang) * Math.sin(az));
    let len = H * rng.range(spec.limbLen[0], spec.limbLen[1]);
    if (spec.kind === 'column') len *= 1.15 - 0.6 * t;
    branch(at, d, len, trunkRadiusAt(t) * (spec.kind === 'vase' ? 0.72 : 0.5), 1);
  }
  // central leader for column types / short crown cap for others
  if (spec.kind === 'column' || spec.kind === 'spread') {
    const top = pointOnTrunk(1);
    branch(top, new THREE.Vector3(rng.range(-0.2, 0.2), 1, rng.range(-0.2, 0.2)), H * (spec.kind === 'column' ? 0.14 : 0.28), trunkRadiusAt(1) * 0.8, 1);
  }

  if (!spec.dead && spec.leaf) {
    const n = Math.min(spec.leafN, Math.max(6, tips.length * 3));
    const hi = tips.filter((t) => t.y - base.y > H * 0.35);
    const pool = hi.length > 4 ? hi : tips;
    for (let i = 0; i < n; i++) {
      const t = rng.pick(pool);
      leafSink.push({
        kind: spec.leaf,
        x: t.x + rng.range(-1, 1) * 0.9,
        y: t.y + rng.range(-0.3, 0.9),
        z: t.z + rng.range(-1, 1) * 0.9,
        size: (spec.leaf === 'poplar' ? rng.range(2.6, 4.2) : spec.leaf === 'apple' ? rng.range(1.5, 2.4) : rng.range(2.2, 3.5)),
        rot: rng.range(0, Math.PI),
      });
    }
  } else if (spec.dead) {
    // a few epicormic sprouts on the trunk of an otherwise dead tree
    const n = rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      const at = pointOnTrunk(rng.range(0.15, 0.55));
      leafSink.push({ kind: 'newgreen', x: at.x + rng.range(-0.5, 0.5), y: at.y, z: at.z + rng.range(-0.5, 0.5), size: rng.range(1.0, 1.6), rot: rng.range(0, 3) });
    }
  }
  return { height: H, trunkR: R0, tips };
}
