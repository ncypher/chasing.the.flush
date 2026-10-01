import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { Season } from './season.js';
import { buildSites, drawSites } from './spawner.js';

// Core game orchestrator: day clock, daily emergence, picking rules, the sickness penalty,
// notebook knowledge and the season tally. Knows nothing about a specific season: all of that
// comes from the season config and the environment module.

export class Game {
  constructor({ scene, env, lib, config, seed, ui }) {
    this.scene = scene; this.env = env; this.lib = lib; this.cfg = config; this.seed = seed; this.ui = ui;
    this.rng = new RNG(seed);
    this.season = new Season(config, this.rng);
    this.root = new THREE.Group();
    scene.add(this.root);

    this.sites = {};
    for (const sp of Object.values(config.species)) this.sites[sp.id] = buildSites(env, sp, this.rng.fork('sites:' + sp.id));
    this.mush = [];
    this.nextId = 1;

    this.phase = 'title'; // title | dayintro | playing | dayend | sickday | ended
    this.dayIdx = -1;
    this.dayTime = 0;
    this.dayLen = config.dayLengthSec;
    this.paused = false;
    this.inspecting = null;
    this.sickToday = false;
    this.skipNext = false;
    this.sickLevel = 0;

    this.knowledge = new Set();
    this.habitat = { true: {}, false: {} };
    this.stats = {
      trueGathered: 0, falsePicked: 0, avoided: 0, missedTrue: 0, trueCut: 0, falseCut: 0, sickDays: 0, trueAppeared: 0,
      perDay: Array.from({ length: config.days }, (_, d) => ({
        day: d, truePicked: 0, falsePicked: 0, inspected: 0, sick: false, skipped: false, appeared: { true: 0, false: 0 },
      })),
    };
    this.summary = null;
  }

  // ---------- day flow ----------
  async start() {
    await this.beginDay(0);
  }

  async beginDay(d) {
    this.dayIdx = d;
    this.dayTime = 0;
    this.sickToday = false;
    this.sickLevel = 0;
    const w = this.season.weather[d];
    this.env.setWeather(w.sky, d === 0);
    this.spawnDay(d);
    this.phase = 'dayintro';
    await this.ui.showDayIntro(this.dayInfo(d));
    this.phase = 'playing';
  }

  dayInfo(d) {
    const w = this.season.weather[d];
    const prev = d > 0 ? this.season.weather[d - 1].soil : null;
    return {
      day: d, days: this.cfg.days, date: this.season.date(d), soil: w.soil, soilDelta: prev === null ? 0 : w.soil - prev,
      rain: w.rain, rain3: this.season.rain3(d), sky: w.sky,
    };
  }

  spawnDay(d) {
    const rec = this.stats.perDay[d];
    // age out
    for (let i = this.mush.length - 1; i >= 0; i--) {
      const m = this.mush[i];
      const life = this.cfg.species[m.species].lifespan;
      if (d - m.bornDay >= life) this.removeMushroom(m, i);
      else if (d - m.bornDay >= life - 1) this.markOld(m);
    }
    for (const sp of Object.values(this.cfg.species)) {
      const r = this.rng.fork(`day:${d}:${sp.id}`);
      const n = this.season.newCount(sp.id, d, r);
      const picks = drawSites(this.sites[sp.id], n, r);
      for (const site of picks) this.addMushroom(sp, site, d, r);
      rec.appeared[sp.kind] += picks.length;
      if (sp.kind === 'true') this.stats.trueAppeared += picks.length;
    }
  }

  addMushroom(sp, site, d, r) {
    const variant = this.lib.pickVariant(sp.id, r);
    const obj = this.lib.createWorldObject(variant, r);
    obj.position.set(site.x, site.y, site.z);
    this.root.add(obj);
    site.occupied = true; site.uses++;
    const m = {
      id: this.nextId++, species: sp.id, kind: sp.kind, site, variant, obj, bornDay: d, state: 'active',
      inspected: false, counted: false, grow: 0, old: false, pos: new THREE.Vector3(site.x, site.y + obj.userData.h * 0.5, site.z),
    };
    this.mush.push(m);
    this.applyScale(m, 0.001);
    return m;
  }

  markOld(m) {
    if (m.old) return;
    m.old = true;
    m.oldScale = 0.86;
    if (m.grow >= 1) this.applyScale(m, 1);
  }

  applyScale(m, e) {
    const k = e * (m.old ? m.oldScale : 1);
    const ud = m.obj.userData;
    ud.body.scale.set(ud.baseScale.x * k, ud.baseScale.y * k * (m.old ? 0.95 : 1), ud.baseScale.z * k);
    ud.blob.scale.setScalar(ud.baseBlob * e);
  }

  removeMushroom(m, idx = this.mush.indexOf(m)) {
    this.root.remove(m.obj);
    m.site.occupied = false;
    if (idx >= 0) this.mush.splice(idx, 1);
  }

  get active() { return this.mush.filter((m) => m.state === 'active'); }

  update(dt) {
    for (const m of this.mush) {
      if (m.grow < 1) {
        m.grow = Math.min(1, m.grow + dt / 1.6);
        this.applyScale(m, 1 - Math.pow(1 - m.grow, 3));
      }
    }
    if (this.sickLevel > 0) this.sickLevel = Math.max(0.55, this.sickLevel - dt * 0.01);
    if (this.phase === 'playing' && !this.paused && !this.inspecting) {
      this.dayTime += dt;
      this.env.setTimeOfDay(this.dayTime / this.dayLen);
      if (this.dayTime >= this.dayLen) this.endDay('dusk');
    }
  }

