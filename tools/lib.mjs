import { chromium } from 'playwright-core';

export async function launch({ w = 1280, h = 720, touch = false } = {}) {
  const browser = await chromium.launch({
    channel: 'msedge', headless: false,
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'log' || process.env.ALLLOGS) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()}`));
  return { browser, page, logs };
}

export async function boot(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction("window.ctf && window.ctf.game.phase==='dayintro'", null, { timeout: 90000 });
}

export async function startDay(page) {
  await page.click('#go-btn');
  await page.waitForFunction("window.ctf.game.phase==='playing'");
}

export const shot = (page, path) => page.screenshot({ path });
