// 开发期工具：打开简历编辑器并截图（校验新增板块 / 起止时间 / 多标签）
const fs = require('fs');
const EXT = 'gjdlmpnonidomglamkoohidaepajakgo';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = async () => (await (await fetch('http://127.0.0.1:9222/json')).json());

async function conn(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m); pend.delete(m.id); } };
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, r => res(r)); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : r; };
  await send('Page.enable'); await send('Runtime.enable');
  return { ws, send, ev };
}

(async () => {
  let page = (await json()).find(x => x.type === 'page' && x.url.includes('editor.html'));
  if (!page) {
    const sw = (await json()).find(x => x.type === 'service_worker' && x.url.includes(EXT));
    const s = await conn(sw);
    const rid = await s.ev('chrome.storage.local.get("resumes").then(a => (a.resumes||[]).find(x=>/示例简历/.test(x.name)).id)');
    s.ws.close();
    page = await (await fetch('http://127.0.0.1:9222/json/new?chrome-extension://' + EXT + '/popup/editor.html?id=' + rid, { method: 'PUT' })).json();
    await sleep(3500);
  }
  const c = await conn(page);
  const info = await c.ev(`JSON.stringify({
    secs: document.querySelectorAll('.section-card').length,
    fields: document.querySelectorAll('.field').length,
    periods: document.querySelectorAll('[data-period]').length,
    periodSample: (document.querySelector('[data-period]')||{}).value || '',
    tags: document.querySelectorAll('.tags-box').length,
    tagChips: [...document.querySelectorAll('.tag-chip')].map(e=>e.textContent.replace('×','')),
    secTitles: [...document.querySelectorAll('.section-card h2')].map(e=>e.childNodes[0].textContent.trim())
  })`);
  console.log(info);
  await c.ev(`(()=>{const el=document.getElementById('sec-intention');if(el)el.scrollIntoView();return 1;})()`);
  await sleep(700);
  let s = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('shots/editor-tags-periods.png', Buffer.from(s.data, 'base64'));
  await c.ev(`(()=>{const el=document.getElementById('sec-internship');if(el)el.scrollIntoView();return 1;})()`);
  await sleep(700);
  s = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('shots/editor-internship.png', Buffer.from(s.data, 'base64'));
  console.log('saved shots/editor-tags-periods.png, shots/editor-internship.png');
  c.ws.close();
})();