  // Mushroom nearest the crosshair within reach.
  findTarget(camera, maxDist = 4.2) {
    const cam = camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    let best = null, bestScore = Infinity;
    const v = new THREE.Vector3();
    for (const m of this.mush) {
      if (m.state !== 'active') continue;
      v.copy(m.pos).sub(cam);
      const d = v.length();
      if (d > maxDist || d < 0.2) continue;
      v.divideScalar(d);
      const ang = Math.acos(Math.min(1, v.dot(fwd)));
      const tol = Math.max(0.075, Math.atan(0.2 / d));
      if (ang < tol && ang / tol < bestScore) { best = m; bestScore = ang / tol; }
    }
    return best;
  }

  // ---------- actions ----------
  beginInspect(m) {
    this.inspecting = m;
    const rec = this.stats.perDay[this.dayIdx];
    if (!m.inspected) {
      m.inspected = true;
      rec.inspected++;
      this.knowledge.add(m.kind === 'true' ? 'obs_honey' : 'obs_brain');
    }
  }

  // Habitat is only tallied once identity is confirmed (picked or cut open).
  confirm(m) {
    this.knowledge.add(`id_${m.kind}`);
    const hostKey = m.site.host;
    this.habitat[m.kind][hostKey] = (this.habitat[m.kind][hostKey] || 0) + 1;
  }

  endInspect() { this.inspecting = null; }

  pick(m) {
    const rec = this.stats.perDay[this.dayIdx];
    m.state = 'picked';
    this.confirm(m);
    this.removeMushroom(m);
    if (m.kind === 'true') {
      this.stats.trueGathered++;
      rec.truePicked++;
      return { kind: 'true', sick: false };
    }
    this.stats.falsePicked++;
    rec.falsePicked++;
    this.knowledge.add('picked_false');
    this.sickToday = true;
    this.sickLevel = 1;
    if (!this.skipNext) this.skipNext = true;
    return { kind: 'false', sick: true };
  }

  cut(m) {
    m.state = 'cut';
    this.confirm(m);
    this.removeMushroom(m);
    if (m.kind === 'true') {
      this.stats.trueCut++;
      this.knowledge.add('cut_true');
    } else {
      this.stats.falseCut++;
      if (!m.counted) { m.counted = true; this.stats.avoided++; }
      this.knowledge.add('cut_false');
    }
  }

  leave(m) {
    if (!m.inspected || m.counted) return;
    m.counted = true;
    if (m.kind === 'true') this.stats.missedTrue++;
    else this.stats.avoided++;
  }

  // ---------- end of day / season ----------
  get todayTruePicked() { return this.stats.perDay[this.dayIdx]?.truePicked || 0; }

  async endDay(reason) {
    if (this.phase !== 'playing') return;
    this.phase = 'dayend';
    const d = this.dayIdx;
    const rec = this.stats.perDay[d];
    rec.sick = this.sickToday;
    await this.ui.showDayEnd({
      ...this.dayInfo(d), reason, truePicked: rec.truePicked, falsePicked: rec.falsePicked, inspected: rec.inspected,
      seasonTotal: this.stats.trueGathered, sick: this.sickToday, lastDay: d >= this.cfg.days - 1,
    });

    let next = d + 1;
    if (this.skipNext && next < this.cfg.days) {
      this.skipNext = false;
      this.phase = 'sickday';
      const sr = this.stats.perDay[next];
      sr.sick = true; sr.skipped = true;
      this.stats.sickDays++;
      this.env.setWeather(this.season.weather[next].sky);
      this.spawnDay(next);
      await this.ui.showSickDay({ ...this.dayInfo(next), appearedTrue: sr.appeared.true });
      next++;
    }
    if (next >= this.cfg.days) { await this.finish(); return; }
    await this.beginDay(next);
  }

  async finish() {
    this.phase = 'ended';
    const s = this.stats;
    let best = { day: 0, count: 0 };
    for (const r of s.perDay) if (r.truePicked > best.count) best = { day: r.day, count: r.truePicked };
    const score = s.trueGathered * 10 + s.avoided * 2 - s.falsePicked * 12;
    this.summary = {
      seed: this.seed, trueGathered: s.trueGathered, avoided: s.avoided, mistakes: s.falsePicked, missedTrue: s.missedTrue,
      trueCut: s.trueCut, falseCut: s.falseCut, sickDays: s.sickDays, trueAppeared: s.trueAppeared,
      bestDay: best, bestDayDate: best.count ? this.season.date(best.day) : null, score,
      perDay: s.perDay.map((r, i) => ({ ...r, date: this.season.date(i), soil: this.season.weather[i].soil, rain: this.season.weather[i].rain })),
    };
    await this.ui.showSummary(this.summary);
  }

  // ---------- readouts ----------
  clockText() {
    const f = Math.min(1, this.dayTime / this.dayLen);
    const h = this.cfg.dayStartHour + f * (this.cfg.dayEndHour - this.cfg.dayStartHour);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const ap = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
  }

  hud() {
    const info = this.dayIdx >= 0 ? this.dayInfo(this.dayIdx) : null;
    return {
      info, clock: this.clockText(), frac: Math.min(1, this.dayTime / this.dayLen),
      today: this.dayIdx >= 0 ? this.todayTruePicked : 0, season: this.stats.trueGathered,
    };
  }

  notebook() {
    const log = [];
    for (let d = 0; d <= Math.min(this.dayIdx, this.cfg.days - 1); d++) {
      const w = this.season.weather[d];
      const r = this.stats.perDay[d];
      log.push({ day: d, date: this.season.date(d), soil: w.soil, rain: w.rain, rain3: this.season.rain3(d), sky: w.sky, found: r.truePicked, sick: r.skipped });
    }
    return { knowledge: this.knowledge, habitat: this.habitat, log, labels: this.cfg.habitatLabels };
  }
}
