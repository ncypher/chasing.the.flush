import * as THREE from 'three';

const TAU = Math.PI * 2;

// sRGB hex -> linear [r,g,b] (vertex colours are interpreted as linear).
export function lin(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export function mix3(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

// Resample control points [r,y] (profile of a solid of revolution, bottom axis -> top axis)
// into evenly spaced samples with outward normals and a 0..1 arc-length parameter.
export function resampleProfile(controls, n) {
  const curve = new THREE.SplineCurve(controls.map((c) => new THREE.Vector2(c[0], c[1])));
  const raw = curve.getSpacedPoints(n);
  const pts = raw.map((v) => ({ r: Math.max(0, v.x), y: v.y, nr: 1, ny: 0, s: 0 }));
  pts[0].r = 0;
  pts[pts.length - 1].r = 0;
  computeNormals2D(pts);
  return pts;
}

export function computeNormals2D(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const tr = b.r - a.r, ty = b.y - a.y;
    const l = Math.hypot(tr, ty) || 1;
    pts[i].nr = ty / l;
    pts[i].ny = -tr / l;
    pts[i].s = i / (n - 1);
  }
}

const ctx = { x: 0, y: 0, z: 0, th: 0, s: 0, r: 0, i: 0 };

// Revolve a profile around Y. shade(ctx, out) may set out.d (displacement along the
// profile normal) and out.r/g/b (vertex colour).
export function buildRevolved({ pts, segs, th0 = 0, th1 = TAU, shade }) {
  const full = Math.abs(th1 - th0 - TAU) < 1e-6;
  const cols = full ? segs : segs + 1;
  const n = pts.length;
  const pos = new Float32Array(n * cols * 3);
  const col = new Float32Array(n * cols * 3);
  const out = { d: 0, r: 1, g: 1, b: 1 };

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    for (let j = 0; j < cols; j++) {
      const th = th0 + (th1 - th0) * (j / segs);
      const c = Math.cos(th), s = Math.sin(th);
      ctx.x = p.r * c; ctx.y = p.y; ctx.z = p.r * s; ctx.th = th; ctx.s = p.s; ctx.r = p.r; ctx.i = i;
      out.d = 0; out.r = 0.8; out.g = 0.8; out.b = 0.8;
      shade(ctx, out);
      const rr = Math.max(0, p.r + p.nr * out.d);
      const yy = p.y + p.ny * out.d;
      const k = (i * cols + j) * 3;
      pos[k] = rr * c; pos[k + 1] = yy; pos[k + 2] = rr * s;
      col[k] = out.r; col[k + 1] = out.g; col[k + 2] = out.b;
    }
  }

  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j2 = full ? (j + 1) % cols : j + 1;
      const a = i * cols + j, b = i * cols + j2, c = (i + 1) * cols + j, d = (i + 1) * cols + j2;
      idx.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Displaced outline at a given azimuth (used for exact cut-plane cross-sections).
function displacedOutline(pts, shade, th) {
  const out = { d: 0, r: 1, g: 1, b: 1 };
  const c = Math.cos(th), s = Math.sin(th);
  return pts.map((p, i) => {
    ctx.x = p.r * c; ctx.y = p.y; ctx.z = p.r * s; ctx.th = th; ctx.s = p.s; ctx.r = p.r; ctx.i = i;
    out.d = 0;
    shade(ctx, out);
    return { r: Math.max(0, p.r + p.nr * out.d), y: p.y + p.ny * out.d };
  });
}

function pathFromSides(right, left) {
  const poly = [];
  const push = (x, y) => {
    const q = poly[poly.length - 1];
    if (!q || Math.hypot(q[0] - x, q[1] - y) > 1e-4) poly.push([x, y]);
  };
  for (const p of right) push(p.r, p.y);
  for (let i = left.length - 1; i >= 0; i--) push(-left[i].r, left[i].y);
  if (poly.length > 2 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1e-4) poly.pop();
  return poly;
}

// Half of a mushroom (body, optional cavity) plus the flat cut face on the z=0 plane.
// th0 = 0 -> body on z>=0, face looks toward -z; th0 = PI -> body on z<=0, face looks +z.
export function buildCutHalf(spec, th0, segs = 64, rings = 0) {
  const outline = rings ? resampleProfile(spec.controls, rings) : spec.outline;
  const body = buildRevolved({ pts: outline, segs, th0, th1: th0 + Math.PI, shade: spec.shade });
  let cavity = null;
  if (spec.cavity) {
    cavity = buildRevolved({ pts: spec.cavity, segs, th0, th1: th0 + Math.PI, shade: spec.cavityShade });
  }

  // The th0 = 0 face is mirrored by rotateY(PI) below, so its sides swap.
  const rightTh = th0 === 0 ? Math.PI : Math.PI * 2;
  const leftTh = th0 === 0 ? 0 : Math.PI;
  const outerR = displacedOutline(outline, spec.shade, rightTh);
  const outerL = displacedOutline(outline, spec.shade, leftTh);
  const shape = new THREE.Shape(pathFromSides(outerR, outerL).map((p) => new THREE.Vector2(p[0], p[1])));
  if (spec.cavity) {
    const cr = displacedOutline(spec.cavity, spec.cavityShade, rightTh);
    const cl = displacedOutline(spec.cavity, spec.cavityShade, leftTh);
    shape.holes.push(new THREE.Path(pathFromSides(cr, cl).map((p) => new THREE.Vector2(p[0], p[1]))));
  }

  const face = new THREE.ShapeGeometry(shape, 8);
  const posA = face.attributes.position;
  const uv = face.attributes.uv;
  for (let i = 0; i < posA.count; i++) uv.setXY(i, posA.getX(i) * 1.1 + 0.5, posA.getY(i) * 1.1);
  if (th0 === 0) {
    face.rotateY(Math.PI);
  }
  face.translate(0, 0, th0 === 0 ? -0.0015 : 0.0015);
  return { body, cavity, face };
}

export { TAU };
