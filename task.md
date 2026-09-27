# Task · Vanya 挂机脚本上线清单

图例：`[ ]` 待办 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞
每个任务标注归属 agent，见 `agents.md`。

## P0 · 部署注入（deploy）

- [ ] 浏览器装好 Tampermonkey
- [ ] 新建脚本，粘贴 `vanya_诸葛连弩.mjs` 全文并保存启用
- [ ] 打开 https://www.vanyaonline.com/ ，确认右下角出现 ⚙ 按钮
- [ ] 控制台执行 `VANYA.scan()`，确认返回诊断结果（脚本已注入）
- [ ] 确认启动日志：`v0.2.7 已启动（/当前路径）`

## P1 · 逐页选择器诊断（diag）

每个页面跑一次 `VANYA.scan()`，记录命中情况：

- [ ] `/`（index）
- [ ] `/actions/hunt`（狩猎页：血量 `.hud-hp`、宝箱 `#huntChest`、倒计时 `#huntChestTimer`）
- [ ] `/actions/explore`（选区页）
- [ ] `/pub`（酒馆：当前生命、最大生命、`#lite-auto-click` 训练开关）
- [ ] dashboard（每日幸运卡片 `.ls-btn--claim`、Demon Pass `.demon-pass-btn` / `#btn-claim-all-free`）
- [ ] 输出「失效选择器」清单 → 转 maint

## P1.5 · 静态审查发现（A/B/C/D 已全部修复）

`node --check` 语法通过。通读逻辑后发现的隐患，按严重度排（A/B 在 v0.2.8 修，C/D 在 v0.2.9 修）：

- [x] **A · `window.confirm` / `alert` 被永久覆盖**（约 385 行）→ v0.2.8 已修
      `claimDemonPass()` 里覆盖后从不恢复，之后整页所有原生弹窗都被自动确认。
      修法：先存 `const _c = window.confirm`，操作完再还原。
- [x] **B · 宝箱失败文案被误判为成功**（约 342 行）→ v0.2.8 已修
      结果正则里包含 `too short`（拖拽太短的失败提示），命中后返回 `claimed: ...`，
      tick 里按 `claimed` 前缀判定成功 → **实际没领到却清零 claimFail**，会持续漏领。
      修法：把 `too short` 从成功判定里剔除，单独归为失败。
- [x] **C · 回血期间高频拉取 dashboard**（约 246 行）→ v0.2.9 已修（缓存 10 分钟）
      `maxLife()` 在本地读不到上限时会 `fetch('/dashboard')`，而 `pubHeal()` 每个 tick 都调它，
      等于回血期间每 15s 拉一次整页 HTML，有触发风控风险。
      修法：结果缓存进 `S.set({maxLife})`，且同一轮回血内只拉一次。
- [x] **D · `closePassModal()` 选择器过宽**（约 405 行）→ v0.2.9 已修（限定作用域，找不到退回原行为）
      用 `.modal` 取页面第一个弹窗，若此时存在其他 modal 会误关。
      修法：限定在 Demon Pass 弹窗容器作用域内查找 `.close-btn`。

## P2 · 功能逐项验证（verify）

每项记录「预期 / 实际 / 结论」，结论写回本文件。

- [x] 宝箱领取：**实测通过** — claimed: RARE · TIER III · Haunted +9,442 EXP（2026-09-25 16:23）
- [ ] 血线保护：HP 低于 `guardPct`(35%) 时置 `mode=guard` 并跳结算
- [ ] 酒馆回血：进 `/pub` 自动开「开始训练」开关，血量回到上限
- [x] 重开狩猎：**实测通过** — 主页待机自动跳 explore 并进入狩猎页（Crimson Depths）
- [~] 每日幸运连签：已点击，结果未确认（明天会重试，待观察）
- [~] Demon Pass：confirm 自动确认成功，但弹窗报 "Could not load Demon Pass."（待观察是否复现）
- [ ] 自动重登：`VANYA.setCred(u,p)` 后，会话失效能自动登录
- [x] 人机验证：**实测通过** — 16:22:15 撞上 → 16:22:21 自动通过（6 秒）
- [ ] 连续领取失败熔断：连败达 `claimFailBreak` 触发自愈
- [~] 今日收益统计（v0.2.15）：宝箱/狩猎结算已接入 `VANYA.daily()`，待完整一天验证数据
- [x] 界面自动切中文（v0.2.14）：实测 URL 带 lang=zh-CN 生效

## P3 · 参数调优（verify）

