// CDP 验证：新面板 / 选区填写 / 辅助填写 / 记录职位 / 反馈 / 右边框吸附与纵向记忆 / 自愈挂载 / iframe 出球
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
    const sel = d.querySelector('select');
    return {
      title: d.querySelector('h3').textContent,
      url: d.querySelectorAll('input')[1].value,
      statusOptions: sel ? [...sel.options].map(o => o.textContent) : [],
      statusDefault: sel ? sel.value : '',
      actions: [...d.querySelectorAll('.qf-dialog-actions .qf-btn')].map(b => b.textContent)
    };
  })()`);
  check('记录职位弹窗出现且预填当前网址', recDlg && recDlg.url.includes('test-form.html'), recDlg && recDlg.url);
  check('记录职位可选投递状态（默认已投递）',
    recDlg && recDlg.statusOptions.join('|') === '已投递|笔试|面试|Offer|已结束' && recDlg.statusDefault === 'applied',
    recDlg && { options: recDlg.statusOptions, def: recDlg.statusDefault });
  await cdp.evaluate(`(() => {
    const s = ${S};
    const d = s.querySelector('.qf-shade .qf-dialog');
    const sel = d.querySelector('select');
    if (sel) sel.value = 'interview';
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
    const sel = d.querySelector('.qf-job .st-sel');
    return {
      rows: d.querySelectorAll('.qf-job').length,
      first: (d.querySelector('.qf-job .ti') || {}).textContent || '',
      status: sel ? sel.value : '',
      statusCls: sel ? sel.className : '',
      chips: [...d.querySelectorAll('.qf-jobs-filter')].map(b => b.textContent),
      sub: d.querySelector('.qf-sub').textContent
    };
  })()`);
  check('管理投递列出刚保存的记录', jobsView && jobsView.rows >= 1 && /网上报名/.test(jobsView.first || ''), jobsView);
  check('列表显示为「面试」状态并带对应配色',
    jobsView && jobsView.status === 'interview' && /st-interview/.test(jobsView.statusCls),
    jobsView && { status: jobsView.status, cls: jobsView.statusCls });
  check('筛选条含「全部」与带计数的「面试」',
    jobsView && jobsView.chips.some(t => /全部/.test(t)) && jobsView.chips.some(t => /面试/.test(t) && /1/.test(t)),
    jobsView && jobsView.chips);
  check('统计显示共 1 条、进行中 1 条',
    jobsView && /共 1 条/.test(jobsView.sub) && /进行中 1 条/.test(jobsView.sub), jobsView && jobsView.sub);
  const switched = await cdp.evaluate(`(async () => {
    const s = ${S};
    let d = s.querySelector('.qf-shade .qf-dialog.qf-jobs');
    const sel = d.querySelector('.qf-job .st-sel');
    sel.value = 'offer';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    d = s.querySelector('.qf-shade .qf-dialog.qf-jobs');
    const sel2 = d && d.querySelector('.qf-job .st-sel');
    return { value: sel2 ? sel2.value : '', cls: sel2 ? sel2.className : '', sub: d ? d.querySelector('.qf-sub').textContent : '' };
  })()`);
  check('状态下拉改为 Offer 后即时生效并换配色',
    switched.value === 'offer' && /st-offer/.test(switched.cls), switched);
  check('Offer 不再计入进行中', /进行中 0 条/.test(switched.sub), switched.sub);
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
  const shadeCount = await cdp.evaluate(`(() => ${S}.querySelectorAll('.qf-shade').length)()`);
  check('选区填写结束后进度遮罩已销毁（不留隐藏层挡住后续弹窗）', shadeCount === 0, shadeCount);

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

  // ---------------- [6] 右边框吸附 + 纵向位置记忆 + 自愈挂载 ----------------
  console.log('\n[6] 悬浮球吸附右边框（横向锁死）+ 纵向位置记忆 + 宿主自愈');
  const drag = await cdp.evaluate(`(() => {
    const s = ${S};
    const b = s.querySelector('.qf-ball');
    const r = b.getBoundingClientRect();
    const mk = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9 }));
    mk('pointerdown', r.left + 20, r.top + 20);
    mk('pointermove', r.left + 20 + 260, r.top + 20 - 140);
    mk('pointerup', r.left + 20 + 260, r.top + 20 - 140);
    const n = b.getBoundingClientRect();
    return { top: b.style.top, left: b.style.left, bottom: b.style.bottom, right: n.right, inner: document.documentElement.clientWidth, beforeTop: r.top };
  })()`);
  const px = v => parseFloat(v) || 0;
  check('纵向拖动生效（球沿右边框上移 140px）', !!drag.top && Math.abs((drag.beforeTop - 140) - px(drag.top)) < 12, drag);
  check('横向锁死：向左拽 260px 后球仍贴浏览器右边框', Math.abs(drag.right - drag.inner) < 2, { right: drag.right, inner: drag.inner });
  check('不再写横向内联定位（吸附态只保留纵向）', drag.left === '' && drag.bottom === 'auto', drag);
  await sleep(600);   // 等位置持久化（防抖 300ms）
  const heal = await cdp.evaluate(`(async () => {
    document.getElementById('__qf_overlay_host__').remove();
    await new Promise(r => setTimeout(r, 1200));
    const h = document.getElementById('__qf_overlay_host__');
    const s = h && h.shadowRoot;
    const b = s && s.querySelector('.qf-ball');
    const r = b && b.getBoundingClientRect();
    return { restored: !!h, ball: !!b, top: b ? b.style.top : '', left: b ? b.style.left : '', right: r ? r.right : 0, inner: document.documentElement.clientWidth };
  })()`);
  check('宿主被移除后自动重建（自愈）', heal.restored && heal.ball, heal);
  check('重建后恢复纵向位置且仍贴右边框', Math.abs(px(heal.top) - px(drag.top)) < 8 && Math.abs(heal.right - heal.inner) < 2,
    { before: drag, after: { top: heal.top, right: heal.right, inner: heal.inner } });
  const snap = await cdp.evaluate(`(() => {
    const s = ${S};
    const b = s.querySelector('.qf-ball');
    const r = b.getBoundingClientRect();
    const mk = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 11 }));
    mk('pointerdown', r.left + 20, r.top + 20);
    mk('pointermove', r.left + 20 - 180, r.top + 20);
    mk('pointerup', r.left + 20 - 180, r.top + 20);
    const n = b.getBoundingClientRect();
    return { top: b.style.top, right: n.right, inner: document.documentElement.clientWidth, beforeTop: r.top };
  })()`);
  check('纯横向拖动不移动球（上下左右乱拽已关闭）', Math.abs(snap.right - snap.inner) < 2 && Math.abs(px(snap.top) - px(snap.beforeTop)) < 2, snap);
  const dbl = await cdp.evaluate(`(() => {
    const s = ${S};
    const b = s.querySelector('.qf-ball');
    b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const r = b.getBoundingClientRect();
    return { top: b.style.top, left: b.style.left, right: r.right, inner: document.documentElement.clientWidth, toast: s.querySelector('.qf-toast').textContent };
  })()`);
  check('双击复位回默认高度并提示', dbl.top === '' && dbl.left === '' && Math.abs(dbl.right - dbl.inner) < 2 && /右边框/.test(dbl.toast || ''), dbl);
  // 面板方位：无论球被拖到哪一档高度，面板都开在球的上方，既不翻到下面也不压住球
  const above = await cdp.evaluate(`(async () => {
    const s = ${S};
    const b = s.querySelector('.qf-ball');
    const p = s.querySelector('.qf-panel');
    const out = [];
    for (const t of [788, 430, 180, 60]) {
      b.style.top = t + 'px'; b.style.bottom = 'auto';
      if (p.classList.contains('qf-hidden')) b.click();
      window.dispatchEvent(new Event('resize'));
      await new Promise(r => setTimeout(r, 450));
      const br = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
      out.push({ set: t, ballTop: Math.round(br.top), panelTop: Math.round(pr.top), panelBottom: Math.round(pr.bottom), panelRight: Math.round(pr.right), panelH: Math.round(pr.height), compact: p.classList.contains('qf-compact') });
    }
    return { out, cw: document.documentElement.clientWidth, ch: document.documentElement.clientHeight, cursor: getComputedStyle(b).cursor };
  })()`);
  check('面板永远在悬浮球上方（不翻转、不压住球）', above.out.every(o => o.panelTop >= 0 && o.panelBottom <= o.ballTop + 2), above.out);
  check('面板始终完整可见且不越过浏览器右边框', above.out.every(o => o.panelBottom <= above.ch && o.panelRight <= above.cw + 1), above.out);
  check('悬浮球悬停指针为食指点击样式', above.cursor === 'pointer', above.cursor);
  check('上方空间紧张时自动进入紧凑模式（收起 hero 宣传区）',
    above.out[0].compact === false && above.out[1].compact === true && above.out[3].compact === true,
    above.out.map(o => o.set + ':' + o.compact).join(' '));

  const dragPanel = await cdp.evaluate(`(async () => {
    const s = ${S};
    const b = s.querySelector('.qf-ball');
    const p = s.querySelector('.qf-panel');
    b.style.top = '700px'; b.style.bottom = 'auto';
    window.dispatchEvent(new Event('resize'));
    if (p.classList.contains('qf-hidden')) b.click();
    await new Promise(r => setTimeout(r, 400));
    const before = !p.classList.contains('qf-hidden');
    const r = b.getBoundingClientRect();
    const mk = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 13 }));
    mk('pointerdown', r.left + 20, r.top + 20); mk('pointermove', r.left + 20, r.top + 20 - 120);
    const during = p.classList.contains('qf-hidden');
    const iconDuring = b.querySelector('.icon').textContent;
    mk('pointerup', r.left + 20, r.top + 20 - 120);
    await new Promise(r => setTimeout(r, 350));
    const after = !p.classList.contains('qf-hidden');
    const iconAfter = b.querySelector('.icon').textContent;
    const br = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
    return { before, during, after, iconDuring, iconAfter, ballTop: Math.round(br.top), panelBottom: Math.round(pr.bottom) };
  })()`);
  check('拖动悬浮球时面板临时收起，松手后重新开在球上方',
    dragPanel.before && dragPanel.during && dragPanel.after && dragPanel.panelBottom <= dragPanel.ballTop + 2, dragPanel);
  check('拖动中球的图标随面板收起/恢复同步切换',
    /⚡/.test(dragPanel.iconDuring) && dragPanel.iconAfter === '\u00D7', dragPanel);

  const mini = await cdp.evaluate(`(async () => {
    const s = ${S};
    const b = s.querySelector('.qf-ball');
    if (s.querySelector('.qf-panel').classList.contains('qf-hidden')) b.click();
    await new Promise(r => setTimeout(r, 200));
    const before = b.getBoundingClientRect();
    s.querySelector('[data-act=hideBall]').click();
    await new Promise(r => setTimeout(r, 250));
    const hiddenBall = b.classList.contains('qf-hidden');
    const m = s.querySelector('.qf-mini');
    const mr = m && m.getBoundingClientRect();
    s.querySelector('.qf-mini').click();
    await new Promise(r => setTimeout(r, 250));
    const after = b.getBoundingClientRect();
    return {
      hiddenBall, hasMini: !!m,
      ballCenter: Math.round(before.top + before.height / 2),
      miniCenter: mr ? Math.round(mr.top + mr.height / 2) : null,
      centerBefore: Math.round(before.top + before.height / 2), centerAfter: Math.round(after.top + after.height / 2),
      back: !b.classList.contains('qf-hidden')
    };
  })()`);
  check('「隐藏闪电悬浮按钮」隐藏球并出现边缘恢复入口', mini.hiddenBall && mini.hasMini, mini);
  check('边缘恢复把手出现在悬浮球原高度', mini.miniCenter !== null && Math.abs(mini.miniCenter - mini.ballCenter) < 3, mini);
  check('点击恢复入口后球重新显示且高度不变', mini.back && Math.abs(mini.centerAfter - mini.centerBefore) < 2, mini);

  const iconState = await cdp.evaluate(`(async () => {
    const s = ${S};
    const b = s.querySelector('.qf-ball'), p = s.querySelector('.qf-panel');
    if (p.classList.contains('qf-hidden')) b.click();
    await new Promise(r => setTimeout(r, 300));
    const open = { icon: b.querySelector('.icon').textContent, aria: b.getAttribute('aria-expanded'), title: b.title };
    b.click();
    await new Promise(r => setTimeout(r, 400));
    const closed = { icon: b.querySelector('.icon').textContent, aria: b.getAttribute('aria-expanded') };
    return { open, closed };
  })()`);
  check('面板打开时球变成「×」提示可收起', iconState.open.icon === '\u00D7' && iconState.open.aria === 'true', iconState.open);
  check('面板收起后球恢复闪电图标', /⚡/.test(iconState.closed.icon) && iconState.closed.aria === 'false', iconState.closed);

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
    const cw = document.documentElement.clientWidth;
    return { left: Math.round(r.left), top: Math.round(r.top), inView: r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= cw, docked: Math.abs(r.right - cw) < 2, inlineLeft: b.style.left };
  })()`);
  check('窗口变化后越界的球会被拉回可视区', shrunk.inView, shrunk);
  check('拉回后仍吸附在浏览器右边框（横向内联定位已清除）', shrunk.docked && shrunk.inlineLeft === '', shrunk);

  // 上面 [7] 把这个标签页导航到了空壳页；不导航回来的话，下一个套件会直接报「未找到页面目标」
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8123/test/test-form.html' }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  cdp.close();
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试驱动异常:', e.message); process.exit(2); });
