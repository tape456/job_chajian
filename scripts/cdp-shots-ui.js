// 视觉自查截图：悬浮球 / 面板 / 进度窗 / 选区遮罩 / 辅助填写
// 用法：node scripts/cdp-shots-ui.js（需 test-server + 带 9222 的测试 Edge）
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
  return {
    ws,
    send: (method, params) => new Promise(res => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
    async ev(expression) {
      const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result && r.result.result && r.result.result.value;
    }
  };
}

(async () => {
  fs.mkdirSync('shots', { recursive: true });
  const list = await (await fetch('http://127.0.0.1:9222/json')).json();
  const t = list.find(x => x.type === 'page' && /127\.0\.0\.1:8123/.test(x.url));
  if (!t) throw new Error('找不到测试页标签，请先打开 http://127.0.0.1:8123/test/test-form.html');
  const c = await connect(t.webSocketDebuggerUrl);
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await fetch('http://127.0.0.1:9222/json/activate/' + t.id);
  await sleep(600);

  const S = "document.getElementById('__qf_overlay_host__').shadowRoot";
  async function shot(name, clip) {
    const r = await c.send('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip: Object.assign({ scale: 1 }, clip) } : {}));
    fs.writeFileSync('shots/' + name, Buffer.from(r.result.data, 'base64'));
    console.log('saved shots/' + name);
  }

  await c.ev(`(() => { const s = ${S}; s.querySelectorAll('.qf-shade').forEach(x => x.remove()); s.querySelector('.qf-panel').classList.add('qf-hidden'); s.querySelector('.qf-ball').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return 1; })()`);
  await sleep(500);
  await c.send('Page.reload', {});
  await sleep(2800);

  // 1. 常驻球（默认右下角）
  await shot('ui-1-ball.png', { x: 1080, y: 420, width: 336, height: 354 });

  // 2. 面板
  await c.ev(`(() => { const s = ${S}; s.querySelector('.qf-ball').click(); return 1; })()`);
  await sleep(700);
  const box = await c.ev(`(() => { const p = ${S}.querySelector('.qf-panel'); const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  console.log('panel box', box);
  await shot('ui-2-panel.png', { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: box.w + 24, height: Math.min(box.h + 24, 860) });

  // 3. 一键填写进度窗（抓中途）
  const P = c.ev(`(() => { ${S}.querySelector('[data-act=fill]').click(); return 1; })()`);
  await sleep(1400);
  await shot('ui-3-progress.png');
  await P;
  await sleep(3500);
  await shot('ui-4-done.png');
  await c.ev(`(() => { ${S}.querySelectorAll('.qf-shade').forEach(x => x.remove()); return 1; })()`);

  // 等填写彻底结束（按钮解除 busy）再截图选区，否则 startRegionFill 会被 filling 拦掉
  for (let i = 0; i < 40; i++) {
    const busy = await c.ev(`(() => { const b = ${S}.querySelector('[data-act=fill]'); return !b || b.disabled; })()`);
    if (!busy) break;
    await sleep(500);
  }
  await c.ev(`(() => { const s = ${S}; s.querySelectorAll('.qf-shade').forEach(x => x.remove()); return 1; })()`);

  // 4. 选区遮罩
  await c.ev(`(() => { const s = ${S}; if (s.querySelector('.qf-panel').classList.contains('qf-hidden')) s.querySelector('.qf-ball').click(); return 1; })()`);
  await sleep(400);
  await c.ev(`(() => { ${S}.querySelector('[data-act=region]').click(); return 1; })()`);
  await sleep(700);
  const hasMask = await c.ev(`(() => !!${S}.querySelector('.qf-select-mask'))()`);
  if (!hasMask) throw new Error('选区遮罩未出现（filling 未结束或被其它状态拦截）');
  await c.ev(`(async () => {
    const s = ${S}; const m = s.querySelector('.qf-select-mask');
    const r = document.querySelector('.qf-region-test').getBoundingClientRect();
    const mk = (t2, x, y) => m.dispatchEvent(new PointerEvent(t2, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 5 }));
    mk('pointerdown', r.left + 3, r.top + 3); mk('pointermove', r.right - 3, r.bottom - 3);
    return 1;
  })()`);
  await sleep(400);
  await shot('ui-5-select.png');
  await c.ev(`(() => { const s = ${S}; const m = s.querySelector('.qf-select-mask'); if (m) { const r = m.getBoundingClientRect(); m.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.right - 3, clientY: r.bottom - 3, button: 0, pointerId: 5 })); } return 1; })()`);
  await sleep(600);
  await shot('ui-6-region-picker.png');
  await c.ev(`(() => { const s = ${S}; s.querySelectorAll('.qf-shade').forEach(x => x.remove()); return 1; })()`);

  // 5. 辅助填写
  await c.ev(`(() => { const s = ${S}; if (s.querySelector('.qf-panel').classList.contains('qf-hidden')) s.querySelector('.qf-ball').click(); return 1; })()`);
  await sleep(400);
  await c.ev(`(() => { ${S}.querySelector('[data-act=helper]').click(); return 1; })()`);
  await sleep(600);
  await shot('ui-7-helper.png');
  c.ws.close();
  console.log('完成');
})().catch(e => { console.error('截图失败:', e.message); process.exit(1); });
