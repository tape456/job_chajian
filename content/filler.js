// 填值执行：兼容 React/Vue 受控组件、各类控件、日期格式转换
(function (root) {
  'use strict';

  const FR = root.FieldRules;

  const nativeInputSetter = Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype, 'value').set;
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement.prototype, 'value').set;

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function setNativeValue(el, value) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') nativeInputSetter.call(el, value);
    else if (tag === 'textarea') nativeTextareaSetter.call(el, value);
    else el.value = value;
    fire(el, 'input');
    fire(el, 'change');
  }

  // 写入后回读：页面会自动格式化（日期分隔符、金额千分位、手机号空格）或整体回滚，
  // 所以比较要宽松——只要"语义上还是同一个值"就算成功，避免把格式化误判成失败。
  function sameValue(expected, actual) {
    const a = String(expected == null ? '' : expected).trim();
    const b = String(actual == null ? '' : actual).trim();
    if (a === b) return true;
    const strip = s => s.replace(/[\s,，]/g, '').toLowerCase();
    if (strip(a) === strip(b)) return true;
    const na = parseFloat(a), nb = parseFloat(b);
    if (isFinite(na) && isFinite(nb) && na === nb) return true;
    const digits = s => (s.match(/\d{4}\D?\d{0,2}\D?\d{0,2}/) || [''])[0].replace(/\D/g, '');
    const da = digits(a), db = digits(b);
    if (da.length >= 4 && db.length >= 4) {
      if (da === db) return true;
      const short = da.length < db.length ? da : db;
      // 页面给 "2024-06" 补全成 "2024-06-01" 也算同一天
      if (short.length >= 6 && (da.startsWith(short) || db.startsWith(short))) return true;
    }
    return false;
  }

  // ---------- 日期处理 ----------
  // 格式推断本身在 FieldRules.formatDate（纯函数，可单测）；这里只负责收集控件提示
  function formatDateFor(value, field) {
    const el = field.el || {};
    const hint = [el.placeholder || '', el.name || '', el.id || '', ...(field.signals || [])].join(' ').toLowerCase();
    return FR.formatDate(value, {
      type: field.inputType || '',
      hint,
      maxLength: el.getAttribute ? parseInt(el.getAttribute('maxlength'), 10) : 0
    });
  }

  const DATE_PATH_HINT = /(date|birth|start|end|period|graduation|time)/i;
  function isDateValue(field) {
    const type = field.inputType || '';
    if (type === 'date' || type === 'month') return true;
    const hint = [field.el.placeholder || '', ...(field.signals || [])].join('');
    return /日期|年月|时间/.test(hint) || DATE_PATH_HINT.test(field.matchedPath || '');
  }

  // ---------- 各类控件填写 ----------
  async function fillTextInput(field, value) {
    let v = String(value);
    if (isDateValue(field)) v = formatDateFor(v, field);
    const el = field.el;
    const max = parseInt(el.getAttribute('maxlength'), 10);
    if (max > 0 && v.length > max) v = v.slice(0, max);
    setNativeValue(el, v);
    if (sameValue(v, el.value)) return true;
    // 受控组件可能要等一轮事件循环才结算，仍不生效就再写一次并失焦触发校验
    await new Promise(r => setTimeout(r, 30));
    if (sameValue(v, el.value)) return true;
    setNativeValue(el, v);
    try { el.blur(); } catch (e) {}
    await new Promise(r => setTimeout(r, 30));
    return sameValue(v, el.value) ? true : 'mismatch';
  }

  function fillContenteditable(field, value) {
    const el = field.el;
    const v = String(value);
    el.focus();
    el.textContent = v;
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    return sameValue(v, el.textContent) ? true : 'mismatch';
  }

  function fillSelect(field, value) {
    const el = field.el;
    const opts = Array.from(el.options);
    // 1) 选项文本语义匹配
    let target = opts.find(o => FR.matchOptionValue(o.textContent, String(value)));
    // 2) value 属性匹配
    if (!target) target = opts.find(o => FR.matchOptionValue(o.value, String(value)));
    // 3) 包含"其他"的兜底：若简历值非空且存在"其他"选项，选中它（用户需手填说明）
    if (!target) {
      const other = opts.find(o => /^(其他|其它|other)/i.test(o.textContent.trim()));
      if (other) {
        el.value = other.value;
        fire(el, 'change');
        return 'other'; // 特殊状态：需人工确认
      }
      return false;
    }
    el.value = target.value;
    fire(el, 'change');
    // 部分框架监听 click
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return sameValue(String(target.value), el.value) ? true : 'mismatch';
  }

  function fillRadio(field, value) {
    for (const opt of field.options) {
      if (FR.matchOptionValue(opt.text, String(value)) || FR.matchOptionValue(opt.el.value, String(value))) {
        if (!opt.el.checked) opt.el.click();
        else { fire(opt.el, 'change'); }
        return opt.el.checked ? true : 'mismatch';
      }
    }
    return false;
  }

  function fillSingleCheckbox(field, value) {
    const truthy = ['是', '有', 'y', 'yes', 'true', '1', '对'];
    const shouldCheck = truthy.includes(String(value).trim().toLowerCase());
    const el = field.el;
    if (shouldCheck !== !!el.checked) el.click();
    return el.checked === shouldCheck ? true : 'mismatch';
  }

  function fillCheckboxGroup(field, value) {
    // 简历值中出现的选项打勾（如技能、证书多选）
    const v = String(value);
    let any = false, mismatch = false;
    for (const opt of field.options) {
      const t = FR.normalize(opt.text);
      const want = t && (v.includes(opt.text.trim()) || FR.matchOptionValue(opt.text, v));
      if (want !== !!opt.el.checked) { opt.el.click(); }
      if (want) { any = true; if (!opt.el.checked) mismatch = true; }
    }
    if (mismatch) return 'mismatch';
    return any ? true : 'none';
  }

  // ---------- select/radio 的 AI 选项兜底 ----------
  // 本地同义词归一覆盖不了所有站点的选项口径（「硕士」/「研究生」/「硕士研究生学历」），
  // 匹配不上时把简历值和选项列表交给模型挑一个序号。未配 AI 时 background 直接回 unavailable。
  async function askAiOption(options, value, label) {
    if (!options || !options.length) return -1;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'ai:pickOption',
        options: options.map(o => String(o.text || '').trim()).filter(Boolean).slice(0, 120),
        value: String(value).slice(0, 150),
        label: String(label || '').slice(0, 30)
      });
      const i = resp && resp.ok ? Number(resp.index) : -1;
      return Number.isInteger(i) && i >= 0 && i < options.length ? i : -1;
    } catch (e) {
      return -1;
    }
  }

  // ---------- 组件驱动用到的基础工具 ----------
  // 面板发现与列分组统一走 DomAgent.observe，这里不再各写一套选择器：
  // 以前 filler 和 dom-agent 各有一份 collectOptions，同一组件两边判定不一致就会偶发漏填。
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 候选触发元素：优先内层（ant-design/el-select 真正监听的是它），外层留作兜底。
  // 一次只点一个候选——同时点内外层会把面板"开了又关"，表现为偶发漏填。
  function triggerCandidates(trig) {
    const inner = trig.querySelector('input, .ant-select-selector, .el-input__inner, [role="combobox"]');
    return inner && inner !== trig ? [inner, trig] : [trig];
  }

  // 「北京市海淀区学院路30号」/「山东济南」→ 逐级 ['北京市','海淀区'] / ['山东','济南']
  function splitRegion(v) {
    let s = String(v).replace(/^中国\s*[\/、]?\s*/, '').trim();
    const re = /([^\/\s,，、]+?(?:省|自治区|特别行政区|自治州|地区|盟|市|区|县|旗))/g;
    const parts = [];
    let m;
    while ((m = re.exec(s))) parts.push(m[1]);
    if (!parts.length) return s.split(/[\/\s,，、]+/).filter(Boolean);
    return parts;
  }

  function normRegion(t) {
    const stripped = String(t).replace(/\s/g, '')
      .replace(/(省|自治区|特别行政区|自治州|地区|盟|市|区|县|旗)$/g, '');
    return stripped || String(t).replace(/\s/g, '');
  }

  // ---------- 组件驱动引擎（自绘下拉 / 级联 / 多级浮层）----------
  // 一条路走通所有「点触发器 → 浮层分列 → 逐级选中 → 可能要点确认」的组件：
  //   1) 目标值里不出现的中间级（北京市 → 市辖区）：本列没有匹配项时，唯一可展开项直接下钻
  //   2) 目标值里不出现的根分支（中国 / 海外）：按 DOM 顺序试 + 回读校验 + 回退换分支
  //   3) 结束必点「完成选择 / 确定」——很多自绘组件不点它就不写回
  //   4) 每步都重新观察，绝不跨步持有元素引用（组件 hover 一次就把整面板重建了）
  // trusted=false 走合成事件（快、无调试横幅），true 走 chrome.debugger 真实事件。
  const MAX_ACTIONS = 60;      // 一次填写的点击预算，防止在超大列表里无限试
  const MAX_PER_LEVEL = 10;    // 单层最多试几个分支
  const COMMIT_RE = /完成选择|完成|确定|确认|提交|ok/i;
  const CLEAR_RE = /清空|清除|重置/;

  function wantTokens(field, value) {
    const raw = field.kind === 'cascader' ? splitRegion(value) : [String(value)];
    return raw.map(normRegion).filter(t => t && t.length >= 1);
  }

  function scoreOption(text, want) {
    const t = normRegion(text);
    if (!t) return 0;
    let best = 0;
    for (const w of want) {
      if (!w) continue;
      if (t === w) best = Math.max(best, 4);
      else if (t.length >= 2 && (t.includes(w) || w.includes(t))) best = Math.max(best, 3);
    }
    return best;
  }

  function coveredBy(path, want) {
    if (!want.length) return false;
    const pn = path.map(normRegion);
    return want.every(w => pn.some(p => p === w || (p.length >= 2 && (p.includes(w) || w.includes(p)))));
  }

  function CancelError() { this.name = 'Cancelled'; }

  // 合成事件档：hover 要真的把 pointerover/mouseover/mousemove 都发一遍，
  // mouseenter 不冒泡，只能直接派发到目标自己身上
  function syntheticHover(el) {
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: el.ownerDocument.defaultView || window,
      clientX: r.left + Math.min(Math.max(r.width / 2, 1), 40), clientY: r.top + r.height / 2, button: 0
    };
    try { el.dispatchEvent(new PointerEvent('pointerover', opts)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerenter', Object.assign({}, opts, { bubbles: false }))); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', Object.assign({}, opts, { bubbles: false })));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
  }

  async function driveWidget(field, value, ctx) {
    const o = ctx || {};
    const DA = root.DomAgent;
    const TI = o.trusted ? root.TrustedInput : null;
    const cancelled = typeof o.cancelled === 'function' ? o.cancelled : () => false;
    const trig = field.trigger || field.el;
    const doc = trig.ownerDocument || document;
    const want = wantTokens(field, value);
    const before = DA ? DA.displayOf(trig) : '';
    const budget = { left: MAX_ACTIONS };
    let lastReason = '';
    // 动作轨迹由调用方传入数组，S=合成事件档、T=可信输入档；真实站点上"为什么没填上"只能靠这个看
    const trace = Array.isArray(o.trace) ? o.trace : null;
    function note(s) { if (trace && trace.length < 60) trace.push((o.trusted ? 'T ' : 'S ') + s); }

    function fail(reason) { lastReason = reason; return { ok: false, reason }; }

    function observeNow() {
      if (!DA) return { openState: 'closed', columns: [], footerActions: [], options: [], display: '' };
      return DA.observe(doc, trig);
    }

    async function tap(el, mode) {
      if (cancelled()) throw new CancelError();
      if (budget.left-- <= 0) return false;
      if (TI) {
        const r = mode === 'hover' ? await TI.hover(el) : await TI.click(el);
        if (!r.ok) { lastReason = r.reason || 'debugger_denied'; return false; }
        return true;
      }
      if (mode === 'hover') syntheticHover(el);
      else if (DA) DA.clickOnce(el);
      else el.click();
      return true;
    }

    // 打开面板：逐个候选触发器试，谁能让浮层出现就用谁（内外层一起点会"开了又关"）
    async function openPanel() {
      const cands = triggerCandidates(trig);
      for (let a = 0; a < cands.length; a++) {
        if (!(await tap(cands[a], 'click'))) return observeNow();
        for (let i = 0; i < 14; i++) {
          await sleep(50);
          const obs = observeNow();
          if (obs.openState === 'open' && obs.columns.length) return obs;
        }
      }
      return observeNow();
    }

    // 回放到 path 深度。判"这一层已到位"用结构而不是选中态：
    // 很多自绘组件不给选中样式，只认 selected 会每轮从头重点一遍，深度 4 就退化成 O(depth²)。
    async function ensurePath(path) {
      let obs = observeNow();
      if (!obs.columns.length) obs = await openPanel();
      for (let level = 0; level < path.length; level++) {
        const col = obs.columns[level];
        if (!col) return { obs: null, reason: 'column_not_found' };
        const hit = col.options.find(x => normRegion(x.text) === normRegion(path[level]));
        if (!hit) return { obs: null, reason: 'node_not_found' };
        if (obs.columns.length > level + 1) continue;         // 下一列已经展开 = 这一层已到位
        await tap(hit.el, 'hover');
        await sleep(60);
        obs = observeNow();
        if (obs.columns.length > level + 1) continue;
        await tap(hit.el, 'click');
        await sleep(60);
        obs = observeNow();
        if (obs.columns.length <= level) return { obs: null, reason: 'panel_closed' };
      }
      return { obs, reason: '' };
    }

    async function commitAndVerify() {
      const obs = observeNow();
      const commit = (obs.footerActions || []).find(a => COMMIT_RE.test(a.text) && !CLEAR_RE.test(a.text));
      note('commit:' + (commit ? commit.text : 'none') + ' cols=' + obs.columns.length);
      if (commit) {
        if (!(await tap(commit.el, 'click'))) return fail(lastReason || 'commit_failed');
        await sleep(120);
      } else if (obs.columns.length) {
        // 没有确认按钮：按 Esc 收起，多数组件点选即生效
        if (TI) await TI.key('Escape');
        else trig.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(80);
      }
      if (!DA) return { ok: true };
      const after = DA.displayOf(trig);
      note('display:' + after.slice(0, 20));
      if (DA.satisfied(after, value)) return { ok: true };
      if (after && after !== before) return fail('verified_mismatch');
      return fail(commit ? 'commit_no_effect' : 'node_not_found');
    }

    // 导航到 path 深度并给出本列候选。候选只留文本：元素引用不能跨步持有，
    // 自绘组件 hover 一次就把整块面板重建，攥着旧引用点的是已经不存在的节点。
    async function locateLevel(path) {
      let ensured = await ensurePath(path);
      if (!ensured.obs) {
        await openPanel();
        ensured = await ensurePath(path);
        if (!ensured.obs) return { ok: false, reason: ensured.reason || 'open_failed' };
      }
      const obs = ensured.obs;
      // 面板开着但一列都解析不出来（或压根没开）时 columns.length 是 0，
      // 下面 columns[length-1] 会取到 undefined 并抛异常——异常会被 fillMatch 吞掉，
      // 表现就是"可信输入永远没机会启动"。必须在这里就返回原因码。
      if (!obs.columns.length) return { ok: false, reason: 'open_failed' };
      const level = obs.columns.length - 1;
      const col = obs.columns[level];
      const seen = new Set();
      const cands = col.options
        .filter(x => !x.disabled && !seen.has(x.text) && seen.add(x.text))
        .map(x => ({ t: x.text, s: scoreOption(x.text, want) }))
        .sort((a, b) => b.s - a.s)                     // 匹配的排前面，同分保持 DOM 顺序
        .slice(0, MAX_PER_LEVEL)
        .map(p => p.t);
      return { ok: true, obs, level, col, cands };
    }

    // 不可恢复的原因：别再往下试分支了
    function fatal(reason) { return /^(timeout|cancelled|debugger_denied|debugger_busy|hit_test_failed|frame_offset_unavailable|disabled)$/.test(reason || ''); }

    async function descend(path) {
      const here = await locateLevel(path);
      if (!here.ok) return here;
      if (!here.cands.length) return fail(path.length ? 'column_not_found' : 'node_not_found');

      for (const text of here.cands) {
        if (budget.left <= 0) return fail('timeout');
        const lvl = await locateLevel(path);            // 每轮取新鲜元素
        if (!lvl.ok) return lvl;
        const c = lvl.col.options.find(o => o.text === text);
        if (!c) continue;
        const before = lvl.obs.columns.length;
        if (!(await tap(c.el, 'hover'))) return fail(lastReason || 'hit_test_failed');
        await sleep(70);
        let after = observeNow();
        let expanded = after.columns.length > before;
        // hover 没能展开下一列就改用点击：有的组件 click 展开，有的只认 hover
        if (!expanded) {
          if (!(await tap(c.el, 'click'))) return fail(lastReason || 'hit_test_failed');
          await sleep(70);
          after = observeNow();
          expanded = after.columns.length > before;
        }
        const newPath = path.concat([c.text]);
        note('L' + lvl.level + ' ' + c.text + (expanded ? ' ↓cols' + after.columns.length : ' leaf cols' + after.columns.length));
        if (expanded) {
          const r = await descend(newPath);
          if (r.ok || fatal(r.reason)) return r;
          continue;                                    // 这条分支走不通，回退换下一个候选
        }
        if (coveredBy(newPath, want)) {
          const v = await commitAndVerify();
          if (v.ok || fatal(v.reason)) return v;
        }
      }
      return fail('node_not_found');
    }

    try {
      note('want ' + want.join(',') + ' trig ' + (trig.tagName || ''));
      return await descend([]);
    } catch (e) {
      if (e && e.name === 'Cancelled') return { ok: false, reason: 'cancelled' };
      throw e;
    }
  }

  // ---------- 对外主入口 ----------
  // match: {field, entry, ...}（matcher 输出）
  // 返回 { ok: true | 'other' | false, reason: 失败原因码, layer: 最终生效的执行层 }
  // 组件类字段按「合成事件 → 可信输入 → AI 单步规划」逐层退，每层都带结果校验，
  // 绝不把"点了几下"当成"填上了"——旧版 fillCascader 返回 hit>0 就是这个坑。
  async function fillMatch(match, opts) {
    const { field, entry } = match;
    const value = entry.value;
    const o = opts || {};
    let ok = false, reason = '', layer = 'native';
    try {
      switch (field.kind) {
        case 'select': {
          const sel = fillSelect(field, value);
          ok = sel;
          if (sel === 'mismatch') { ok = false; reason = 'verified_mismatch'; break; }
          if (ok !== true) {
            const i = await askAiOption(field.options, value, o.label);
            if (i >= 0 && field.options[i]) {
              const opt = field.options[i];
              field.el.value = opt.value != null ? opt.value : opt.el.value;
              fire(field.el, 'change');
              if (opt.el && opt.el.dispatchEvent) opt.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              ok = true; layer = 'ai';
            } else if (ok === false) {
              reason = 'option_not_found';
            }
          }
          break;
        }
        case 'radio': {
          const rad = fillRadio(field, value);
          ok = rad;
          if (rad === 'mismatch') { ok = false; reason = 'verified_mismatch'; break; }
          if (ok !== true) {
            const i = await askAiOption(field.options, value, o.label);
            if (i >= 0 && field.options[i] && field.options[i].el) {
              field.options[i].el.click();
              ok = field.options[i].el.checked ? true : false;
              if (!ok) reason = 'verified_mismatch';
              else layer = 'ai';
            } else {
              reason = 'option_not_found';
            }
          }
          break;
        }
        case 'checkbox': {
          const cb = fillSingleCheckbox(field, value);
          ok = cb === true;
          if (cb === 'mismatch') reason = 'verified_mismatch';
          break;
        }
        case 'checkboxGroup': {
          const cbg = fillCheckboxGroup(field, value);
          if (cbg === 'mismatch') { ok = false; reason = 'verified_mismatch'; }
          else ok = cbg;
          break;
        }
        case 'contenteditable': {
          const ce = fillContenteditable(field, value);
          ok = ce === true;
          if (ce === 'mismatch') reason = 'verified_mismatch';
          break;
        }
        case 'textarea': {
          const ta = await fillTextInput(field, value);
          ok = ta === true;
          if (ta === 'mismatch') reason = 'verified_mismatch';
          break;
        }
        case 'dropdown':
        case 'cascader': {
          const r = await fillWidget(field, value, o);
          ok = r.ok; reason = r.reason; layer = r.layer;
          break;
        }
        default: {
          const txt = await fillTextInput(field, value);
          ok = txt === true;
          if (txt === 'mismatch') reason = 'verified_mismatch';
          break;
        }
      }
    } catch (e) {
      ok = false;
      reason = e && e.name === 'Cancelled' ? 'cancelled' : 'exception';
      if (e && e.name !== 'Cancelled') console.warn('[速填] 填写异常', field.kind, e.message);
    }
    return { ok, reason, layer, trace: o.trace };
  }

  async function fillWidget(field, value, o) {
    const trace = Array.isArray(o.trace) ? o.trace : [];
    const ctx = { cancelled: o.cancelled, trace: trace };
    const say = typeof o.onPhase === 'function' ? o.onPhase : () => {};
    const done = (ok, reason, layer) => ({ ok: ok, reason: reason || '', layer: layer, trace: trace });

    let r = await driveWidget(field, value, ctx);
    if (r.ok) return done(true, '', 'synthetic');
    if (r.reason === 'cancelled') return done(false, 'cancelled', 'synthetic');
    const syntheticReason = r.reason;

    if (root.TrustedInput) {
      const usable = await root.TrustedInput.available();
      if (usable) {
        say('trusted');
        r = await driveWidget(field, value, Object.assign({ trusted: true }, ctx));
        if (r.ok) return done(true, '', 'trusted');
        if (r.reason === 'cancelled') return done(false, 'cancelled', 'trusted');
        if (!r.reason) r.reason = syntheticReason;
      } else {
        r.reason = root.TrustedInput.reason || 'debugger_denied';
      }
    }

    // 最后一层：AI 单步规划（需要用户配了 Key）
    if (root.DomAgent && root.DomAgent.fillField) {
      say('ai');
      const agentOk = await root.DomAgent.fillField(field, value, Object.assign({
        label: o.label
      }, ctx));
      if (agentOk) return done(true, '', 'ai');
    }
    return done(false, r.reason || syntheticReason || 'node_not_found', 'ai');
  }

  async function fillAll(matched, isCancelled, onProgress, onAgentStep, onPhase) {
    const results = [];
    const cancelled = typeof isCancelled === 'function' ? isCancelled : () => false;
    for (const m of matched) {
      if (cancelled()) return results;
      m.field.matchedPath = m.path;
      let res = { ok: false, reason: 'exception', layer: 'native' };
      try {
        res = await fillMatch(m, { cancelled, onStep: onAgentStep, onPhase, label: m.entry && m.entry.label });
      } catch (e) { res = { ok: false, reason: 'exception', layer: 'native' }; }
      if (cancelled()) return results;
      if (res.ok !== true && (m.field.kind === 'dropdown' || m.field.kind === 'cascader')) {
        try { await navigator.clipboard.writeText(String(m.entry.value)); } catch (e) {}
      }
      results.push({ match: m, ok: res.ok, reason: res.reason, layer: res.layer });
      markField(m.field, res.ok === true ? 'filled' : res.ok === 'other' ? 'filled-other' : 'failed', m, res.reason);
      if (onProgress) onProgress(results.length);
    }
    return results;
  }

  // ---------- 高亮标记 ----------
  const CLASS = {
    filled: '__qf_filled',
    'filled-other': '__qf_filled_other',
    failed: '__qf_failed',
    missing: '__qf_missing',
    unmatched: '__qf_unmatched',
    skipped: '__qf_skip',      // 选区填写专用：识别得到但不属于本次选中的那一组
    required: '__qf_required'  // 必填但最终仍为空（含未识别），比「简历缺失」更醒目
  };

  function markField(field, state, match, reason) {
    const els = field.kind === 'radio' || field.kind === 'checkboxGroup' ? field.group : [field.el];
    for (const el of els) {
      for (const c of Object.values(CLASS)) el.classList.remove(c);
      el.classList.add(CLASS[state] || CLASS.failed);
      const desc = match ? `${match.entry ? match.entry.label : ''} → ${match.entry ? String(match.entry.value).slice(0, 40) : ''}` : '';
      const why = reason && REASON_TEXT[reason] ? '（' + REASON_TEXT[reason] + '）' : '';
      el.setAttribute('title', '【速填】' + stateText(state) + why + (desc ? '：' + desc : ''));
    }
  }

  function stateText(s) {
    return { filled: '已填写', 'filled-other': '已选"其他"，请人工确认', failed: '填写失败，请手动处理', missing: '简历缺失该项，请补充', unmatched: '未识别，请手动填写', skipped: '不属于本次选中的这一组，已跳过', required: '必填项为空，请手动补充' }[s] || s;
  }

  // 失败原因码 → 人话。放在这里而不是新文件：它只是一张查找表，
  // 单独注入一个 content script 要多改 manifest / importScripts / CS_FILES 三处注册。
  const REASON_TEXT = {
    open_failed: '面板打不开',
    column_not_found: '找不到对应的那一列',
    node_not_found: '选项里没有这个值',
    panel_closed: '面板中途被关掉',
    commit_button_missing: '没找到确认按钮',
    commit_no_effect: '点了确认但没生效',
    commit_failed: '确认按钮点不动',
    verified_mismatch: '填了但和简历值不一致，请核对',
    option_not_found: '下拉/单选选项里没有与简历值匹配的项（AI 兜底也未选中）',
    hit_test_failed: '被遮挡或不在视口内',
    frame_offset_unavailable: '跨域框架里算不出真实坐标',
    debugger_denied: '未授权可信输入（点了调试横幅的「取消」）',
    debugger_busy: '该标签页已被其它调试工具占用（如 F12）',
    disabled: '设置里未开启可信输入',
    trusted_unavailable: '可信输入不可用',
    screenshot_failed: '截图失败',
    ai_unavailable: '未配置 AI',
    timeout: '尝试次数用尽',
    cancelled: '已中止',
    exception: '填写过程出错',
    no_element: '目标控件已不在页面上'
  };

  function reasonText(r) { return REASON_TEXT[r] || r || ''; }

  function clearMarks(doc) {
    doc = doc || document;
    for (const c of Object.values(CLASS)) {
      doc.querySelectorAll('.' + c).forEach(el => {
        el.classList.remove(c);
        const t = el.getAttribute('title') || '';
        if (t.startsWith('【速填】')) el.removeAttribute('title');
      });
    }
  }

  // 把页面上任意一个元素归一成「组件字段」：辅助填写与 AI 辅助点击只拿到用户点的那个元素
  function widgetFieldOf(el) {
    if (!el) return null;
    const wrapped = root.DomAgent && root.DomAgent.wrapTarget && root.DomAgent.wrapTarget(el);
    const custom = wrapped
      ? wrapped.el
      : (el.closest && el.closest('.el-select, .ant-select, .el-cascader, .ant-cascader, [role="combobox"]'));
    if (!custom) return null;
    const cls = String(custom.getAttribute('class') || '');
    const isCascader = (wrapped && wrapped.kind === 'cascader') || /cascader/i.test(cls) || !!custom.querySelector('.el-cascader, .ant-cascader');
    return wrapped || { el: custom, trigger: custom, kind: isCascader ? 'cascader' : 'dropdown', signals: [] };
  }

  // 便捷入口：按元素类型填写一个裸值（辅助填写场景：只有目标元素、无字段元数据）
  // 返回 true / 'other' / false（自定义组件走完整引擎，返回 Promise）
  function setTextValue(el, value) {
    if (!el) return false;
    const field = widgetFieldOf(el);
    if (field) return (async () => (await fillWidget(field, value, {})).ok === true)();
    if (el.tagName === 'SELECT') {
      return fillSelect({ el, options: Array.from(el.options).map(o => ({ el: o, text: o.textContent.trim(), value: o.value })) }, value);
    }
    if (el.isContentEditable) return fillContenteditable({ el }, value);
    return fillTextInput({ el, signals: [] }, value);
  }

  // 供「AI 辅助点击」用：带失败原因码与生效层级的填写入口
  function fillWidgetTarget(el, value, opts) {
    const field = widgetFieldOf(el);
    if (!field) return Promise.resolve({ ok: false, reason: 'no_element', layer: 'native' });
    return fillWidget(field, value, opts || {});
  }

  root.FieldFiller = {
    fillAll, fillMatch, markField, clearMarks, formatDateFor, CLASS, stateText, reasonText,
    setNativeValue, fillTextInput, fillSelect, fillContenteditable, setTextValue,
    fillWidgetTarget, widgetFieldOf
  };
})(typeof window !== 'undefined' ? window : self);