- [ ] 按账号情况设 `choice`（wealth / growth / shadow）
- [ ] 调 `guardPct` 到不会频繁回血也不容易死的档位
- [ ] 调 `tickMs` / `jitterMax`（默认 15s / 60s，按站点敏感度放宽）
- [ ] 不需要自动开狩猎时：`VANYA.cfg({autoStartHunt:false})`
- [ ] 调优后的配置记回本文件，便于复现

## P4 · 长跑值守（watch）

- [ ] 连续跑满一轮宝箱周期无卡死
- [ ] 看门狗（`modeWatchdogMs` 15min）未误触发
- [ ] `VANYA.logTail(60)` 无持续异常刷屏
- [ ] 记录一次完整周期耗时，作为后续基线

## 当前状态

- 脚本版本：v0.2.15（含今日收益统计）
- 运行环境：**10.10.10.4 独立挂机机**（Alpine 1 核/1GB），OpenRC `vanya` 服务守护中
- 面板：http://10.10.10.4:8080（画面+遥控+今日收益按钮）
- 本机 10.10.10.3：内存 512MB 仅运行 CodeBuddy，挂机服务已停（恢复需先扩内存再 `node server.mjs`）
- 注意：两台机不要同时挂同一账号（会互踢会话）

## 生产部署（10.10.10.4 · root / 密码见用户）

- 目录：`/root/todo/vanya_诸葛连弩`（chromium profile 在 `vanya_%E8%AF%B8.../.profile`，URL 编码路径，含登录态勿删）
- 依赖：`apk add nodejs npm chromium-headless-shell`（community 源 + 清华镜像）
- 守护：`/etc/init.d/vanya`（supervisor="supervise-daemon"，--respawn-delay 5，**无次数上限**）
  `rc-update add vanya default` 开机自启；`rc-service vanya start|stop|restart`
- 传输：源机起临时文件服务（node http :9999）→ 目标机 `wget http://10.10.10.3:9999/`（scp/sftp 在 1 核机上不可靠）
- 更新流程：本地改 → git push → 打包 tar → wget 传输 → `rc-service vanya restart`
- 踩坑记录：`pkill -f "server.mjs"` 会匹配 ssh 命令行自杀，用 `pkill -x node`（但 node 的 comm 是
  {MainThread}，需用 cmdline 匹配——用 `pgrep -f "[s]erver[.]mjs"` 方括号技巧防自杀）

## 长期运行稳定性（OOM 复盘 · 2026-09-27）

跑几小时正常、跑一天后开始 OOM 崩溃，实测数据（目标机 1 核 / 宿主内存紧）：

| 指标 | 数值 | 性质 |
|---|---|---|
| chromium 匿名内存 | 218~285MB | 稳定，无泄漏 |
| 页面 JS 堆 | 10MB | 很轻 |
| cgroup file（页缓存） | 484MB | **大部分可回收** |

**修正结论**：曾判断「chromium 磁盘缓存累积 491MB 是元凶」——**不准确**。
实测 chromium 的 HTTP 缓存目录只有 41.5MB；那 484MB 的 `file` 主要是
chromium 二进制与库文件的**页缓存**（file-backed，内核可随时丢弃，不是泄漏）。

真实机制：

```
宿主整体内存紧张（available 一度只剩 128MB）＋ 目标机无 swap
  → 内核只能靠回收页缓存腾空间，回收跟不上分配峰值
  → OOM killer 杀 chromium
  → 自愈重载 → 又分配 → 又被杀（循环，越杀越快）
  → supervise-daemon 重启上限（respawn-max 5/30min）耗尽 → 服务彻底停摆
```

三层修复（均已部署）：

1. **swap（核心）**：PVE 面板给目标机加 768MB swap，实测 `Swap: 8192`，
   把「悬崖式 OOM」变成「缓慢换出」，压力期后 swap 用量回落到 ~1MB
2. **缓存上限（加固）**：`--disk-cache-size=32MB --media-cache-size=8MB --disable-application-cache`
   ——防未来缓存无限累积（虽然本次不是主因，但属于该配没配的参数）
3. **每日重启（兜底）**：crond `0 5 * * * rc-service vanya restart`，斩断任何残余累积；
   重启窗口几十秒，登录态在 profile、游戏进度在服务端，均无损失

另修：`respawn-max` 改为无上限（原 5 次/30 分钟会让 supervise 永久放弃监督）。

## 环境结论（源机 10.10.10.3）

