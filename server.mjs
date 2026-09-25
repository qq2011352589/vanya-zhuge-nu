import { chromium } from 'playwright-core';
import { createServer } from 'http';
import { readFileSync, mkdirSync } from 'fs';

const PORT = Number(process.env.PORT || 8080);
const VW = 1024, VH = 700;
const PROFILE = new URL('./.profile/', import.meta.url).pathname;
const SRC = readFileSync(new URL('./vanya_诸葛连弩.mjs', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('./screen.html', import.meta.url), 'utf8');
mkdirSync(PROFILE, { recursive: true });

// 1. 持久化 profile：cookie / localStorage 跨重启保留，登录态不再丢
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: '/usr/bin/chromium-headless-shell',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--process-per-site',   // 同站点共享渲染进程，减少进程数和内存
    // 反风控：去掉 HeadlessChrome 标识与 navigator.webdriver 标志
    '--disable-blink-features=AutomationControlled',
    '--force-prefers-reduced-motion',   // 告知站点减少动画，配合 CSS 动画暂停
    '--remote-debugging-port=9223',   // 仅供本地 Profiler 诊断，只绑 localhost
  ],
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  viewport: { width: VW, height: VH },
});
const page = ctx.pages()[0] || await ctx.newPage();
page.on('pageerror', (e) => console.log('[页面错误]', String(e).slice(0, 150)));

// 启动导航带重试（站点偶发抖动不应让服务崩掉）
let navigated = false;
for (let i = 1; i <= 3 && !navigated; i++) {
  try {
    await page.goto('https://www.vanyaonline.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    navigated = true;
  } catch (e) {
    console.log('[导航失败 ' + i + '/3]', e.message.slice(0, 80), '→ 8s 后重试');
    await new Promise(r => setTimeout(r, 8000));
  }
}
if (!navigated) { console.error('站点连续不可达，退出（稍后可重启本服务）'); process.exit(1); }

// 2. 导航后自动重注入（模拟油猴行为：每次页面加载都注入一次）
let injecting = false;
async function ensureInjected(tag) {
  if (injecting) return;
  injecting = true;
  try {
    const has = await page.evaluate(() => typeof window.VANYA).catch(() => 'nav');
    if (has !== 'undefined') return; // 已注入或正在跳转
    await page.addScriptTag({ content: SRC });
    // 挂机不看动画：页面 3 个持续 CSS 动画是合成/光栅化 CPU 的最大头（GPU 进程 ~75%）
    await page.addStyleTag({ content:
      '*,*::before,*::after{animation-play-state:paused !important;transition:none !important;}'
    }).catch(() => {});
    console.log('[注入]', tag, '→', page.url().slice(0, 60));
  } catch (e) { console.log('[注入失败]', e.message.slice(0, 100)); }
  finally { injecting = false; }
}
page.on('load', () => setTimeout(() => ensureInjected('load'), 800));
page.on('domcontentloaded', () => setTimeout(() => ensureInjected('dcl'), 1500));
await ensureInjected('首次');

// 2.5 CPU 节流：页面自身的高频轮询/动画是 CPU 大头。挂机脚本 15s 一次 tick
// 不受影响（setInterval 间隔不变，回调本身轻量）；session 随跨进程导航失效，导航后重设。
let mgmt = null;
async function ensureThrottle() {
  if (mgmt) {
    try { await mgmt.send('Emulation.setCPUThrottlingRate', { rate: 8 }); return; }
    catch (e) { mgmt = null; }
  }
  try {
    mgmt = await ctx.newCDPSession(page);
    await mgmt.send('Emulation.setCPUThrottlingRate', { rate: 8 });
    console.log('[节流] 页面 CPU x8 已设置');
  } catch (e) {}
}
page.on('load', () => setTimeout(ensureThrottle, 600));
page.on('domcontentloaded', () => setTimeout(ensureThrottle, 1200));
await ensureThrottle();

// 3. screencast：按需推流——有人看才抓帧（空闲时 JPEG 编码是 CPU 大头），断流自愈
let lastFrame = null, frameTs = 0, cdp = null, castOn = false;
let streamConns = 0, lastShotAt = 0;
const IDLE_STOP_MS = 20000;

async function castStart(force) {
  if (castOn && !force) return;
  await castStop(true);
  try {
    cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', async (f) => {
      lastFrame = Buffer.from(f.data, 'base64');
      frameTs = Date.now();
      try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 45, maxWidth: 640, everyNthFrame: 2 });
    castOn = true;
    console.log('[推流] 开启（有观看者）→', page.url().slice(0, 60));
  } catch (e) { console.log('[推流失败]', e.message.slice(0, 100)); }
}
async function castStop(silent) {
  if (!castOn) return;
  try { await cdp.send('Page.stopScreencast'); } catch (e) {}
  try { await cdp.detach(); } catch (e) {}
  castOn = false; lastFrame = null;
  if (!silent) console.log('[推流] 停止（无人观看，省 CPU）');
}
// 守护：有观看者→保证推流在跑（含断流自愈）；没人看→缓冲 20s 后停掉
setInterval(() => {
  const active = streamConns > 0 || Date.now() - lastShotAt < 5000;
  const stale = Date.now() - frameTs > 6000;
  if (active && (!castOn || stale)) castStart(true);
  else if (!active && castOn && Date.now() - frameTs > IDLE_STOP_MS) castStop();
}, 4000);

// 4. 执行走 page.evaluate（playwright 自动做 session 迁移，跨进程导航也安全）
async function exec(code) {
  try {
    const v = await page.evaluate(code);
    return v === undefined ? '(无返回值)' : (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  } catch (e) { return '错误: ' + e.message.slice(0, 150); }
}

// 5. HTTP 服务
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

  if (u.pathname === '/stream.mjpg') {
    streamConns++;
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=--vframe',
      'Cache-Control': 'no-cache, no-store', 'Connection': 'keep-alive',
    });
    res.write('--vframe\r\n');
    const timer = setInterval(() => {
      if (!lastFrame) return;
      res.write('Content-Type: image/jpeg\r\nContent-Length: ' + lastFrame.length + '\r\n\r\n');
      res.write(lastFrame); res.write('\r\n--vframe\r\n');
    }, 400);
    req.on('close', () => { streamConns--; clearInterval(timer); });
    return;
  }

  // 单帧：MJPEG 不工作时的降级轮询源
  if (u.pathname === '/shot.jpg') {
    lastShotAt = Date.now();
    if (!lastFrame) { res.writeHead(503); return res.end('no frame yet'); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    return res.end(lastFrame);
  }

  if (u.pathname === '/api/exec') {
    const result = await exec(u.searchParams.get('c') || '');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, result: String(result).slice(0, 3000) }));
  }

  if (u.pathname === '/api/click') {
    const x = Number(u.searchParams.get('x')), y = Number(u.searchParams.get('y'));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await page.mouse.click(Math.round(x * VW), Math.round(y * VH)).catch(() => {});
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  res.writeHead(404); res.end('not found');
});
server.listen(PORT, '0.0.0.0', () =>
  console.log('面板 → http://0.0.0.0:' + PORT));

const shutdown = async () => {
  server.close();
  await ctx.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
