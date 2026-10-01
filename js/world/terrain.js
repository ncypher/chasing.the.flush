import * as THREE from 'three';
import { smoothstep, clamp } from '../core/util.js';

export const WORLD_RADIUS = 74; // playable radius
export const WORLD_SIZE = 300;

// Spring woodland height field: rolling floor, a tulip-poplar slope to the NE, a damp hollow,
// and a ridge ring that closes the horizon.
export function createHeightField(noise) {
  const slopeT = (x, z) => (x * 0.62 + z * 0.78 - 18) / 46;
  const heightAt = (x, z) => {
    let h = noise.fbm2(x * 0.011, z * 0.011, 4) * 3.2;
    h += noise.fbm2(x * 0.05 + 40, z * 0.05, 3) * 0.45;
    h += smoothstep(0, 1, slopeT(x, z)) * 10.5;
    h -= 1.3 * Math.exp(-((x + 6) ** 2 + (z - 18) ** 2) / (2 * 14 * 14));
    h += smoothstep(68, 110, Math.hypot(x, z)) * 12;
    return h;
  };
  return { heightAt, slopeT };
}

export function normalAt(heightAt, x, z, out = new THREE.Vector3()) {
  const e = 0.4;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-dx, 2 * e, -dz).normalize();
}

export function buildTerrain({ heightAt, zoneTint, tex, quality }) {
  const seg = quality.terrainSegs;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const uv = geo.attributes.uv;
  const c = [1, 1, 1];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    uv.setXY(i, x / 3.2, z / 3.2);
    zoneTint(x, z, y, c);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: tex.map, roughnessMap: tex.rough, bumpMap: tex.rough, bumpScale: 1.6,
    vertexColors: true, roughness: 1.0, metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { mesh, mat };
}

export { clamp };
