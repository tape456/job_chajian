// 专项验证：扩展重载后，已打开且未刷新的页面能否自动恢复出一个可用的悬浮球
// 用法：node scripts/cdp-verify-reinject.js [调试端口，默认 9222]
// 前置：node scripts/test-server.js + 已打开 http://127.0.0.1:8123/test/test-form.html
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

const PROBE = `(async () => {
  const hosts = document.querySelectorAll('#__qf_overlay_host__');
  const s = hosts[0] && hosts[0].shadowRoot;
  const ball = s && s.querySelector('.qf-ball');
  const r = ball && ball.getBoundingClientRect();
  let panelOk = false, acts = 0;
  if (ball) {
    ball.click();
    await new Promise(x => setTimeout(x, 300));
    const panel = s.querySelector('.qf-panel');
    panelOk = !!panel && !panel.classList.contains('qf-hidden');
    acts = panel ? panel.querySelectorAll('[data-act]').length : 0;
    if (panelOk) panel.querySelector('[data-act=close]').click();
  }
  return { hosts: hosts.length, ball: !!ball, visible: !!ball && !ball.classList.contains('qf-hidden'),
    inView: !!r && r.width > 0 && r.right <= innerWidth + 2 && r.bottom <= innerHeight + 2, panelOk, acts };
})()`;

(async () => {
  const page = (await targets()).find(x => x.type === 'page' && /test-form\.html/.test(x.url));
  if (!page) { console.log('找不到 test-form 页，请先打开 http://127.0.0.1:8123/test/test-form.html'); process.exit(2); }

  // 1. 先刷新一次，确保页面里跑的是当前代码，并唤醒 Service Worker
  let c = await connect(page.webSocketDebuggerUrl);
  await c.send('Page.reload', {});
  await sleep(3000);
  const before = await c.ev(PROBE);
  console.log('\n[1] 正常加载');
  check('页面刷新后有一个可用悬浮球', before.hosts === 1 && before.visible && before.panelOk, before);
  c.ws.close();

  // 2. 重载扩展（不刷新页面）
  let sw = (await targets()).find(x => x.type === 'service_worker' && /background\.js$/.test(x.url));
  if (!sw) { console.log('  (找不到扩展 Service Worker，跳过重载)'); process.exit(1); }
  const sc = await connect(sw.webSocketDebuggerUrl);
  await sc.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()' });
  sc.ws.close();
  console.log('\n[2] 扩展已重载，页面保持不刷新');
  await sleep(6000);

  // 3. 球应当自动补回来，且只有一个、仍可点开
  c = await connect((await targets()).find(x => x.id === page.id).webSocketDebuggerUrl);
  const after = await c.ev(PROBE);
  check('未刷新的页面自动恢复悬浮球（补注入生效）', after.visible === true, after);
  check('页面上只有一个悬浮球宿主（旧孤儿球已拆台）', after.hosts === 1, after);
  check('恢复后的球仍可点开面板', after.panelOk === true && after.acts >= 10, after);

  // 4. 恢复后一键填写依然可用
  const filled = await c.ev(`(async () => {
    const s = document.getElementById('__qf_overlay_host__').shadowRoot;
    s.querySelector('.qf-ball').click();
    s.querySelector('[data-act=fill]').click();
    await new Promise(r => setTimeout(r, 4500));
    const g = n => (document.querySelector('[name=' + n + ']') || {}).value || '';
    return { name: g('realname'), mobile: g('mobile') };
  })()`);
  check('补注入后一键填写仍能写入表单', !!filled.name && !!filled.mobile, filled);
  c.ws.close();

  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  console.log('提示：若「自动恢复」失败，多半是浏览器把该扩展的站点访问权限设成了受限，此时点工具栏图标 →「立即填写」仍可强制注入或提示刷新。');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试驱动异常:', e.message); process.exit(2); });
