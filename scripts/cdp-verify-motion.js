// 专项验证：交互动效与取消流程（扫光 / 呼吸光晕 / 阶段文案 / 计时 / 逐字段扫描 / 两段式取消 / 跨帧进度 / 键盘）
// 用法：node scripts/cdp-verify-motion.js [调试端口，默认 9222]
// 前置：node scripts/test-server.js + 已打开 http://127.0.0.1:8123/test/test-form.html
// 说明：内容脚本跑在 isolated world，Edge 不把它暴露成 CDP 执行上下文，所以这里一律走真实点击驱动，
//      不去偷调 QuickFillOverlay 的方法——顺带也让测试路径与用户路径一致。
const PORT = process.argv[2] || '9222';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() { return (await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()); }

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  await send('Runtime.enable');
  return { ws, send, ev };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

const SHADOW = `document.getElementById('__qf_overlay_host__').shadowRoot`;
// 一次采样把「球光晕 / 进度窗文案 / 计时 / 跨帧进度 / 页面描边」全读回来，避免多次往返把时序打散
const SAMPLE = `(() => {
  const s = ${SHADOW};
  const b = s.querySelector('.qf-ball');
  const halo = b ? getComputedStyle(b, '::before') : null;
  const icon = b ? getComputedStyle(b.querySelector('.icon') || b, 'auto') : null;
  const r = b ? b.getBoundingClientRect() : null;
  const dlg = s.querySelector('.qf-dialog');
  const q = sel => { const e = s.querySelector(sel); return e ? e.textContent : ''; };
  const pseudo = (sel, prop) => { const e = s.querySelector(sel); return e ? getComputedStyle(e, '::before')[prop] : ''; };
  return {
    haloName: halo ? halo.animationName : '', haloDur: halo ? parseFloat(halo.animationDuration) : 0,
    haloBg: halo ? halo.backgroundImage.slice(0, 120) : '',
    iconAnim: b && b.querySelector('.icon') ? getComputedStyle(b.querySelector('.icon')).animationName : '',
    ballRight: r ? Math.round(r.right) : -1, cw: document.documentElement.clientWidth,
    busy: !!dlg && dlg.classList.contains('is-busy'),
    cancelled: !!dlg && dlg.classList.contains('is-cancelled'),
    ariaBusy: dlg ? dlg.getAttribute('aria-busy') : '',
    focusInDialog: !!dlg && !!s.activeElement && dlg.contains(s.activeElement),
    elapsed: q('[data-role=elapsed]'), comment: q('[data-role=comment]'), count: q('[data-role=progressCount]'),
    other: q('[data-role=other]'),
    stage: q('[data-role=stage]'), detail: q('[data-role=detail]'),
    sweepOn: (() => { const e = s.querySelector('.qf-steps .on'); return e ? getComputedStyle(e, '::after').animationName : ''; })(),
    sweepBar: (() => { const e = s.querySelector('.qf-progress-fill'); return e ? getComputedStyle(e, '::after').animationName : ''; })(),
    doneTick: pseudo('.qf-steps .done', 'content'),
    filling: document.querySelectorAll('.__qf_filling').length,
    land: document.querySelectorAll('.__qf_land').length,
    marks: document.querySelectorAll('.__qf_filled, .__qf_failed, .__qf_missing, .__qf_unmatched').length,
    fillBtnReady: (() => { const e = s.querySelector('[data-act=fill]'); return !!e && !e.disabled && /一键填写/.test(e.textContent); })()
  };
})()`;
// 用时格式：<10 秒走「6.2 秒」，之后走 mm:ss
const TIME_RE = '[0-9]+(\\.[0-9])?( 秒|:[0-9][0-9])';

