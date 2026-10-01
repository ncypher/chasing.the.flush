import * as THREE from 'three';
import { RNG } from '../core/rng.js';

// All world textures are painted procedurally on canvases (no asset downloads).

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function leafPath(g, x, y, len, wid, ang) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(wid, len * 0.25, wid * 0.85, len * 0.7, 0, len);
  g.bezierCurveTo(-wid * 0.85, len * 0.7, -wid, len * 0.25, 0, 0);
  g.closePath();
}

// Wrap-around draw so tiles repeat seamlessly.
function tiled(S, draw) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) draw(dx, dy);
}

export function makeGroundTextures(seed = 1) {
  const S = 1024;
  const rng = new RNG(seed * 7919 + 13);
  const cc = canvas(S, S), cr = canvas(S, S);
  const g = cc.getContext('2d'), r = cr.getContext('2d');
  g.fillStyle = '#3d2c1b'; g.fillRect(0, 0, S, S);
  r.fillStyle = '#e0e0e0'; r.fillRect(0, 0, S, S);

  const palette = ['#5e4630', '#6f4f33', '#4e3a26', '#35271a', '#86633a', '#6b5a3a', '#2b2216', '#78572f', '#463524', '#8d6d44', '#54452a'];
  // damp, dark mulch blotches
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, S), y = rng.range(0, S), rad = rng.range(30, 110);
    tiled(S, (dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 2, x + dx, y + dy, rad);
      gr.addColorStop(0, 'rgba(22,14,8,0.55)'); gr.addColorStop(1, 'rgba(22,14,8,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      const gr2 = r.createRadialGradient(x + dx, y + dy, 2, x + dx, y + dy, rad);
      gr2.addColorStop(0, 'rgba(70,70,70,0.7)'); gr2.addColorStop(1, 'rgba(70,70,70,0)');
      r.fillStyle = gr2; r.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  // leaves
  for (let i = 0; i < 5200; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    const len = rng.range(14, 44), wid = len * rng.range(0.28, 0.5), ang = rng.range(0, Math.PI * 2);
    const col = rng.pick(palette);
    const wet = rng.chance(0.3);
    tiled(S, (dx, dy) => {
      if (x + dx < -60 || x + dx > S + 60 || y + dy < -60 || y + dy > S + 60) return;
      leafPath(g, x + dx, y + dy, len, wid, ang);
      g.fillStyle = col; g.globalAlpha = rng.range(0.7, 1); g.fill();
      g.strokeStyle = 'rgba(20,12,6,0.35)'; g.lineWidth = 0.8; g.stroke();
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, len * 0.9);
      g.strokeStyle = 'rgba(30,20,10,0.4)'; g.stroke();
      g.restore();
      leafPath(r, x + dx, y + dy, len, wid, ang);
      r.fillStyle = wet ? '#8a8a8a' : '#f0f0f0'; r.globalAlpha = 0.9; r.fill();
      r.restore();
    });
  }
  g.globalAlpha = 1; r.globalAlpha = 1;
  // twigs
  for (let i = 0; i < 160; i++) {
    const x = rng.range(0, S), y = rng.range(0, S), a = rng.range(0, Math.PI * 2), l = rng.range(30, 110);
    tiled(S, (dx, dy) => {
      g.strokeStyle = rng.chance(0.5) ? '#2a1d12' : '#4a3623';
      g.lineWidth = rng.range(1.2, 3);
      g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); g.stroke();
    });
  }
  // small green new growth flecks (spring)
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    tiled(S, (dx, dy) => {
      g.fillStyle = `rgba(${rng.int(70, 110)},${rng.int(120, 160)},${rng.int(30, 60)},${rng.range(0.3, 0.7)})`;
      g.beginPath(); g.ellipse(x + dx, y + dy, rng.range(2, 6), rng.range(1, 3), rng.range(0, 3), 0, Math.PI * 2); g.fill();
    });
  }
  return {
    map: finish(cc, { repeat: true }),
    rough: finish(cr, { srgb: false, repeat: true }),
  };
}

export function makeBarkTexture(seed = 2) {
  const W = 256, H = 512;
  const rng = new RNG(seed * 31 + 5);
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#9a9488'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 520; i++) {
    const x = rng.range(0, W), y = rng.range(0, H), l = rng.range(30, 160), w = rng.range(1.5, 6);
    const v = rng.int(70, 175);
    const wob = rng.range(-6, 6);
    for (const dx of [-W, 0, W]) {
      g.strokeStyle = `rgba(${v},${v - 4},${v - 10},${rng.range(0.35, 0.8)})`;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x + dx, y); g.quadraticCurveTo(x + dx + wob, y + l / 2, x + dx + wob * 0.4, y + l); g.stroke();
    }
  }
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, W), y = rng.range(0, H);
    g.strokeStyle = 'rgba(25,20,15,0.55)'; g.lineWidth = rng.range(1, 2.5);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-3, 3), y + rng.range(30, 90)); g.stroke();
  }
  return finish(c, { repeat: true });
}

