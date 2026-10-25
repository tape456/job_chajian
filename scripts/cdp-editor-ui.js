// 编辑器 UI 验证：打开 editor.html，断言内容导航统计与「查看未补齐项」视图，并截图
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = process.argv[2] || '9222';
const WS = `http://127.0.0.1:${PORT}/json`;

async function findExtId() {
  const targets = await (await fetch(WS)).json();
  for (const sw of targets.filter(x => x.type === 'service_worker')) {
    try {
      const ws = new WebSocket(sw.webSocketDebuggerUrl);
      let id = 0; const pending = new Map();
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      await new Promise(r => ws.onopen = r);
      const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
      const r = await send('Runtime.evaluate', { expression: "fetch('/manifest.json').then(r=>r.json()).then(j=>j.name)", returnByValue: true, awaitPromise: true });
      const name = r.result.result.value;
      ws.close();
      if (name === '央国企网申速填简历') return sw.url.replace('chrome-extension://', '').split('/')[0];
    } catch (e) {}
  }
  throw new Error('未找到扩展 service worker');
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

(async () => {
  const EXT = await findExtId();
  console.log('扩展 ID:', EXT);

  const tab = await (await fetch(WS + '/new?' + encodeURIComponent(`chrome-extension://${EXT}/popup/editor.html`), { method: 'PUT' })).json();
  await sleep(1800);
  const list = await (await fetch(WS)).json();
  const t = list.find(x => x.id === tab.id);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '').slice(0, 200);
    return r.result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.bringToFront');
  await sleep(600);

  console.log('\n[A. 内容导航统计]');
  const stats = await ev(`(() => ({
    filled: document.getElementById('navFilled').textContent,
    total: document.getElementById('navTotal').textContent,
    percent: document.getElementById('navPercent').textContent,
    missing: document.getElementById('navMissing').textContent,
    barW: document.getElementById('navProgress').style.width
  }))()`);
  console.log('   ', JSON.stringify(stats));
  check('总览：已填/总数存在', /^\d+$/.test(stats.filled) && parseInt(stats.total) > 0, stats);
  check('总览：完成度百分比', /%$/.test(stats.percent), stats.percent);
  check('总览：未补齐项数', /未补齐 \d+ 项|已全部补齐/.test(stats.missing), stats.missing);
  check('总览：进度条宽度与百分比一致', stats.barW === (stats.percent || '').replace('%', '%'), stats.barW);

  console.log('\n[B. 模块导航项]');
  const navInfo = await ev(`(() => Array.from(document.querySelectorAll('.nav-item')).map(n => ({
    sec: n.dataset.sec,
    title: n.querySelector('.nav-item-title').textContent,
    cnt: n.querySelector('.cnt').textContent,
    badge: n.querySelector('.nav-badge').textContent,
    ring: n.querySelector('.ring-text').textContent
  })))()`);
  console.log('   ', JSON.stringify(navInfo, null, 1));
  const schemaSecs = await ev(`ResumeSchema.SCHEMA.sections.length`);
  check('导航项数量 = 模块数', navInfo.length === schemaSecs, { nav: navInfo.length, schema: schemaSecs });
  check('导航项含 filled/total 计数', navInfo.every(n => /^\d+\/\d+$|^—$/.test(n.cnt)), navInfo.map(n => n.cnt));
  check('未补齐徽标（示例简历应有缺失项）', navInfo.some(n => /未补齐 \d+ 项/.test(n.badge)), navInfo.map(n => n.badge));
  check('导航徽标状态合法（未补齐/已完成/尚未新增）', navInfo.every(n => /^未补齐 \d+ 项$|^已完成$|^尚未新增内容$/.test(n.badge)), navInfo.map(n => n.badge));

  console.log('\n[C. 「查看未补齐项」视图]');
  const before = await ev(`(() => ({ only: document.body.classList.contains('only-missing'), emptyFields: document.querySelectorAll('#formRoot .field.empty').length, filledFields: document.querySelectorAll('#formRoot .field.filled').length }))()`);
  await ev(`document.getElementById('btnOnlyMissing').click()`);
  await sleep(400);
  const after = await ev(`(() => ({
    only: document.body.classList.contains('only-missing'),
    btnText: document.getElementById('btnOnlyMissing').textContent,
    hiddenDoneSecs: document.querySelectorAll('.section-card.done-sec').length,
    emptyFields: document.querySelectorAll('#formRoot .field.empty').length
  }))()`);
  console.log('   before:', JSON.stringify(before), ' after:', JSON.stringify(after));
  check('切换后进入 only-missing 模式', after.only === true, after);
  check('按钮文案变为「显示全部字段」', after.btnText === '显示全部字段', after.btnText);
  check('已完成模块被隐藏', after.hiddenDoneSecs >= 1, after.hiddenDoneSecs);
  check('未填字段仍展示', after.emptyFields === before.emptyFields && after.emptyFields > 0, { before: before.emptyFields, after: after.emptyFields });
  const shotMissing = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync('shots/editor-missing-view.png', Buffer.from(shotMissing.result.data, 'base64'));
  console.log('    saved shots/editor-missing-view.png');

  // 还原
  await ev(`document.getElementById('btnOnlyMissing').click()`);
  await sleep(300);

  console.log('\n[D. 空数组段：删空语言能力后显示「尚未新增内容」]');
  const emptyBadge = await ev(`(async () => {
    const card = document.getElementById('sec-language');
    const del = card.querySelector('[data-act=del]');
    if (!del) return 'NO-DEL-BTN';
    del.click();
    await new Promise(r => setTimeout(r, 400));
    const item = document.querySelector('.nav-item[data-sec=language]');
    return {
      badge: item.querySelector('.nav-badge').textContent,
      cnt: item.querySelector('.cnt').textContent,
      cardBadge: card.querySelector('.sec-missing-badge').textContent
    };
  })()`);
  console.log('   ', JSON.stringify(emptyBadge));
  check('空数组段徽标为「尚未新增内容」', emptyBadge.badge === '尚未新增内容', emptyBadge);
  check('空数组段计数显示 —', emptyBadge.cnt === '—', emptyBadge);

  console.log('\n[E. 交互：填写空字段后统计实时更新]');
  const filledBefore = await ev(`document.getElementById('navFilled').textContent`);
  await ev(`(() => { const i = document.querySelector('#formRoot .field.empty input'); i.value = '测试值'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(400);
  const filledAfter = await ev(`document.getElementById('navFilled').textContent`);
  check('输入后已填计数 +1', parseInt(filledAfter) === parseInt(filledBefore) + 1, { filledBefore, filledAfter });
  const fieldCls = await ev(`(() => { const i = document.querySelector('#sec-education .field.empty input, #sec-education .field.filled input'); return { wrap: i.closest('.field').className, tag: i.closest('.field').querySelector('.tag-missing').style.display }; })()`);
  check('字段填充态切换为 filled', /filled/.test(fieldCls.wrap) && !/empty/.test(fieldCls.wrap), fieldCls);

  console.log('\n[F. 导航点击滚动（重载页面隔离前序步骤副作用）]');
  await send('Page.reload', { ignoreCache: false });
  await sleep(2500);
  const restored = await ev(`(() => ({ only: document.body.classList.contains('only-missing'), doneSecs: document.querySelectorAll('.section-card.done-sec').length, filled: document.getElementById('navFilled').textContent }))()`);
  console.log('    重载后状态:', JSON.stringify(restored));
  const scrolled = await ev(`(async () => {
    document.querySelector('.nav-item[data-sec="family"]').click();
    // 平滑滚动长距离可能超过 1.6s：轮询直到滚动位置稳定
    let lastY = -1, stable = 0;
    for (let i = 0; i < 40 && stable < 6; i++) {
      await new Promise(r => setTimeout(r, 150));
      const y = Math.round(window.scrollY);
      if (y === lastY) stable++; else { stable = 0; lastY = y; }
    }
    const act = document.querySelector('.nav-item.active');
    return { y: Math.round(window.scrollY), activeSec: act ? act.dataset.sec : null };
  })()`);
  check('点击家庭成员后页面滚动', scrolled.y > 100, scrolled);
  check('滚动后导航高亮跟随', scrolled.activeSec === 'family', scrolled);

  console.log('\n[F. 编辑器默认视图截图]');
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync('shots/editor.png', Buffer.from(shot.result.data, 'base64'));
  console.log('    saved shots/editor.png');

  ws.close();
  console.log(`\n========== 编辑器 UI 验证: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('运行错误:', e.message); process.exit(2); });
