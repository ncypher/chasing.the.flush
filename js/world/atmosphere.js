import * as THREE from 'three';
import { makeSoftDotTexture } from './textures.js';

// Height-aware exponential fog: patch the stock fog chunks once, before any material compiles.
// Fog is thicker below eye level (ground mist) and thins out up in the canopy.
export function patchFog() {
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogRel;
#endif`;
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRel = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz );
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogRel;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogHeight = 1.0 + 1.1 * exp( - max( vFogRel + 1.8, 0.0 ) * 0.28 );
    float fogD = fogDensity * fogHeight;
    float fogFactor = 1.0 - exp( - fogD * fogD * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

export function createSky({ top, horizon, sun }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHorizon: { value: new THREE.Color(horizon) },
      uSunDir: { value: sun.clone().normalize() },
      uGlow: { value: 1.0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform float uGlow;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        float t = pow(clamp(h, 0.0, 1.0), 0.55);
        vec3 c = mix(uHorizon, uTop, t);
        float s = max(dot(normalize(vDir), uSunDir), 0.0);
        c += vec3(1.0, 0.82, 0.5) * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.9) * uGlow * smoothstep(0.02, 0.4, vDir.y);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 12), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// Volumetric-feeling light shafts: additive cylindrical billboards aligned to the sun,
// placed only where the canopy actually has a gap along the sun ray.
export function createShafts({ sunDir, canopy, heightAt, rng, radius }) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.84, 0.52) }, uStrength: { value: 0.16 } },
    vertexShader: `
      attribute float aSeed; varying vec2 vUv; varying float vSeed; varying float vDepth;
      void main(){ vUv = uv; vSeed = aSeed; vec4 mv = modelViewMatrix * vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      varying vec2 vUv; varying float vSeed; varying float vDepth; uniform float uTime; uniform vec3 uColor; uniform float uStrength;
      void main(){
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        across = pow(smoothstep(0.0, 0.75, across), 1.4);
        float along = vUv.y;
        float prof = smoothstep(0.0, 0.18, along) * (1.0 - smoothstep(0.35, 1.0, along) * 0.85);
        float flick = 0.78 + 0.22 * sin(uTime * 0.5 + vSeed * 40.0 + along * 4.0);
        float near = smoothstep(1.2, 7.0, vDepth);
        float far = 1.0 - smoothstep(26.0, 52.0, vDepth);
        float a = across * prof * flick * near * far * uStrength;
        gl_FragColor = vec4(uColor, a);
      }`,
  });

  const clusters = new Map();
  const cell = 4;
  for (const c of canopy) {
    const k = Math.floor(c.x / cell) + ',' + Math.floor(c.z / cell);
    if (!clusters.has(k)) clusters.set(k, []);
    clusters.get(k).push(c);
  }
  const blocked = (gx, gy, gz) => {
    for (let t = 2.5; t < 34; t += 1.6) {
      const x = gx + sunDir.x * t, y = gy + sunDir.y * t, z = gz + sunDir.z * t;
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const list = clusters.get((cx + dx) + ',' + (cz + dz));
        if (!list) continue;
        for (const c of list) {
          const ddx = c.x - x, ddy = c.y - y, ddz = c.z - z;
          if (ddx * ddx + ddy * ddy + ddz * ddz < c.r * c.r) return true;
        }
      }
    }
    return false;
  };

  const shafts = [];
  const len = 24;
  for (let gx = -radius; gx <= radius; gx += 5.0) {
    for (let gz = -radius; gz <= radius; gz += 5.0) {
      if (gx * gx + gz * gz > radius * radius) continue;
      const px = gx + rng.range(-1.4, 1.4), pz = gz + rng.range(-1.4, 1.4);
      const py = heightAt(px, pz);
      if (blocked(px, py + 0.5, pz)) continue;
      // require a canopy above somewhere so open meadows don't glow
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(4).fill(rng.next()), 1));
      const m = new THREE.Mesh(geo, mat);
      const w = rng.range(1.0, 2.6);
      m.scale.set(w, len, 1);
      m.position.set(px + sunDir.x * len * 0.5, py + sunDir.y * len * 0.5, pz + sunDir.z * len * 0.5);
      m.userData.axisPos = m.position.clone();
      m.frustumCulled = true;
      m.renderOrder = 5;
      group.add(m);
      shafts.push(m);
    }
  }

  const xAxis = new THREE.Vector3(), zAxis = new THREE.Vector3(), toCam = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const axis = sunDir.clone().normalize(); // plane local +Y runs along the ray, toward the sun
  function update(time, camera, strength) {
    mat.uniforms.uTime.value = time;
    mat.uniforms.uStrength.value = strength;
    const cp = camera.position;
    for (const s of shafts) {
      const p = s.userData.axisPos;
      const dx = p.x - cp.x, dz = p.z - cp.z;
      const vis = dx * dx + dz * dz < 55 * 55 && strength > 0.002;
      s.visible = vis;
      if (!vis) continue;
      toCam.set(cp.x - p.x, cp.y - p.y, cp.z - p.z);
      xAxis.crossVectors(axis, toCam).normalize();
      zAxis.crossVectors(xAxis, axis).normalize();
      basis.makeBasis(xAxis, axis, zAxis);
      s.quaternion.setFromRotationMatrix(basis);
    }
  }
  return { group, update, count: shafts.length, material: mat };
}

export function createMotes({ count = 420, area = 26 }) {
  const geo = new THREE.BufferGeometry();
  const base = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    base[i * 3] = Math.random() * area;
    base[i * 3 + 1] = Math.random() * 9 + 0.3;
    base[i * 3 + 2] = Math.random() * area;
  }
  const pos = new Float32Array(count * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.075, map: makeSoftDotTexture(), color: 0xfff1c8, transparent: true, opacity: 0.55, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  function update(time, camera, groundY) {
    const cx = camera.position.x, cz = camera.position.z;
    for (let i = 0; i < count; i++) {
      const bx = base[i * 3] + Math.sin(time * 0.15 + i) * 0.8 + time * 0.05;
      const by = base[i * 3 + 1] + Math.sin(time * 0.3 + i * 1.7) * 0.25;
      const bz = base[i * 3 + 2] + Math.cos(time * 0.18 + i * 0.7) * 0.8;
      pos[i * 3] = cx + ((((bx - cx) % area) + area * 1.5) % area) - area / 2;
      pos[i * 3 + 1] = groundY + by;
      pos[i * 3 + 2] = cz + ((((bz - cz) % area) + area * 1.5) % area) - area / 2;
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { points: pts, update, material: mat };
}