const LEAF_PALETTES = {
  newgreen: ['#a4c43e', '#86ad2f', '#bcd95a', '#6f9a26', '#c9df6a', '#7fa83a'],
  oak: ['#b58245', '#9ba14a', '#c9a050', '#a9783c', '#8aa044', '#cfb060'],
  poplar: ['#b3d04c', '#9bc040', '#c4dc62', '#84b232', '#d2e578'],
  apple: ['#8fb338', '#79a02e', '#a3c24a', '#6e9a2c'],
};

export function makeLeafClusterTexture(kind, seed = 3) {
  const S = 256;
  const rng = new RNG(seed * 101 + kind.length * 17);
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const pal = LEAF_PALETTES[kind] || LEAF_PALETTES.newgreen;
  const big = kind === 'poplar';
  for (let i = 0; i < (big ? 38 : 70); i++) {
    const a = rng.range(0, Math.PI * 2);
    const rad = Math.sqrt(rng.next()) * S * 0.38;
    const x = S / 2 + Math.cos(a) * rad, y = S / 2 + Math.sin(a) * rad;
    const len = rng.range(big ? 34 : 20, big ? 56 : 38);
    leafPath(g, x, y, len, len * rng.range(0.28, 0.42), rng.range(0, Math.PI * 2));
    g.fillStyle = rng.pick(pal); g.fill();
    g.strokeStyle = 'rgba(30,50,10,0.45)'; g.lineWidth = 1; g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, len * 0.85); g.stroke();
    g.restore();
  }
  if (kind === 'apple') {
    for (let i = 0; i < 34; i++) {
      const a = rng.range(0, Math.PI * 2), rad = Math.sqrt(rng.next()) * S * 0.36;
      const x = S / 2 + Math.cos(a) * rad, y = S / 2 + Math.sin(a) * rad;
      const pink = rng.chance(0.4);
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2;
        g.fillStyle = pink ? '#f5b8c8' : '#fbf1ee';
        g.beginPath(); g.ellipse(x + Math.cos(pa) * 5, y + Math.sin(pa) * 5, 5.5, 3.6, pa, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#e8c840'; g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
    }
  }
  return finish(c, { aniso: 4 });
}

export function makeFernTexture(seed = 4) {
  const W = 128, H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rng = new RNG(seed * 13);
  g.strokeStyle = '#4c7a2a'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 6); g.stroke();
  const n = 20;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = H - 14 - t * (H - 24);
    const len = (1 - Math.pow(t, 1.6)) * 52 + 6;
    for (const side of [-1, 1]) {
      g.strokeStyle = rng.chance(0.5) ? '#5f9632' : '#6fa83a';
      g.lineWidth = 5 - t * 3;
      g.beginPath(); g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + side * len * 0.55, y - 4 - len * 0.18, W / 2 + side * len, y - 8 - len * 0.38);
      g.stroke();
    }
  }
  return finish(c, { aniso: 4 });
}

export function makeGrassTexture(seed = 5) {
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rng = new RNG(seed * 41);
  for (let i = 0; i < 46; i++) {
    const x = rng.range(10, S - 10);
    const h = rng.range(50, S - 8);
    g.strokeStyle = rng.pick(['#6ea63a', '#80b83f', '#5d9230', '#93c24c']);
    g.lineWidth = rng.range(1.4, 3);
    g.beginPath(); g.moveTo(x, S); g.quadraticCurveTo(x + rng.range(-14, 14), S - h * 0.6, x + rng.range(-24, 24), S - h); g.stroke();
  }
  return finish(c, { aniso: 4 });
}

export function makeLeafTexture() {
  const S = 64;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  leafPath(g, S / 2, 4, S - 8, S * 0.26, 0);
  g.fillStyle = '#ffffff'; g.fill();
  g.strokeStyle = 'rgba(120,110,100,0.9)'; g.lineWidth = 1.2; g.stroke();
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, (S - 8) * 0.9); g.stroke();
  g.restore();
  return finish(c, { aniso: 4 });
}

export function makeSoftDotTexture() {
  const S = 64;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return finish(c, { aniso: 1 });
}
