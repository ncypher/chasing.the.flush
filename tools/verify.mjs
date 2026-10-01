// End-to-end verification in a real browser (Edge via Playwright). Run: node tools/verify.mjs
// Starts the dev server itself if nothing is listening, plays a full 10-day season through the real UI,
// measures fps, checks console cleanliness (desktop + mobile viewport) and writes README screenshots.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080/';
const SEED = process.env.SEED || '1234';
const SHOTS = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const report = { base: BASE, seed: SEED, checks: {} };
const log = (...a) => console.log(...a);

let server = null;
async function ensureServer() {
  try { await fetch(BASE); } catch {
    server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs'), '8080'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
  }
}

async function launch(ctxOpts) {
  const browser = await chromium.launch({
    channel: 'msedge', headless: false,
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  });
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ...ctxOpts });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));
  return { browser, ctx, page, logs };
}

async function bootGame(page, extra = '') {
  await page.goto(`${BASE}index.html?autostart=1&seed=${SEED}${extra}`, { waitUntil: 'load' });
  await page.waitForFunction("window.ctf && window.ctf.game.phase==='dayintro'", null, { timeout: 120000 });
}

// ------------------------------------------------------------------ desktop
async function desktop() {
  const { browser, page, logs } = await launch({ viewport: { width: 1600, height: 900 } });
  await bootGame(page);
  const gpu = await page.evaluate(() => {
    const gl = ctf.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  report.gpu = gpu;
  report.stats = await page.evaluate(() => ({ ...ctf.env.stats, quality: ctf.quality.name }));

  // --- intro card then the opening view
  await page.screenshot({ path: path.join(SHOTS, '00-day-intro.png') });
  await page.click('#go-btn');
  await page.waitForFunction("ctf.game.phase==='playing'");
  await page.evaluate(() => { ctf.controls.yaw = 0.62; ctf.controls.pitch = -0.04; });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOTS, '01-opening-view.png') });

  // --- fps while walking forward and turning (default settings)
  await page.keyboard.down('KeyW');
  const turner = setInterval(() => page.evaluate(() => { ctf.controls.yaw += 0.35; }).catch(() => {}), 1200);
  const fps720 = await (async () => { await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(1500); return page.evaluate(() => ctf.measureFps(8)); })();
  const fps1080 = await (async () => { await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(1500); return page.evaluate(() => ctf.measureFps(8)); })();
  clearInterval(turner);
  await page.keyboard.up('KeyW');
  report.fps = { '1280x720': fps720, '1920x1080': fps1080 };
  log('fps 720p', fps720.fps.toFixed(1), 'avg ms', fps720.avgMs.toFixed(2), 'p95 ms', fps720.p95Ms.toFixed(2), 'pr', fps720.pixelRatio);
  log('fps 1080p', fps1080.fps.toFixed(1), 'avg ms', fps1080.avgMs.toFixed(2), 'p95 ms', fps1080.p95Ms.toFixed(2), 'pr', fps1080.pixelRatio);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(800);

  // --- real season through the UI
  const tally = { truePicked: 0, trueCut: 0, falsePicked: 0, falseCut: 0, falseLeft: 0, trueLeft: 0, perDayTrue: [] };
  const flush = [];
  const press = (k) => page.keyboard.press(k);
  const dayState = () => page.evaluate(() => ({
    d: ctf.game.dayIdx, phase: ctf.game.phase,
    activeTrue: ctf.game.active.filter((m) => m.kind === 'true').length,
    activeFalse: ctf.game.active.filter((m) => m.kind === 'false').length,
    appeared: ctf.game.stats.perDay[ctf.game.dayIdx].appeared,
    w: ctf.game.season.weather[ctf.game.dayIdx],
  }));
  const startInspect = async (kind, i = 0) => {
    const ok = await page.evaluate(([k, i]) => !!ctf.goTo(k, i), [kind, i]);
    if (!ok) return false;
    await page.waitForTimeout(250);
    const tgt = await page.evaluate(() => ({ t: !!ctf.target, prompt: !document.getElementById('prompt').classList.contains('hidden') }));
    report.checks.targetPrompt = (report.checks.targetPrompt ?? true) && tgt.t && tgt.prompt;
    await press('KeyE');
    await page.waitForFunction('ctf.inspect.active', null, { timeout: 5000 });
    await page.waitForTimeout(500);
    return true;
  };
  const doPick = async () => { await press('KeyP'); await page.waitForFunction('!ctf.inspect.active', null, { timeout: 5000 }); };
  const doLeave = async () => { await press('Escape'); await page.waitForFunction('!ctf.inspect.active', null, { timeout: 5000 }); };
  const doCut = async (shotName) => {
    await press('KeyC');
    await page.waitForFunction("ctf.inspect.state==='cut'", null, { timeout: 8000 });
    await page.waitForTimeout(700);
    if (shotName) await page.screenshot({ path: path.join(SHOTS, shotName) });
    await press('Enter');
    await page.waitForFunction('!ctf.inspect.active', null, { timeout: 5000 });
  };
  const advance = async () => {
    await page.evaluate(() => { ctf.game.endDay('home'); });
    await page.waitForSelector('#next-btn');
    await page.click('#next-btn');
    for (let k = 0; k < 6; k++) {
      await page.waitForFunction("document.getElementById('go-btn') || document.getElementById('again-btn') || (document.getElementById('next-btn') && /bed/.test(document.querySelector('#overlay h2')?.textContent||''))");
      if (await page.$('#next-btn')) { report.sickCardSeen = true; await page.click('#next-btn'); continue; }
      break;
    }
    if (await page.$('#go-btn')) { await page.click('#go-btn'); await page.waitForFunction("ctf.game.phase==='playing'"); await page.waitForTimeout(2000); }
  };

  const daySeq = [];
  for (let step = 0; step < 12; step++) {
    const s = await dayState();
    if (s.phase === 'ended') break;
    const d = s.d;
    flush.push({ day: d + 1, soil: s.w.soil, rain: s.w.rain, sky: s.w.sky, appearedTrue: s.appeared.true, appearedFalse: s.appeared.false, activeTrue: s.activeTrue, activeFalse: s.activeFalse });
    daySeq.push(d);
    log(`day ${d + 1}: soil ${s.w.soil} rain ${s.w.rain} ${s.w.sky} | new true ${s.appeared.true} false ${s.appeared.false} | on the ground true ${s.activeTrue} false ${s.activeFalse}`);

    // screenshot the same spot on an early and a peak day (flush visibly changes)
    if (step === 0 || s.activeTrue > 40 && !report.peakShot) {
      await page.evaluate(() => { const g = ctf.game; const m = g.active.find((x) => x.kind === 'true') || g.active[0]; if (m) { ctf.controls.teleport(m.pos.x + 3.2, m.pos.z + 2.4, 0); ctf.controls.lookAt(m.pos.x, m.pos.y, m.pos.z); } });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(SHOTS, step === 0 ? 'flush-day1.png' : 'flush-peak.png') });
      if (step !== 0) report.peakShot = true;
    }

    const mine = { day: d + 1, truePicked: 0 };
    if (d === 0) {
      // lookalikes are up first: inspect one and leave it
      if (await startInspect('false', 0)) { await doLeave(); tally.falseLeft++; }
    } else if (s.activeTrue > 0) {
      if (!report.truePick) {
        // first true morel: inspect, screenshot, cut it open to learn the tell
        if (await startInspect('true', 0)) {
          await page.screenshot({ path: path.join(SHOTS, '02-inspect-true-morel.png') });
          await doCut('03-cut-open-true-morel.png'); tally.trueCut++;
        }
        if (await startInspect('false', 0)) {
          await page.screenshot({ path: path.join(SHOTS, '04-inspect-false-morel.png') });
          await doCut('05-cut-open-false-morel.png'); tally.falseCut++;
        }
        report.truePick = true;
      }
      const picks = d === 9 ? 1 : 3;
      for (let k = 0; k < picks; k++) {
        const before = await page.evaluate(() => ctf.game.stats.trueGathered);
        if (await startInspect('true', k)) {
          await doPick();
          const after = await page.evaluate(() => ctf.game.stats.trueGathered);
          if (after === before + 1) { tally.truePicked++; mine.truePicked++; } else log('!! true pick did not increase basket');
        }
      }
      if (d === 6 && !tally.falsePicked) {
        // the mistake: pick a lookalike -> sick, tomorrow is lost
        if (await startInspect('false', 1)) {
          await page.screenshot({ path: path.join(SHOTS, '06-inspect-before-mistake.png') });
          await doPick(); tally.falsePicked++;
          const after = await page.evaluate(() => ({ sick: ctf.game.sickToday, skip: ctf.game.skipNext, lvl: ctf.game.sickLevel, vis: !document.getElementById('vignette-sick').classList.contains('hidden') }));
          report.checks.sickAfterFalsePick = after;
          await page.waitForTimeout(800);
          await page.screenshot({ path: path.join(SHOTS, '07-sick.png') });
        }
      }
      if (d === 8) { if (await startInspect('false', 0)) { await doLeave(); tally.falseLeft++; } }
    }
    tally.perDayTrue.push(mine);
    if (step === 4) { // notebook screenshot mid-season
      await press('KeyN'); await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, '08-notebook.png') });
      await press('KeyN'); await page.waitForTimeout(300);
    }
    await advance();
  }

  // --- summary screen vs ground truth
  await page.waitForSelector('#end-stats');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '09-end-summary.png') });
  const shown = await page.evaluate(() => ({
    true: document.getElementById('s-true').textContent, avoid: document.getElementById('s-avoid').textContent, mist: document.getElementById('s-mist').textContent,
    best: document.getElementById('s-best').textContent, missed: document.getElementById('s-missed').textContent, sick: document.getElementById('s-sick').textContent,
    score: document.getElementById('s-score').textContent, rows: document.querySelectorAll('table.tbl tbody tr').length,
  }));
  const st = await page.evaluate(() => ({ ...ctf.game.stats, perDay: undefined, days: ctf.game.stats.perDay.map((r) => ({ p: r.truePicked, sk: r.skipped })) }));
  const bestTrue = Math.max(...tally.perDayTrue.map((r) => r.truePicked));
  const bestDay = tally.perDayTrue.find((r) => r.truePicked === bestTrue);
  const expected = {
    true: tally.truePicked, avoid: tally.falseCut + tally.falseLeft, mist: tally.falsePicked, missed: tally.trueCut + tally.trueLeft, sick: tally.falsePicked ? 1 : 0,
  };
  report.summary = { shown, expected, daysPlayed: daySeq.map((d) => d + 1), flush };
  report.checks.summaryAccurate = shown.true == expected.true && shown.avoid == expected.avoid && shown.mist == expected.mist && shown.missed == expected.missed && shown.sick == expected.sick && shown.rows === 10;
  report.checks.bestDayMatches = shown.best.includes(`: ${bestTrue}`) || bestTrue === 0;
  report.checks.sickDayLost = report.sickCardSeen === true && daySeq.length === 9;
  const t = flush.map((f) => f.appearedTrue);
  report.checks.flushVaries = Math.max(...t) > 3 * (Math.min(...t) + 1) && t[0] === 0 && t[t.length - 1] < Math.max(...t) / 2;
  log('summary shown', JSON.stringify(shown), 'expected', JSON.stringify(expected));
  log('days played', daySeq.map((d) => d + 1).join(','), 'checks', JSON.stringify(report.checks));

  report.desktopLogs = logs;
  log('desktop console errors/warnings:', logs.length ? logs.join('\n') : 'none');
  await browser.close();
}

