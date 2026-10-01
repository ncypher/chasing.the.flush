// All DOM UI: HUD, toasts, prompts, overlay screens, field notebook and the inspect-mode controls.

const $ = (id) => document.getElementById(id);
const skyLabel = { sunny: 'Sunny', cloudy: 'Overcast', rain: 'Rain' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SVG_TRUE = `<svg viewBox="0 0 120 150" aria-label="True morel in section">
  <path d="M45 142 L45 92 C28 80 32 40 60 16 C88 40 92 80 75 92 L75 142 Z" fill="#cfae52" stroke="#6e5420" stroke-width="2"/>
  <path d="M52 138 L52 94 C41 82 44 50 60 30 C76 50 79 82 68 94 L68 138 Z" fill="#f4ecd2"/>
  <text x="60" y="100" text-anchor="middle" font-size="9" fill="#6e5420">hollow</text></svg>`;
const SVG_FALSE = `<svg viewBox="0 0 120 150" aria-label="False morel in section">
  <path d="M46 142 L50 66 L70 66 L74 142 Z" fill="#ecdfca" stroke="#7a6a50" stroke-width="2"/>
  <circle cx="56" cy="90" r="3.5" fill="#8a7658"/><circle cx="64" cy="108" r="4.5" fill="#8a7658"/><circle cx="58" cy="124" r="3" fill="#8a7658"/><circle cx="65" cy="80" r="2.6" fill="#8a7658"/>
  <path d="M16 72 C10 30 40 12 60 12 C80 12 110 30 104 72 C98 80 86 68 72 64 L48 64 C34 68 22 80 16 72 Z" fill="#8f4220" stroke="#3a1a0c" stroke-width="2"/>
  <text x="60" y="52" text-anchor="middle" font-size="9" fill="#e8c8a8">chambered</text></svg>`;

export class UI {
  constructor({ isTouch }) {
    this.isTouch = isTouch;
    this.overlay = $('overlay');
    this.on = {};
    this.noteTab = 'identify';
    this.noteOpen = false;
    this._last = {};
    document.body.classList.toggle('touch', isTouch);
    $('hud-hints').textContent = isTouch ? '' : 'WASD move \u00b7 Mouse look \u00b7 Shift sprint \u00b7 C crouch \u00b7 E inspect';
    $('btn-notebook').addEventListener('click', () => this.on.notebook?.());
    $('btn-home').addEventListener('click', () => this.on.home?.());
    $('btn-menu').addEventListener('click', () => this.on.menu?.());
    $('touch-inspect').addEventListener('click', () => this.on.inspect?.());
    $('act-cut').addEventListener('click', () => this.on.cut?.());
    $('act-pick').addEventListener('click', () => this.on.pick?.());
    $('act-leave').addEventListener('click', () => this.on.leave?.());
    $('act-notes').addEventListener('click', () => this.on.notebook?.());
    $('act-done').addEventListener('click', () => this.on.done?.());
  }

  setText(id, v) {
    if (this._last[id] !== v) { this._last[id] = v; $(id).textContent = v; }
  }

  showHUD(v) {
    $('hud').classList.toggle('hidden', !v);
    $('touch').classList.toggle('hidden', !(v && this.isTouch));
  }

  updateHUD(h, { sick } = {}) {
    if (!h.info) return;
    const i = h.info;
    this.setText('hud-daynum', `Day ${i.day + 1} / ${i.days}`);
    this.setText('hud-date', i.date);
    this.setText('hud-clock', h.clock);
    this.setText('hud-sky', sick ? 'Feeling ill' : skyLabel[i.sky]);
    const arrow = i.soilDelta > 0.4 ? ' \u25b2' : i.soilDelta < -0.4 ? ' \u25bc' : '';
    this.setText('hud-soil', `${i.soil.toFixed(0)}\u00b0F${arrow}`);
    this.setText('hud-rain', `${i.rain3.toFixed(2)} in`);
    this.setText('hud-basket-n', `${h.today}  /  ${h.season}`);
    const bar = $('hud-daybar');
    const w = `${(h.frac * 100).toFixed(1)}%`;
    if (this._last.bar !== w) { this._last.bar = w; bar.style.width = w; }
  }

  setPrompt(text) {
    const p = $('prompt'), c = $('crosshair');
    if (text) { if (this._last.prompt !== text) { p.textContent = text; this._last.prompt = text; } p.classList.remove('hidden'); c.classList.add('target'); }
    else { p.classList.add('hidden'); c.classList.remove('target'); this._last.prompt = ''; }
    $('touch-inspect').classList.toggle('hidden', !text || !this.isTouch);
  }

  toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { el.style.opacity = '0'; }, 3800);
    setTimeout(() => el.remove(), 4400);
  }

  setLockHint(locked) {
    if (this.isTouch || this._lockState === locked) return;
    this._lockState = locked;
    $('hud-hints').textContent = (locked ? '' : 'Click the view to capture the mouse (or drag to look). ') + 'WASD move \u00b7 Shift sprint \u00b7 C crouch \u00b7 E inspect';
  }

  setSick(on) { $('vignette-sick').classList.toggle('hidden', !on); }

  // ---------- overlays ----------
  _card(html, { clear = false, title = false } = {}) {
    this.on.overlayOpen?.();
    this.overlay.className = title ? 'title' : clear ? 'clear' : '';
    this.overlay.innerHTML = `<div class="card">${html}</div>`;
    this.overlay.classList.remove('hidden');
    return this.overlay.firstChild;
  }

  hideOverlay() { this.overlay.classList.add('hidden'); this.overlay.innerHTML = ''; }
  get overlayOpen() { return !this.overlay.classList.contains('hidden'); }

  showTitle(seed) {
    return new Promise((resolve) => {
      const el = this._card(`
        <svg viewBox="0 0 64 64" width="54" height="54" aria-hidden="true" style="float:right;margin:0 0 8px 12px"><rect x="26" y="34" width="12" height="24" rx="4" fill="#efe6cf"/><path d="M32 5C47 8 51 28 47 40 40 43 24 43 17 40 13 28 17 8 32 5Z" fill="#d2ab4e"/><g fill="#5a3d14"><circle cx="28" cy="18" r="3"/><circle cx="37" cy="22" r="3"/><circle cx="26" cy="29" r="3"/><circle cx="35" cy="33" r="3"/><circle cx="42" cy="31" r="2.4"/><circle cx="32" cy="11" r="2.2"/></g></svg>
        <h1>Chasing the Flush</h1>
        <p class="sub">A morel-hunting game &middot; Spring &middot; Michigan hardwoods</p>
        <p>The spring flush lasts about ten days. Soil warms, rain comes, and the morels pop up under dying elm, ash, old apple trees and tulip poplar &mdash; right beside the <b>false morels</b> that can make you sick.</p>
        <h3>How to play</h3>
        <p>Walk the woods and spot mushrooms. <b>Inspect</b> one up close, turn it over, even <b>cut it in half</b> (that costs you the mushroom). Then pick it or leave it. A false morel in the basket ruins your next day. Watch the soil temperature and rain: they decide how many morels fruit each day.</p>
        <p class="sub">${this.isTouch ? 'Left thumb: move &middot; right thumb: look &middot; tap Inspect near a mushroom.' : 'WASD move &middot; mouse look (click to capture) &middot; Shift sprint &middot; C crouch &middot; E inspect &middot; N notebook &middot; H head home &middot; Esc menu.'}</p>
        <div class="actions"><span class="sub" style="align-self:center">Seed</span><input id="seed-in" type="text" inputmode="numeric" value="${esc(seed)}" aria-label="Seed"><button class="btn primary" id="start-btn" type="button">Start the season</button></div>`, { title: true });
      const go = () => {
        const v = $('seed-in').value.trim();
        const n = /^\d+$/.test(v) ? Number(v) >>> 0 : Array.from(v).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
        this.hideOverlay();
        resolve(n || seed);
      };
      $('start-btn').addEventListener('click', go);
      $('seed-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      setTimeout(() => $('start-btn').focus(), 50);
    });
  }

  showDayIntro(i) {
    return new Promise((resolve) => {
      const trend = i.soilDelta > 0.4 ? 'warming' : i.soilDelta < -0.4 ? 'cooling' : 'steady';
      const el = this._card(`
        <h2>Day ${i.day + 1} of ${i.days} &middot; ${i.date}</h2>
        <p class="sub">${skyLabel[i.sky]} &middot; rain today ${i.rain.toFixed(2)} in</p>
        <div class="stats">
          <div class="stat"><b>${i.soil.toFixed(0)}&deg;F</b><span>Soil temperature (${trend})</span></div>
          <div class="stat"><b>${i.rain3.toFixed(2)} in</b><span>Rain, last 3 days</span></div>
        </div>
        <p class="sub">${i.day === 0 ? 'Morels are not up yet if the ground is still cold. Look anyway: the lookalikes like it cool.' : 'Yesterday\u2019s soil and rain decide what pushed up overnight.'}</p>
        <div class="actions"><button class="btn primary" id="go-btn" type="button">Head into the woods</button></div>`, { clear: true });
      void el;
      const go = () => { this.hideOverlay(); window.removeEventListener('keydown', onKey); resolve(); };
      const onKey = (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); go(); } };
      window.addEventListener('keydown', onKey);
      $('go-btn').addEventListener('click', go);
      setTimeout(() => $('go-btn')?.focus(), 30);
    });
  }

  showDayEnd(i) {
    return new Promise((resolve) => {
      this._card(`
        <h2>${i.reason === 'dusk' ? 'Dusk' : 'Heading home'} &middot; ${i.date}</h2>
        <div class="stats">
          <div class="stat good"><b>${i.truePicked}</b><span>True morels today</span></div>
          <div class="stat"><b>${i.seasonTotal}</b><span>Season total</span></div>
          <div class="stat ${i.falsePicked ? 'bad' : ''}"><b>${i.falsePicked}</b><span>False morels picked</span></div>
        </div>
        ${i.sick ? '<p><b style="color:var(--bad)">You picked a false morel.</b> By evening you are ill, and tomorrow is lost in bed.</p>' : `<p class="sub">${i.truePicked ? 'Good haul. Wash them, slice them in half, and cook them well.' : 'Nothing in the basket today.'}</p>`}
        <div class="actions"><button class="btn primary" id="next-btn" type="button">${i.lastDay ? 'See the season summary' : 'Sleep, then next day'}</button></div>`);
      const go = () => { this.hideOverlay(); resolve(); };
      $('next-btn').addEventListener('click', go);
      setTimeout(() => $('next-btn')?.focus(), 30);
    });
  }

  showSickDay(i) {
    return new Promise((resolve) => {
      this._card(`
        <h2>${i.date}: a day in bed</h2>
        <p>The false morel (<i>Gyromitra</i>) has made you properly sick. You spend the day miserable while the woods keep going without you.</p>
        <p class="sub">Soil ${i.soil.toFixed(0)}&deg;F &middot; ${skyLabel[i.sky]}. ${i.appearedTrue > 0 ? `<b>${i.appearedTrue}</b> true morels pushed up today with nobody there to pick them.` : 'Not much fruited today anyway.'}</p>
        <div class="actions"><button class="btn primary" id="next-btn" type="button">Back out tomorrow</button></div>`);
      const go = () => { this.hideOverlay(); resolve(); };
      $('next-btn').addEventListener('click', go);
      setTimeout(() => $('next-btn')?.focus(), 30);
    });
  }

  showSummary(s) {
    this.showHUD(false);
    document.body.classList.remove('inspecting');
    let best = 0;
    try { best = Number(localStorage.getItem('ctf-best') || 0); } catch { /* storage unavailable */ }
    const isBest = s.score > best;
    if (isBest) { try { localStorage.setItem('ctf-best', String(s.score)); } catch { /* ignore */ } }
    const maxV = Math.max(1, ...s.perDay.map((d) => Math.max(d.appeared.true, d.truePicked)));
    const bars = s.perDay.map((d) => `<i title="${esc(d.date)}: ${d.appeared.true} fruited, ${d.truePicked} picked" style="height:${Math.max(3, (d.appeared.true / maxV) * 100)}%;${d.skipped ? 'background:rgba(224,112,90,.7)' : ''}"></i>`).join('');
    const rows = s.perDay.map((d) => `<tr><td>${d.day + 1}</td><td>${esc(d.date)}</td><td class="num">${d.soil.toFixed(0)}&deg;</td><td class="num">${d.rain.toFixed(2)}</td><td class="num">${d.appeared.true}</td><td class="num">${d.skipped ? 'sick' : d.truePicked}</td></tr>`).join('');
    this._card(`
      <h1>Season over</h1>
      <p class="sub">Seed ${s.seed} &middot; the flush has closed and the canopy is leafing out.</p>
      <div class="stats" id="end-stats">
        <div class="stat good"><b id="s-true">${s.trueGathered}</b><span>True morels gathered</span></div>
        <div class="stat"><b id="s-avoid">${s.avoided}</b><span>Lookalikes avoided</span></div>
        <div class="stat ${s.mistakes ? 'bad' : ''}"><b id="s-mist">${s.mistakes}</b><span>Mistakes (false morels picked)</span></div>
        <div class="stat"><b id="s-best">${s.bestDay.count || '-'}</b><span>Best day${s.bestDay.count ? ` (${s.bestDayDate})` : ''}</span></div>
        <div class="stat"><b id="s-missed">${s.missedTrue + s.trueCut}</b><span>True morels left or cut open</span></div>
        <div class="stat ${s.sickDays ? 'bad' : ''}"><b id="s-sick">${s.sickDays}</b><span>Sick days lost</span></div>
      </div>
      <p>Score <b style="color:var(--accent)" id="s-score">${s.score}</b>${isBest ? ' &middot; new best on this device!' : best ? ` &middot; best ${best}` : ''} <span class="sub">(10 per true morel, +2 per lookalike avoided, -12 per mistake)</span></p>
      <h3>The flush, day by day</h3>
      <p class="sub">${s.trueAppeared} true morels fruited this season; you found ${s.trueGathered}. Bars show how many fruited each day (red = day lost to illness).</p>
      <div class="spark">${bars}</div>
      <table class="tbl" style="margin-top:10px"><thead><tr><th>#</th><th>Date</th><th class="num">Soil</th><th class="num">Rain in</th><th class="num">Fruited</th><th class="num">Picked</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="actions"><button class="btn primary" id="again-btn" type="button">Play again (same seed)</button><button class="btn" id="newseed-btn" type="button">New seed</button></div>`);
    $('again-btn').addEventListener('click', () => { location.search = `?seed=${s.seed}`; });
    $('newseed-btn').addEventListener('click', () => { location.search = `?seed=${Math.floor(Math.random() * 9000 + 1000)}`; });
    return new Promise(() => {});
  }

  showPause({ onResume, onRestart, onHome }) {
    this._card(`
      <h2>Paused</h2>
      <p class="sub">The clock is stopped.</p>
      <div class="actions">
        <button class="btn primary" id="p-resume" type="button">Resume</button>
        <button class="btn" id="p-notes" type="button">Notebook</button>
        <button class="btn" id="p-home" type="button">Head home (end the day)</button>
        <button class="btn" id="p-restart" type="button">Restart season</button>
      </div>`);
    $('p-resume').addEventListener('click', () => { this.hideOverlay(); onResume(); });
    $('p-notes').addEventListener('click', () => this.on.notebook?.());
    $('p-home').addEventListener('click', () => { this.hideOverlay(); onHome(); });
    $('p-restart').addEventListener('click', onRestart);
  }

  // ---------- notebook ----------
  toggleNotebook(data) {
    if (this.noteOpen) { this.closeNotebook(); return false; }
    this.openNotebook(data);
    return true;
  }

  openNotebook(data) {
    this.noteOpen = true;
    this._noteData = data;
    this._renderNotebook();
  }

  closeNotebook() {
    this.noteOpen = false;
    this.hideOverlay();
    this.on.notebookClosed?.();
  }

  refreshNotebook(data) { if (this.noteOpen) { this._noteData = data; this._renderNotebook(); } }

  _renderNotebook() {
    const d = this._noteData;
    const tabs = [['identify', 'Identify'], ['habitat', 'Habitat'], ['weather', 'Weather'], ['tips', 'Tips']];
    const k = d.knowledge;
    let body = '';
    if (this.noteTab === 'identify') {
      const A = k.has('obs_honey'), B = k.has('obs_brain');
      const idT = k.has('id_true'), idF = k.has('id_false');
      const unseen = '<span class="unknown">Not observed yet. Inspect one.</span>';
      const unidentified = (known, text) => known ? text : '<span class="unknown">Unknown. Only cutting one open shows this.</span>';
      body = `
        <p class="sub">You notice two kinds of mushroom out there. Sort them out by what you see, then cut one open (or pick one and live with it) to learn which is which.</p>
        <div class="diagram">
          <figure>${k.has('cut_true') ? SVG_TRUE : '<svg viewBox="0 0 120 150"><text x="60" y="80" text-anchor="middle" fill="#7d8a68" font-size="11">cut one open</text></svg>'}<figcaption>${idT ? 'True morel, in section' : 'Honeycomb type, in section'}</figcaption></figure>
          <figure>${k.has('cut_false') ? SVG_FALSE : '<svg viewBox="0 0 120 150"><text x="60" y="80" text-anchor="middle" fill="#7d8a68" font-size="11">cut one open</text></svg>'}<figcaption>${idF ? 'False morel, in section' : 'Folded type, in section'}</figcaption></figure>
        </div>
        <table class="tbl"><thead><tr><th>Trait</th><th>${idT ? 'True morel' : 'Type A'}</th><th>${idF ? 'False morel' : 'Type B'}</th></tr></thead><tbody>
          <tr><td>Cap surface</td><td>${A ? 'Honeycomb: deep pits with sharp ridges' : unseen}</td><td>${B ? 'Wrinkled, folded, brain-like. No pits' : unseen}</td></tr>
          <tr><td>Cap and stem</td><td>${A ? 'Cap fused to the stem along its lower rim' : unseen}</td><td>${B ? 'Cap hangs free like a skirt, joined only near the top' : unseen}</td></tr>
          <tr><td>Colour</td><td>${A ? 'Yellow, blonde, gray or black' : unseen}</td><td>${B ? 'Reddish-brown to chestnut. Overlaps some morels, so do not trust colour alone' : unseen}</td></tr>
          <tr><td>Inside</td><td>${unidentified(k.has('cut_true'), 'One clean hollow, tip to base. Thin walls')}</td><td>${unidentified(k.has('cut_false'), 'Cottony, chambered, packed flesh. Not a clean hollow')}</td></tr>
          <tr><td>Stem</td><td>${unidentified(k.has('cut_true'), 'Pale, hollow and brittle')}</td><td>${unidentified(k.has('cut_false'), 'Thick, ribbed, solid and chalky')}</td></tr>
          <tr><td><b>Verdict</b></td><td>${idT ? '<b style="color:var(--good)">True morel (<i>Morchella</i>): edible, cooked</b>' : '<span class="unknown">?</span>'}</td><td>${idF ? '<b style="color:var(--bad)">False morel (<i>Gyromitra</i>): toxic</b>' : '<span class="unknown">?</span>'}</td></tr>
        </tbody></table>
        ${k.has('picked_false') ? '<p style="margin-top:12px"><b style="color:var(--bad)">Learned the hard way:</b> <i>Gyromitra</i> contains gyromitrin. Eating it makes you sick, and in the game it costs you a day.</p>' : ''}`;
    } else if (this.noteTab === 'habitat') {
      const labels = d.labels; const seen = {};
      for (const kind of ['true', 'false']) for (const [h, n] of Object.entries(d.habitat[kind])) { const l = labels[h] || h; (seen[l] ||= { true: 0, false: 0 })[kind] += n; }
      const rows = Object.entries(seen).sort((a, b) => b[1].true - a[1].true);
      let note = 'Pick or cut open mushrooms and the notebook will tally where each kind turns up.';
      const total = rows.reduce((a, r) => a + r[1].true, 0);
      if (total >= 4) {
        const top = rows[0];
        note = top[0] === 'Open leaf litter' ? 'Your finds are scattered over open ground. Try the trees.' : `Most of your true morels were found near <b>${esc(top[0])}</b>. Worth working that ground again.`;
      }
      body = `<p>${note}</p><table class="tbl"><thead><tr><th>Where</th><th class="num">True</th><th class="num">False</th></tr></thead><tbody>${rows.length ? rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${r[1].true}</td><td class="num">${r[1].false}</td></tr>`).join('') : '<tr><td colspan="3" class="unknown">Nothing recorded yet.</td></tr>'}</tbody></table>`;
    } else if (this.noteTab === 'weather') {
      const max = Math.max(1, ...d.log.map((r) => r.found));
      const bars = d.log.map((r) => `<i title="${esc(r.date)}: ${r.found}" style="height:${Math.max(3, (r.found / max) * 100)}%"></i>`).join('');
      const best = d.log.reduce((b, r) => (r.found > (b?.found ?? 0) ? r : b), null);
      body = `<p>${best ? `Best day so far: <b>${esc(best.date)}</b> with ${best.found} morels, soil ${best.soil.toFixed(0)}&deg;F and ${best.rain3.toFixed(2)} in of rain over three days.` : 'Log your finds and look for the pattern in soil temperature and rain.'}</p>
        <div class="spark">${bars}</div>
        <table class="tbl" style="margin-top:10px"><thead><tr><th>Date</th><th class="num">Soil</th><th class="num">Rain 3d</th><th>Sky</th><th class="num">Found</th></tr></thead><tbody>${d.log.map((r) => `<tr><td>${esc(r.date)}</td><td class="num">${r.soil.toFixed(0)}&deg;</td><td class="num">${r.rain3.toFixed(2)}</td><td>${skyLabel[r.sky]}</td><td class="num">${r.sick ? 'sick' : r.found}</td></tr>`).join('')}</tbody></table>`;
    } else {
      body = `<ul style="line-height:1.6;padding-left:18px;color:#dce4c8">
        <li>Morels start to fruit when soil warms to around 50&deg;F, and a few damp days help. Too warm and the flush closes.</li>
        <li>Look around dying elm and ash, old apple trees and tulip poplar. Open ground is mostly empty.</li>
        <li>False morels come up earlier, in cooler ground, in much the same places.</li>
        <li>Inspect before you pick. Cutting a mushroom open destroys it, but it settles the question, and you only need to learn the tell once.</li>
        <li>A false morel in the basket means a sick day.</li></ul>`;
    }
    this._card(`
      <h2>Field notebook</h2>
      <div class="tabs">${tabs.map(([id, l]) => `<button type="button" class="tab ${this.noteTab === id ? 'on' : ''}" data-tab="${id}">${l}</button>`).join('')}</div>
      ${body}
      <div class="actions"><button class="btn primary" id="nb-close" type="button">Close <kbd>N</kbd></button></div>`);
    this.overlay.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { this.noteTab = b.dataset.tab; this._renderNotebook(); }));
    $('nb-close').addEventListener('click', () => this.closeNotebook());
  }

  // ---------- inspect controls ----------
  openInspect(kindHint) {
    document.body.classList.add('inspecting');
    $('inspect').classList.remove('hidden');
    $('inspect-title').textContent = kindHint || 'Unknown morel-like mushroom';
    $('inspect-hint').textContent = 'Drag to turn it over. Look at the cap, how it joins the stem, the colour. Cutting it open destroys it.';
    $('inspect-hint').classList.remove('hidden');
    $('inspect-result').classList.add('hidden');
    for (const id of ['act-cut', 'act-pick', 'act-leave', 'act-notes']) { $(id).classList.remove('hidden'); $(id).disabled = false; }
    $('act-done').classList.add('hidden');
  }

  inspectCutting() {
    for (const id of ['act-cut', 'act-pick', 'act-leave']) $(id).disabled = true;
  }

  showCutResult(isTrue) {
    $('inspect-title').textContent = isTrue ? 'True morel' : 'False morel (Gyromitra)';
    const r = $('inspect-result');
    r.className = isTrue ? 'is-true' : 'is-false';
    r.innerHTML = isTrue
      ? '<b>True morel (<i>Morchella</i>).</b> One clean hollow runs from the cap tip to the stem base, thin-walled and empty. The cap is fused to the stem. Safe, and you have just spent it. Noted in the notebook.'
      : '<b>False morel (<i>Gyromitra</i>).</b> The inside is cottony and chambered, not hollow, and the cap hangs free of the stem. Good thing you looked first. Noted in the notebook.';
    $('inspect-hint').classList.add('hidden');
    for (const id of ['act-cut', 'act-pick', 'act-leave']) $(id).classList.add('hidden');
    $('act-done').classList.remove('hidden');
  }

  closeInspect() { document.body.classList.remove('inspecting'); $('inspect').classList.add('hidden'); }
  get inspectOpen() { return !$('inspect').classList.contains('hidden'); }
}
