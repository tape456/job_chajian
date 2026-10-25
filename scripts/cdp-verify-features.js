// CDP 验证：#8 上传简历解析（popup 文件输入）+ #9 多简历按站点记忆复用（siteBindings）
const WS = 'http://127.0.0.1:' + (process.argv[2] || '9222') + '/json';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 动态发现扩展 ID：从 service worker 目标中按 manifest 名称匹配（不同 profile 下 ID 不同，不能写死）
async function findExtId() {
  const targets = await (await fetch(WS)).json();
  const sws = targets.filter(x => x.type === 'service_worker');
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
      if (name === '央国企网申速填简历') return sw.url.replace('chrome-extension://', '').split('/')[0];
    } catch (e) {}
  }
  throw new Error('未找到扩展 service worker（扩展未加载？）');
}

async function listTargets() { return (await fetch(WS)).json(); }
async function getTarget(urlPart) {
  const t = (await listTargets()).find(x => x.type === 'page' && x.url.includes(urlPart));
  if (!t) throw new Error('未找到页面目标: ' + urlPart);
  return t.webSocketDebuggerUrl;
}
async function openTab(url) {
  await fetch(WS.replace('/json', '/json/new?' + encodeURIComponent(url)), { method: 'PUT' });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) {
        const { resolve, reject } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
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
    if (r.exceptionDetails) throw new Error('异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }
  close() { this.ws.close(); }
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

(async () => {
  // ---------- #8 上传解析 ----------
  console.log('\n[8] Popup 上传简历解析（DOCX）');
  const EXT = await findExtId();
  console.log('    扩展 ID:', EXT);
  // 清理旧的同名解析简历，避免重复累积
  await openTab('chrome-extension://' + EXT + '/popup/popup.html');
  await sleep(1500);
  const popWs = await getTarget('popup/popup.html');
  const pop = await CDP.connect(popWs);

  const before = await pop.evaluate("new Promise(r=>chrome.storage.local.get('resumes',d=>r((d.resumes||[]).length)))");
  await pop.evaluate(`(async()=>{const s=await new Promise(r=>chrome.storage.local.get('resumes',d=>r(d.resumes||[])));const f=s.filter(x=>!/sample-resume-解析/.test(x.name||''));await new Promise(r=>chrome.storage.local.set({resumes:f},r));})()`);

  await pop.send('DOM.enable');
  const { root } = await pop.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await pop.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileParse' });
  check('找到文件输入 #fileParse', !!nodeId, nodeId);
  await pop.send('DOM.setFileInputFiles', { files: ['D:\\job_chajian\\test\\sample-resume.docx'], nodeId });
  await sleep(2500);

  const store = await pop.evaluate("new Promise(r=>chrome.storage.local.get(['resumes','activeResumeId'],d=>r(d)))");
  const parsed = (store.resumes || []).find(x => /sample-resume-解析/.test(x.name || ''));
  check('已创建解析简历', !!parsed, parsed && parsed.name);
  if (parsed) {
    const d = parsed.data || {};
    check('解析·姓名', d.basic && d.basic.name === '张三', d.basic && d.basic.name);
    check('解析·手机', d.basic && d.basic.phone === '13900139000', d.basic && d.basic.phone);
    check('解析·期望岗位', d.intention && d.intention.expectedJob === '软件开发工程师', d.intention && d.intention.expectedJob);
    check('解析·公司名完整', d.work && d.work[0] && d.work[0].company === '中国移动通信集团有限公司', d.work && d.work[0] && d.work[0].company);
    check('解析·职务', d.work && d.work[0] && d.work[0].position === '软件开发工程师', d.work && d.work[0] && d.work[0].position);
    check('解析·教育≥2', d.education && d.education.length >= 2, d.education && d.education.length);
    check('解析后设为默认', store.activeResumeId === parsed.id);
  }

  // ---------- #9 站点记忆复用 ----------
  console.log('\n[9] 多简历按站点记忆复用（siteBindings）');
  const pageWs = await getTarget('test-form.html');
  const page = await CDP.connect(pageWs);
  const opts = await page.evaluate(`(()=>{const h=document.getElementById('__qf_overlay_host__');if(!h||!h.shadowRoot)return null;const sel=h.shadowRoot.querySelector('[data-role=resume]');return {value:sel.value, ids:[...sel.options].map(o=>o.value)};})()`);
  check('悬浮球含多份简历可选', opts && opts.ids.length >= 2, opts && opts.ids.length);
  const target = opts && opts.ids.find(i => i !== opts.value);
  check('存在可切换的其他简历', !!target, target);

  if (target) {
    await page.evaluate(`(()=>{const s=document.getElementById('__qf_overlay_host__').shadowRoot;const sel=s.querySelector('[data-role=resume]');sel.value=${JSON.stringify(target)};sel.dispatchEvent(new Event('change'));return sel.value;})()`);
    await sleep(1000);
    const sb = await pop.evaluate("new Promise(r=>chrome.storage.local.get('siteBindings',d=>r(d.siteBindings||{})))");
    check('站点绑定已写入 127.0.0.1', sb['127.0.0.1'] === target, sb);

    await page.send('Page.enable');
    await page.send('Page.reload', { ignoreCache: true });
    await sleep(3000);
    const after = await page.evaluate(`(()=>{const h=document.getElementById('__qf_overlay_host__');if(!h||!h.shadowRoot)return null;const sel=h.shadowRoot.querySelector('[data-role=resume]');return {value:sel.value, hint:sel.title};})()`);
    check('刷新后自动复用绑定简历', after && after.value === target, after && after.value);
    check('提示语标注为本站记忆', after && /记忆/.test(after.hint || ''), after && after.hint);
  }

  pop.close(); page.close();
  console.log('\n========== 结果:', pass, '通过 /', fail, '失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('运行错误:', e.message); process.exit(2); });
