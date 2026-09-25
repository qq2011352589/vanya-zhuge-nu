import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('./vanya_诸葛连弩.mjs', import.meta.url), 'utf8');

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium-headless-shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage();

const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e).slice(0, 200)));

await page.goto('https://www.vanyaonline.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('页面已加载:', page.url());

// 模拟 Tampermonkey 的 @run-at document-idle：DOM 就绪后再注入
await page.addScriptTag({ content: SRC });
console.log('脚本已注入');

await page.waitForTimeout(3000); // 让 tick() 跑一轮

const r = await page.evaluate(() => {
  const out = { hasVANYA: typeof window.VANYA };
  if (!window.VANYA) return out;
  out.page = window.VANYA.page();
  out.state = window.VANYA.state();
  out.hp = window.VANYA.readHP();
  out.logs = window.VANYA.logTail(25);
  const scan = window.VANYA.scan();
  out.scan = { page: scan.page, hunting: scan.hunting, hp: scan.hp, missing: scan.missing, counts: scan.counts };
  return out;
});

console.log('\n=== 注入结果 ===');
console.log('VANYA 对象:', r.hasVANYA);
console.log('page() 判定:', r.page);
console.log('readHP():', JSON.stringify(r.hp));
console.log('state:', JSON.stringify(r.state));
console.log('\n=== scan 诊断 ===');
console.log('缺失项 missing:', JSON.stringify(r.scan && r.scan.missing));
if (r.scan && r.scan.counts) {
  const c = r.scan.counts;
  const hit = Object.keys(c).filter((k) => c[k] > 0);
  console.log('命中的选择器:', hit.join(', ') || '(无)');
}
console.log('\n=== 脚本日志 ===');
(r.logs || []).forEach((l) => console.log(' ', l));
console.log('\n=== 浏览器控制台（最近 10 条）===');
logs.slice(-10).forEach((l) => console.log(' ', l.slice(0, 150)));

await browser.close();
console.log('\n完成');
