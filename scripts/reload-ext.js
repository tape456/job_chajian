// 按扩展名精确 reload 我们的扩展（CDP）
const port = process.argv[2] || '9223';
const EXT_ID = 'gjdlmpnonidomglamkoohidaepajakgo';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// MV3 的 service worker 空闲几十秒就被回收，/json 里查不到目标；开一次扩展页把它唤醒
async function wakeAndList() {
  let targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  if (targets.some(x => x.type === 'service_worker' && x.url.includes(EXT_ID))) return targets;
  const created = await (await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${EXT_ID}/popup/popup.html`, { method: 'PUT' })).json();
  await sleep(2500);
  targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  if (created && created.id) { try { await fetch(`http://127.0.0.1:${port}/json/close/${created.id}`); } catch (e) {} }
  return targets;
}

(async () => {
  const targets = await wakeAndList();
  const sws = targets.filter(x => x.type === 'service_worker' && /background\.js$/.test(x.url));
  let ours = null;
  for (const sw of sws) {
    try {
      const ws = new WebSocket(sw.webSocketDebuggerUrl);
      let id = 0; const pending = new Map();
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      await new Promise(r => ws.onopen = r);
      const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
      const r = await send('Runtime.evaluate', { expression: "fetch('/manifest.json').then(r=>r.json()).then(j=>j.name)", returnByValue: true, awaitPromise: true });
      const name = r.result.result.value;
      ws.close();
      if (name === '央国企网申速填简历') { ours = sw; break; }
    } catch (e) {}
  }
  if (!ours) { console.log('OUR SW NOT FOUND on port ' + port); process.exit(1); }
  const ws = new WebSocket(ours.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await send('Runtime.evaluate', { expression: 'chrome.runtime.reload()', returnByValue: true });
  console.log('extension reloaded');
  await new Promise(r => setTimeout(r, 2500));
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(2); });