(async () => {
  const page = (await targets()).find(x => x.type === 'page' && /test-form\.html/.test(x.url));
  if (!page) { console.log('找不到 test-form 页，请先打开 http://127.0.0.1:8123/test/test-form.html'); process.exit(2); }

  const c = await connect(page.webSocketDebuggerUrl);
  const sample = () => c.ev(SAMPLE);
  await c.send('Page.reload', {});
  await c.send('Page.bringToFront', {});   // 窗口被遮挡时 Chromium 会静默丢弃真实鼠标事件，可信输入会退化成逐层重试到超时
  await sleep(3200);

  console.log('\n[1] 循环动画收敛为「球呼吸 + 一条扫光」，且只在需要时出现');
  const styleText = await c.ev(`${SHADOW}.querySelector('style').textContent`);
  check('旧的三套循环动画（shimmer/pulse/spin）已移除', !/qf-shimmer|qf-pulse|qf-spin/.test(styleText));
  check('扫光 keyframe 只有一条', (styleText.match(/@keyframes qf-sweep/g) || []).length === 1);
  const infiniteRules = styleText.match(/animation:[^;]*infinite/g) || [];
  check('样式里只剩两条 infinite 规则（halo 与 sweep）', infiniteRules.length === 2, infiniteRules);
  const idle = await sample();
  check('空闲时球光晕仍是 qf-halo 3.4s（cdp-test 断言的就是这两个名字）',
    idle.haloName === 'qf-halo' && idle.haloDur > 3 && idle.haloDur < 3.8, { name: idle.haloName, dur: idle.haloDur });
  check('空闲时进度窗不在场，页面也没有常驻动画节点', !idle.busy && idle.filling === 0, { busy: idle.busy, filling: idle.filling });

  console.log('\n[2] 真实填写：逐字段蓝光 + 计时走动 + 阶段文案轮播 + 跨帧进度汇总');
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(400);
  await c.ev(`${SHADOW}.querySelector('[data-act=fill]').click()`);
  let sawBusyHalo = false, sawFilling = false, sawLand = false, sawOther = '', sawDoneTick = '', sawFocus = false;
  let firstElapsed = '', lateElapsed = '', firstComment = '', lateComment = '';
  let sawStepCount = false, sweepSamples = [];
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 100000) {
    await sleep(150);
    const s = await sample();
    if (s.busy) {
      if (parseFloat(s.haloDur) < 1.5 && /21,\s?101,\s?255/.test(s.haloBg)) sawBusyHalo = true;
      if (s.filling > 0) sawFilling = true;
      if (s.land > 0) sawLand = true;
      if (s.other && /已填/.test(s.other)) sawOther = s.other;
      if (/已用 [0-9]/.test(s.elapsed)) {
        if (!firstElapsed) { firstElapsed = s.elapsed; firstComment = s.comment; }
        else if (s.elapsed !== firstElapsed) lateElapsed = s.elapsed;
      }
      if (firstComment && s.comment && s.comment !== firstComment) lateComment = s.comment;
      if (new RegExp('第 [0-9]+/[0-9]+ 项').test(s.count)) sawStepCount = true;
      if (s.doneTick && s.doneTick !== 'none' && s.doneTick.length > 1) sawDoneTick = s.doneTick;
      if (s.focusInDialog) sawFocus = true;
      sweepSamples.push([s.sweepBar, s.sweepOn]);
    }
    last = s;
    if (s.fillBtnReady && !s.busy && Date.now() - t0 > 3000) break;
  }
  const done = last || await sample();
  check('填写中球光晕提速到 1.5s 以内（呼吸变快 = 「它在干活」）', sawBusyHalo);
  check('填写期间出现过 .__qf_filling（逐字段推进的视觉锚点）', sawFilling);
  check('出现过 .__qf_land 落定闪光', sawLand);
  check('进度窗计时确实在走', !!firstElapsed && !!lateElapsed, { firstElapsed, lateElapsed });
  check('阶段副文案会轮播（不是一行死文案）', !!firstComment && !!lateComment && firstComment !== lateComment,
    { first: firstComment.slice(0, 18), late: lateComment.slice(0, 18) });
  check('进度窗显示「第 n/m 项」的逐行进度', sawStepCount, done.count);
  check('已完成的阶段胶囊带一次性对勾', !!sawDoneTick, sawDoneTick);
  check('进度窗出现时焦点进入对话框（键盘可用）', sawFocus);
  check('iframe 子区域的逐字段进度会汇总到 lead 进度窗', !!sawOther, sawOther);
  check('进行中进度条与当前阶段胶囊都在扫光',
    sweepSamples.length > 2 && sweepSamples.every(p => p[0] === 'qf-sweep' && p[1] === 'qf-sweep'),
    sweepSamples.slice(0, 2));
  check('填写过程中球始终贴右边框（动效没有挪动几何）', Math.abs(done.ballRight - done.cw) < 2, { ballRight: done.ballRight, cw: done.cw });

  console.log('\n[3] 完成态：真实用时 + 结算提示 + 光晕短提示后自动回落');
  check('用时行是真实用时（<10s 一位小数，之后 mm:ss）',
    new RegExp('本次用时 ' + TIME_RE).test(done.elapsed), done.elapsed);
  check('完成提示里同时给出真实用时与「按每项约 4 秒」的估算口径',
    /本次用时 [0-9]+ 秒/.test(done.detail) && /约 4 秒估算/.test(done.detail), done.detail.slice(0, 80));
  check('完成时 aria-busy 归位 false', done.ariaBusy === 'false', done.ariaBusy);
  check('完成时光晕给出颜色提示（有失败/缺必填=橙，全绿=绿）',
    /217,\s?119,\s?6|22,\s?163,\s?74/.test(done.haloBg), done.haloBg.slice(0, 56));
  check('结算时球图标弹一下（弹的是图标，不是球本身）', done.iconAnim === 'qf-num', done.iconAnim);
  check('完成遮罩上「其它区域」那行已收起（避免和汇总口径重复）', !done.other, done.other);
  await sleep(5600);
  const back = await sample();
  check('提示 5 秒后自动回到常态 3.4s 蓝晕，不留残影', back.haloDur > 3 && /21,\s?101,\s?255/.test(back.haloBg), { dur: back.haloDur });

  console.log('\n[4] 两段式取消：第一下上膛，3 秒不确认自动松开');
  // 必须重新加载：表单已被上面那轮填满，candidates 为空会让填写秒完成
  await c.send('Page.reload', {});
  await c.send('Page.bringToFront', {});   // 窗口被遮挡时 Chromium 会静默丢弃真实鼠标事件，可信输入会退化成逐层重试到超时
  await sleep(3200);
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(400);
  await c.ev(`${SHADOW}.querySelector('[data-act=fill]').click()`);
  await sleep(600);
  const midFill = await sample();
  check('重新填写后进度窗确实处于进行中', midFill.busy, { busy: midFill.busy, stage: midFill.stage });
  const armed = await c.ev(`(() => { const s = ${SHADOW}; const b = s.querySelector('[data-act=stop]');
    if (!b) return null; b.click();
    return { text: b.textContent, cls: b.className, busy: !!s.querySelector('.qf-dialog.is-busy') }; })()`);
  check('第一次点击只把「停止填写」上膛并改问句', !!armed && /确认停止/.test(armed.text) && /is-armed/.test(armed.cls), armed);
  check('上膛期间仍在正常填写（没有偷偷中止）', !!armed && armed.busy, armed && armed.busy);
  await sleep(1400);
  const stillArmed = await c.ev(`(() => { const b = ${SHADOW}.querySelector('[data-act=stop]');
    return { text: b.textContent, cls: b.className }; })()`);
  // 逐字段进度每几十毫秒就刷一次窗口，早先的实现会把「确认停止？」一起冲掉，导致第二下永远点不到
  check('上膛后继续刷新进度不会把确认状态冲掉', /确认停止/.test(stillArmed.text) && /is-armed/.test(stillArmed.cls), stillArmed);
  await sleep(2100);
  const disarmed = await c.ev(`(() => { const b = ${SHADOW}.querySelector('[data-act=stop]');
    return { text: b.textContent, cls: b.className }; })()`);
  check('3 秒不确认自动松开，文案回到「停止填写」', disarmed.text === '停止填写' && !/is-armed/.test(disarmed.cls), disarmed);

  console.log('\n[5] 键盘：Esc 一次上膛、两次中止（与鼠标同一套两段式）');
  await c.send('Page.reload', {});
  await c.send('Page.bringToFront', {});   // 窗口被遮挡时 Chromium 会静默丢弃真实鼠标事件，可信输入会退化成逐层重试到超时
  await sleep(3200);
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(400);
  await c.ev(`${SHADOW}.querySelector('[data-act=fill]').click()`);
  await sleep(350);
  const esc1 = await c.ev(`(() => { const s = ${SHADOW};
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const b = s.querySelector('[data-act=stop]');
    return { text: b.textContent, busy: !!s.querySelector('.qf-dialog.is-busy') }; })()`);
  check('第一次 Esc 只上膛，不中止', /确认停止/.test(esc1.text) && esc1.busy, esc1);
  await sleep(120);
  const esc2 = await c.ev(`(() => { const s = ${SHADOW};
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true; })()`);
  await sleep(700);
  const escState = await c.ev(`(() => { const s = ${SHADOW}; const d = s.querySelector('.qf-dialog');
    return { cls: d.className, stage: s.querySelector('[data-role=stage]').textContent }; })()`);
  check('第二次 Esc 才进入结算态', !!esc2 && /is-cancelled/.test(escState.cls) && escState.stage === '已停止填写', escState);
  await c.ev(`${SHADOW}.querySelector('[data-act=clear]').click()`);

  console.log('\n[6] 上膛后立刻确认：进入结算态并保留现场');
  // 再开一轮：上一轮可能已经自然跑完，那样 showCancelled 会（正确地）拒绝把「跑完」说成「中止」
  await c.send('Page.reload', {});
  await c.send('Page.bringToFront', {});   // 窗口被遮挡时 Chromium 会静默丢弃真实鼠标事件，可信输入会退化成逐层重试到超时
  await sleep(3200);
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(400);
  await c.ev(`${SHADOW}.querySelector('[data-act=fill]').click()`);
  // 这台机器上整轮填写只要 2~6 秒，取消必须早点下手，否则测的就不是「中止」而是「补刀」
  await sleep(350);
  const marksBefore = await c.ev(`document.querySelectorAll('.__qf_filled, .__qf_failed, .__qf_missing, .__qf_unmatched').length`);
  await c.ev(`(() => { const s = ${SHADOW}; const b = s.querySelector('[data-act=stop]'); b.click(); b.click(); return true; })()`);
  await sleep(900);
  const settled = await c.ev(`(() => { const s = ${SHADOW}; const d = s.querySelector('.qf-dialog');
    return { cls: d.className, stage: s.querySelector('[data-role=stage]').textContent,
      cells: [...s.querySelectorAll('[data-role=cancelStat] div')].map(x => x.textContent),
      stopHidden: s.querySelector('[data-act=stop]').classList.contains('qf-hidden'),
      doneShown: !s.querySelector('[data-act=done]').classList.contains('qf-hidden'),
      elapsed: s.querySelector('[data-role=elapsed]').textContent }; })()`);
  check('第二次点击后进入「已停止填写」结算态', /is-cancelled/.test(settled.cls) && settled.stage === '已停止填写', { cls: settled.cls, stage: settled.stage });
  check('结算态列出 已填写 / 本轮剩余 / 已用时 三个数', settled.cells.length === 3
    && /项/.test(settled.cells[0]) && /项/.test(settled.cells[1]) && new RegExp(TIME_RE).test(settled.cells[2]), settled.cells);
  check('结算后隐藏「停止填写」、保留「查看页面」', settled.stopHidden && settled.doneShown, { stopHidden: settled.stopHidden, doneShown: settled.doneShown });
  check('结算里也报真实用时', settled.elapsed.indexOf('已用时') >= 0 && new RegExp(TIME_RE).test(settled.elapsed), settled.elapsed);
  const marksAfter = await c.ev(`document.querySelectorAll('.__qf_filled, .__qf_failed, .__qf_missing, .__qf_unmatched').length`);
  check('取消不会清掉结果描边（那是「清除标记」的活）', marksAfter >= 1 && marksAfter <= marksBefore + 3, { before: marksBefore, after: marksAfter });
  check('取消后「正在填」的蓝光已摘干净', await c.ev(`document.querySelectorAll('.__qf_filling').length`) === 0);
  const btn = await c.ev(`(() => { const b = ${SHADOW}.querySelector('[data-act=fill]');
    return { disabled: b.disabled, text: b.textContent }; })()`);
  check('取消后一键填写按钮恢复可用（cdp-test 的完成信号口径）', !btn.disabled && /一键填写/.test(btn.text), btn);

  console.log('\n[7] 填写已经跑完时点「停止」，不能把完成谎说成中止');
  await c.ev(`${SHADOW}.querySelector('[data-act=clear]').click()`);
  await sleep(500);
  await c.send('Page.reload', {});
  await c.send('Page.bringToFront', {});   // 窗口被遮挡时 Chromium 会静默丢弃真实鼠标事件，可信输入会退化成逐层重试到超时
  await sleep(3200);
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(400);
  await c.ev(`${SHADOW}.querySelector('[data-act=fill]').click()`);
  for (let i = 0; i < 240; i++) {
    await sleep(300);
    const s = await sample();
    if (!s.busy && s.fillBtnReady) break;
  }
  const finished = await sample();
  // 完成态下「停止填写」按钮是隐藏的，这里用程序点击模拟极端时序，验证守卫而不是 UI
  await c.ev(`(() => { const b = ${SHADOW}.querySelector('[data-act=stop]'); b.click(); b.click(); return true; })()`);
  await sleep(600);
  const afterLate = await c.ev(`(() => { const s = ${SHADOW}; const d = s.querySelector('.qf-dialog');
    return { cls: d.className, stage: s.querySelector('[data-role=stage]').textContent }; })()`);
  check('完成态不会被补刀成「已停止填写」', /is-done/.test(afterLate.cls) && !/is-cancelled/.test(afterLate.cls)
    && /完成/.test(afterLate.stage), afterLate);
  check('上一轮确实正常跑到了完成态', !finished.busy && finished.fillBtnReady, { busy: finished.busy });

  console.log('\n[8] 投递看板逐行错峰入场');
  check('看板行的错峰规则写在样式里（animation-delay 由 --i 驱动）',
    styleText.indexOf('.qf-job') >= 0 && styleText.indexOf('animation-delay: calc(var(--i, 0) * 22ms)') >= 0);
  // 内容脚本的世界没法写 storage，借扩展页（主世界有 chrome.storage）种 3 条记录
  const EXT_ID = 'gjdlmpnonidomglamkoohidaepajakgo';
  const seed = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' +
    encodeURIComponent(`chrome-extension://${EXT_ID}/popup/records.html`), { method: 'PUT' })).json();
  await sleep(1500);
  const seedCtx = (await targets()).find(x => x.id === seed.id);
  const sc = seedCtx ? await connect(seedCtx.webSocketDebuggerUrl) : null;
  if (sc) await sc.ev(`chrome.storage.local.set({ jobRecords: [0,1,2].map(i => ({
    id: 'seed' + i, url: 'https://example.com/job/' + i, title: '测试职位 ' + i,
    note: '', status: 'applied', ts: Date.now(), updatedAt: Date.now() })) }).then(() => 'seeded')`);
  await c.ev(`${SHADOW}.querySelector('[data-act=clear]').click()`);
  await sleep(400);
  await c.ev(`(() => { const s = ${SHADOW}; if (s.querySelector('.qf-panel').classList.contains('qf-hidden')) s.querySelector('.qf-ball').click(); return 1; })()`);
  await sleep(400);
  await c.ev(`${SHADOW}.querySelector('[data-act=jobs]').click()`);
  await sleep(500);
  const stagger = await c.ev(`(() => { const s = ${SHADOW};
    return [...s.querySelectorAll('.qf-job')].slice(0, 3).map(x => getComputedStyle(x).animationDelay); })()`);
  check('三条记录的行入场时间依次错开', stagger.length === 3
    && parseFloat(stagger[1]) > parseFloat(stagger[0]) && parseFloat(stagger[2]) > parseFloat(stagger[1]), stagger);
  await c.ev(`(() => { const s = ${SHADOW}; s.querySelectorAll('.qf-shade').forEach(x => x.remove()); return 1; })()`);
  if (sc) {
    await sc.ev(`chrome.storage.local.remove('jobRecords').then(() => 'cleared')`);   // 别把假记录留给后面的套件
    sc.ws.close();
    await fetch('http://127.0.0.1:' + PORT + '/json/close/' + seed.id).catch(() => {});
    await sleep(400);
  }

  console.log('\n[9] 清除标记仍会一并销毁结算遮罩');
  await c.send('Page.reload', {});
  await c.send('Page.bringToFront', {});   // 窗口被遮挡时 Chromium 会静默丢弃真实鼠标事件，可信输入会退化成逐层重试到超时
  await sleep(3000);
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(400);
  await c.ev(`${SHADOW}.querySelector('[data-act=fill]').click()`);
  await sleep(1200);
  await c.ev(`(() => { const s = ${SHADOW}; const b = s.querySelector('[data-act=stop]'); b.click(); b.click(); return true; })()`);
  await sleep(600);
  await c.ev(`${SHADOW}.querySelector('[data-act=clear]').click()`);
  await sleep(600);
  check('点「清除标记」后 .qf-shade 数为 0（不留隐藏遮罩）',
    await c.ev(`${SHADOW}.querySelectorAll('.qf-shade').length`) === 0);
  check('页面标记已清空', await c.ev(`document.querySelectorAll('[class*=__qf_]').length`) === 0);
  const afterClear = await sample();
  check('清除后计时器已停（进度窗不在场）', !afterClear.busy && !afterClear.cancelled);

  console.log('\n[10] 设置里关掉动效：只撤动画，不撤颜色与描边');
  // 内容脚本的世界没有 chrome.storage，借扩展页改设置
  const cfg = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' +
    encodeURIComponent(`chrome-extension://${EXT_ID}/popup/records.html`), { method: 'PUT' })).json();
  await sleep(1500);
  const cfgCtx = (await targets()).find(x => x.id === cfg.id);
  const cc = cfgCtx ? await connect(cfgCtx.webSocketDebuggerUrl) : null;
  // 先让页面热起来（点开一次面板会走 analyze → loadContext → applyMotion），此时动效仍是开的
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(600);
  await c.ev(`${SHADOW}.querySelector('[data-act=close]').click()`);
  await sleep(300);
  const beforeOff = await sample();
  check('默认状态下球仍在呼吸（动效开着）', beforeOff.haloName === 'qf-halo', beforeOff.haloName);
  // 关键：写设置 + 广播，全程不刷新页面、也不再点面板
  if (cc) await cc.ev(`chrome.storage.local.get('settings').then(r => chrome.storage.local.set(
    { settings: Object.assign({}, r.settings || {}, { motionEnabled: false }) })).then(() => 'off')`);
  if (cc) await cc.ev(`chrome.runtime.sendMessage({ type: 'settings:changed' }).then(() => 'sent').catch(() => 'sent')`);
  await sleep(1200);
  const still = await sample();
  const stillHost = await c.ev(`document.getElementById('__qf_overlay_host__').classList.contains('qf-still')`);
  check('关掉动效后宿主带上 qf-still 标记', stillHost === true);
  check('关掉动效后球不再呼吸', still.haloName === 'none', still.haloName);
  // 只撤动画，颜色信息必须原样保留：此刻球可能处于 warn/ok 短提示态，所以按「任一状态色」判定而不是写死蓝
  const bgFlat = still.haloBg.split(' ').join('');
  check('但光晕与颜色都还在（只撤动画，不撤信息）',
    bgFlat.indexOf('radial-gradient') >= 0
      && (bgFlat.indexOf('21,101,255') >= 0 || bgFlat.indexOf('217,119,6') >= 0 || bgFlat.indexOf('22,163,74') >= 0),
    still.haloBg.slice(0, 60));
  if (cc) {
    await cc.ev(`chrome.storage.local.get('settings').then(r => chrome.storage.local.set(
      { settings: Object.assign({}, r.settings || {}, { motionEnabled: true }) })).then(() => 'on')`);
    await cc.ev(`chrome.runtime.sendMessage({ type: 'settings:changed' }).then(() => 'sent').catch(() => 'sent')`);
    await sleep(900);
    const back2 = await sample();
    check('再打开动效也同样即时生效（回到 qf-halo）', back2.haloName === 'qf-halo', back2.haloName);
    cc.ws.close();
    await fetch('http://127.0.0.1:' + PORT + '/json/close/' + cfg.id).catch(() => {});
    await sleep(400);
  }

  console.log('\n[11] 「去补齐缺项」深链：编辑器直接落在未补齐视图');
  const ed = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' +
    encodeURIComponent(`chrome-extension://${EXT_ID}/popup/editor.html?missing=1`), { method: 'PUT' })).json();
  await sleep(2600);
  const edCtx = (await targets()).find(x => x.id === ed.id);
  if (edCtx) {
    const ec = await connect(edCtx.webSocketDebuggerUrl);
    const view = await ec.ev(`({ missing: document.body.classList.contains('only-missing'),
      btn: (document.querySelector('#btnOnlyMissing') || {}).textContent || '' })`);
    check('带 missing=1 打开时自动进入「只看未补齐项」', view.missing === true && /显示全部字段/.test(view.btn), view);
    ec.ws.close();
    await fetch('http://127.0.0.1:' + PORT + '/json/close/' + ed.id).catch(() => {});
    await sleep(400);
  }
  await c.send('Page.reload', {});
  await c.send('Page.bringToFront', {});   // 窗口被遮挡时 Chromium 会静默丢弃真实鼠标事件，可信输入会退化成逐层重试到超时
  await sleep(3000);
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(500);
  await c.ev(`${SHADOW}.querySelector('[data-act=fill]').click()`);
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    const s = await sample();
    if (!s.busy && s.fillBtnReady) break;
  }
  const fixState = await c.ev(`(() => { const s = ${SHADOW}; const b = s.querySelector('[data-act=fix]');
    return { hidden: b.classList.contains('qf-hidden'), text: b.textContent,
      missing: document.querySelectorAll('.__qf_missing').length }; })()`);
  check('缺项数与「去补齐缺项」按钮的显隐一致',
    (fixState.missing > 0) === !fixState.hidden, fixState);
  check('按钮上带缺项条数', fixState.hidden || fixState.text.indexOf(String(fixState.missing)) >= 0, fixState.text);

  console.log('\n[12] 统计列表：问题行优先显示，必填项带徽标并排在前面');
  await c.ev(`(() => {
    if (document.getElementById('__qf_tmp_req__')) return 1;
    const sec = document.createElement('section');
    sec.id = '__qf_tmp_req__';
    sec.innerHTML = '<h3>临时必填检查</h3>'
      + '<label for="qf-tmp-a">宠物名</label><input id="qf-tmp-a" name="qfTmpPet" required>'
      + '<label for="qf-tmp-b">幸运数字</label><input id="qf-tmp-b" name="qfTmpLucky">';
    document.body.appendChild(sec);
    return 1;
  })()`);
  // 关面板再开一次，触发 analyze → updateOverlay → setStats
  await c.ev(`(() => { const s = ${SHADOW}; if (!s.querySelector('.qf-panel').classList.contains('qf-hidden')) s.querySelector('[data-act=close]').click(); return 1; })()`);
  await sleep(400);
  await c.ev(`${SHADOW}.querySelector('.qf-ball').click()`);
  await sleep(1600);
  const list = await c.ev(`(() => { const s = ${SHADOW};
    const rows = [...s.querySelectorAll('.qf-list .li')].map(li => ({
      lab: (li.querySelector('.lab') || {}).textContent || '',
      req: !!li.querySelector('.qf-req-tag'),
      dotBg: getComputedStyle(li.querySelector('.dot')).backgroundColor }));
    const reqIdx = rows.findIndex(r => r.lab.indexOf('宠物名') >= 0);
    const plainIdx = rows.findIndex(r => r.lab.indexOf('幸运数字') >= 0);
    return { total: rows.length, reqIdx, plainIdx,
      reqTag: reqIdx >= 0 ? rows[reqIdx].req : null,
      plainTag: plainIdx >= 0 ? rows[plainIdx].req : null,
      reqDotBg: reqIdx >= 0 ? rows[reqIdx].dotBg : '',
      plainDotBg: plainIdx >= 0 ? rows[plainIdx].dotBg : '' }; })()`);
  check('必填与未识别行能出现在列表里（不再被上百条已匹配挤出可视区）',
    list.reqIdx >= 0 && list.plainIdx >= 0, list);
  check('必填项带「必填」徽标，非必填没有', list.reqTag === true && list.plainTag === false,
    { reqTag: list.reqTag, plainTag: list.plainTag });
  check('同一组里必填排在前面', list.reqIdx < list.plainIdx, { reqIdx: list.reqIdx, plainIdx: list.plainIdx });
  check('必填行的状态点被改成红色，与普通未识别行区分',
    !!list.reqDotBg && list.reqDotBg !== list.plainDotBg && list.reqDotBg.indexOf('220, 38, 38') >= 0,
    { req: list.reqDotBg, plain: list.plainDotBg });
  await c.ev(`(() => { const t = document.getElementById('__qf_tmp_req__'); if (t) t.remove(); return 1; })()`);

  console.log('\n[13] 从 popup 勾选框改设置：整条链（复选框→存储→两跳广播→页面）真的通');
  // 上一轮正是漏了「把 motionFx 挂进 change 监听数组」，所以必须从 UI 点进去测，不能只写存储
  const pop = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' +
    encodeURIComponent(`chrome-extension://${EXT_ID}/popup/popup.html`), { method: 'PUT' })).json();
  await sleep(1800);
  const popCtx = (await targets()).find(x => x.id === pop.id);
  const pc = popCtx ? await connect(popCtx.webSocketDebuggerUrl) : null;
  if (pc) {
    const box = await pc.ev(`(() => { const b = document.getElementById('motionFx');
      return b ? { found: true, checked: b.checked } : { found: false }; })()`);
    check('popup 里有「交互动效」复选框', box.found === true, box);
    await pc.ev(`(() => { const b = document.getElementById('motionFx'); b.checked = false;
      b.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await sleep(1500);
    const stored = await pc.ev(`chrome.storage.local.get('settings').then(r => String((r.settings || {}).motionEnabled))`);
    check('改勾选框会把 motionEnabled 写进存储（漏挂 change 监听就会在这一步红）', stored === 'false', stored);
    const live = await sample();
    const liveHost = await c.ev(`document.getElementById('__qf_overlay_host__').classList.contains('qf-still')`);
    check('存储改动经 background 转发后，测试页不刷新就停止动效', liveHost === true && live.haloName === 'none',
      { host: liveHost, halo: live.haloName });
    await pc.ev(`(() => { const b = document.getElementById('motionFx'); b.checked = true;
      b.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await sleep(1500);
    const restored = await sample();
    check('再勾回来也即时生效', restored.haloName === 'qf-halo', restored.haloName);
    pc.ws.close();
    await fetch('http://127.0.0.1:' + PORT + '/json/close/' + pop.id).catch(() => {});
    await sleep(400);
  }

  c.ws.close();
  console.log(`\n========== 动效与取消流程: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('运行错误:', e.message); process.exit(2); });
