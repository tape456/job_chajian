// 验证「可信输入」链路：扩展经 chrome.debugger 派发的事件，页面必须收到 isTrusted=true，
// 并且只有真实事件才点得动的组件，要能被自动填对。
//
// 用法: node scripts/cdp-verify-trusted-input.js [调试端口，默认 9222]
// 前置: node scripts/test-server.js
//       以 --remote-debugging-port=9222 --load-extension=<本目录> 启动 Edge，
//       并打开 http://127.0.0.1:8123/test/test-form.html
//
// 为什么不像 cdp-test.js 那样连页面 target：一个标签页只允许一个调试客户端。
// 本用例里扩展自己要用 chrome.debugger 去派发输入事件，脚本若连上页面就把它挤掉了
// （表现为 debugger_busy，看起来像功能坏了）。所以：
//   · 驱动：连**扩展的 service worker** 目标，用 chrome.tabs.sendMessage 触发 doFill
//   · 断言：纯 HTTP /json/list 读页面 title（夹具把可信计数与两个级联的取值写进 title）
const PORT = process.argv[2] || '9222';
const LIST = 'http://127.0.0.1:' + PORT + '/json';
const EXT_ID = 'gjdlmpnonidomglamkoohidaepajakgo';
const PAGE_URL = 'http://127.0.0.1:8123/test/test-form.html';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function targets() { return await (await fetch(LIST)).json(); }

function pick(list, pred, what) {
  const t = list.find(pred);
  if (!t) throw new Error('未找到目标: ' + what);
  return t;
}

// MV3 的 service worker 空闲几十秒就被回收，/json 里随之消失。
// 开一次扩展页把它唤醒（popup 一加载 SW 就活），拿到目标后再关掉。
async function wakeServiceWorker() {
  let list = await targets();
  if (list.some(t => t.type === 'service_worker' && t.url.includes(EXT_ID))) return list;
  const created = await (await fetch(LIST + '/new?chrome-extension://' + EXT_ID + '/popup/popup.html', { method: 'PUT' })).json();
  await sleep(2500);
  list = await targets();
  if (created && created.id) { try { await fetch(LIST + '/close/' + created.id); } catch (e) {} }
  return list;
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('执行异常: ' + JSON.stringify(
        (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  close() { this.ws.close(); }
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

// 夹具标题形状：速填自测 T<可信>/N<不可信> D<可信down>M<可信up>C<可信click> R4[..] R4S[..]
async function readTitle() {
  const list = await targets();
  const page = pick(list, t => t.type === 'page' && /127\.0\.0\.1:8123/.test(t.url), '测试页面');
  const title = String(page.title || '');
  const num = re => { const m = title.match(re); return m ? Number(m[1]) : 0; };
  return {
    title,
    trusted: num(/T(\d+)/),
    untrusted: num(/\/N(\d+)/),
    down: num(/D(\d+)/),
    up: num(/M(\d+)/),
    click: num(/C(\d+)/),
    city: (title.match(/R4\[([^\]]*)\]/) || [])[1] || '',
    archive: (title.match(/R4S\[([^\]]*)\]/) || [])[1] || ''
  };
}

function filled(v) { return /北京/.test(v) && /海淀/.test(v); }

(async () => {
  const list0 = await wakeServiceWorker();
  const sw = pick(list0, t => t.type === 'service_worker' && t.url.includes(EXT_ID), '扩展 service worker');
  const cdp = await CDP.connect(sw.webSocketDebuggerUrl);

  console.log('\n[1] 背景会话状态');
  const status = await cdp.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({ url: '${PAGE_URL}' });
    const tabId = tabs[0] && tabs[0].id;
    return Object.assign({ tabId }, await dbgStatus(tabId));
  })()`);
  check('拿到测试页 tabId', typeof status.tabId === 'number', status.tabId);
  check('可信输入开关默认开启', status.enabled === true, status.enabled);
  check('当前无冲突（usable）', status.usable === true, status.reason || '');

  console.log('\n[2] 经 debugger 派发一次真实点击 → 页面应收到 isTrusted=true');
  // 用探针方块（页面上一个普通的 div）先确认「按下/抬起/click 三件套」能送达，
  // 再谈驱动组件——严格模式那个级联只在可信事件上响应，是这条链路的最终判据。
  const before = await readTitle();
  const clicked = await cdp.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({ url: '${PAGE_URL}' });
    // 必须指定 frameId:0 —— 测试页里有 iframe，不指定会被 iframe 的内容脚本先应答（它没有探针元素）
    return await chrome.tabs.sendMessage(tabs[0].id, { type: 'qf:tiSelfTest' }, { frameId: 0 });
  })()`);
  check('TrustedInput.click 成功', clicked && clicked.ok === true, clicked && (clicked.reason || clicked.point || clicked.error));
  await sleep(500);
  const afterClick = await readTitle();
  // 一次真实点击必须同时产生可信 down / up / click：
  // 只涨 down 不涨 up/click = 抬起被丢，组件的 click 监听根本不会触发（面板打不开）。
  check('可信 mousedown 送达', afterClick.down > before.down, { before: before.down, now: afterClick.down });
  check('可信 mouseup 送达', afterClick.up > before.up, { before: before.up, now: afterClick.up });
  check('可信 click 合成', afterClick.click > before.click, { before: before.click, now: afterClick.click });

  console.log('\n[3] 一键填写（不连页面 target，把 debugger 留给扩展自己）');
  await cdp.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({ url: '${PAGE_URL}' });
    await chrome.tabs.reload(tabs[0].id);
    return true;
  })()`);
  await sleep(4000);
  await cdp.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({ url: '${PAGE_URL}' });
    return await chrome.tabs.sendMessage(tabs[0].id, { type: 'doFill' });
  })()`);

  let snap = await readTitle();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    snap = await readTitle();
    if (filled(snap.city) && filled(snap.archive)) break;
    await sleep(700);
  }
  check('自绘四列级联已填对（hover 展开 + 自动点「完成选择」）', filled(snap.city), snap.city);
  check('严格模式级联已填对（合成事件对它无效）', filled(snap.archive), snap.archive);
  check('整轮填写确实用到了可信输入', snap.trusted > 0, { trusted: snap.trusted, untrusted: snap.untrusted });

  console.log('\n[4] 空闲后自动 detach（不长期挂着调试横幅）');
  const detached = await cdp.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({ url: '${PAGE_URL}' });
    const tabId = tabs[0].id;
    await dbgDetach(tabId);
    const s = dbgSessions.get(tabId);
    return { attached: !!(s && s.attached), timer: !!(s && s.timer) };
  })()`);
  check('detach 后会话标记已清除', detached.attached === false, detached);

  cdp.close();
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试驱动异常:', e.message); process.exit(2); });
