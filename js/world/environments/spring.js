import * as THREE from 'three';
import { makeNoise } from '../../core/noise.js';
import { smoothstep, lerp } from '../../core/util.js';
import { createHeightField, buildTerrain, normalAt, WORLD_RADIUS } from '../terrain.js';
import * as TX from '../textures.js';
import { GeomBuilder, TREE_SPECS, growTree } from '../trees.js';
import * as PL from '../plants.js';
import { patchFog, createSky, createShafts, createMotes } from '../atmosphere.js';

// SPRING ENVIRONMENT MODULE (Michigan hardwoods, late April / early May).
// Contract used by the core (see js/main.js): returns { group, heightAt, zoneAt, hostTrees, canSpawn,
// collide, start, update, setWeather, setTimeOfDay, lights/fog handles }. A summer or fall level supplies
// another module with the same shape.

const tick = () => new Promise((r) => setTimeout(r, 0));

const ELM = { x: -42, z: -8, r: 28 };
const ORCH = { x: 32, z: -40, w: 42, d: 26, rot: 0.22 };

export const ZONE_LABELS = {
  elm: 'Dying elm & ash stand',
  orchard: 'Old orchard edge',
  poplar: 'Tulip poplar slope',
  litter: 'Open leaf-litter floor',
};

export async function createEnvironment({ rng, renderer, quality, progress = () => {} }) {
  const noise = makeNoise(rng.fork('terrain').int(1, 1e9));
  const { heightAt, slopeT } = createHeightField(noise);
  const group = new THREE.Group();
  const START = { x: -6, z: 11, yaw: 0.55 };

  const orchU = (x, z) => {
    const dx = x - ORCH.x, dz = z - ORCH.z, c = Math.cos(ORCH.rot), s = Math.sin(ORCH.rot);
    return [dx * c + dz * s, -dx * s + dz * c];
  };
  const orchardSDF = (x, z) => {
    const [u, v] = orchU(x, z);
    return Math.max(Math.abs(u) - ORCH.w / 2, Math.abs(v) - ORCH.d / 2);
  };
  const zoneAt = (x, z) => {
    if (orchardSDF(x, z) < 0) return 'orchard';
    if (Math.hypot(x - ELM.x, z - ELM.z) < ELM.r) return 'elm';
    if (slopeT(x, z) > 0.12) return 'poplar';
    return 'litter';
  };

  // ---------- lighting & atmosphere ----------
  const sunAz = THREE.MathUtils.degToRad(212), sunEl = THREE.MathUtils.degToRad(51);
  const sunDir = new THREE.Vector3(Math.cos(sunEl) * Math.cos(sunAz), Math.sin(sunEl), Math.cos(sunEl) * Math.sin(sunAz));
  const fogColor = new THREE.Color(0xb4c49a);
  const fog = new THREE.FogExp2(fogColor, 0.0185);

  const sun = new THREE.DirectionalLight(0xfff0cf, 3.3);
  sun.castShadow = true;
  const SH = 34;
  sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 4, far: 150 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xc4dcff, 0x6b5a38, 1.3);
  group.add(hemi);
  group.add(new THREE.AmbientLight(0xdfe8ff, 0.22));

  const sky = createSky({ top: 0x8fb6dc, horizon: fogColor.getHex(), sun: sunDir });
  group.add(sky);

  // soft sky reflection for the wet litter + glossy caps
  let reflection = null;
  if (renderer) {
    const skyScene = new THREE.Scene();
    skyScene.add(createSky({ top: 0x8fb6dc, horizon: 0xcfdcc0, sun: sunDir }));
    const pm = new THREE.PMREMGenerator(renderer);
    reflection = pm.fromScene(skyScene, 0.04).texture;
    pm.dispose();
  }

  progress('Shaping the land', 0.05);
  await tick();

  // ---------- terrain ----------
  const groundTex = TX.makeGroundTextures(1);
  const tint = (x, z, y, out) => {
    const n = noise.fbm2(x * 0.03 + 9, z * 0.03, 3);
    const k = 0.92 + n * 0.45;
    let r = k, g = k, b = k;
    const orch = smoothstep(4, -2, orchardSDF(x, z));
    r *= lerp(1, 0.55, orch); g *= lerp(1, 1.5, orch); b *= lerp(1, 0.5, orch);
    const elm = smoothstep(ELM.r, ELM.r - 8, Math.hypot(x - ELM.x, z - ELM.z));
    r *= lerp(1, 1.06, elm); g *= lerp(1, 1.0, elm);
    const damp = Math.exp(-((x + 6) ** 2 + (z - 18) ** 2) / (2 * 12 * 12));
    r *= 1 - 0.32 * damp; g *= 1 - 0.25 * damp; b *= 1 - 0.18 * damp;
    const edge = smoothstep(55, 78, Math.hypot(x, z));
    r *= 1 - 0.35 * edge; g *= 1 - 0.3 * edge; b *= 1 - 0.3 * edge;
    out[0] = r; out[1] = g; out[2] = b;
    void y;
  };
  const terrain = buildTerrain({ heightAt, zoneTint: tint, tex: groundTex, quality });
  if (reflection) { terrain.mat.envMap = reflection; terrain.mat.envMapIntensity = 0.35; }
  group.add(terrain.mesh);

  // ---------- trees ----------
  progress('Growing trees', 0.2);
  await tick();
  const trng = rng.fork('trees');
  const trees = [];
  const colliders = [];
  const leafSink = [];
  const chunks = new Map();
  const startClear = (x, z) => Math.hypot(x - START.x, z - START.z) < 6;

  function tryPlace(type, x, z, minGap) {
    if (Math.hypot(x, z) > WORLD_RADIUS - 2) return false;
    if (startClear(x, z)) return false;
    const spec = TREE_SPECS[type];
    const inOrch = orchardSDF(x, z) < 3;
    if (type !== 'apple_old' && inOrch) return false;
    for (const t of trees) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < minGap) return false;
    }
    const y = heightAt(x, z);
    const key = Math.floor(x / 36) + ',' + Math.floor(z / 36);
    if (!chunks.has(key)) chunks.set(key, new GeomBuilder());
    const info = growTree(spec, trng, new THREE.Vector3(x, y - 0.1, z), chunks.get(key), leafSink);
    trees.push({ type, host: spec.host, x, z, y, r: info.trunkR, height: info.height, dead: !!spec.dead });
    colliders.push({ x, z, r: info.trunkR * 1.15 + 0.18 });
    return true;
  }
  const scaleN = (n) => Math.max(1, Math.round(n * quality.treeDensity));

  // dying elm / ash stand
  const elmMix = { elm_dying: 0.42, ash_dying: 0.3, elm_live: 0.18, maple: 0.1 };
  const pickType = (mix) => trng.weighted(Object.keys(mix), (k) => mix[k]);
  for (let i = 0, placed = 0; i < 900 && placed < scaleN(40); i++) {
    const a = trng.range(0, Math.PI * 2), d = Math.sqrt(trng.next()) * ELM.r;
    if (tryPlace(pickType(elmMix), ELM.x + Math.cos(a) * d, ELM.z + Math.sin(a) * d, 5.2)) placed++;
  }
  // tulip poplar slope
  for (let i = 0, placed = 0; i < 1200 && placed < scaleN(32); i++) {
    const x = trng.range(0, 72), z = trng.range(0, 72), t = slopeT(x, z);
    if (t < 0.2 || t > 0.97 || zoneAt(x, z) !== 'poplar') continue;
    const type = trng.chance(0.86) ? 'tulip_poplar' : trng.pick(['maple', 'oak']);
    if (tryPlace(type, x, z, 6.2)) placed++;
  }
  // old apple orchard (loose rows)
  {
    const c = Math.cos(ORCH.rot), s = Math.sin(ORCH.rot);
    for (let u = -ORCH.w / 2 + 4; u < ORCH.w / 2 - 2; u += 8.2) {
      for (let v = -ORCH.d / 2 + 4; v < ORCH.d / 2 - 2; v += 8.4) {
        if (trng.chance(0.12)) continue;
        const uu = u + trng.range(-1.4, 1.4), vv = v + trng.range(-1.4, 1.4);
        tryPlace('apple_old', ORCH.x + uu * c - vv * s, ORCH.z + uu * s + vv * c, 4.5);
      }
    }
    // woods fringe around the orchard
    for (let i = 0, placed = 0; i < 400 && placed < scaleN(14); i++) {
      const a = trng.range(0, Math.PI * 2);
      const rr = trng.range(22, 34);
      const x = ORCH.x + Math.cos(a) * rr, z = ORCH.z + Math.sin(a) * rr;
      if (zoneAt(x, z) === 'orchard') continue;
      if (tryPlace(trng.pick(['oak', 'maple', 'elm_live']), x, z, 6)) placed++;
    }
  }
  // open leaf-litter floor: scattered hardwoods plus a few lone dying elms/ash
  for (let i = 0, placed = 0; i < 1500 && placed < scaleN(30); i++) {
    const a = trng.range(0, Math.PI * 2), d = Math.sqrt(trng.next()) * 68;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (zoneAt(x, z) !== 'litter') continue;
    const type = placed % 6 === 0 ? trng.pick(['elm_dying', 'ash_dying']) : trng.pick(['oak', 'maple', 'oak', 'elm_live']);
    if (tryPlace(type, x, z, 7)) placed++;
  }

  const barkTex = TX.makeBarkTexture(2);
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, vertexColors: true, roughness: 0.95, emissive: 0x2c281f });
  for (const b of chunks.values()) {
    const m = new THREE.Mesh(b.toGeometry(), barkMat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }

  // leaf cards (instanced per foliage kind)
  const cardGeo = PL.leafCardGeometry();
  const canopy = [];
  const byKind = {};
  for (const l of leafSink) (byKind[l.kind] ||= []).push(l);
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
  const tints = { newgreen: 0xffffff, oak: 0xffffff, poplar: 0xffffff, apple: 0xffffff };
  for (const [kind, list] of Object.entries(byKind)) {
    const mat = PL.foliageMaterial({ map: TX.makeLeafClusterTexture(kind), color: tints[kind], sway: kind === 'poplar' ? 0.07 : 0.05, glow: 0.7 });
    if (reflection) { mat.envMap = reflection; mat.envMapIntensity = 0.25; }
    const im = new THREE.InstancedMesh(cardGeo, mat, list.length);
    list.forEach((l, i) => {
      tmpE.set(trng.range(-0.25, 0.25), l.rot, trng.range(-0.25, 0.25));
      tmpQ.setFromEuler(tmpE);
      tmpS.setScalar(l.size);
      tmpM.compose(tmpP.set(l.x, l.y, l.z), tmpQ, tmpS);
      im.setMatrixAt(i, tmpM);
      const k = trng.range(0.82, 1.12);
      im.setColorAt(i, tmpC.setRGB(k * trng.range(0.95, 1.05), k, k * trng.range(0.9, 1.0)));
      canopy.push({ x: l.x, y: l.y, z: l.z, r: l.size * 0.42 });
    });
    im.castShadow = true; im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
  }

  // ---------- understory ----------
  progress('Scattering the forest floor', 0.5);
  await tick();
  const urng = rng.fork('understory');
  const onFree = (x, z, pad = 0.6) => {
    for (const c of colliders) {
      const dx = c.x - x, dz = c.z - z, rr = c.r + pad;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  };
  const place = (im, i, x, z, scale, yawJit = true, lift = 0) => {
    const y = heightAt(x, z) + lift;
    tmpE.set(0, yawJit ? urng.range(0, Math.PI * 2) : 0, 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(scale, scale * urng.range(0.85, 1.2), scale));
    im.setMatrixAt(i, tmpM);
  };

  // logs
  const logMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: barkTex, emissive: 0x15130d });
  let logs = 0;
  for (let i = 0; i < 400 && logs < 16; i++) {
    const a = urng.range(0, Math.PI * 2), d = Math.sqrt(urng.next()) * 64;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const zn = zoneAt(x, z);
    if (zn === 'orchard' || slopeT(x, z) > 0.25 || !onFree(x, z, 2.5) || startClear(x, z)) continue;
    const len = urng.range(3.5, 8), rad = urng.range(0.22, 0.42), yaw = urng.range(0, Math.PI);
    const geo = PL.logGeometry(noise, urng, len, rad);
    const m = new THREE.Mesh(geo, logMat);
    const h1 = heightAt(x - Math.cos(yaw) * len / 2, z + Math.sin(yaw) * len / 2);
    const h2 = heightAt(x + Math.cos(yaw) * len / 2, z - Math.sin(yaw) * len / 2);
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw; m.rotation.z = Math.atan2(h2 - h1, len);
    m.position.set(x, (h1 + h2) / 2 + rad * 0.42, z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    for (let t = -len / 2 + 0.6; t <= len / 2 - 0.4; t += 1.0) {
      colliders.push({ x: x + Math.cos(yaw) * t, z: z - Math.sin(yaw) * t, r: rad * 0.85, log: true });
    }
    logs++;
  }

  // ferns (clumps near logs, trees and the damp hollow)
  {
    const geo = PL.fernGeometry(7);
    const mat = PL.foliageMaterial({ map: TX.makeFernTexture(4), sway: 0.04, roughness: 0.8 });
    const n = quality.ferns;
    const im = new THREE.InstancedMesh(geo, mat, n);
    let i = 0;
    for (let tries = 0; i < n && tries < n * 14; tries++) {
      const a = urng.range(0, Math.PI * 2), d = Math.sqrt(urng.next()) * 70;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (zoneAt(x, z) === 'orchard' || startClear(x, z) || !onFree(x, z, 0.5)) continue;
      const patch = noise.fbm2(x * 0.07 + 20, z * 0.07, 2) + 0.55 * Math.exp(-((x + 6) ** 2 + (z - 18) ** 2) / 300);
      if (patch < 0.06 + urng.next() * 0.25) continue;
      place(im, i, x, z, urng.range(0.7, 1.5));
      im.setColorAt(i, tmpC.setRGB(urng.range(0.5, 0.75), urng.range(0.62, 0.85), urng.range(0.45, 0.65)));
      i++;
    }
    im.count = i;
    im.receiveShadow = true; im.castShadow = false;
    im.frustumCulled = false;
    group.add(im);
  }

  // trillium patches + mayapple colonies
  {
    const geo = PL.trilliumGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 });
    const n = quality.flowers;
    const im = new THREE.InstancedMesh(geo, mat, n);
    let i = 0;
    const patches = [];
    for (let tries = 0; patches.length < 18 && tries < 500; tries++) {
      const a = urng.range(0, Math.PI * 2), d = Math.sqrt(urng.next()) * 62;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const zn = zoneAt(x, z);
      if (zn === 'orchard' || startClear(x, z) || slopeT(x, z) > 0.8) continue;
      patches.push({ x, z });
    }
    for (const p of patches) {
      const cnt = urng.int(10, 24);
      for (let k = 0; k < cnt && i < n; k++) {
        const a = urng.range(0, Math.PI * 2), d = Math.sqrt(urng.next()) * 4.2;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (!onFree(x, z, 0.3) || zoneAt(x, z) === 'orchard') continue;
        place(im, i, x, z, urng.range(0.8, 1.35));
        i++;
      }
    }
    im.count = i;
    im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);

    const mgeo = PL.mayappleGeometry();
    const mm = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
    const mn = quality.flowers;
    const mi = new THREE.InstancedMesh(mgeo, mm, mn);
    let j = 0;
    for (let c = 0; c < 10; c++) {
      const a = urng.range(0, Math.PI * 2), d = Math.sqrt(urng.next()) * 60;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      const zn = zoneAt(cx, cz);
      if (zn === 'orchard' || zn === 'poplar' || startClear(cx, cz)) continue;
      const cnt = urng.int(18, 34);
      for (let k = 0; k < cnt && j < mn; k++) {
        const aa = urng.range(0, Math.PI * 2), dd = Math.sqrt(urng.next()) * 5.5;
        const x = cx + Math.cos(aa) * dd, z = cz + Math.sin(aa) * dd;
        if (!onFree(x, z, 0.3)) continue;
        place(mi, j, x, z, urng.range(0.8, 1.4));
        j++;
      }
    }
    mi.count = j;
    mi.receiveShadow = true; mi.castShadow = true;
    mi.frustumCulled = false;
    group.add(mi);
  }

  // orchard grass
  {
    const geo = PL.grassGeometry();
    const mat = PL.foliageMaterial({ map: TX.makeGrassTexture(5), sway: 0.05, roughness: 0.9, glow: 0.45 });
    const n = quality.grass;
    const im = new THREE.InstancedMesh(geo, mat, n);
    let i = 0;
    const c = Math.cos(ORCH.rot), s = Math.sin(ORCH.rot);
    for (let tries = 0; i < n && tries < n * 3; tries++) {
      const u = urng.range(-ORCH.w / 2 - 3, ORCH.w / 2 + 3), v = urng.range(-ORCH.d / 2 - 3, ORCH.d / 2 + 3);
      const x = ORCH.x + u * c - v * s, z = ORCH.z + u * s + v * c;
      const sd = orchardSDF(x, z);
      if (sd > 3 || (sd > -1 && urng.next() < 0.5) || !onFree(x, z, 0.3)) continue;
      place(im, i, x, z, urng.range(0.6, 1.2));
      im.setColorAt(i, tmpC.setRGB(urng.range(0.45, 0.65), urng.range(0.5, 0.68), urng.range(0.35, 0.5)));
      i++;
    }
    im.count = i;
    im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
  }

  // fallen leaves lying on the litter
  {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: TX.makeLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    const n = quality.leaves;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const pal = ['#6a4c2e', '#7a5832', '#554029', '#8e6a3c', '#62553a', '#45331f', '#7d5d38'].map((h) => new THREE.Color(h));
    const n3 = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let i = 0;
    for (let tries = 0; i < n && tries < n * 2; tries++) {
      const a = urng.range(0, Math.PI * 2), d = Math.sqrt(urng.next()) * 72;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (zoneAt(x, z) === 'orchard' && urng.next() < 0.7) continue;
      normalAt(heightAt, x, z, n3);
      tmpQ.setFromUnitVectors(up, n3);
      const yaw = new THREE.Quaternion().setFromAxisAngle(up, urng.range(0, Math.PI * 2));
      tmpQ.multiply(yaw);
      const sz = urng.range(0.045, 0.12);
      tmpM.compose(tmpP.set(x, heightAt(x, z) + 0.015 + urng.range(0, 0.02), z), tmpQ, tmpS.set(sz * 0.7, 1, sz));
      im.setMatrixAt(i, tmpM);
      im.setColorAt(i, tmpC.copy(urng.pick(pal)).multiplyScalar(urng.range(0.8, 1.2)));
      i++;
    }
    im.count = i;
    im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
  }

  // ---------- atmosphere ----------
  progress('Letting the light in', 0.8);
  await tick();
  const shafts = createShafts({ sunDir: sunDir.clone(), canopy, heightAt, rng: rng.fork('shafts'), radius: 66 });
  group.add(shafts.group);
  const motes = createMotes({ count: quality.motes });
  group.add(motes.points);

  // rain streaks (visible only on rainy days)
  const RAIN = 700;
  const rainPos = new Float32Array(RAIN * 6);
  const rainBase = new Float32Array(RAIN * 3);
  for (let i = 0; i < RAIN; i++) {
    rainBase[i * 3] = Math.random() * 30; rainBase[i * 3 + 1] = Math.random() * 18; rainBase[i * 3 + 2] = Math.random() * 30;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xcdd9e2, transparent: true, opacity: 0.0, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  group.add(rain);

  // ---------- weather / time-of-day state ----------
  const W = { sky: 'sunny', sun: 3.3, hemi: 1.3, fog: 1, shaft: 0.16, wet: 0.0, rain: 0, glow: 1 };
  const WT = { ...W };
  const WEATHER = {
    sunny: { sun: 3.3, hemi: 1.3, fog: 1.0, shaft: 0.17, wet: 0.0, rain: 0, glow: 1.0 },
    cloudy: { sun: 1.25, hemi: 1.5, fog: 1.2, shaft: 0.04, wet: 0.3, rain: 0, glow: 0.35 },
    rain: { sun: 0.55, hemi: 1.4, fog: 1.55, shaft: 0.0, wet: 1.0, rain: 1, glow: 0.1 },
  };
  let tod = 0.3;
  const sunColorA = new THREE.Color(0xfff2dc), sunColorB = new THREE.Color(0xffc27a);
  const fogA = new THREE.Color(0xb4c49a), fogB = new THREE.Color(0xc9c08e), fogRain = new THREE.Color(0x98a79a);

  function setWeather(skyName, instant = false) {
    Object.assign(WT, WEATHER[skyName] || WEATHER.sunny);
    W.sky = skyName;
    if (instant) for (const k of Object.keys(WEATHER.sunny)) W[k] = WT[k];
  }
  function setTimeOfDay(f) { tod = f; }

  const snapRight = new THREE.Vector3(), snapUp = new THREE.Vector3(), fwd = sunDir.clone().negate();
  snapRight.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  snapUp.crossVectors(snapRight, fwd).normalize();
  const texel = (SH * 2) / quality.shadowSize;
  const tgt = new THREE.Vector3();
  const mix = new THREE.Color();

  function update(dt, time, camera, groundY) {
    PL.timeUniform.value = time;
    const k = 1 - Math.exp(-dt * 1.2);
    for (const key of Object.keys(WEATHER.sunny)) W[key] += (WT[key] - W[key]) * k;

    const late = smoothstep(0.55, 1.0, tod);
    sun.color.copy(sunColorA).lerp(sunColorB, late * 0.7);
    sun.intensity = W.sun * (0.9 + 0.15 * Math.sin(tod * Math.PI));
    hemi.intensity = W.hemi;
    mix.copy(fogA).lerp(fogB, late * 0.5).lerp(fogRain, smoothstep(0.2, 1, W.rain));
    fog.color.copy(mix);
    sky.material.uniforms.uHorizon.value.copy(mix);
    sky.material.uniforms.uGlow.value = W.glow;
    fog.density = 0.0185 * W.fog;
    terrain.mat.roughness = lerp(1.0, 0.72, W.wet);
    terrain.mat.envMapIntensity = 0.3 + 0.5 * W.wet;
    terrain.mat.color.setScalar(lerp(1, 0.78, W.wet));
    rainMat.opacity = 0.32 * W.rain;
    rain.visible = W.rain > 0.02;

    sky.position.copy(camera.position);
    // follow the player with texel-snapped shadow frustum (no shimmer while walking)
    tgt.set(camera.position.x, groundY, camera.position.z);
    const a = tgt.dot(snapRight), b = tgt.dot(snapUp);
    tgt.addScaledVector(snapRight, Math.round(a / texel) * texel - a).addScaledVector(snapUp, Math.round(b / texel) * texel - b);
    sun.target.position.copy(tgt);
    sun.position.copy(tgt).addScaledVector(sunDir, 70);

    shafts.update(time, camera, W.shaft);
    motes.update(time, camera, groundY);
    motes.material.opacity = 0.2 + 0.4 * (W.shaft / 0.17);

    if (rain.visible) {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < RAIN; i++) {
        const fall = (rainBase[i * 3 + 1] - time * 14) % 18;
        const y = cy + (fall < 0 ? fall + 18 : fall) - 6;
        const x = cx + ((rainBase[i * 3] % 30) - 15), z = cz + ((rainBase[i * 3 + 2] % 30) - 15);
        rainPos.set([x, y, z, x + 0.05, y - 0.55, z + 0.02], i * 6);
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
  }

  function collide(pos, radius) {
    for (const c of colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z, min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
      }
    }
    const r = Math.hypot(pos.x, pos.z);
    if (r > WORLD_RADIUS) { pos.x *= WORLD_RADIUS / r; pos.z *= WORLD_RADIUS / r; }
  }

  progress('Ready', 1);

  return {
    id: 'spring',
    group, heightAt, zoneAt, slopeT, trees, colliders, groundMap: groundTex.map,
    start: START, radius: WORLD_RADIUS,
    fog, sun, hemi, reflection,
    zoneLabels: ZONE_LABELS,
    hostTrees: () => trees.filter((t) => t.host),
    allTrees: () => trees,
    canSpawn: (x, z) => Math.hypot(x, z) < WORLD_RADIUS - 4 && slopeT(x, z) < 1.0 && onFree(x, z, 0.35) && !startClear(x, z),
    collide, update, setWeather, setTimeOfDay,
    stats: { trees: trees.length, canopyCards: canopy.length, shafts: shafts.count },
  };
}
