// 截图验证：popup、editor、测试页（悬浮球/面板/填写高亮）
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const EXT = 'gjdlmpnonidomglamkoohidaepajakgo';

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
  return {
    ws,
    send: (method, params) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); })
  };
}

async function shotAndAssert(targetId, file, expr) {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json();
  const t = list.find(x => x.id === targetId);
  const c = await connect(t.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await fetch('http://127.0.0.1:9222/json/activate/' + targetId);
  await sleep(700);
  if (expr) {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    console.log(file, 'assert:', JSON.stringify(r.result && r.result.result && r.result.result.value));
  }
  const s = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  console.log('saved', file);
  c.ws.close();
  return t;
}

(async () => {
  fs.mkdirSync('shots', { recursive: true });

  // 1. popup
  const popup = await (await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(`chrome-extension://${EXT}/popup/popup.html`), { method: 'PUT' })).json();
  await sleep(1200);
  await shotAndAssert(popup.id, 'shots/popup.png', `JSON.stringify({
    resumes: document.querySelectorAll('.resume-item').length,
    name: (document.querySelector('.r-name')||{}).textContent,
    active: !!document.querySelector('.resume-item.active')
  })`);

  // 2. editor（读取第一份简历 id 后打开）
  const c1 = await connect(popup.webSocketDebuggerUrl);
  const rid = await c1.send('Runtime.evaluate', { expression: `ResumeStore.getResumes().then(l=>l[0].id)`, returnByValue: true, awaitPromise: true });
  const resumeId = rid.result.result.value;
  c1.ws.close();
  const editor = await (await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(`chrome-extension://${EXT}/popup/editor.html?id=${resumeId}`), { method: 'PUT' })).json();
  await sleep(1500);
  await shotAndAssert(editor.id, 'shots/editor.png', `JSON.stringify({
    sections: document.querySelectorAll('.section-card').length,
    name: document.getElementById('resumeName').value,
    nameField: (document.querySelector('#sec-basic input')||{}).value,
    eduItems: document.querySelectorAll('#sec-education .array-item').length
  })`);

  // 3. 测试页：打开面板截图
  const list = await (await fetch('http://127.0.0.1:9222/json')).json();
  const page = list.find(x => x.type === 'page' && x.url.includes('test-form'));
  const c2 = await connect(page.webSocketDebuggerUrl);
  await c2.send('Page.enable'); await c2.send('Runtime.enable');
  await fetch('http://127.0.0.1:9222/json/activate/' + page.id);
  await sleep(500);
  const ev = async expr => (await c2.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
  await ev(`(()=>{const s=document.getElementById('__qf_overlay_host__').shadowRoot; if(s.querySelector('.qf-panel').classList.contains('qf-hidden')) s.querySelector('.qf-ball').click(); return true})()`);
  await sleep(500);
  const s1 = await c2.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('shots/page-panel.png', Buffer.from(s1.result.data, 'base64'));
  console.log('saved shots/page-panel.png');

  // 4. 一键填写后高亮截图
  await ev(`document.getElementById('__qf_overlay_host__').shadowRoot.querySelector('[data-act=fill]').click()`);
  await sleep(1800);
  const s2 = await c2.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('shots/page-filled.png', Buffer.from(s2.result.data, 'base64'));
  console.log('saved shots/page-filled.png');
  console.log('filled check:', await ev(`document.querySelector('[name=realname]').value`));
  c2.ws.close();

  // 清理测试标签页
  await fetch('http://127.0.0.1:9222/json/close/' + popup.id);
  await fetch('http://127.0.0.1:9222/json/close/' + editor.id);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
