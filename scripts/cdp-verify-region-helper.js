// CDP 验证：新面板 / 选区填写 / 辅助填写 / 记录职位 / 反馈 / 拖动记忆 / 自愈挂载 / iframe 出球
// 用法: node scripts/cdp-verify-region-helper.js [调试端口，默认 9222]
const PORT = process.argv[2] || '9222';
const WS_URL_FETCH = 'http://127.0.0.1:' + PORT + '/json';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getTarget(urlPart) {
  const resp = await fetch(WS_URL_FETCH);
  const targets = await resp.json();
  const t = targets.find(x => x.type === 'page' && x.url.includes(urlPart));
  if (!t) throw new Error('未找到页面目标: ' + urlPart);
  return t.webSocketDebuggerUrl;
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
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async bringToFront() {
    await this.send('Page.enable').catch(() => {});
    await this.send('Page.bringToFront').catch(() => {});
  }
  async reloadPage() {
    await this.send('Page.enable').catch(() => {});
    await this.send('Page.reload', { ignoreCache: false }).catch(() => {});
    await sleep(2600);
  }
  close() { this.ws.close(); }
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

const S = "document.getElementById('__qf_overlay_host__').shadowRoot";

(async () => {
  const pageWs = await getTarget('test-form.html');
  const cdp = await CDP.connect(pageWs);
  await cdp.reloadPage();
  await cdp.bringToFront();
  await sleep(1500);

  // ---------------- [1] 新面板结构 ----------------
  console.log('\n[1] 新面板结构（复刻版）');
  const acts = await cdp.evaluate(`(() => {
    const s = ${S};
    s.querySelector('.qf-ball').click();
    return [...s.querySelectorAll('.qf-panel [data-act]')].map(e => e.dataset.act);
  })()`);
  await sleep(200);
  const want = ['fill', 'region', 'helper', 'record', 'jobs', 'manage', 'switch', 'toggleMore', 'tools', 'hideBall', 'help', 'close', 'clear'];
  check('三个主功能按钮齐全', ['fill', 'region', 'helper'].every(a => acts.includes(a)), acts.join(','));
  check('记录职位/管理投递/编辑简历/切换简历齐全', ['record', 'jobs', 'manage', 'switch'].every(a => acts.includes(a)));
  check('隐藏悬浮球与清除标记入口存在', acts.includes('hideBall') && acts.includes('clear'));
  const texts = await cdp.evaluate(`(() => {
    const s = ${S};
    return {
      h1: (s.querySelector('.qf-hero .h1') || {}).textContent || '',
      badge: (s.querySelector('.qf-hero .qf-badge') || {}).textContent || '',
      tagline: (s.querySelector('.qf-hero .h2') || {}).textContent || '',
      title: s.querySelector('.qf-head .t').textContent,
      tool: s.querySelector('.qf-tool-card').textContent,
      note: (s.querySelector('.qf-body .qf-note') || {}).textContent || '',
      radius: getComputedStyle(s.querySelector('.qf-btn')).borderRadius,
      ballBg: getComputedStyle(s.querySelector('.qf-ball')).backgroundImage.slice(0, 40)
    };
  })()`);
  check('面板主视觉复刻（标题/徽章/副标题）',
    texts.h1.includes('简历自动填写助手') && /求职提效/.test(texts.badge) && /自动识别招聘表单/.test(texts.tagline), texts.h1 + ' | ' + texts.badge);
  check('面板含「先编辑简历再填写」引导', /编辑简历/.test(texts.note), texts.note.slice(0, 24));
  check('按钮采用胶囊圆角（参考站设计语言）', parseFloat(texts.radius) >= 999, texts.radius);
  check('悬浮球为品牌蓝渐变', /gradient/.test(texts.ballBg) && /21, 101, 255|1565FF|#1565/i.test(texts.ballBg), texts.ballBg);

  // ---------------- [2] 记录职位 / 管理投递 ----------------
  console.log('\n[2] 记录职位 / 管理投递（本地记录）');
  const recDlg = await cdp.evaluate(`(() => {
    const s = ${S};
    s.querySelector('[data-act=record]').click();
    const d = s.querySelector('.qf-shade .qf-dialog');
    if (!d) return null;
    return { title: d.querySelector('h3').textContent, url: d.querySelectorAll('input')[1].value, actions: [...d.querySelectorAll('.qf-dialog-actions .qf-btn')].map(b => b.textContent) };
  })()`);
  check('记录职位弹窗出现且预填当前网址', recDlg && recDlg.url.includes('test-form.html'), recDlg && recDlg.url);
  await cdp.evaluate(`(() => {
    const s = ${S};
    const d = s.querySelector('.qf-shade .qf-dialog');
    [...d.querySelectorAll('.qf-dialog-actions .qf-btn')].find(b => b.textContent.includes('保存')).click();
    return true;
  })()`);
  await sleep(400);
  const afterSave = await cdp.evaluate(`(() => {
    const s = ${S};
    return { toast: s.querySelector('.qf-toast').textContent, shadeOpen: !!s.querySelector('.qf-shade') };
  })()`);
  check('保存后提示已记录', /已记录/.test(afterSave.toast || ''), afterSave.toast);
  check('弹窗已关闭', !afterSave.shadeOpen);
  const jobsView = await cdp.evaluate(`(async () => {
    const s = ${S};
    s.querySelector('[data-act=jobs]').click();
    await new Promise(r => setTimeout(r, 400));
    const d = s.querySelector('.qf-shade .qf-dialog.qf-jobs');
    if (!d) return null;
    return { rows: d.querySelectorAll('.qf-job').length, first: (d.querySelector('.qf-job .ti') || {}).textContent || '' };
  })()`);
  check('管理投递列出刚保存的记录', jobsView && jobsView.rows >= 1 && /网上报名/.test(jobsView.first || ''), jobsView);
  // 清空历史脏记录，保证下一轮「1 条」这类断言可复现
  await cdp.evaluate(`(async () => {
    const s = ${S};
    const d = s.querySelector('.qf-shade .qf-dialog.qf-jobs');
    if (d) { [...d.querySelectorAll('.qf-dialog-actions .qf-btn')].find(b => b.textContent.includes('清空'))?.click(); await new Promise(r => setTimeout(r, 400)); }
    return 1;
  })()`);
  await cdp.evaluate(`(() => { const s = ${S}; const d = s.querySelector('.qf-shade .qf-dialog.qf-jobs'); [...d.querySelectorAll('.qf-dialog-actions .qf-btn')].find(b => b.textContent.includes('关闭')).click(); return true; })()`);
  await sleep(200);

  // ---------------- [3] 选区填写 ----------------
  console.log('\n[3] 选区填写（框选一组经历 → 选记录 → 只填圈内）');
  const picker = await cdp.evaluate(`(async () => {
    const s = ${S};
    const panel = s.querySelector('.qf-panel');
    if (panel.classList.contains('qf-hidden')) s.querySelector('.qf-ball').click();
    s.querySelector('[data-act=region]').click();
    await new Promise(r => setTimeout(r, 250));
    const mask = s.querySelector('.qf-select-mask');
    if (!mask) return { err: 'no-mask' };
    const ms = getComputedStyle(mask);
    const mr = mask.getBoundingClientRect();
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    // 立刻快照：框选结束后遮罩会被移除，live CSSStyleDeclaration 之后再读会全空
    const maskInfo = {
      pos: ms.position, z: ms.zIndex, cursor: ms.cursor,
      w: Math.round(mr.width), h: Math.round(mr.height),
      full: mr.width >= document.documentElement.clientWidth - 2 && mr.height >= document.documentElement.clientHeight - 2,
      hit: !!hit && hit.id === '__qf_overlay_host__'
    };
    const rect = document.querySelector('.qf-region-test').getBoundingClientRect();
    const mk = (t, x, y) => mask.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 3 }));
    mk('pointerdown', rect.left + 2, rect.top + 2);
    mk('pointermove', rect.right - 2, rect.bottom - 2);
    mk('pointerup', rect.right - 2, rect.bottom - 2);
    await new Promise(r => setTimeout(r, 350));
    const d = s.querySelector('.qf-dialog.qf-rk');
    if (!d) return { err: 'no-picker' };
    return {
      title: d.querySelector('h3').textContent,
      sub: d.querySelector('.qf-sub').textContent,
      modules: [...d.querySelectorAll('.qf-rk-mod .mk')].map(e => e.textContent),
      preview: d.querySelectorAll('.qf-rk-preview .qf-rk-fchip').length,
      warn: d.querySelector('.qf-warn-bar').textContent,
      mask: maskInfo
    };
  })()`);
  check('确认选区填写弹窗出现', picker && picker.title === '确认选区填写', picker && picker.err);
  check('框选遮罩为全屏可交互层（曾有缺样式导致选区不可用）',
    !!picker && picker.mask.pos === 'fixed' && picker.mask.full &&
    picker.mask.cursor === 'crosshair' && picker.mask.hit,
    picker && picker.mask);
  // 遮罩层级必须低于悬浮球（2147483000），否则框选期间点不到球、无法中止
  check('遮罩层级低于悬浮球，框选期间仍可点球中止',
    Number(picker.mask.z) > 0 && Number(picker.mask.z) < 2147483000, picker && picker.mask.z);
  check('左侧模块列表含工作经历与实习经历', picker && /工作/.test(picker.modules.join()) && /实习/.test(picker.modules.join()), picker && picker.modules);
  check('中部区域预览列出圈内字段', picker && picker.preview > 0, picker && picker.preview);
  check('警告「一次只能框选一组」', picker && /一次只能框选一组/.test(picker.warn || ''));
  const confirmed = await cdp.evaluate(`(() => {
    const s = ${S};
    const d = s.querySelector('.qf-dialog.qf-rk');
    // 框选的是实习经历那一组，优先选「实习经历」板块（拆分后工作经历/实习经历是两个模块）
    const mods = [...d.querySelectorAll('.qf-rk-mod')];
    const workMod = mods.find(b => /实习/.test(b.textContent)) || mods.find(b => /工作/.test(b.textContent));
    if (!workMod) return { err: 'no-work-module' };
    workMod.click();
    const items = [...d.querySelectorAll('.qf-rk-item')];
    if (!items.length) return { err: 'no-items' };
    items[0].click();
    [...d.querySelectorAll('.qf-dialog-actions .qf-btn')].find(b => b.textContent.includes('确认填写')).click();
    return { itemLabel: items[0].textContent };
  })()`);
  check('可选中第 1 组记录并确认', confirmed && !confirmed.err, confirmed);
  await sleep(900);
  const regionVals = await cdp.evaluate(`(() => {
    const g = n => (document.querySelector('[name=' + n + ']') || {}).value || '';
    const c = n => { const e = document.querySelector('[name=' + n + ']'); return e ? e.className : ''; };
    return {
      company: g('rgCompany'), position: g('rgPosition'), period: g('rgPeriod'),
      outside: g('rgOutsideCompany'), cls: c('rgCompany')
    };
  })()`);
  check('圈内 工作单位 已填入', regionVals.company.includes('华能'), regionVals.company);
  check('圈内 职务 已填入', regionVals.position.length > 0, regionVals.position);
  check('圈内 工作时间段 已填入', /2024/.test(regionVals.period || ''), regionVals.period);
  check('圈内字段绿色高亮', regionVals.cls.includes('__qf_filled'), regionVals.cls);
  check('圈外同名「工作单位」未被写入', regionVals.outside === '', regionVals.outside);

  // ---------------- [3b] 教育经历选区：规则路径方言回归 + 只用所选记录 ----------------
  // 回归的 bug：fillRegion 发的是 education.*.school，规则写的是 education.0.school，
  // 精确相等匹配不上 → 0 项填入且整组标红。修复后必须填进「第 1 组-北京科技大学」那条。
  console.log('\n[3b] 教育经历选区填写（路径方言归一化回归）');
  const eduDrag = await cdp.evaluate(`(async () => {
    const s = ${S};
    const panel = s.querySelector('.qf-panel');
    if (panel.classList.contains('qf-hidden')) s.querySelector('.qf-ball').click();
    await new Promise(r => setTimeout(r, 250));
    s.querySelector('[data-act=region]').click();
    await new Promise(r => setTimeout(r, 300));
    const mask = s.querySelector('.qf-select-mask');
    if (!mask) return { err: 'no-mask' };
    const rect = document.querySelector('.qf-region-edu').getBoundingClientRect();
    const mk = (t, x, y) => mask.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7 }));
    mk('pointerdown', rect.left - 4, rect.top - 4);
    mk('pointermove', rect.right + 4, rect.bottom + 4);
    mk('pointerup', rect.right + 4, rect.bottom + 4);
    await new Promise(r => setTimeout(r, 400));
    const d = s.querySelector('.qf-dialog.qf-rk');
    if (!d) return { err: 'no-picker' };
    const mods = [...d.querySelectorAll('.qf-rk-mod .mk')].map(e => e.textContent);
    const eduMod = [...d.querySelectorAll('.qf-rk-mod')].find(b => /教育(背景|经历)/.test(b.textContent));
    if (!eduMod) return { err: 'no-edu-module', mods };
    eduMod.click();
    await new Promise(r => setTimeout(r, 150));
    const items = [...d.querySelectorAll('.qf-rk-item .lb')].map(e => e.textContent);
    const first = [...d.querySelectorAll('.qf-rk-item')][0];
    first.click();
    [...d.querySelectorAll('.qf-dialog-actions .qf-btn')].find(b => b.textContent.includes('确认填写')).click();
    return { mods, items, picked: first.textContent };
  })()`);
  check('教育背景出现在模块列表', !eduDrag.err && eduDrag.mods.some(m => /教育(背景|经历)/.test(m)), eduDrag.err || eduDrag.mods);
  check('记录列表首条是本科那条', /北京科技大学/.test(eduDrag.picked || ''), eduDrag.picked);
  await new Promise(r => setTimeout(r, 1200));
  const eduVals = await cdp.evaluate(`(() => {
    const g = n => (document.querySelector('[name=' + n + ']') || {}).value || '';
    const cls = n => { const e = document.querySelector('[name=' + n + ']'); return e ? e.className : ''; };
    const block = document.querySelector('.qf-region-edu');
    return {
      school: g('edSchool'), major: g('edMajor'), degree: g('edDegree'), dept: g('edDept'),
      start: g('edStart'), gpa: g('edGpa'),
      missingInBlock: block.querySelectorAll('.__qf_missing').length,
      filledInBlock: block.querySelectorAll('.__qf_filled').length,
      skipInBlock: block.querySelectorAll('.__qf_skip').length,
      toast: ${S}.querySelector('.qf-toast').textContent,
      toastClass: ${S}.querySelector('.qf-toast').className
    };
  })()`);
  check('圈内毕业院校=本科记录（非 latest 的硕士那条）', eduVals.school === '北京科技大学', eduVals.school);
  check('圈内专业/学历/院系/入学/GPA 均取自同一记录',
    eduVals.major === '工商管理' && eduVals.degree === '本科' && eduVals.dept === '经济管理学院'
    && /2018/.test(eduVals.start) && eduVals.gpa === '3.6',
    { major: eduVals.major, degree: eduVals.degree, dept: eduVals.dept, start: eduVals.start, gpa: eduVals.gpa });
  check('不再出现「简历缺该项」红标', eduVals.missingInBlock === 0, eduVals.missingInBlock);
  check('反馈为成功态且标明板块', /已填入 \d+ 项/.test(eduVals.toast) && /教育(背景|经历)/.test(eduVals.toast), eduVals.toast);
  check('成功反馈挂 ok 样式类', /qf-toast-ok/.test(eduVals.toastClass), eduVals.toastClass);

  // ---------------- [3f] 空框选必须诚实反馈，不能报「完成」 ----------------
  console.log('\n[3f] 框选纯文字区域');
  const emptyDrag = await cdp.evaluate(`(async () => {
    const s = ${S};
    if (s.querySelector('.qf-panel').classList.contains('qf-hidden')) s.querySelector('.qf-ball').click();
    await new Promise(r => setTimeout(r, 250));
    s.querySelector('[data-act=region]').click();
    await new Promise(r => setTimeout(r, 300));
    const mask = s.querySelector('.qf-select-mask');
    if (!mask) return { err: 'no-mask' };
    const tip = document.querySelector('p.tip');
    const r = tip.getBoundingClientRect();
    const mk = (t, x, y) => mask.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 8 }));
    mk('pointerdown', r.left, r.top); mk('pointermove', r.right, r.bottom); mk('pointerup', r.right, r.bottom);
    await new Promise(r2 => setTimeout(r2, 500));
    return {
      pickerOpen: !!s.querySelector('.qf-dialog.qf-rk'),
      toast: s.querySelector('.qf-toast').textContent,
      toastClass: s.querySelector('.qf-toast').className
    };
  })()`);
  check('纯文字框选不弹确认窗', !emptyDrag.pickerOpen, emptyDrag);
  check('反馈说明「没有可填写的控件」而非「完成」',
    /没有可填写的控件/.test(emptyDrag.toast || '') && !/完成/.test(emptyDrag.toast || ''), emptyDrag.toast);
  check('该反馈为 warn 样式', /qf-toast-warn/.test(emptyDrag.toastClass || ''), emptyDrag.toastClass);
  await cdp.evaluate(`(() => { const s = ${S}; s.querySelector('.qf-ball').click(); return 1; })()`);
  await new Promise(r => setTimeout(r, 300));

  // ---------------- [4] 辅助填写 ----------------
  console.log('\n[4] 辅助填写（点字段 → 点输入框填入）');
  const helper = await cdp.evaluate(`(async () => {
    const s = ${S};
    const panel = s.querySelector('.qf-panel');
    if (panel.classList.contains('qf-hidden')) s.querySelector('.qf-ball').click();
    s.querySelector('[data-act=helper]').click();
    await new Promise(r => setTimeout(r, 300));
    const h = s.querySelector('.qf-helper');
    if (!h) return { err: 'no-helper' };
    return {
      head: h.querySelector('.qf-helper-head').textContent,
      tip: h.querySelector('.qf-helper-tip').textContent,
      groups: [...h.querySelectorAll('.qf-helper-content h4')].map(e => e.textContent),
      chips: [...h.querySelectorAll('.qf-chip')].map(e => e.textContent),
      hasFeedback: !!h.querySelector('.qf-helper-foot button')
    };
  })()`);
  check('辅助填写面板出现且显示字段总数', helper && /共 \d+ 项/.test(helper.head || ''), helper && helper.head);
  check('提示为两步式', helper && /第一步/.test(helper.tip || ''), helper && helper.tip);
  check('字段按模块分组', helper && (helper.groups || []).length >= 3, helper && (helper.groups || []).slice(0, 4));
  check('含「紧急联系人电话」字段', helper && (helper.chips || []).includes('紧急联系人电话'), helper && (helper.chips || []).length + ' 个字段');
  check('底部有「反馈不适配」入口', helper && helper.hasFeedback);
  const helperFill = await cdp.evaluate(`(async () => {
    const s = ${S};
    const h = s.querySelector('.qf-helper');
    const chip = [...h.querySelectorAll('.qf-chip')].find(c => c.textContent === '紧急联系人电话');
    chip.click();
    await new Promise(r => setTimeout(r, 200));
    const tipAfter = h.querySelector('.qf-helper-tip').textContent;
    const el = document.querySelector('[name=emerRelation]');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    return { tipAfter, value: el.value, toast: s.querySelector('.qf-toast').textContent };
  })()`);
  check('选中后提示切换为「已选择字段…点击输入框」', /已选择字段/.test(helperFill.tipAfter || ''), helperFill.tipAfter);
  check('点击网页输入框后值已填入', helperFill.value === '13900139000', helperFill.value);
  check('填入后有提示', /已填入/.test(helperFill.toast || ''), helperFill.toast);

  // ---------------- [5] 不适配反馈 ----------------
  console.log('\n[5] 反馈不适配');
  const fb = await cdp.evaluate(`(async () => {
    const s = ${S};
    const h = s.querySelector('.qf-helper');
    h.querySelector('.qf-helper-foot button').click();
    await new Promise(r => setTimeout(r, 250));
    const d = s.querySelector('.qf-shade .qf-dialog');
    if (!d) return { err: 'no-feedback-dialog' };
    const title = d.querySelector('h3').textContent;
    const url = d.querySelectorAll('input')[0].value;
    d.querySelector('textarea').value = '测试：辅助填写点输入框填不进去';
    [...d.querySelectorAll('.qf-dialog-actions .qf-btn')].find(b => b.textContent.includes('提交')).click();
    await new Promise(r => setTimeout(r, 300));
    return { title, url, toast: s.querySelector('.qf-toast').textContent };
  })()`);
  check('反馈弹窗出现且带当前网址', fb && fb.title === '反馈不适配' && (fb.url || '').includes('test-form'), fb && fb.err);
  check('提交后有成功提示', /已提交反馈/.test(fb.toast || ''), fb.toast);
  await cdp.evaluate(`(() => { const s = ${S}; const h = s.querySelector('.qf-helper'); if (h) h.querySelector('.qf-helper-head button').click(); return true; })()`);
  await sleep(200);

  // ---------------- [6] 拖动记忆 + 自愈挂载 ----------------
  console.log('\n[6] 拖动位置记忆 + 宿主自愈');
  const drag = await cdp.evaluate(`(() => {
    const s = ${S};
    const b = s.querySelector('.qf-ball');
    const r = b.getBoundingClientRect();
    const mk = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9 }));
    mk('pointerdown', r.left + 20, r.top + 20);
    mk('pointermove', r.left + 20 - 160, r.top + 20 - 120);
    mk('pointerup', r.left + 20 - 160, r.top + 20 - 120);
    return { left: b.style.left, top: b.style.top };
  })()`);
  check('拖动后球位置已改变（内联定位）', !!drag.left && !!drag.top, drag);
  await sleep(600);   // 等位置持久化（防抖 300ms）
  const heal = await cdp.evaluate(`(async () => {
    document.getElementById('__qf_overlay_host__').remove();
    await new Promise(r => setTimeout(r, 1200));
    const h = document.getElementById('__qf_overlay_host__');
    const s = h && h.shadowRoot;
    const b = s && s.querySelector('.qf-ball');
    return { restored: !!h, ball: !!b, left: b ? b.style.left : '', top: b ? b.style.top : '' };
  })()`);
  check('宿主被移除后自动重建（自愈）', heal.restored && heal.ball, heal);
  const px = v => parseFloat(v) || 0;
  check('重建后恢复拖动位置', Math.abs(px(heal.left) - px(drag.left)) < 8 && Math.abs(px(heal.top) - px(drag.top)) < 8,
    { before: drag, after: { left: heal.left, top: heal.top } });
  const mini = await cdp.evaluate(`(async () => {
    const s = ${S};
    if (s.querySelector('.qf-panel').classList.contains('qf-hidden')) s.querySelector('.qf-ball').click();
    s.querySelector('[data-act=hideBall]').click();
    await new Promise(r => setTimeout(r, 150));
    const hiddenBall = s.querySelector('.qf-ball').classList.contains('qf-hidden');
    const hasMini = !!s.querySelector('.qf-mini');
    s.querySelector('.qf-mini').click();
    await new Promise(r => setTimeout(r, 150));
    return { hiddenBall, hasMini, back: !s.querySelector('.qf-ball').classList.contains('qf-hidden') };
  })()`);
  check('「隐藏闪电悬浮按钮」隐藏球并出现边缘恢复入口', mini.hiddenBall && mini.hasMini, mini);
  check('点击恢复入口后球重新显示', mini.back, mini);

  // ---------------- [7] 常驻球：顶层永远有球，iframe 不再抢球 ----------------
  console.log('\n[7] 悬浮球常驻（顶层空壳页也必须有球，iframe 不再抢球）');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8123/test/test-shell-host.html' }).catch(() => {});
  await sleep(4000);
  const shell = await cdp.evaluate(`(() => {
    const topHost = document.getElementById('__qf_overlay_host__');
    const topBall = topHost && topHost.shadowRoot && topHost.shadowRoot.querySelector('.qf-ball');
    const r = topBall && topBall.getBoundingClientRect();
    const f = document.querySelector('iframe');
    const d = f && f.contentDocument;
    const ifHost = d && d.getElementById('__qf_overlay_host__');
    const ifBall = ifHost && ifHost.shadowRoot && ifHost.shadowRoot.querySelector('.qf-ball');
    return {
      topBallVisible: !!(topBall && !topBall.classList.contains('qf-hidden')),
      topBallInViewport: !!(r && r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight),
      iframeBallVisible: !!(ifBall && !ifBall.classList.contains('qf-hidden')),
      topActs: topHost && topHost.shadowRoot ? [...topHost.shadowRoot.querySelectorAll('.qf-panel [data-act]')].length : 0
    };
  })()`);
  check('顶层空壳页常驻显示悬浮球', shell.topBallVisible === true, shell);
  check('球完整落在可视区域内', shell.topBallInViewport === true, shell);
  check('内嵌 iframe 不再单独出球（避免球掉进看不见的小窗）', shell.iframeBallVisible === false, shell);
  const shellFill = await cdp.evaluate(`(async () => {
    const s = document.getElementById('__qf_overlay_host__').shadowRoot;
    s.querySelector('.qf-ball').click();
    s.querySelector('[data-act=fill]').click();
    await new Promise(r => setTimeout(r, 3000));
    const d = document.querySelector('iframe').contentDocument;
    const gi = n => (d.querySelector('[name=' + n + ']') || {}).value || '';
    return { ifName: gi('realname'), ifMobile: gi('mobile'), ifSchool: gi('school') };
  })()`);
  check('顶层球发起的一键填写仍能穿透 iframe 填写', !!shellFill.ifName && !!shellFill.ifMobile, shellFill);
  const shrunk = await cdp.evaluate(`(async () => {
    const s = document.getElementById('__qf_overlay_host__').shadowRoot;
    const b = s.querySelector('.qf-ball');
    Object.assign(b.style, { left: (innerWidth + 400) + 'px', top: (innerHeight + 300) + 'px', right: 'auto', bottom: 'auto' });
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 500));
    const r = b.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  })()`);
  check('窗口变化后越界的球会被拉回可视区', shrunk.inView, shrunk);

  cdp.close();
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试驱动异常:', e.message); process.exit(2); });
