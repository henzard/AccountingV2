/* Playwright smoke: load the served web build, capture console + page errors,
 * screenshot, and dump visible text to see how far boot got. */
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.argv[2] || 'http://127.0.0.1:8080';
const OUT = process.argv[3] || '/tmp/pw';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const globSync = fs.globSync || null;
  let exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (!fs.existsSync(exe) && globSync) { const h = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome'); if (h && h[0]) exe = h[0]; }
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} :: ${r.failure() && r.failure().errorText}`));
  let navErr = null;
  try { await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }); } catch (e) { navErr = e.message; }
  await page.waitForTimeout(4000);
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '(no body)');
  const rootLen = await page.evaluate(() => (document.getElementById('root') || document.body).innerHTML.length).catch(() => 0);
  await page.screenshot({ path: `${OUT}/smoke.png`, fullPage: true }).catch(() => {});
  fs.writeFileSync(`${OUT}/smoke.log`, [`URL: ${URL}`,`navError: ${navErr}`,`rootHtmlLen: ${rootLen}`,`--- visibleText ---`,bodyText.slice(0,2000),`--- console/errors (${logs.length}) ---`,...logs].join('\n'));
  console.log(`navError=${navErr} rootHtmlLen=${rootLen} logs=${logs.length}`);
  console.log('VISIBLE TEXT:\n' + bodyText.slice(0, 600));
  console.log('\nERRORS:\n' + logs.slice(0, 30).join('\n'));
  await browser.close();
})();
