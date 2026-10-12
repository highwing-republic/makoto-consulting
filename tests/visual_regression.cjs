#!/usr/bin/env node
/*
 * Screenshot and result-text regression check for refactoring work.
 *
 *   node tests/visual_regression.cjs capture SITE_DIR OUT_DIR
 *   node tests/visual_regression.cjs compare BEFORE_DIR AFTER_DIR
 *
 * SITE_DIR is a built site (for example `jekyll build -d _site`) or the
 * repository root. Every page is captured at four widths with external
 * requests blocked, so Google Analytics and web fonts never load and the
 * result is reproducible offline. `compare` exits non-zero when any
 * screenshot pixel or any captured result text differs.
 *
 * Requires Playwright with Chromium (set CHROMIUM_PATH to use a specific
 * binary). Output stays outside the repository.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const WIDTHS = { pc: [1440, 900], tablet: [768, 1024], m390: [390, 844], m360: [360, 780] };

// Tool states use the URL parameters the pages already accept, so the
// captured text covers each tool's calculated result, not only its empty form.
const PAGES = [
  '/',
  '/dx-diagnosis.html',
  '/inbound-analysis.html',
  '/inbound-analysis.html?pref=nagano',
  '/dx-necessity-analysis.html?pref=nagano',
  '/dx-necessity-analysis.html?pref=tokyo',
  '/supply-demand-gap-analysis.html?pref=okinawa',
  '/supply-demand-gap-analysis.html?pref=tokyo',
  '/tourism-pressure-analysis.html?pref=nagano',
  '/tourism-pressure-analysis.html?pref=okinawa',
  '/management-ai.html?pref=nagano&topic=dx',
  '/report.html',
  '/hotel-price-trends.html',
  '/hotel-price-trends.html?region=noboribetsu-onsen&hotel_no=9691&meal_type=two_meals',
  '/edinet-investment-radar/watch/',
  '/edinet-investment-radar/watch/stock.html?code=9901',
  '/classics-ai-management/',
  '/classics-ai-management/hanfeizi/',
  '/classics-ai-management/hanfeizi/shudo/',
  '/classics-ai-management/zhanguoce/',
  '/classics-ai-management/zhanguoce/kyutei/',
  '/classics-ai-management/sunzi/',
  '/classics-ai-management/sunzi/shikei/',
  '/demo/mini-pms/',
  '/demo/booking/',
  '/demo/hotel/',
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain',
};

const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

function loadPlaywright() {
  for (const name of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(name); } catch (error) { /* try the next location */ }
  }
  throw new Error('Playwright is required (npm install playwright).');
}

function serve(root) {
  const server = http.createServer((request, response) => {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.join(root, pathname);
    if (!file.startsWith(path.resolve(root))) { response.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function slug(page) {
  return page.replace(/^\//, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'home';
}

async function capture(siteDir, outDir) {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(outDir, { recursive: true });
  const server = await serve(path.resolve(siteDir));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const report = [];
  try {
    for (const [widthName, [width, height]] of Object.entries(WIDTHS)) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
      await context.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
      for (const pagePath of PAGES) {
        const page = await context.newPage();
        const errors = [];
        const missing = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('response', (response) => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url().replace(base, '')}`); });
        await page.goto(base + pagePath, { waitUntil: 'networkidle' });
        await page.addStyleTag({ content: FREEZE });
        await page.waitForTimeout(300);
        const facts = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          nav: Array.from(document.querySelectorAll('.site-header .global-nav a')).map((link) => `${link.textContent.trim()} ${link.getAttribute('href')}`),
          text: (document.querySelector('main') || document.body).innerText,
        }));
        const name = `${widthName}__${slug(pagePath)}`;
        await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
        report.push({ name, page: pagePath, width: widthName, errors, missing, overflow: facts.overflow, nav: facts.nav, text: facts.text });
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  const problems = report.filter((item) => item.errors.length || item.missing.length || item.overflow);
  problems.forEach((item) => console.log(`${item.name}: errors=${item.errors.length} missing=${item.missing.join(', ')} overflow=${item.overflow}`));
  console.log(`captured ${report.length} screenshots into ${outDir}; ${problems.length} with errors, 404s or horizontal overflow`);
}

async function compare(beforeDir, afterDir) {
  const { chromium } = loadPlaywright();
  const before = JSON.parse(fs.readFileSync(path.join(beforeDir, 'report.json'), 'utf-8'));
  const after = new Map(JSON.parse(fs.readFileSync(path.join(afterDir, 'report.json'), 'utf-8')).map((item) => [item.name, item]));
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  let failures = 0;
  try {
    for (const item of before) {
      const other = after.get(item.name);
      if (!other) { console.log(`${item.name}: missing after`); failures += 1; continue; }
      const notes = [];
      if (item.text !== other.text) notes.push('result text differs');
      if (JSON.stringify(item.nav) !== JSON.stringify(other.nav)) notes.push(`nav ${JSON.stringify(item.nav)} -> ${JSON.stringify(other.nav)}`);
      if (other.errors.length > item.errors.length) notes.push(`new JS errors: ${other.errors.join(' | ')}`);
      if (other.overflow && !item.overflow) notes.push('new horizontal overflow');
      const a = fs.readFileSync(path.join(beforeDir, `${item.name}.png`)).toString('base64');
      const b = fs.readFileSync(path.join(afterDir, `${item.name}.png`)).toString('base64');
      if (a !== b) {
        const diff = await page.evaluate(async ([left, right]) => {
          const load = (data) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = `data:image/png;base64,${data}`; });
          const [x, y] = await Promise.all([load(left), load(right)]);
          if (x.width !== y.width || x.height !== y.height) return `size ${x.width}x${x.height} -> ${y.width}x${y.height}`;
          const pixels = (image) => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return context.getImageData(0, 0, image.width, image.height).data; };
          const p = pixels(x); const q = pixels(y);
          let count = 0;
          for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) count += 1;
          return count ? `${count} pixels differ` : '';
        }, [a, b]);
        if (diff) notes.push(diff);
      }
      if (notes.length) { failures += 1; console.log(`${item.name}: ${notes.join('; ')}`); }
    }
  } finally {
    await browser.close();
  }
  console.log(`${before.length - failures} of ${before.length} captures identical`);
  process.exitCode = failures ? 1 : 0;
}

const [command, first, second] = process.argv.slice(2);
if (command === 'capture' && first && second) capture(first, second).catch((error) => { console.error(error); process.exit(2); });
else if (command === 'compare' && first && second) compare(first, second).catch((error) => { console.error(error); process.exit(2); });
else { console.error('usage: visual_regression.cjs capture SITE_DIR OUT_DIR | compare BEFORE_DIR AFTER_DIR'); process.exit(2); }
