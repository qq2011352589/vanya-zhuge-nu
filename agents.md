# Agents · Vanya 挂机脚本协作分工

## 目标

把本目录下的 `vanya_诸葛连弩.mjs`（Tampermonkey 脚本 v0.2.7）在 vanyaonline.com 上稳定注入、逐项验证、长期值守。

## 脚本速览

- 匹配站点：`https://www.vanyaonline.com/*`，`@run-at document-idle`
- 页面判定：`login` / `human` / `hunt` / `dashboard` / `pub` / `explore` / `index`
- 主循环：`tick()`，间隔 `CFG.tickMs`（默认 15000ms），另有心跳对抗后台节流
- 状态机 `mode`：normal → starting → guard → healing → normal
- 持久化：全部走 localStorage（`vanya_auto_cfg_v1` / `vanya_auto_state_v1` / `vanya_auto_cred_v1` / `vanya_auto_log`）
- 调试接口 `window.VANYA`：
  `scan()` `tick()` `cfg({})` `setCred(u,p)` `state()` `setState({})` `reset()` `logTail(n)`
  `claimChest()` `startHunt()` `pubHeal()` `solveHumanCheck()` `claimDaily()` `claimDemonPass()`
  `readHP()` `readPubLife()` `readMaxLife()` `page()`
- 关键配置：`choice`(wealth|growth|shadow) `guardPct`(35) `area` `jitterMax` `tickMs`
  `autoStartHunt` `claimFailBreak`(5) `autoRelogin` `debug`

## 角色分工

每个 agent 只推进自己这一段。**改动脚本文件前必须先认领，同一时间只有一个 agent 持有脚本。**

### 1. deploy —— 部署注入
负责把脚本装进 Tampermonkey 并确认注入成功。
- 产出：脚本已启用、`@match` 命中、控制台 `VANYA` 对象可用
- 不负责业务逻辑，不做选择器改动

### 2. diag —— 选择器诊断
负责核对脚本里的选择器与真实站点 DOM 是否对得上。
- 工具：`VANYA.scan()` 逐页跑，比对 `SEL` 集合
- 产出：一份「选择器命中/失效」清单，只报告不自行改码
- 失效项交给 maint

### 3. verify —— 功能验证
负责按 task.md 的 P2 清单逐项实测，每项记录「预期 / 实际 / 结论」。
- 覆盖：宝箱领取、每日连签、Demon Pass、血线保护、酒馆回血、重开狩猎、自动重登、人机验证
- 实测结论写回 task.md

### 4. watch —— 值守巡检
负责脚本跑起来后的长跑监控。
- 看 `VANYA.logTail()`、`VANYA.state()`、看门狗是否触发
- 发现卡死/连续领取失败先记录现场（日志 + 状态快照），再交给 maint

### 5. maint —— 站点改版维护
负责修选择器、修流程分支、发新版本。
- 输入：diag 的失效清单、watch 的故障现场
- 改动后必须 bump 版本号并在脚本头部注释里写清变更原因
- 每次改动回到 verify 重新验收

## 协作规则

1. 一次只有一个 agent 持有并修改 `vanya_诸葛连弩.mjs`。
2. 任何实测结论写进 `task.md`，不要只留在聊天里。
3. 修 bug 前先取现场：`VANYA.state()` + `VANYA.logTail(60)` + 当前 URL。
4. 不确定站点当前 DOM 时先 `VANYA.scan()`，不要凭记忆改选择器。
5. 凭据只通过 `VANYA.setCred(u,p)` 写本机 localStorage，不写进任何文件、不进版本库。
