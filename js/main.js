import * as THREE from 'three';
import { RNG } from './core/rng.js';
import { qs, isTouchDevice } from './core/util.js';
import { patchFog } from './world/atmosphere.js';
import { createComposer } from './render/post.js';
import { SEASONS, DEFAULT_SEASON } from './seasons/index.js';
import { MushroomLibrary } from './mushrooms/index.js';
import { Game } from './game/game.js';
import { Controls } from './controls/controls.js';
import { UI } from './ui/ui.js';
import { InspectView } from './ui/inspect.js';

const $ = (id) => document.getElementById(id);
const tick = () => new Promise((r) => setTimeout(r, 0));

const PRESETS = {
  high: { pixelRatioCap: 2, shadowSize: 2048, terrainSegs: 230, treeDensity: 1, ferns: 800, flowers: 360, grass: 2600, leaves: 14000, motes: 420, bloom: true, msaa: 0, aa: 'smaa', hiSegs: 84, hiRings: 120 },
  medium: { pixelRatioCap: 1.5, shadowSize: 2048, terrainSegs: 190, treeDensity: 0.85, ferns: 500, flowers: 260, grass: 1600, leaves: 9000, motes: 300, bloom: true, msaa: 0, aa: 'smaa', hiSegs: 64, hiRings: 100 },
  low: { pixelRatioCap: 1.25, shadowSize: 1024, terrainSegs: 140, treeDensity: 0.6, ferns: 260, flowers: 160, grass: 900, leaves: 4500, motes: 160, bloom: false, msaa: 0, aa: 'fxaa', hiSegs: 48, hiRings: 80 },
};

function fatal(err) {
  console.error(err);
  const el = $('fatal');
  el.classList.remove('hidden');
  el.innerHTML = `<h2>Chasing the Flush could not start</h2><p>${String(err && err.message || err)}</p><p>This game needs a browser with WebGL 2 enabled.</p>`;
  $('loading').classList.add('hidden');
}

window.addEventListener('error', (e) => { if (!window.__ctfBooted) fatal(e.error || e.message); });

