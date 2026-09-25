import { chromium } from 'playwright-core';

const EXE = '/usr/bin/chromium-headless-shell';

const browser = await chromium.launch({
  executablePath: EXE,
  args: [
    '--no-sandbox',            // root 运行必需
    '--disable-dev-shm-usage', // 容器 /dev/shm 只有 64MB，不加必崩
    '--disable-gpu',
  ],
});
console.log('浏览器已启动:', browser.version());

const page = await browser.newPage();
page.on('console', (m) => console.log('  [页面控制台]', m.text().slice(0, 160)));
page.on('pageerror', (e) => console.log('  [页面错误]', String(e).slice(0, 160)));

const resp = await page.goto('https://www.vanyaonline.com/', {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});

console.log('HTTP 状态:', resp && resp.status());
console.log('标题:', await page.title());
console.log('最终 URL:', page.url());
console.log('是否登录页:', page.url().includes('login'));

// 页面关键特征探测
const info = await page.evaluate(() => ({
  bodyLen: document.body ? document.body.innerText.length : 0,
  hasLoginForm: !!document.querySelector('#login_username'),
  buttons: Array.from(document.querySelectorAll('button,a.btn')).slice(0, 15)
    .map((e) => (e.innerText || '').trim().slice(0, 24)).filter(Boolean),
}));
console.log('页面探测:', JSON.stringify(info, null, 2));

await browser.close();
console.log('探针完成，浏览器已正常关闭');
