// 抓取页面控制台/日志（含内容脚本报错）
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
  const t = targets.find(x => x.type === 'page' && x.url.includes('test-form'));
  if (!t) { console.log('no target'); return; }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const args = m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
      console.log('[console.' + m.params.type + ']', args.slice(0, 500));
    }
    if (m.method === 'Runtime.exceptionDetails' || m.method === 'Runtime.exceptionThrown') {
      console.log('[EXCEPTION]', JSON.stringify(m.params.exceptionDetails && (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)).slice(0, 800));
    }
    if (m.method === 'Log.entryAdded') {
      const en = m.params.entry;
      console.log('[log.' + en.level + ']', (en.source || '') + ' ' + (en.text || '').slice(0, 400), en.url || '');
    }
  };
  const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(4000);
  const r = await send('Runtime.evaluate', { expression: `!!document.getElementById('__qf_overlay_host__')`, returnByValue: true });
  console.log('overlay injected:', JSON.stringify(r.result && r.result.result));
  ws.close();
  process.exit(0);
})();