async function boot() {
  patchFog();
  const touch = isTouchDevice() || qs('touch') === '1';
  const qName = qs('q') || (touch ? 'low' : 'high');
  const quality = { ...(PRESETS[qName] || PRESETS.high), name: qName };
  if (qs('msaa') !== null) quality.msaa = Number(qs('msaa'));
  if (qs('shadow') !== null) quality.shadowSize = Number(qs('shadow'));
  if (qs('bloom') !== null) quality.bloom = qs('bloom') === '1';
  const autoQuality = !qs('q');

  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is not available.');
  let pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = true;

  const ui = new UI({ isTouch: touch });
  $('loading').classList.add('hidden');

  const defaultSeed = Number(qs('seed')) || Math.floor(Math.random() * 9000 + 1000);
  const seed = qs('autostart') ? defaultSeed : await ui.showTitle(defaultSeed);

  const loading = $('loading');
  loading.classList.remove('hidden', 'done');
  const progress = (msg, f) => { $('load-msg').textContent = msg; $('load-bar').style.width = `${Math.round(f * 100)}%`; };
  progress('Waking the woods', 0.02);
  await tick();

  const seasonId = qs('season') || DEFAULT_SEASON;
  const config = await SEASONS[seasonId]();
  const envModule = await config.loadEnvironment();
  const rng = new RNG(seed);

  const scene = new THREE.Scene();
  const env = await envModule.createEnvironment({
    rng: rng.fork('env'), renderer, quality,
    progress: (m, f) => progress(m, 0.05 + f * 0.7),
  });
  scene.add(env.group);
  scene.fog = env.fog;

  progress('Finding the mushrooms', 0.78);
  await tick();
  const lib = new MushroomLibrary(rng.fork('mushrooms'), { morel: 8, gyromitra: 5 }, quality);
  let n = 0;
  const total = lib.pending;
  while (lib.pending) { lib.buildNext(); n++; progress('Finding the mushrooms', 0.78 + 0.18 * (n / total)); await tick(); }
  if (env.reflection) { lib.mats.false.envMap = env.reflection; lib.mats.false.envMapIntensity = 0.5; lib.mats.true.envMap = env.reflection; lib.mats.true.envMapIntensity = 0.25; }

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 280);
  const post = createComposer(renderer, scene, camera, quality);
  const { composer, bloom, grade, fxaa } = post;
  const inspect = new InspectView(renderer, lib, env.groundMap);

  const game = new Game({ scene, env, lib, config, seed, ui });
  const controls = new Controls({
    canvas, camera, env, isTouch: touch,
    callbacks: { onKey: (e) => onKey(e), onUnlock: () => onPointerUnlock() },
  });

  // ---------- sizing ----------
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (w * pixelRatio), 1 / (h * pixelRatio));
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 82 : 70;
    camera.updateProjectionMatrix();
    grade.uniforms.uAspect.value = w / h;
    inspect.resize(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  // ---------- inspect flow ----------
  let paused = false;
  let expectUnlock = false;
  let hPending = 0;
  const unlock = () => { expectUnlock = true; controls.unlockPointer(); setTimeout(() => { expectUnlock = false; }, 200); };

  function notebookTouched(before) {
    const added = [...game.knowledge].filter((k) => !before.has(k));
    for (const k of added) {
      if (k === 'obs_honey') ui.toast('Notebook: a cap pitted like a honeycomb.', 'note');
      else if (k === 'obs_brain') ui.toast('Notebook: a folded, brain-like cap.', 'note');
      else if (k === 'cut_true' || k === 'cut_false') ui.toast('Notebook updated: what the inside looks like.', 'note');
    }
    ui.refreshNotebook(game.notebook());
  }

  function startInspect(m) {
    if (!m || m.state !== 'active' || game.inspecting || game.phase !== 'playing') return;
    const before = new Set(game.knowledge);
    game.beginInspect(m);
    notebookTouched(before);
    inspect.open(m.variant);
    inspect.onCut = () => {
      const b = new Set(game.knowledge);
      const isTrue = m.kind === 'true';
      game.cut(m);
      ui.showCutResult(isTrue);
      notebookTouched(b);
    };
    ui.openInspect();
    controls.setEnabled(false);
    ui.setPrompt(null);
    unlock();
  }

  function closeInspect() {
    inspect.close();
    ui.closeInspect();
    game.endInspect();
    controls.setEnabled(true);
    if (!touch) controls.lockPointer();
  }

  function doCut() {
    if (!game.inspecting || inspect.state !== 'intact') return;
    ui.inspectCutting();
    inspect.cut();
  }

  function doPick() {
    const m = game.inspecting;
    if (!m || inspect.state !== 'intact') return;
    const before = new Set(game.knowledge);
    const res = game.pick(m);
    closeInspect();
    if (res.kind === 'true') {
      ui.toast(`True morel! Into the basket (${game.todayTruePicked} today, ${game.stats.trueGathered} this season).`, 'good');
    } else {
      ui.toast('That was a false morel (Gyromitra). You feel it coming on. Tomorrow is lost.', 'bad');
    }
    notebookTouched(before);
  }

  function doLeave() {
    const m = game.inspecting;
    if (!m || inspect.state !== 'intact') return;
    game.leave(m);
    closeInspect();
    ui.toast('You leave it where it grows.');
  }

  function doDoneAfterCut() {
    closeInspect();
  }

  function toggleNotebook() {
    if (!(game.phase === 'playing' || game.inspecting)) return;
    if (ui.noteOpen) { ui.closeNotebook(); return; }
    paused = true;
    ui.openNotebook(game.notebook());
    unlock();
  }

  function pauseGame() {
    if (game.phase !== 'playing' || game.inspecting || paused) return;
    paused = true;
    controls.setEnabled(false);
    unlock();
    ui.showPause({ onResume: resume, onRestart: () => { location.search = `?seed=${seed}`; }, onHome: () => { resume(); game.endDay('home'); } });
  }

  function resume() {
    paused = false;
    if (game.phase === 'playing' && !game.inspecting) { controls.setEnabled(true); if (!touch) controls.lockPointer(); }
  }

  ui.on.notebook = toggleNotebook;
  ui.on.overlayOpen = () => { if (!touch) unlock(); };
  ui.on.notebookClosed = () => {
    if (game.inspecting) { paused = false; return; }
    paused = false;
    resume();
  };
  ui.on.menu = pauseGame;
  ui.on.home = () => { if (game.phase === 'playing' && !game.inspecting) game.endDay('home'); };
  ui.on.inspect = () => startInspect(currentTarget);
  ui.on.cut = doCut; ui.on.pick = doPick; ui.on.leave = doLeave; ui.on.done = doDoneAfterCut;

  function onKey(e) {
    const code = e.code;
    if (ui.noteOpen) {
      if (code === 'KeyN' || code === 'Escape') { ui.closeNotebook(); e.preventDefault(); }
      return true;
    }
    if (ui.overlayOpen) {
      if (code === 'Escape' && paused) { ui.hideOverlay(); resume(); }
      return false;
    }
    if (game.inspecting) {
      if (code === 'KeyC') doCut();
      else if (code === 'KeyP' || code === 'Space') { e.preventDefault(); doPick(); }
      else if (code === 'Escape' || code === 'KeyL' || code === 'KeyQ') { if (inspect.state === 'cut') closeInspect(); else doLeave(); }
      else if (code === 'KeyN') toggleNotebook();
      else if (code === 'Enter' && inspect.state === 'cut') closeInspect();
      return true;
    }
    if (game.phase !== 'playing') return false;
    if (code === 'KeyE') { startInspect(currentTarget); return true; }
    if (code === 'KeyN') { toggleNotebook(); return true; }
    if (code === 'Escape') { pauseGame(); return true; }
    if (code === 'KeyH') {
      const now = performance.now();
      if (now - hPending < 2500) { hPending = 0; game.endDay('home'); }
      else { hPending = now; ui.toast('Press H again to head home and end the day.'); }
      return true;
    }
    return false;
  }

  function onPointerUnlock() {
    if (expectUnlock || touch) return;
    if (game.phase === 'playing' && !game.inspecting && !paused && !ui.overlayOpen) pauseGame();
  }

  // inspect-view drag / wheel
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { if (inspect.active) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture?.(e.pointerId); } });
  canvas.addEventListener('pointermove', (e) => {
    if (!inspect.active || !drag || drag.id !== e.pointerId) return;
    inspect.rotate(e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => { if (inspect.active) { inspect.zoom(e.deltaY * 0.004); e.preventDefault(); } }, { passive: false });

  // ---------- main loop ----------
  let currentTarget = null;
  let last = performance.now();
  let time = 0;
  const frameTimes = [];
  let adaptT = 0;
  const perf = { fps: 0, ms: 0, pixelRatio };

  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(0.05, rawDt);
    time += dt;
    frameTimes.push(rawDt * 1000);
    if (frameTimes.length > 120) frameTimes.shift();

    const canMove = game.phase === 'playing' && !paused && !game.inspecting && !ui.overlayOpen;
    if (controls.enabled !== canMove && !game.inspecting) controls.setEnabled(canMove);
    controls.speedMul = game.sickLevel > 0 ? 0.65 : 1;
    controls.update(dt);
    env.update(dt, time, camera, controls.groundY);
    game.paused = paused || ui.overlayOpen;
    game.update(dt);

    if (canMove) {
      currentTarget = game.findTarget(camera);
      ui.setPrompt(currentTarget ? (touch ? 'Inspect' : 'E  Inspect mushroom') : null);
    } else if (!game.inspecting) {
      currentTarget = null;
      ui.setPrompt(null);
    }
    ui.updateHUD(game.hud(), { sick: game.sickLevel > 0 });
    ui.setSick(game.sickLevel > 0 && game.phase === 'playing');
    ui.setLockHint(controls.locked);

    grade.uniforms.uTime.value = time;
    grade.uniforms.uSick.value = game.phase === 'playing' ? game.sickLevel * (0.55 + 0.25 * Math.sin(time * 1.7)) : 0;

    if (inspect.active) { inspect.update(dt); inspect.render(); }
    else composer.render(dt);

    // adaptive resolution (only when the user did not pin a quality tier)
    adaptT += dt;
    if (adaptT > 3 && frameTimes.length >= 60) {
      adaptT = 0;
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      perf.ms = avg; perf.fps = 1000 / avg;
      if (autoQuality && !inspect.active) {
        if (perf.fps < 40 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, pixelRatio - 0.2); resize(); }
        else if (perf.fps > 57 && pixelRatio < Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap)) { pixelRatio = Math.min(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap), pixelRatio + 0.1); resize(); }
      }
      perf.pixelRatio = pixelRatio;
    }
  }

  window.__ctfBooted = true;
  window.ctf = {
    game, env, controls, camera, scene, renderer, inspect, ui, quality, perf, lib,
    startInspect, doCut, doPick, doLeave, closeInspect,
    get target() { return currentTarget; },
    // test helper: stand near a given kind of mushroom and face it
    goTo(kind, i = 0) {
      const list = game.active.filter((m) => m.kind === kind);
      const m = list[i];
      if (!m) return null;
      const a = 0.8 + i;
      controls.teleport(m.pos.x + Math.cos(a) * 1.4, m.pos.z + Math.sin(a) * 1.4);
      controls.crouch = false;
      controls.eyeNow = 1.62;
      controls.update(0.016);
      controls.lookAt(m.pos.x, m.pos.y, m.pos.z);
      controls.update(0.016);
      return m;
    },
    async measureFps(seconds = 5) {
      const samples = [];
      let prev = performance.now();
      return new Promise((resolve) => {
        const t0 = prev;
        const step = (t) => {
          samples.push(t - prev); prev = t;
          if (t - t0 < seconds * 1000) requestAnimationFrame(step);
          else {
            const s = samples.slice(2).sort((a, b) => a - b);
            const avg = s.reduce((a, b) => a + b, 0) / s.length;
            resolve({ fps: 1000 / avg, avgMs: avg, p95Ms: s[Math.floor(s.length * 0.95)], frames: s.length, pixelRatio });
          }
        };
        requestAnimationFrame(step);
      });
    },
  };

  requestAnimationFrame(frame);
  progress('Ready', 1);
  loading.classList.add('done');
  setTimeout(() => loading.classList.add('hidden'), 700);
  ui.showHUD(true);
  await game.start();
  if (!touch && !qs('autostart')) controls.lockPointer();
}

boot().catch(fatal);
