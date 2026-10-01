import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { makeMorelSpec } from './morel.js';
import { makeGyromitraSpec } from './gyromitra.js';
import { buildRevolved, buildCutHalf, resampleProfile } from './lathe.js';

// Species registry. A future species (chanterelle, black trumpet, maitake...) only needs a
// spec factory returning { outline, cavity, shade, cavityShade, flesh, worldHeight, kind }.
export const SPECIES_BUILDERS = {
  morel: makeMorelSpec,
  gyromitra: makeGyromitraSpec,
};

function canvasTex(size, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Cross-section textures: the visible "tell" when a mushroom is cut in half.
function makeFleshTexture(flesh) {
  const rng = new RNG(flesh === 'hollow' ? 11 : 29);
  return canvasTex(512, (g, S) => {
    if (flesh === 'hollow') {
      g.fillStyle = '#f2e9d2';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 700; i++) {
        g.strokeStyle = `rgba(${rng.int(205, 235)},${rng.int(190, 215)},${rng.int(150, 185)},0.18)`;
        g.lineWidth = rng.range(0.6, 1.6);
        g.beginPath();
        const x = rng.range(0, S), y = rng.range(0, S);
        g.moveTo(x, y);
        g.lineTo(x + rng.range(-3, 3), y + rng.range(10, 30));
        g.stroke();
      }
    } else {
      g.fillStyle = '#e4d5bb';
      g.fillRect(0, 0, S, S);
      // chambers: long irregular channels and pockets with dark depths
      for (let i = 0; i < 34; i++) {
        const x = rng.range(0, S), y = rng.range(0, S);
        const long = rng.chance(0.55);
        const rx = long ? rng.range(5, 13) : rng.range(10, 26), ry = long ? rng.range(26, 70) : rng.range(12, 34);
        const grd = g.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry));
        grd.addColorStop(0, 'rgba(48,36,24,0.97)');
        grd.addColorStop(0.55, 'rgba(98,78,54,0.9)');
        grd.addColorStop(1, 'rgba(176,152,118,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(x, y, rx, ry, rng.range(-0.3, 0.3) + (long ? 0 : rng.range(0, 3)), 0, Math.PI * 2);
        g.fill();
      }
      // cottony strands crossing the voids
      for (let i = 0; i < 1300; i++) {
        g.strokeStyle = `rgba(255,252,244,${rng.range(0.2, 0.7)})`;
        g.lineWidth = rng.range(0.6, 1.8);
        g.beginPath();
        let x = rng.range(0, S), y = rng.range(0, S);
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          x += rng.range(-12, 12); y += rng.range(-16, 16);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(150,128,98,${rng.range(0.08, 0.25)})`;
        g.beginPath();
        g.arc(rng.range(0, S), rng.range(0, S), rng.range(1, 4), 0, Math.PI * 2);
        g.fill();
      }
    }
  }, true);
}

function makeBlobTexture() {
  return canvasTex(64, (g, S) => {
    const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  });
}

export class MushroomLibrary {
  constructor(rng, counts = { morel: 8, gyromitra: 5 }, quality = {}) {
    this.rng = rng;
    this.hiRings = quality.hiRings || 120;
    this.hiSegs = quality.hiSegs || 84;
    this.variants = {};
    this.mats = {
      true: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
      false: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0 }),
      cavity: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    };
    this.faceMats = {
      hollow: new THREE.MeshStandardMaterial({ map: makeFleshTexture('hollow'), roughness: 0.92, side: THREE.DoubleSide }),
      chambered: new THREE.MeshStandardMaterial({ map: makeFleshTexture('chambered'), roughness: 0.95, side: THREE.DoubleSide }),
    };
    this.blobMat = new THREE.MeshBasicMaterial({
      map: makeBlobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.blobGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    this.counts = counts;
    this._queue = [];
    for (const [id, n] of Object.entries(counts)) {
      this.variants[id] = [];
      for (let i = 0; i < n; i++) this._queue.push([id, i]);
    }
  }

  // Build variants in small steps so the loading screen can paint between them.
  get pending() { return this._queue.length; }
  buildNext() {
    const job = this._queue.shift();
    if (!job) return false;
    const [id, i] = job;
    const spec = SPECIES_BUILDERS[id](this.rng.fork(`${id}:${i}`), {});
    const hi = buildRevolved({ pts: spec.outline, segs: this.hiSegs, shade: spec.shade });
    const lo = buildRevolved({ pts: resampleProfile(spec.controls, 34), segs: 22, shade: spec.shade });
    this.variants[id][i] = { id, index: i, spec, hi, lo, halves: null };
    return true;
  }

  pickVariant(id, rng) {
    return rng.pick(this.variants[id]);
  }

  // A world mushroom: LOD(high-res | low-res) + soft contact shadow.
  createWorldObject(variant, rng) {
    const kind = variant.spec.kind;
    const mat = this.mats[kind];
    const lod = new THREE.LOD();
    const hi = new THREE.Mesh(variant.hi, mat);
    const lo = new THREE.Mesh(variant.lo, mat);
    lod.addLevel(hi, 0);
    lod.addLevel(lo, 10);
    const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
    blob.position.y = 0.006;
    const h = variant.spec.worldHeight * rng.range(0.78, 1.28);
    const w = h * rng.range(0.85, 1.2);
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.add(lod);
    body.scale.set(w, h, w);
    body.rotation.set(rng.range(-0.12, 0.12), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
    blob.scale.setScalar(w * (kind === 'false' ? 0.62 : 0.4));
    root.add(blob, body);
    root.userData = { body, baseScale: body.scale.clone(), blob, baseBlob: blob.scale.x, h };
    return root;
  }

  // Both cut halves for the inspect view (cached per variant).
  getHalves(variant) {
    if (variant.halves) return variant.halves;
    const spec = variant.spec;
    const make = (th0) => {
      const { body, cavity, face } = buildCutHalf(spec, th0, 120, 200);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(body, this.mats[spec.kind]));
      if (cavity) g.add(new THREE.Mesh(cavity, this.mats.cavity));
      g.add(new THREE.Mesh(face, this.faceMats[spec.flesh]));
      return g;
    };
    variant.halves = { a: make(0), b: make(Math.PI) };
    return variant.halves;
  }
}
