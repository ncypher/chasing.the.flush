import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lin } from '../mushrooms/lathe.js';

export const timeUniform = { value: 0 };

// Alpha-tested foliage that stays lit from below (leaves are translucent) and sways a little.
export function foliageMaterial({ map, color = 0xffffff, sway = 0.05, roughness = 0.85, glow = 0 }) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness, color });
  if (glow > 0) { m.emissive = new THREE.Color(0x3a5a14).multiplyScalar(glow); m.emissiveMap = map; }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.27;
      #else
        float ph = 0.0;
      #endif
      transformed.x += sin(uTime * 1.3 + ph + position.y * 2.0) * ${sway.toFixed(3)};
      transformed.z += cos(uTime * 1.1 + ph * 1.3 + position.y * 2.0) * ${sway.toFixed(3)};`);
    sh.fragmentShader = sh.fragmentShader.replace(/float faceDirection = gl_FrontFacing \? 1\.0 : - ?1\.0;/, 'float faceDirection = 1.0;');
  };
  m.customProgramCacheKey = () => 'foliage' + sway;
  return m;
}

// Three crossed cards with upward normals: soft canopy shading and good shadow dapple.
export function leafCardGeometry() {
  const parts = [];
  const make = (rx, ry) => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(rx);
    g.rotateY(ry);
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    parts.push(g);
  };
  make(-Math.PI / 2, 0);
  make(-Math.PI / 2 + 0.75, 0.9);
  make(-Math.PI / 2 - 0.75, -0.9);
  return mergeGeometries(parts);
}

function tinted(geo, hex, jitter = 0) {
  const c = lin(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  void jitter;
  return geo;
}

export function fernGeometry(fronds = 7) {
  const parts = [];
  for (let k = 0; k < fronds; k++) {
    const th = (k / fronds) * Math.PI * 2 + (k % 2) * 0.3;
    const L = 0.55 + (k % 3) * 0.1;
    const segs = 5;
    const pos = [], uv = [], nor = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const out = L * (0.12 + 0.88 * Math.sin(t * Math.PI * 0.5));
      const up = 0.32 * Math.sin(t * Math.PI * 0.85) - 0.1 * t * t + 0.05;
      const w = 0.17 * (1 - t * 0.55);
      const c = Math.cos(th), s = Math.sin(th);
      const cx = out * c, cz = out * s;
      for (const side of [-1, 1]) {
        pos.push(cx - s * w * side, up, cz + c * w * side);
        uv.push(side < 0 ? 0 : 1, t);
        nor.push(0, 1, 0);
      }
      if (i < segs) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

export function grassGeometry() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(0.3, 0.26);
    g.translate(0, 0.13, 0);
    g.rotateY((k / 3) * Math.PI);
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function ellipse(rx, rz, y, tilt, yaw, hex, lift = 0) {
  const g = new THREE.CircleGeometry(1, 10);
  g.rotateX(-Math.PI / 2);
  g.scale(rx, 1, rz);
  g.translate(0, 0, rz * 0.9);
  g.rotateX(-tilt);
  g.rotateY(yaw);
  g.translate(0, y + lift, 0);
  return tinted(g, hex);
}

export function trilliumGeometry() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const yaw = (k / 3) * Math.PI * 2 + 0.3;
    parts.push(ellipse(0.075, 0.11, 0.17, 0.12, yaw, '#4d8a35'));
    parts.push(ellipse(0.05, 0.085, 0.23, 0.75, yaw + Math.PI / 3, '#fbfbf6', 0.0));
  }
  const stem = new THREE.CylinderGeometry(0.006, 0.008, 0.17, 4);
  stem.translate(0, 0.085, 0);
  parts.push(tinted(stem, '#5d8c3a'));
  const eye = new THREE.SphereGeometry(0.014, 5, 4);
  eye.translate(0, 0.235, 0);
  parts.push(tinted(eye, '#e6d34a'));
  const g = mergeGeometries(parts);
  g.scale(0.62, 0.62, 0.62);
  return g;
}

export function mayappleGeometry() {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.3, 4);
  stem.translate(0, 0.15, 0);
  parts.push(tinted(stem, '#7a9a4a'));
  const cone = new THREE.ConeGeometry(0.22, 0.12, 8, 1, true);
  cone.translate(0, 0.34, 0);
  parts.push(tinted(cone, '#34592a'));
  return mergeGeometries(parts);
}

export function logGeometry(noise, rng, length, radius) {
  const g = new THREE.CylinderGeometry(radius, radius * 1.08, length, 12, 10, false);
  g.rotateZ(Math.PI / 2);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const bark = lin('#4a3f33'), moss = lin('#587a30'), cut = lin('#7a6a50');
  const seed = rng.range(0, 100);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise.n3(x * 1.4 + seed, y * 4, z * 4);
    const rr = Math.hypot(y, z);
    const k = 1 + n * 0.12;
    pos.setY(i, y * k); pos.setZ(i, z * k);
    const up = rr > 0 ? y / rr : 0;
    const m = Math.max(0, Math.min(1, (up - 0.1) * 1.4 + noise.n3(x * 3 + seed, 1.5, z * 2) * 0.8));
    const endCap = Math.abs(x) > length / 2 - 0.02 && rr < radius * 0.95 ? 1 : 0;
    const base = endCap ? cut : bark;
    col[i * 3] = base[0] + (moss[0] - base[0]) * m * (endCap ? 0.2 : 0.75);
    col[i * 3 + 1] = base[1] + (moss[1] - base[1]) * m * (endCap ? 0.2 : 0.75);
    col[i * 3 + 2] = base[2] + (moss[2] - base[2]) * m * (endCap ? 0.2 : 0.75);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
