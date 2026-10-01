// Quick screenshot helper: node tools/shot.mjs <url> <out.png> [width] [height] [waitExpr]
import { chromium } from 'playwright-core';

const [url, out, w = '1280', h = '800', waitExpr = 'window.done===true'] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'msedge', headless: false,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(waitExpr, null, { timeout: 60000 }).catch((e) => logs.push('wait failed: ' + e.message));
await page.screenshot({ path: out });
console.log(logs.join('\n') || 'no console output');
console.log('buildMs', await page.evaluate(() => window.buildMs));
await browser.close();
