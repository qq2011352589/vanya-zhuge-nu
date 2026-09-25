// ==UserScript==
// @name         Vanya 挂机（宝箱 + 血线保护 · 强化版 v0.2 + UI）
// @namespace    vanya.auto
// @version      0.2.13
// @description  容错版：多语言文案兼容 + 多套选择器兜底 + 自诊断扫描 + 后台节流对抗 + 交互控制面板。右下角 ⚙ 打开面板。
// @match        https://www.vanyaonline.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/qq2011352589/vanya-zhuge-nu/main/vanya-zhuge-nu.user.js
// @downloadURL  https://raw.githubusercontent.com/qq2011352589/vanya-zhuge-nu/main/vanya-zhuge-nu.user.js
// ==/UserScript==

/* ============================================================================
 * v0.2.13：修正区域弹窗误判——弹窗是 position:fixed，visible() 的 offsetParent
 *           判据恒 null 导致「弹窗已开却报未打开」。startHunt 两处 waitFor 补上
 *           .explore-area-modal.is-open class 判定。
 * v0.2.12：开狩猎修复——实测站点委托 handler 就绪前 tile 点击无效（曾卡选区页
 *           数十分钟）。两道保险：①弹窗 8s 未响应则直接复刻 openAreaModal 激活；
 *           ②explore 页 normal 态带 20s 冷却重试开狩猎。
 * v0.2.11：状态机盲区修复——healing 状态下页面流落 dashboard 时（实测站点会把
 *           页面拉回 dashboard），dashboard 分支此前不处理 healing，导致卡死到
 *           看门狗。现在主动跳回 /pub 继续回血闭环；healTimeout 兜底也恢复有效。
 * v0.2.10：防重入——IIFE 开头检查 __VANYA_LIVE__ 标志，同一文档重复注入时
 *           直接返回，杜绝双实例双份定时器（实测日志成对、双 renderer 高 CPU 的根因）。
 * v0.2.9：两处收尾
 *          1) maxLife()：网络结果缓存 10 分钟。原先本地读不到生命上限时
 *             每个 tick(15s) 都 fetch('/dashboard') 拉整页，回血期间等于
 *             持续高频请求，有触发风控风险。
 *          2) closePassModal()：优先在 Demon Pass 容器内找弹窗。原先直接
 *             first(['.modal']) 取页面第一个 modal，存在其他弹窗时会误关；
 *             找不到时退回原行为，不退化。
 * v0.2.8：修复两处「静默失败」
 *          1) 宝箱：拼图失败文案（too short 等）原先被算进成功判定，
 *             返回 claimed → tick 清零 claimFail，实际没领到却持续漏领。
 *             现在失败文案单独识别为 failed，正常计入熔断自愈。
 *          2) Demon Pass：处理时覆盖的 window.confirm / window.alert 从不还原，
 *             导致之后整页所有原生弹窗都被自动确认。改为 try/finally 用完即还原。
 * v0.2.7：新增右下角交互控制面板（可折叠）
 *          - 参数可视化编辑（宝箱选择 / 血线 / 巡检间隔 / 抖动 / 开关）
 *          - 快捷操作（立即执行 / 诊断 / 领宝箱 / 人机验证 / 重置 / 清日志）
 *          - 状态显示 + 实时日志，不用开 F12
 *          - 自动重登凭据可视化配置
 * v0.2.6：酒馆回血前自动打开「开始训练」开关（#lite-auto-click）——用户实测发现
 *          不开训练血量就停在原地不动（之前 682/705 卡住的根因）。
 * v0.2.5：修复「登录后一直停在 dashboard 不去狩猎」——主页在待机态（mode=normal 且未狩猎）
 *          会自动置 starting 并跳 /actions/explore 开狩猎（可用 VANYA.cfg({autoStartHunt:false})
 *          关闭，改为纯领奖挂机）；狩猎页遇到残留 starting 状态直接复位。
 * v0.2.4：修复 Demon Pass 弹窗卡死（站点只认点击弹窗内 .close-btn，ESC 无效）。
 *          关闭流程改为：点 .close-btn → 等待确认关闭 → 3.5s 仍未关则强制隐藏。
 * v0.2.3：新增 Demon Pass 免费奖励自动领取（顶栏 .demon-pass-btn 开弹窗 →
 *          #btn-claim-all-free 显示 Claim All (N) 即点 → 验证变 All Claimed；
 *          覆盖 window.confirm/alert 防原生弹窗阻塞；15 分钟检查一次）。
 * v0.2.2：新增主页「每日幸运·幸运连签」自动领取（展开卡片 → 点 .ls-btn--claim
 *          → 按钮变「明天再来」即成功；每天只处理一次）。
 * v0.2.1：根据真实站点实测，把真实 id/class 提到选择器首位：
 *          #huntChest / #huntChestTimer / #huntChestModal / .hud-hp
 *
 * 用法
 *   粘贴到 Tampermonkey 新脚本保存即可，进 vanyaonline.com 自动注入。
 *   右下角 ⚙ 按钮打开控制面板（无需 F12）。
 *   控制台调试：
 *     VANYA.scan()             → 打印本页候选元素诊断
 *     VANYA.tick()             → 立即跑一轮
 *     VANYA.setCred(u,p)       → 写入自动重登凭据
 *     VANYA.cfg({tickMs:8000}) → 运行时改配置（持久化）
 *     VANYA.logTail(40)        → 查看最近日志
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__VANYA_LIVE__) return;   // v0.2.10 防重入：同一文档只允许一个实例（外层注入器可能重复注入）
  window.__VANYA_LIVE__ = 1;

  // ------------------------- 配置 -------------------------
  const DEFAULT_CFG = {
    choice: 'shadow',        // wealth | growth | shadow
    guardPct: 35,            // 血线保护阈值 %
    area: null,              // 指定区域 slug；null=自动挑等级最高的可用区域
    jitterMax: 60000,        // 宝箱就绪后随机延迟上限(ms)
    tickMs: 15000,           // 巡检间隔(ms)
    autoStartHunt: true,     // 主页待机时自动去开启狩猎
    claimFailBreak: 5,       // 连续领取失败熔断
    modeWatchdogMs: 15 * 60 * 1000, // 状态卡死看门狗阈值
    healTimeoutMs: 30 * 60 * 1000,  // 回血超时兜底
    autoRelogin: true,       // 会话失效时自动重登（需已 setCred）
    debug: false,            // 打开后控制台输出更啰嗦
  };
  const CFG_KEY = 'vanya_auto_cfg_v1';
  const CRED_KEY = 'vanya_auto_cred_v1';
  const LOG_KEY = 'vanya_auto_log';
  const KEY = 'vanya_auto_state_v1';
  const OPEN_KEY = 'vanya_auto_ui_open_v1';

  let CFG = Object.assign({}, DEFAULT_CFG);
  try { CFG = Object.assign(CFG, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}

  // ------------------------- 状态 / 存储 -------------------------
  const S = {
    all() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } },
    set(patch) { const s = Object.assign(this.all(), patch); s.ts = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} return s; },
    get(k, d) { const v = this.all()[k]; return v === undefined ? d : v; },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} },
  };
  const cred = () => { try { return JSON.parse(localStorage.getItem(CRED_KEY) || '{}'); } catch (e) { return {}; } };
  const setCred = (u, p) => { localStorage.setItem(CRED_KEY, JSON.stringify({ user: u, pass: p })); log('凭据已保存（仅存在本机 localStorage）'); };

  // ------------------------- 工具 -------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();
  const tx = (e) => { if (!e) return ''; const v = (e.innerText === undefined ? e.textContent : e.innerText); return v == null ? '' : String(v); };

  function first(sels, root = document) {
    for (const s of sels) { const e = root.querySelector(s); if (e) return e; }
    return null;
  }
  function allOf(sels, root = document) {
    const out = [];
    for (const s of sels) Array.prototype.push.apply(out, $$(s, root));
    return Array.from(new Set(out));
  }
  function byText(sels, words, root = document, exact = false) {
    const list = words.split('|').map((w) => w.toLowerCase());
    for (const e of allOf(sels, root)) {
      const t = lower(tx(e));
      if (!t || t.length > 60) continue;
      for (const w of list) {
        if (exact ? (t === w) : t.includes(w)) return e;
      }
    }
    return null;
  }

  // ------------------------- 日志（含 UI 订阅）-------------------------
  const logSubs = [];   // UI 订阅回调；必须声明在 log() 之前
  let hudSink = null;   // 由 UI 面板接管的实时状态行
  function hud(line) { if (hudSink) { try { hudSink(line); } catch (e) {} } }

  function log(...a) {
    const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    const stamp = new Date().toLocaleTimeString();
    try { console.log('%c[Vanya]', 'color:#7cf', ...a); } catch (e) {}
    try {
      const buf = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      buf.push(stamp + ' ' + line);
      localStorage.setItem(LOG_KEY, JSON.stringify(buf.slice(-200)));
    } catch (e) {}
    hud(line);
    for (const f of logSubs) { try { f(stamp + ' ' + line); } catch (e) {} }
  }
  function dbg(...a) { if (CFG.debug) log('·', ...a); }

  function waitFor(fn, timeout = 20000, step = 300) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function loop() {
        let v = null; try { v = fn(); } catch (e) {}
        if (v) return resolve(v);
        if (Date.now() - t0 >= timeout) return resolve(null);
        setTimeout(loop, step);
      })();
    });
  }
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];

  // ------------------------- 后台节流对抗 -------------------------
  let workerTick = null;
  function startHeartbeat(cb) {
    try {
      const src = 'let id=null;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(1),e.data)};';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
      w.onmessage = () => { try { cb(); } catch (e) {} };
      w.postMessage(CFG.tickMs);
      workerTick = w;
    } catch (e) { dbg('worker 心跳不可用（忽略）'); }
  }

  // ------------------------- 页面判定 -------------------------
  function page() {
    const p = location.pathname;
    if (p.includes('human_check') || $('.puzzle-hole')) return 'human';
    if (p.includes('login') || $('#login_username')) return 'login';
    if (p.includes('/actions/hunt')) return 'hunt';
    if (p.includes('/actions/explore')) return 'explore';
    if (p.startsWith('/pub') || $('.pub-resource-label, .pub-heal')) return 'pub';
    if (p.includes('/dashboard') || $('.dashboard-resource-life')) return 'dashboard';
    if (p === '/' || p === '/index' || p.startsWith('/index')) return 'index';
    return 'other';
  }

  // ------------------------- 选择器集合 -------------------------
  const SEL = {
    hp: ['.hud-hp', '.hp-value', '.hunt-hp', '[class*="hp-value"]', '[class*="health"]', '.stat-hp'],
    maxLife: ['[class*="dashboard-resource-life"]', '[class*="resource-life"]', '.dashboard-life'],
    chest: ['#huntChest', '[class*="hunt-chest"]', '.chest', '[class*="chest"]'],
    chestReady: ['#huntChest.hunt-chest-ready', '[class*="hunt-chest"][class*="ready"]', '.chest.hunt-chest-ready', '[class*="chest"][class*="ready"]'],
    chestTimer: ['#huntChestTimer', '[class*="chest"][class*="timer"]', '.hunt-chest-timer'],
    modal: ['#huntChestModal', '[class*="hunt-chest-modal"]', '[class*="chest-modal"]', '.modal.is-open', '[class*="modal"][class*="chest"]'],
    choice: ['[class*="hunt-chest-choice"]', '[class*="chest-choice"]'],
    result: ['[class*="hunt-chest-result"]', '[class*="chest-result"]'],
    shield: ['[class*="hunt-chest-shield"]', '[class*="chest-shield"]'],
    verify: ['[class*="shield-verify"]', '[class*="chest-verify"]'],
    close: ['[class*="result-close"]', '[class*="chest-close"]', '[class*="modal-close"]'],
    hole: ['[class*="puzzle-hole"]', '[class*="chest-puzzle-hole"]'],
    piece: ['[class*="puzzle-piece"]', '[class*="chest-puzzle-piece"]'],
    stop: ['.stop-button', '[class*="stop-button"]', '[class*="end-hunt"]', '[class*="leave-hunt"]'],
    dailyClaim: ['.ls-btn--claim', '[class*="ls-btn--claim"]', '[class*="claim"][class*="ls-"]'],
    dailyToggle: ['.dashboard-daily-toggle', '[class*="daily-toggle"]'],
    dpOpen: ['.demon-pass-btn', '[class*="demon-pass-btn"]'],
    dpClaimFree: ['#btn-claim-all-free', '[id*="claim-all-free"]', '[class*="claim-all-btn"]'],
    pubTrain: ['#lite-auto-click', '.pub-auto-hit-box input[type="checkbox"]', '[class*="auto-click"]'],
    pubLife: ['[class*="pub-resource-label"]', '[class*="resource-label"]', '.chip-stat'],
    tile: ['[class*="explore-area-tile"]', '[class*="area-tile"]'],
    areaModal: ['[class*="explore-area-modal"]', '[class*="area-modal"]'],
    button: ['button', 'a.btn', 'a[role="button"]', '.btn'],
  };

  const WORD = {
    hunt: '狩猎|hunt|start hunting|begin hunt|猎',
    stop: '停止|结算|stop|leave|end hunt|retreat|离开',
    verify: '验证|确认|verify|confirm|submit',
    login: '登录|log in|login|sign in',
    life: '生命|health|life|hp',
  };

  // ------------------------- 读取 -------------------------
  const visible = (e) => { if (!e) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.offsetParent !== null; };

  function huntHP() {
    for (const e of allOf(SEL.hp)) {
      const m = norm(tx(e)).match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
      if (m) return [parseInt(m[1].replace(/,/g, '')), parseInt(m[2].replace(/,/g, ''))];
    }
    const cand = $$('[class*="hp"], [class*="health"], [class*="life"]');
    for (const e of cand) {
      const m = norm(tx(e)).match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
      if (m) return [parseInt(m[1].replace(/,/g, '')), parseInt(m[2].replace(/,/g, ''))];
    }
    return null;
  }

  function pubLife() {
    for (const l of allOf(SEL.pubLife)) {
      const t = tx(l);
      if (!new RegExp(WORD.life.split('|').join('|'), 'i').test(t)) continue;
      let container = l.parentElement;
      for (let i = 0; i < 3 && container; i++) {
        const scopes = [container.querySelector('[class*="value"]'), container];
        for (const sc of scopes) {
          if (!sc) continue;
          const m = norm(tx(sc)).match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
          if (m) return [parseInt(m[1].replace(/,/g, '')), parseInt(m[2].replace(/,/g, ''))];
          const m2 = norm(tx(sc)).replace(new RegExp(WORD.life.split('|').join('|'), 'i'), '').match(/(\d[\d,]*)/);
          if (m2) return [parseInt(m2[1].replace(/,/g, '')), null];
        }
        container = container.parentElement;
      }
    }
    return null;
  }

  // v0.2.9：fetch 结果缓存 10 分钟。原先本地读不到上限时每个 tick(15s) 都会
  // fetch('/dashboard') 拉整页 HTML，回血期间等于持续高频请求，有风控风险。
  let maxLifeCache = { v: null, at: 0 };
  async function maxLife() {
    const local = (() => {
      for (const e of allOf(SEL.maxLife)) {
        const m = norm(tx(e)).match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
        if (m) return parseInt(m[2].replace(/,/g, ''));
      }
      return null;
    })();
    if (local) return local;
    if (maxLifeCache.v && Date.now() - maxLifeCache.at < 10 * 60 * 1000) return maxLifeCache.v;
    try {
      const html = await (await fetch('/dashboard', { credentials: 'same-origin' })).text();
      const pats = [
        /dashboard-resource-life[\s\S]{0,700}?(\d[\d,]*)\s*\/\s*(\d[\d,]*)/,
        /life[\s\S]{0,300}?(\d[\d,]*)\s*\/\s*(\d[\d,]*)/i,
      ];
      for (const re of pats) {
        const m = html.match(re);
        if (m) {
          const v = parseInt(m[2].replace(/,/g, ''));
          maxLifeCache = { v: v, at: Date.now() };
          S.set({ maxLife: v });
          return v;
        }
      }
    } catch (e) {}
    return S.get('maxLife', null);
  }

  const isHunting = () => location.pathname.indexOf('/actions/hunt') >= 0 && !!first(SEL.hp);

  // ------------------------- 宝箱 / 拼图 -------------------------
  const modalOpen = () => allOf(SEL.modal).some(visible);
  function modalPhase() {
    if (!modalOpen()) return 'none';
    const r = first(SEL.result);
    if (r && visible(r)) return 'result';
    if (first(SEL.shield) && visible(first(SEL.shield))) return 'shielding';
    if (first(SEL.choice) && visible(first(SEL.choice))) return 'choice';
    return 'unknown';
  }
  function fireMouse(type, x, y, buttons) {
    const t = document.elementFromPoint(x, y) || document;
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: buttons, detail: 1 };
    try { t.dispatchEvent(new PointerEvent(type.replace('mouse', 'pointer'), Object.assign({}, base, { pointerId: 1, pointerType: 'mouse', isPrimary: true }))); } catch (e) {}
    t.dispatchEvent(new MouseEvent(type, base));
  }
  async function dragTo(ax, ay, bx, by, steps = 18) {
    fireMouse('mousemove', ax, ay, 0);
    await sleep(50 + rand(60));
    fireMouse('mousedown', ax, ay, 1);
    await sleep(80 + rand(60));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const jitter = (Math.random() - 0.5) * 3;
      fireMouse('mousemove', ax + (bx - ax) * t + jitter, ay + (by - ay) * t + jitter, 1);
      await sleep(18 + rand(14));
    }
    await sleep(90);
    fireMouse('mouseup', bx, by, 0);
  }
  function grab(sels) {
    return allOf(sels).filter(visible).map((e) => {
      const r = e.getBoundingClientRect();
      const m = (e.className || '').toString().match(/shape-(\w+)/i);
      return { el: e, shape: m ? m[1] : null, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  }
  async function solveShield(rounds = 3) {
    for (let r = 0; r < rounds; r++) {
      const holes = grab(SEL.hole);
      const pieces = grab(SEL.piece);
      if (!holes.length || !pieces.length) { dbg('拼图元素缺失', holes.length, pieces.length); return false; }
      const pool = pieces.slice();
      for (const h of holes) {
        let i = h.shape ? pool.findIndex((p) => p.shape === h.shape) : -1;
        if (i < 0) i = 0;
        const p = pool.splice(i, 1)[0];
        if (!p) break;
        await dragTo(p.x, p.y, h.x, h.y);
        await sleep(260 + rand(200));
      }
      const v = first(SEL.verify) || byText(SEL.button, WORD.verify);
      if (v) v.click();
      const ok = await waitFor(() => modalPhase() !== 'shielding', 10000);
      if (ok) return true;
      await sleep(800);
    }
    return false;
  }

  // ------------------------- 动作：领宝箱 -------------------------
  async function claimChest() {
    if (!modalOpen()) {
      const chest = first(SEL.chestReady) || allOf(SEL.chest).find((e) => /ready|打开|open|claim/i.test(e.className + ' ' + tx(e)));
      if (!chest) return 'notready';
      chest.click();
      await waitFor(modalOpen, 8000);
      if (!modalOpen()) { chest.dispatchEvent(new MouseEvent('click', { bubbles: true })); await waitFor(modalOpen, 5000); }
    }
    if (!modalOpen()) return 'no-modal';

    if (modalPhase() === 'choice') {
      const want = '.' + CFG.choice;
      const c = first([want].concat(SEL.choice.map((s) => s + want))) || allOf(SEL.choice)[rand(Math.max(1, allOf(SEL.choice).length))];
      if (!c) return 'no-choice';
      c.click();
      await waitFor(() => ['shielding', 'result'].includes(modalPhase()), 20000);
    }
    if (modalPhase() === 'shielding') await solveShield(3);

    let result = await waitFor(() => {
      const r = first(SEL.result);
      if (!r || !visible(r)) return null;
      const txt = norm(tx(r)) || '';
      // v0.2.8：拼图失败文案单独识别，不再混进成功判定（否则会静默漏领）
      if (/too short|too fast|太短|try again|failed/i.test(txt)) return 'FAIL:' + txt;
      return (/[\d][\d,]*\s*(?:Gold|EXP|gold|exp)/.test(txt) || /稀有|额外|bonus|reward/i.test(txt)) ? txt : null;
    }, 25000);
    if (!result) { const r = first(SEL.result); result = r ? norm(tx(r)) : null; }
    if (result && /too short|too fast|太短|try again|failed/i.test(String(result))) {
      return 'failed: 拼图未通过（' + String(result).slice(0, 60) + '）';
    }

    const close = first(SEL.close) || byText(SEL.button, '关闭|领取|close|collect|ok');
    if (close) close.click(); else { try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {} }
    await sleep(900);
    return result ? ('claimed: ' + result.slice(0, 160)) : 'no-result';
  }

  // ------------------------- 动作：每日幸运 -------------------------
  async function claimDaily() {
    const today = new Date().toDateString();
    if (S.get('dailyClaimDate') === today) return false;
    const card = $('[data-dashboard-card-part="login-streak"]') || first(SEL.dailyClaim);
    if (!card) return false;
    const tg = first(SEL.dailyToggle);
    if (tg) { try { tg.click(); } catch (e) {} await sleep(600); }
    const b = first(SEL.dailyClaim);
    if (!b) { dbg('每日幸运：找不到领取按钮'); return false; }
    if (b.disabled || b.getAttribute('aria-disabled') === 'true' || /明天再来|tomorrow|come back/i.test(tx(b))) {
      S.set({ dailyClaimDate: today });
      dbg('每日幸运：今日已领取');
      return false;
    }
    b.click();
    await sleep(2200);
    const b2 = first(SEL.dailyClaim);
    const done = b2 && (b2.disabled || b2.getAttribute('aria-disabled') === 'true' || /明天再来|tomorrow/i.test(tx(b2)));
    S.set({ dailyClaimDate: today });
    log('每日幸运: ' + (done ? '已领取 ✓' : '已点击（结果未确认，明天会重试）'));
    if (!done) S.set({ dailyClaimDate: '' });
    return done;
  }

  // ------------------------- 动作：Demon Pass -------------------------
  async function claimDemonPass() {
    const now = Date.now();
    if (now - S.get('dpCheckAt', 0) < 15 * 60 * 1000) return false;
    S.set({ dpCheckAt: now });
    const openBtn = first(SEL.dpOpen);
    if (!openBtn) { dbg('Demon Pass：找不到入口按钮'); return false; }
    const _confirm = window.confirm, _alert = window.alert;
    try {
      window.confirm = function () { log('Demon Pass: confirm 自动确认 → ' + (arguments[0] || '').slice(0, 80)); return true; };
      window.alert = function (m) { log('Demon Pass: ' + (m || '').slice(0, 100)); };
    } catch (e) {}
    let done = false;
    try {
      openBtn.click();
      const b = await waitFor(() => first(SEL.dpClaimFree), 8000);
      if (!b) { dbg('Demon Pass：弹窗未打开'); await closePassModal(); return false; }
      const txt = tx(b);
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') { dbg('Demon Pass: ' + norm(txt).slice(0, 40)); await closePassModal(); return false; }
      if (!/\(\s*[1-9]/.test(txt)) { dbg('Demon Pass: ' + (norm(txt).slice(0, 40) || '无可领')); await closePassModal(); return false; }
      b.click();
      await sleep(2500);
      const b2 = first(SEL.dpClaimFree);
      done = !!(b2 && (b2.disabled || /all claimed|\(0\)/i.test(tx(b2))));
      log('Demon Pass: ' + (done ? '免费奖励已领取 ✓' : '已点击（结果未确认，下轮重试）'));
      if (!done) S.set({ dpCheckAt: 0 });
      await closePassModal();
    } finally {
      // v0.2.8：用完立即还原，避免污染整页原生弹窗
      try { window.confirm = _confirm; window.alert = _alert; } catch (e) {}
    }
    return done;
  }
  async function closePassModal() {
    // v0.2.9：优先在 Demon Pass 容器内找弹窗，原先直接 first(['.modal']) 取页面
    // 第一个 modal，若此时存在其他弹窗会误关。找不到时退回原行为，不退化。
    const scope = first([
      '[class*="demon-pass-modal"]',
      '[id*="demon-pass"]',
      '[class*="demon-pass"]:not(.demon-pass-btn)',
    ]);
    const pick = () => {
      if (scope) {
        const inScope = (scope.classList && scope.classList.contains('modal')) ? scope : scope.querySelector('.modal');
        if (inScope) return inScope;
      }
      return first(['.modal']);
    };
    const isOpen = () => {
      const m = pick();
      return !!(m && getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().width > 0);
    };
    if (!isOpen()) return true;
    const m = pick();
    const c = m.querySelector('.close-btn') || m.querySelector('[class*="close"]');
    if (c) { try { c.click(); } catch (e) {} }
    dispatchEscape();
    const closed = await waitFor(() => !isOpen(), 3500, 250);
    if (!closed) {
      try { const m2 = pick(); if (m2) m2.style.display = 'none'; } catch (e) {}
      log('Demon Pass: 弹窗未能正常关闭，已强制隐藏');
    }
    return true;
  }
  function dispatchEscape() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
    } catch (e) {}
  }

  // ------------------------- 动作：血线保护 -------------------------
  async function maybeGuard() {
    const hp = huntHP();
    if (!hp) return false;
    const [cur, max] = hp;
    if (!max) return false;
    if (cur * 100 / max >= CFG.guardPct) return false;
    const last = S.get('guardAt', 0);
    if (Date.now() - last < 60000) { dbg('结算冷却中，跳过'); return false; }
    log('血线告警 ' + cur + '/' + max + '，触发止损…');
    S.set({ mode: 'guard', guardAt: Date.now(), maxLife: max });
    const stop = first(SEL.stop) || byText(SEL.button, WORD.stop);
    if (stop) { stop.click(); return true; }
    log('找不到结算按钮（可能没在狩猎）');
    S.set({ mode: 'normal' });
    return false;
  }

  // ------------------------- 动作：回血 → 重开 -------------------------
  async function pubHeal() {
    const tr = first(SEL.pubTrain);
    if (tr && !tr.checked) {
      tr.click();
      log('已开启酒馆训练（开始训练开关）');
      await sleep(800);
    }
    const mx = (await maxLife()) || S.get('maxLife', 0) || 810;
    S.set({ maxLife: mx });
    const read = pubLife();
    const cur = read ? read[0] : null;
    const mxNow = read && read[1] ? read[1] : mx;
    log('回血中 ' + cur + '/' + mxNow);
    if (cur !== null && cur >= mxNow) {
      log('已满血，去重开狩猎…');
      S.set({ mode: 'starting' });
      location.href = 'https://www.vanyaonline.com/actions/explore';
      return true;
    }
    const t0 = S.get('healSince', Date.now());
    S.set({ healSince: t0 });
    if (Date.now() - t0 > CFG.healTimeoutMs) {
      log('回血超时，直接进入狩猎流程');
      S.set({ mode: 'starting' });
      location.href = 'https://www.vanyaonline.com/actions/explore';
      return true;
    }
    return false;
  }

  async function startHunt() {
    log('开始狩猎…');
    let tiles = allOf(SEL.tile).map((e) => {
      const opener = e.hasAttribute('data-area-modal-open') ? e : $('[data-area-modal-open]', e) || e;
      const attr = opener.getAttribute('data-area-modal-open') || '';
      const m = norm(tx(e)).match(/Lv\s*(\d+)\s*\+?/i) || opener.className.match(/lv-?(\d+)/i);
      const r = e.getBoundingClientRect();
      return {
        el: opener, slug: attr.replace(/^explore-area-modal-/, ''),
        lv: m ? parseInt(m[1]) : 0,
        locked: /locked|锁定/i.test(e.className + ' ' + tx(e)),
        x: r.x + r.width / 2, y: r.y + r.height / 2,
      };
    }).filter((t) => t.el);

    let chosen = null;
    if (CFG.area) chosen = tiles.find((t) => t.slug === CFG.area) || null;
    if (!chosen) {
      const ok = tiles.filter((t) => !t.locked);
      if (ok.length) chosen = ok.slice().sort((a, b) => b.lv - a.lv)[0];
      else if (tiles.length) { log('所有区域都判为锁定，尝试第一个'); chosen = tiles[0]; }
    }
    if (!chosen) { log('找不到可用区域 → 自诊断输出见 VANYA.scan()'); S.set({ mode: 'normal' }); return; }
    log('选区域: ' + (chosen.slug || '(未知)') + ' Lv' + chosen.lv);

    try { chosen.el.click(); } catch (e) { fireMouse('mousedown', chosen.x, chosen.y, 1); fireMouse('mouseup', chosen.x, chosen.y, 0); }
    let modal = await waitFor(() => allOf(SEL.areaModal).find(visible) || $('.modal.is-open') || document.querySelector('.explore-area-modal.is-open'), 8000);
    if (!modal) {
      // v0.2.12: 站点委托 handler 就绪前点击不生效——直接复刻其 openAreaModal 激活弹窗
      log('区域弹窗未响应，直接激活…');
      const mm = document.getElementById('explore-area-modal-' + chosen.slug);
      if (mm) {
        mm.classList.add('is-open');
        mm.setAttribute('aria-hidden', 'false');
        document.body.classList.add('explore-modal-open');
      }
      modal = await waitFor(() => allOf(SEL.areaModal).find(visible) || $('.modal.is-open') || document.querySelector('.explore-area-modal.is-open'), 5000);
    }
    if (!modal) { log('区域弹窗未打开'); S.set({ mode: 'normal' }); return; }
    const btn = await waitFor(() => byText(['button', 'a'], WORD.hunt, modal), 5000);
    if (!btn) { log('弹窗中找不到「狩猎」按钮（中英都试过）'); S.set({ mode: 'normal' }); return; }
    btn.click();
    const entered = await waitFor(() => location.pathname.includes('/actions/hunt'), 15000);
    S.set({ mode: 'normal' });
    log(entered ? '已进入狩猎页' : '未进入狩猎页（可能要人工确认）');
  }

  // ------------------------- 人机验证 -------------------------
  async function solveHumanCheck() {
    log('撞上人机验证，尝试自动解…');
    for (let r = 0; r < 3; r++) {
      const p = grab(SEL.piece)[0], h = grab(SEL.hole)[0];
      if (!p || !h) { await sleep(1000); continue; }
      await dragTo(p.x, p.y, h.x, h.y, 20);
      await sleep(600);
      const v = byText(['button', 'a'], WORD.verify);
      if (v) v.click();
      await sleep(2200);
      if (!location.pathname.includes('human_check') && !$('.puzzle-hole')) { log('人机验证已通过'); return true; }
    }
    log('人机验证未能自动通过，请人工点一下');
    return false;
  }

  // ------------------------- 登录 -------------------------
  async function autoLogin() {
    const c = cred();
    if (!CFG.autoRelogin || !c.user || !c.pass) {
      log('未配置自动重登凭据，跳过。可用面板或 VANYA.setCred(用户,密码) 设置');
      return false;
    }
    if (!$('#login_username')) { location.href = 'https://www.vanyaonline.com/login'; return true; }
    log('会话失效，自动登录…');
    const setVal = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    ['#vanyaEntryClose', '#vanyaEntryLogin'].forEach((s) => { const b = $(s); if (b) try { b.click(); } catch (e) {} });
    const cb = $('.cookie-btn'); if (cb) try { cb.click(); } catch (e) {}
    const tab = $('#tabLogin'); if (tab) try { tab.click(); } catch (e) {}
    await sleep(400);
    const u = $('#login_username'), p = $('#login_password');
    if (!u || !p) return false;
    setVal(u, c.user); setVal(p, c.pass);
    await sleep(300);
    const f = $('form.auth-form[action="login"]') || $('form[action*="login"]') || $('form.auth-form');
    if (f) {
      const b = f.querySelector('button[type=submit]') || byText(['button'], WORD.login, f);
      if (b) b.click(); else { try { f.submit(); } catch (e) {} }
    }
    await sleep(4000);
    return true;
  }

  // ------------------------- 看门狗 -------------------------
  function watchdog() {
    const st = S.all();
    if (st.mode && st.mode !== 'normal' && st.mode !== 'healing' && Date.now() - (st.ts || 0) > CFG.modeWatchdogMs) {
      log('状态 ' + st.mode + ' 卡住超时，复位为 normal');
      S.set({ mode: 'normal', healSince: Date.now() });
    }
  }

  // ------------------------- 自诊断 -------------------------
  function scan() {
    const pg = page();
    const rep = {
      url: location.href, page: pg, hunting: isHunting(),
      hp: huntHP(), maxLife: null,
      counts: {}, found: {}, missing: [],
      chestClasses: [], texts: [],
    };
    for (const k of Object.keys(SEL)) rep.counts[k] = allOf(SEL[k]).length;
    rep.found = {
      hp: !!first(SEL.hp), chest: !!first(SEL.chest), chestReady: !!first(SEL.chestReady),
      modal: !!first(SEL.modal), stop: !!first(SEL.stop) || !!byText(SEL.button, WORD.stop),
      tile: allOf(SEL.tile).length, pubLife: !!first(SEL.pubLife),
    };
    for (const k of Object.keys(rep.found)) if (!rep.found[k]) rep.missing.push(k);
    rep.chestClasses = allOf(SEL.chest).slice(0, 12).map((e) => (e.className || '').toString().slice(0, 80));
    rep.texts = $$('button,a.btn,.btn').slice(0, 40).map((e) => norm(tx(e)).slice(0, 30)).filter(Boolean);
    maxLife().then((mx) => { rep.maxLife = mx; console.log('%c[Vanya.scan]', 'color:#7cf', rep); });
    console.log('%c[Vanya.scan]（maxLife 异步稍后补）', 'color:#7cf', rep);
    return rep;
  }

  // ------------------------- 调度 -------------------------
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      watchdog();
      const pg = page();
      dbg('tick page=' + pg);
      if (pg === 'login' || /error=unauthorized|session.*expired/i.test(location.href)) {
        await autoLogin();
      } else if (pg === 'human') {
        await solveHumanCheck();
      } else if (pg === 'hunt') {
        if (S.get('mode') === 'starting') S.set({ mode: 'normal' });
        if (await maybeGuard()) return;
        if (first(SEL.chestReady) || allOf(SEL.chest).some((e) => /ready/i.test(e.className))) {
          if (S.get('claimUnlockAt', 0) > Date.now()) hud('宝箱就绪，冷却中');
          else {
            const delay = rand(Math.max(1000, CFG.jitterMax));
            log('宝箱就绪，随机延后 ' + Math.round(delay / 1000) + 's');
            await sleep(delay);
            const r = await claimChest();
            log('领取结果: ' + r);
            if (String(r).indexOf('claimed') === 0) S.set({ claimFail: 0, claimUnlockAt: Date.now() + 1000 });
            else {
              const f = S.get('claimFail', 0) + 1;
              S.set({ claimFail: f });
              if (f >= CFG.claimFailBreak) {
                log('连续 ' + f + ' 次失败 → 自愈');
                if (CFG.autoRelogin) await autoLogin();
                S.set({ claimFail: 0 });
              }
            }
          }
        } else {
          const t = first(SEL.chestTimer);
          hud('狩猎中，等宝箱冷却' + (t ? '（' + norm(tx(t)) + '）' : ''));
        }
      } else if (pg === 'dashboard') {
        if (S.get('mode') === 'healing') { log('回血中流落 dashboard，回酒馆…'); S.set({ mode: 'healing' }); location.href = 'https://www.vanyaonline.com/pub'; return; }
        await claimDaily();
        await claimDemonPass();
        if (CFG.autoStartHunt && S.get('mode', 'normal') === 'normal' && Date.now() - S.get('autoStartAt', 0) > 5 * 60 * 1000) {
          S.set({ mode: 'starting', autoStartAt: Date.now() });
          log('主页待机，自动去开启狩猎…');
          location.href = 'https://www.vanyaonline.com/actions/explore';
          return;
        }
        if (S.get('mode') === 'guard') { log('结算完成，去酒馆回血…'); S.set({ mode: 'healing', healSince: Date.now() }); location.href = 'https://www.vanyaonline.com/pub'; return; }
      } else if (pg === 'pub') {
        const m = S.get('mode');
        if (m === 'guard') { S.set({ mode: 'healing', healSince: Date.now() }); await pubHeal(); }
        else if (m === 'healing') await pubHeal();
      } else if (pg === 'explore') {
        const m2 = S.get('mode');
        if (m2 === 'starting') await startHunt();
        else if (m2 === 'normal' && CFG.autoStartHunt && Date.now() - S.get('huntRetryAt', 0) > 20000) {
          S.set({ huntRetryAt: Date.now(), mode: 'starting' });
          log('选区页重试开狩猎…');
          await startHunt();
        }
      } else if (pg === 'index') {
        const m = S.get('mode', 'normal');
        if (m === 'normal') location.href = 'https://www.vanyaonline.com/actions/explore';
      }
    } catch (e) { log('异常: ' + (e && e.message ? e.message : e)); }
    finally { busy = false; }
  }

  // SPA 软跳转也要触发调度
  (function hookHistory() {
    const push = history.pushState;
    history.pushState = function () { const r = push.apply(this, arguments); setTimeout(tick, 600); return r; };
    window.addEventListener('popstate', () => setTimeout(tick, 600));
  })();

  // ------------------------- 对外调试接口 -------------------------
  window.VANYA = {
    scan, tick, setCred, log,
    cfg(patch) { CFG = Object.assign(CFG, patch || {}); try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) {} log('配置已更新'); return CFG; },
    state: () => S.all(),
    reset() { S.clear(); log('状态已清空'); },
    logTail(n = 40) { const b = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); console.log(b.slice(-n).join('\n')); return b.slice(-n); },
    page, claimChest, startHunt, pubHeal, solveHumanCheck, claimDaily, claimDemonPass,
    readHP: huntHP, readPubLife: pubLife, readMaxLife: maxLife,
    setState(patch) { S.set(patch || {}); return S.all(); },
  };

  // ------------------------- 交互面板 -------------------------
  let mainTimer = null;
  function startTimer() {
    if (mainTimer) clearInterval(mainTimer);
    mainTimer = setInterval(tick, Math.max(1000, CFG.tickMs));
  }

  const UI = (function () {
    let root = null, panel = null, toggleEl = null, statusEl = null, logEl = null, open = false;

    const mk = (tag, css, text) => {
      const e = document.createElement(tag);
      if (css) e.style.cssText = css;
      if (text != null) e.textContent = text;
      return e;
    };
    const btn = (text, onClick, css) => {
      const b = mk('button', 'cursor:pointer;background:#22364a;color:#d6e6f2;border:1px solid #33506b;border-radius:4px;padding:3px 9px;font:inherit;transition:background .12s;' + (css || ''), text);
      b.addEventListener('mouseenter', () => { b.style.background = '#2d4762'; });
      b.addEventListener('mouseleave', () => { b.style.background = '#22364a'; });
      b.addEventListener('click', (e) => { e.preventDefault(); try { onClick(e); } catch (err) { console.log('[Vanya UI]', err); } });
      return b;
    };
    const row = (label, node) => {
      const r = mk('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;');
      r.appendChild(mk('span', 'flex:0 0 92px;color:#9fb6c9;font-size:11px;', label));
      r.appendChild(node);
      return r;
    };
    const section = (title, nodes, defaultOpen) => {
      const isOpen = defaultOpen !== false;
      const wrap = mk('div', 'border-top:1px solid #1e2c3a;margin-top:6px;padding-top:6px;');
      const head = mk('div', 'display:flex;align-items:center;gap:6px;cursor:pointer;color:#8fd6ff;font-weight:bold;user-select:none;');
      const caret = mk('span', '', isOpen ? '▾' : '▸');
      head.appendChild(caret); head.appendChild(mk('span', '', title));
      const body = mk('div', 'padding:2px 0 2px 2px;display:' + (isOpen ? 'block' : 'none') + ';');
      for (const n of nodes) body.appendChild(n);
      head.addEventListener('click', () => {
        const nowOpen = body.style.display !== 'none';
        body.style.display = nowOpen ? 'none' : 'block';
        caret.textContent = nowOpen ? '▸' : '▾';
      });
      wrap.appendChild(head); wrap.appendChild(body);
      return wrap;
    };
    const num = (val, min, max, step, onChange) => {
      const i = document.createElement('input');
      i.type = 'number'; i.value = val;
      if (min != null) i.min = String(min);
      if (max != null) i.max = String(max);
      if (step != null) i.step = String(step);
      i.style.cssText = 'width:80px;background:#0d1826;color:#d6e6f2;border:1px solid #2c4159;border-radius:4px;padding:2px 5px;font:inherit;';
      i.addEventListener('change', () => {
        let v = parseFloat(i.value);
        if (isNaN(v)) return;
        if (min != null) v = Math.max(min, v);
        if (max != null) v = Math.min(max, v);
        i.value = v; onChange(v);
      });
      return i;
    };
    const chk = (val, onChange) => {
      const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = !!val;
      c.style.cssText = 'cursor:pointer;accent-color:#4a90d9;transform:translateY(1px);';
      c.addEventListener('change', () => onChange(c.checked));
      return c;
    };
    const sel = (opts, val, onChange) => {
      const s = document.createElement('select');
      s.style.cssText = 'background:#0d1826;color:#d6e6f2;border:1px solid #2c4159;border-radius:4px;padding:2px 5px;font:inherit;';
      for (const o of opts) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; s.appendChild(op); }
      s.value = val;
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const txt = (val, ph, type) => {
      const i = document.createElement('input');
      i.type = type || 'text';
      i.value = val || ''; i.placeholder = ph || '';
      i.style.cssText = 'flex:1;min-width:0;background:#0d1826;color:#d6e6f2;border:1px solid #2c4159;border-radius:4px;padding:2px 5px;font:inherit;';
      return i;
    };

    const persistCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) {} };
    const setStatus = (m) => { if (statusEl) statusEl.textContent = String(m || ''); };
    const pushLog = (line) => {
      if (!logEl) return;
      logEl.textContent += (logEl.textContent ? '\n' : '') + line;
      const lines = logEl.textContent.split('\n');
      if (lines.length > 200) logEl.textContent = lines.slice(-200).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    };
    const setOpen = (v) => {
      open = !!v;
      if (!panel || !toggleEl) return;
      panel.style.display = open ? 'block' : 'none';
      toggleEl.textContent = open ? '× 收起面板' : '⚙ Vanya 挂机';
      try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) {}
    };

    function build() {
      if (root) return;
      root = mk('div', 'position:fixed;right:10px;bottom:10px;z-index:2147483647;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#d6e6f2;text-align:left;');

      toggleEl = btn('⚙ Vanya 挂机', () => setOpen(!open),
        'padding:6px 12px;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.5);font-size:12px;');
      root.appendChild(toggleEl);

      panel = mk('div', 'display:none;position:absolute;right:0;bottom:100%;margin-bottom:8px;width:320px;max-height:calc(100vh - 100px);overflow-y:auto;background:rgba(8,12,20,.97);border:1px solid #2c4159;border-radius:8px;padding:8px 10px 10px;box-shadow:0 8px 28px rgba(0,0,0,.6);');
      root.appendChild(panel);

      const titleBar = mk('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;');
      titleBar.appendChild(mk('span', 'font-weight:bold;color:#8fd6ff;', 'Vanya 挂机 v0.2.7'));
      titleBar.appendChild(btn('×', () => setOpen(false), 'padding:0 8px;line-height:18px;'));
      panel.appendChild(titleBar);

      statusEl = mk('div', 'background:#0d1826;border:1px solid #1e2c3a;border-radius:4px;padding:5px 7px;color:#8fd6ff;min-height:30px;max-height:66px;overflow:hidden;white-space:pre-wrap;word-break:break-all;font-size:11px;');
      panel.appendChild(statusEl);

      panel.appendChild(section('设置', [
        row('宝箱选择', sel([
          { value: 'shadow', label: 'shadow（暗影）' },
          { value: 'wealth', label: 'wealth（财富）' },
          { value: 'growth', label: 'growth（成长）' },
        ], CFG.choice, (v) => { CFG.choice = v; persistCfg(); })),
        row('血线保护 %', num(CFG.guardPct, 0, 100, 1, (v) => { CFG.guardPct = v; persistCfg(); })),
        row('巡检间隔 秒', num(Math.round(CFG.tickMs / 1000), 5, 600, 1, (v) => {
          CFG.tickMs = Math.round(v * 1000); persistCfg(); startTimer();
        })),
        row('宝箱抖动 秒', num(Math.round(CFG.jitterMax / 1000), 0, 600, 1, (v) => {
          CFG.jitterMax = Math.round(v * 1000); persistCfg();
        })),
        row('自动开狩猎', chk(CFG.autoStartHunt, (v) => { CFG.autoStartHunt = v; persistCfg(); })),
        row('自动重登',   chk(CFG.autoRelogin,  (v) => { CFG.autoRelogin = v; persistCfg(); })),
        row('调试日志',   chk(CFG.debug,        (v) => { CFG.debug = v; persistCfg(); })),
      ]));

      const actWrap = mk('div', 'display:flex;flex-wrap:wrap;gap:6px;');
      actWrap.appendChild(btn('立即执行', () => { tick(); setStatus('已手动触发 tick'); }));
      actWrap.appendChild(btn('诊断扫描', () => {
        const r = scan();
        pushLog('[诊断] page=' + r.page + ' 缺失=' + (r.missing.length ? r.missing.join(',') : '无'));
        pushLog('[诊断] 计数=' + JSON.stringify(r.counts));
      }));
      actWrap.appendChild(btn('领宝箱', async () => {
        const r = await claimChest();
        pushLog('[手动] 领宝箱 → ' + r);
      }));
      actWrap.appendChild(btn('人机验证', async () => {
        const ok = await solveHumanCheck();
        pushLog('[手动] 人机验证 → ' + (ok ? '通过' : '未通过'));
      }));
      actWrap.appendChild(btn('重置状态', () => { S.clear(); setStatus('状态已清空'); pushLog('[手动] 状态已清空'); }));
      actWrap.appendChild(btn('清空日志', () => {
        try { localStorage.removeItem(LOG_KEY); } catch (e) {}
        if (logEl) logEl.textContent = '';
      }));
      panel.appendChild(section('操作', [actWrap]));

      const c = cred();
      const uIn = txt(c.user, '用户名');
      const pIn = txt(c.pass, '密码', 'password');
      const credWrap = mk('div', '');
      credWrap.appendChild(row('用户名', uIn));
      credWrap.appendChild(row('密码', pIn));
      const saveWrap = mk('div', 'display:flex;gap:6px;margin-top:4px;');
      saveWrap.appendChild(btn('保存凭据', () => { setCred(uIn.value.trim(), pIn.value); setStatus('凭据已保存到本机'); }));
      credWrap.appendChild(saveWrap);
      panel.appendChild(section('自动重登凭据（仅本机）', [credWrap], false));

      logEl = mk('div', 'background:#0d1826;border:1px solid #1e2c3a;border-radius:4px;padding:5px 7px;height:130px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;color:#b8ccd9;font-size:11px;');
      try {
        const buf = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        logEl.textContent = buf.slice(-40).join('\n');
        requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight; });
      } catch (e) {}
      panel.appendChild(section('日志', [logEl]));

      (document.body || document.documentElement).appendChild(root);

      let wasOpen = false;
      try { wasOpen = localStorage.getItem(OPEN_KEY) === '1'; } catch (e) {}
      setOpen(wasOpen);
    }

    return { build, pushLog, setStatus, setOpen, isOpen: () => open };
  })();

  try { UI.build(); } catch (e) { console.log('[Vanya] UI 构建失败', e); }
  logSubs.push((l) => UI.pushLog(l));
  hudSink = (l) => UI.setStatus(l);

  // ------------------------- 启动 -------------------------
  tick();
  startTimer();
  startHeartbeat(tick);
  log('v0.2.13 已启动（' + location.pathname + '）· 右下角 ⚙ 打开控制面板');
})();