- 完整 chromium 渲染进程卡死（Seccomp+dbus），**chromium-headless-shell 可用**
- 必需参数：`--no-sandbox --disable-dev-shm-usage`；1 核时 launch 需 `timeout: 600000`
- 自愈判定只认 `Target crashed`（导航期 context destroyed 属正常，勿误判）

## 环境结论（2026-09-25 实测 · 旧结论已被推翻）

旧结论写「本容器跑不了浏览器」，它描述的是**完整 chromium**（`/usr/bin/chromium`）——
这部分观察属实，别浪费时间重试：

- 完整 chromium 启动渲染进程必卡死：`--dump-dom` 连 `data:text/html` 都出不来
- `timeout` 杀不掉（zygote 子进程持有 stdout），只能强杀
- `--no-sandbox --no-zygote --single-process --disable-gpu` 各种组合均无效
- 根因：容器 Seccomp 过滤 + 缺 dbus，属容器级限制

**但换成 `chromium-headless-shell` 就能跑**（Alpine 原生编译，专为 headless 设计，不依赖完整渲染栈）：

- 装法：`apk add chromium-headless-shell`（会带上 chromium-swiftshader）
- 驱动：`playwright-core` + `executablePath: '/usr/bin/chromium-headless-shell'`
  （不要装 `playwright`，它 postinstall 会下一份 glibc 版 Chromium，在 musl 上跑不了还白占带宽）
- 实测：vanyaonline.com 返回 200，脚本注入成功，`window.VANYA` 可用，`scan()` 正常出诊断
- 必需启动参数：
  `--no-sandbox`（root 运行必需）+ `--disable-dev-shm-usage`（容器 /dev/shm 仅 64MB，**不加必崩**）

**结论**：本容器能真跑脚本，走 headless-shell 路线即可，不需要外部浏览器。
驱动脚本：`probe.mjs`（连通性探针）、`inject.mjs`（注入 + 诊断）。

## 调试端口 / DevTools 实测结论（2026-09-25 · 五轮实验）

1. `--remote-debugging-address=0.0.0.0` **无效**：独立进程启动（排除 playwright 干扰）后
   `/proc/net/tcp` 显示仍只监听 `127.0.0.1:9222`。新版 Chromium 为防 DNS rebinding
   强制 DevTools 服务绑 localhost。→ 手机在网络层就到不了 9222，必须自建转发。
2. 内置 DevTools 前端可用：`http://127.0.0.1:9222/devtools/inspector.html` 返回 200，
   不依赖被墙的 Google appspot 前端。
3. 但前端界面对普通 page target **没有 screencast**：shadow DOM 深度探测
   screencast/device-mode/canvas 元素全为 0。「DevTools 里有画面」是 chrome://inspect
   通过 adb 连安卓真机的 Remote Devices 面板，headless target 不适用。
4. page ws 连 vanyaonline.com 会被周期性 **1006 强断**：站点跨进程导航所致
   （about:blank 30s 稳定对照确认，断开时间与 reCAPTCHA 加载吻合）。
   browser 级 ws + `Target.attachToTarget`(flatten)（playwright 方式）不受影响——
   这是 inject.mjs 反复跑从不掉线的原因。
5. **结论**：手机看画面走自建 screencast 服务（browser-ws 驱动 + 推帧 + 控制面板）。
   DevTools 直连路线三处硬伤：端口绑死 localhost、无画面 UI、ws 被站点导航打断。

## 手机面板（server.mjs · 已实测跑通）

- 启动：`node server.mjs`（默认 8080，`PORT=9000 node server.mjs` 改端口）
- 访问：同网段手机浏览器开 `http://<本机IP>:8080`
- 文件：`server.mjs`（浏览器驱动 + CDP screencast + HTTP 服务）、`screen.html`（手机页面）
- 画面：MJPEG（`/stream.mjpg`，实测 2.5 秒 13 帧 ≈ 5fps）——手机 `<img>` 原生支持，iOS/Android 通吃
- 遥控：点画面 → 按视口比例换算 → `page.mouse.click`
- 执行：`/api/exec?c=<JS>`，页面按钮走 `VANYA.tick()/scan()/claimChest()/state()/logTail()`
- 关键坑：screencast 每帧**必须** `Page.screencastFrameAck`，否则 Chromium 推几帧就停
- 安全：当前**无鉴权**，同网段任何人打开即可任意执行 JS（等同接管登录态）。
  非可信网络务必加口令，或改走 Tailscale 而非裸开端口。

## 备注

- 凭据只走 `VANYA.setCred(u,p)`，不写入本目录任何文件。
- 站点改版导致失效时，由 diag 出清单 → maint 修 → verify 复验，闭环走一遍。