// ------------------------------------------------------------------ mobile
async function mobile() {
  const { browser, ctx, page, logs } = await launch({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  await bootGame(page);
  report.mobile = await page.evaluate(() => ({ touchClass: document.body.classList.contains('touch'), quality: ctf.quality.name, dpr: window.devicePixelRatio, pixelRatio: ctf.perf.pixelRatio, canvas: [ctf.renderer.domElement.width, ctf.renderer.domElement.height] }));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-00-intro.png') });
  await page.tap('#go-btn');
  await page.waitForFunction("ctf.game.phase==='playing'");
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const pos0 = await page.evaluate(() => ({ x: ctf.controls.pos.x, z: ctf.controls.pos.z, yaw: ctf.controls.yaw }));
  await touch('touchStart', [{ x: 90, y: 700, id: 1 }]);
  await touch('touchMove', [{ x: 90, y: 640, id: 1 }]);
  await page.waitForTimeout(900);
  await touch('touchEnd', []);
  const pos1 = await page.evaluate(() => ({ x: ctf.controls.pos.x, z: ctf.controls.pos.z, yaw: ctf.controls.yaw }));
  await touch('touchStart', [{ x: 300, y: 400, id: 2 }]);
  await touch('touchMove', [{ x: 360, y: 400, id: 2 }]);
  await touch('touchEnd', []);
  const pos2 = await page.evaluate(() => ({ yaw: ctf.controls.yaw }));
  report.mobile.moved = Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z);
  report.mobile.lookDelta = pos2.yaw - pos1.yaw;
  report.mobile.fps = await page.evaluate(() => ctf.measureFps(5));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-01-playing.png') });
  // inspect via the on-screen button
  await page.evaluate(() => { const g = ctf.game; for (let d = 1; d < 5; d++) g.spawnDay(d); });
  await page.evaluate(() => ctf.goTo(ctf.game.active.some((m) => m.kind === 'true') ? 'true' : 'false', 0));
  await page.waitForTimeout(400);
  const btnVisible = await page.evaluate(() => !document.getElementById('touch-inspect').classList.contains('hidden'));
  if (btnVisible) {
    await page.tap('#touch-inspect');
    await page.waitForFunction('ctf.inspect.active', null, { timeout: 5000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, 'mobile-02-inspect.png') });
    await page.tap('#act-cut');
    await page.waitForFunction("ctf.inspect.state==='cut'", null, { timeout: 8000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, 'mobile-03-cut.png') });
  }
  report.mobile.inspectButton = btnVisible;
  report.mobileLogs = logs;
  log('mobile', JSON.stringify(report.mobile), 'logs:', logs.length ? logs.join('\n') : 'none');
  await browser.close();
}

await ensureServer();
await desktop();
await mobile();
fs.writeFileSync(path.join(root, 'scratch', 'verify-report.json'), JSON.stringify(report, null, 2));
log('REPORT', JSON.stringify({ checks: report.checks, fps: report.fps, gpu: report.gpu }, null, 1));
if (server) server.kill();
process.exit(0);
