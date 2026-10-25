// DOM Agent：启发式点选失败后，观察当前浮层选项，请模型规划一步动作并执行。
// 依赖：FieldFiller.setNativeValue、ResumeStore、background 消息 ai:pageAct。
(function (root) {
  'use strict';

  const MAX_STEPS = 10;
  const HOST = '#__qf_overlay_host__';
  const KNOWN_PANEL = [
    '.el-select-dropdown', '.ant-select-dropdown',
    '.el-cascader-panel', '.el-cascader__dropdown', '.ant-cascader-menus',
    '[role="listbox"]', '[role="menu"]'
  ].join(', ');
  const OPT_SEL = [
    '[role="option"]', '[role="menuitem"]',
    '.el-select-dropdown__item', '.ant-select-item-option',
    '.el-cascader-node', '.ant-cascader-menu-item', 'li'
  ].join(', ');
  function isActionText(text) {
    const t = clean(text);
    if (!t || t.length > 12) return false;
    return /清空|清除|完成选择|确定|确认|取消/.test(t);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    return true;
  }

  function clean(t) {
    return String(t || '').replace(/\s+/g, ' ').trim();
  }

  function clickOnce(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: el.ownerDocument.defaultView || window,
      clientX: r.left + Math.min(Math.max(r.width / 2, 1), 40),
      clientY: r.top + r.height / 2,
      button: 0
    };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function triggerInner(trig) {
    return trig.querySelector('input, .ant-select-selector, .el-input__inner, [role="combobox"]') || trig;
  }

  function knownPanels(doc) {
    return Array.from(doc.querySelectorAll(KNOWN_PANEL)).filter(p => {
      if (!visible(p) || p.closest(HOST)) return false;
      return !/dropdown-hidden/.test(String(p.className || ''));
    });
  }

  function overlayBoxes(doc) {
    const out = [];
    const nodes = doc.body ? doc.body.querySelectorAll('div, ul, section') : [];
    for (const el of nodes) {
      if (!visible(el) || el.closest(HOST)) continue;
      const s = getComputedStyle(el);
      if (s.position !== 'absolute' && s.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 140 || r.height < 48 || r.width > window.innerWidth * 0.98) continue;
      out.push(el);
      if (out.length > 40) break;
    }
    return out;
  }

  // 从某个元素往上找最近的定位祖先——弹窗几乎一定是 absolute/fixed 的
  function absoluteAncestor(el, doc, maxHop) {
    let p = el && el.parentElement;
    for (let i = 0; i < (maxHop || 8) && p && p !== doc.body; i++, p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.position === 'absolute' || s.position === 'fixed') {
        return (visible(p) && !p.closest(HOST)) ? p : null;
      }
    }
    return null;
  }

  // 带「完成选择 / 清空」按钮的浮层：按定位祖先认，不按尺寸猜。
  // 旧实现要求祖先 width>180 && height>80，窄面板（只有一列的地区选择器）会漏判。
  function panelsByFooter(doc) {
    const out = [];
    const nodes = doc.body ? doc.body.querySelectorAll('button, div, span, a') : [];
    for (const el of nodes) {
      if (!visible(el) || el.closest(HOST)) continue;
      const t = clean(el.innerText || el.textContent);
      if (!/完成选择|清空/.test(t) || t.length > 16) continue;
      const p = absoluteAncestor(el, doc) || el.parentElement;
      if (p && !out.includes(p)) out.push(p);
    }
    return out;
  }

  function largest(list) {
    return list.slice().sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    });
  }

  function genericPanels(doc, trigger) {
    const tr = trigger.getBoundingClientRect();
    const sel = '[class*="dropdown"], [class*="popover"], [class*="popup"], [class*="cascader"], [class*="picker"], [class*="select-panel"], [class*="Select"], [class*="panel"]';
    const out = [];
    for (const el of doc.querySelectorAll(sel)) {
      if (!visible(el) || el.closest(HOST) || trigger.contains(el)) continue;
      const s = getComputedStyle(el);
      if (s.position !== 'absolute' && s.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 72 || r.height < 36) continue;
      const near = Math.abs(r.left - tr.left) < 480 && r.top < tr.bottom + 560 && r.bottom > tr.top - 80;
      if (near) out.push(el);
      if (out.length >= 8) break;
    }
    return out;
  }

  // 最后一道：完全猜不到 class 时，找「小而靠近触发器」的定位元素。
  // 取最小的而不是最大的——巨大的 absolute 容器通常是页面布局，不是弹窗。
  function nearbyPopups(doc, trigger) {
    const tr = trigger.getBoundingClientRect();
    const hits = [];
    const nodes = doc.body ? doc.body.querySelectorAll('div, ul, section') : [];
    for (const el of nodes) {
      if (!visible(el) || el.closest(HOST) || trigger.contains(el)) continue;
      const s = getComputedStyle(el);
      if (s.position !== 'absolute' && s.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 96 || r.height < 40) continue;
      if (r.width > window.innerWidth * 0.9 && r.height > window.innerHeight * 0.9) continue;
      const near = r.left < tr.right + 320 && r.right > tr.left - 320 &&
        r.top < tr.bottom + 520 && r.bottom > tr.top - 520;
      if (near) hits.push(el);
    }
    const tops = hits.filter(el => !hits.some(o => o !== el && o.contains(el)));
    return tops.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (ra.width * ra.height) - (rb.width * rb.height);
    }).slice(0, 3);
  }

  // 两个矩形之间的最小距离（重叠时为 0）
  function rectGap(a, b) {
    const dx = Math.max(a.left - b.right, b.left - a.right, 0);
    const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
    return dx + dy;
  }

  // 候选面板里只留「离触发器够近、且真能解析出选项或按钮」的。
  // 这一步是必需的：panelsOf 是全文档搜索，页面上残留的别的字段弹层
  // （或布局用的大 absolute 容器）会被误当成当前面板，读出来选项和按钮都是空的。
  function usableNear(list, tr) {
    const seen = new Set();
    const out = [];
    for (const p of list) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      const r = p.getBoundingClientRect();
      const d = rectGap(tr, r);
      if (d > 600) continue;
      if (!optionLeaves(p).length && !collectActions([p]).length) continue;
      out.push({ p, d });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 3).map(x => x.p);
  }

  function panelsOf(doc, trigger) {
    const tr = trigger.getBoundingClientRect();
    const tiers = [
      () => knownPanels(doc),
      () => panelsByFooter(doc),
      () => genericPanels(doc, trigger),
      () => nearbyPopups(doc, trigger)
    ];
    for (const tier of tiers) {
      const ok = usableNear(tier(), tr);
      if (ok.length) return ok;
    }
    const boxes = overlayBoxes(doc);
    const loose = usableNear(boxes, tr);
    return loose.length ? loose : largest(boxes).slice(0, 2);
  }

  // ---------- 列感知的观察模型 ----------
  // 级联/多级面板把所有列拍平成一个列表喂给模型是填不对的：模型看不出哪列是当前级、
  // 哪个已选中、哪个还能往下展开。这里按列分组，并把状态标出来。
  const COL_CLASS = /(menu|column|list|-col|pane|panel|picker|cascader)/i;
  const SELECTED_CLASS = /(is-active|active|is-selected|selected|checked|current)/i;
  const EXPAND_CLASS = /(arrow|expand|caret|chevron|next)/i;

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function optionText(el) {
    // 去掉「›」这类展开箭头，只留选项本身文字
    return clean(el.innerText || el.textContent).replace(/\s*[›»＞→+]\s*$/, '').slice(0, 40);
  }

  function isSelected(el) {
    if (el.getAttribute('aria-selected') === 'true') return true;
    const cls = String(el.className || '');
    if (SELECTED_CLASS.test(cls)) return true;
    const child = el.firstElementChild;
    return !!(child && SELECTED_CLASS.test(String(child.className || '')));
  }

  function isDisabled(el) {
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.disabled) return true;
    return /(is-disabled|disabled)/.test(String(el.className || ''));
  }

  function isExpandable(el) {
    if (el.getAttribute('aria-expanded') != null) return true;
    if (EXPAND_CLASS.test(String(el.className || ''))) return true;
    for (const c of Array.from(el.querySelectorAll('span, i, em, svg, div'))) {
      if (EXPAND_CLASS.test(String(c.className || ''))) return true;
    }
    return /[›»＞→]\s*$/.test(String(el.textContent || ''));
  }

  // 面板内的可点叶子：优先组件库语义选择器，退化到「短文本且几乎没子节点」
  function optionLeaves(root) {
    let nodes = Array.from(root.querySelectorAll(OPT_SEL)).filter(visible);
    if (!nodes.length) {
      nodes = Array.from(root.querySelectorAll('div, span, a, button, li')).filter(n => {
        if (!visible(n) || n.children.length > 2) return false;
        const t = clean(n.innerText || n.textContent);
        return t && t.length <= 24;
      });
    }
    const leaves = nodes.filter(n => !nodes.some(o => o !== n && n.contains(o)));
    const seen = new Set();
    const out = [];
    for (const n of leaves) {
      if (/group__title|item-group/.test(String(n.className || ''))) continue;
      const text = optionText(n);
      if (!text || isActionText(text)) continue;
      const r = n.getBoundingClientRect();
      const key = text + '|' + Math.round(r.left) + '|' + Math.round(r.top);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  }

  // 列容器：往上找「像列的」或「能滚动的」祖先；若所有选项都落在同一个容器，退回按 x 坐标聚类
  function groupColumns(roots) {
    const all = [];
    for (const p of roots) for (const el of optionLeaves(p)) all.push(el);
    if (!all.length) return [];
    const byParent = new Map();
    for (const el of all) {
      let col = el.parentElement;
      for (let i = 0; i < 5 && col; i++) {
        const parent = col.parentElement;
        if (!parent || parent === (col.ownerDocument || document).body) break;
        const s = getComputedStyle(col);
        const scrollable = col.scrollHeight > col.clientHeight + 4 || /auto|scroll/.test(s.overflowY);
        if (COL_CLASS.test(String(col.className || '')) || scrollable) break;
        col = parent;
      }
      if (!byParent.has(col)) byParent.set(col, []);
      byParent.get(col).push(el);
    }
    let groups = Array.from(byParent.entries());
    if (groups.length === 1 && all.length > 6) {
      const byX = new Map();
      for (const el of all) {
        const x = Math.round(el.getBoundingClientRect().left);
        let key = null;
        for (const k of byX.keys()) if (Math.abs(k - x) <= 24) { key = k; break; }
        if (key == null) { key = x; byX.set(key, []); }
        byX.get(key).push(el);
      }
      groups = Array.from(byX.entries()).map(e => [null, e[1]]);
    }
    groups.sort((a, b) => a[1][0].getBoundingClientRect().left - b[1][0].getBoundingClientRect().left);
    return groups.map((g, idx) => {
      const container = g[0];
      const anchor = container || g[1][0];
      return {
        index: idx,
        container,
        rect: rectOf(anchor),
        scroll: container
          ? { top: Math.round(container.scrollTop), max: Math.round(container.scrollHeight - container.clientHeight) }
          : { top: 0, max: 0 },
        options: g[1].slice(0, 40).map((el, i) => ({
          el, index: i, text: optionText(el),
          selected: isSelected(el), disabled: isDisabled(el), expandable: isExpandable(el),
          rect: rectOf(el)
        }))
      };
    });
  }

  function placeholderOf(trig) {
    const input = trig.querySelector && trig.querySelector('input');
    return clean((input && input.placeholder) || (trig.getAttribute && trig.getAttribute('aria-label')) || '');
  }

  // 主观察入口：确定性引擎与 AI 单步规划共用
  function observe(doc, trig) {
    const panels = panelsOf(doc, trig);
    const columns = groupColumns(panels);
    const footerActions = collectActions(panels);
    const total = columns.reduce((n, c) => n + c.options.length, 0);
    return {
      openState: panels.length && (total || footerActions.length) ? 'open' : 'closed',
      display: displayOf(trig),
      placeholder: placeholderOf(trig),
      triggerRect: trig && trig.getBoundingClientRect ? rectOf(trig) : null,
      columns,
      footerActions,
      // 扁平视图留给旧提示词与退化路径
      options: columns.reduce((acc, c) => acc.concat(c.options.map(o => ({ el: o.el, text: o.text }))), []).slice(0, 120)
    };
  }

  // 喂给模型的形状：只留文本与状态，不带 DOM 引用和大坐标
  function observeForAi(obs) {
    return {
      openState: obs.openState,
      display: obs.display,
      placeholder: obs.placeholder,
      columns: obs.columns.map(c => ({
        level: c.index,
        scroll: c.scroll,
        options: c.options.map(o => {
          const m = { col: c.index, index: o.index, text: o.text };
          if (o.selected) m.selected = true;
          if (o.disabled) m.disabled = true;
          if (o.expandable) m.expandable = true;
          return m;
        })
      })),
      actions: obs.footerActions.map((a, i) => ({ index: i, text: a.text }))
    };
  }

  function collectActions(panels) {
    const out = [];
    const seen = new Set();
    const hits = [];
    for (const root of panels) {
      for (const b of root.querySelectorAll('button, [role="button"], a, span, div')) {
        if (!visible(b) || b.closest(HOST)) continue;
        const text = clean(b.innerText || b.textContent);
        if (!isActionText(text) || seen.has(text)) continue;
        if (b.children.length > 4) continue;
        seen.add(text);
        hits.push({ el: b, text, rect: rectOf(b) });
      }
    }
    // 容器自己的文本会把内部按钮的文字拼进来（「↺ 清空 ✓ 完成选择」），
    // 那种"既是按钮又是父元素"的条目要剔掉，否则点它等于点空白。
    return hits
      .filter(h => !hits.some(o => o !== h && h.el.contains(o.el)))
      .slice(0, 8);
  }

  function displayOf(trig) {
    const item = trig.querySelector('.ant-select-selection-item, .el-cascader__label, .el-select__selected-item, input');
    const raw = item ? (item.value || item.textContent || '') : (trig.innerText || '');
    return clean(raw).replace(/请选择|请输入|选择/g, '').trim().slice(0, 120);
  }

  function norm(s) {
    return String(s || '').replace(/\s/g, '').replace(/[\/、,，|]/g, '');
  }

  function goalParts(goal) {
    const s = String(goal || '');
    const re = /([^\/\s,，、]+?(?:省|自治区|特别行政区|自治州|地区|盟|市|区|县|旗))/g;
    const parts = [];
    let m;
    while ((m = re.exec(s))) parts.push(m[1]);
    if (parts.length) return parts;
    return s.split(/[\/\s,，、]+/).filter(Boolean);
  }

  function satisfied(display, goal) {
    const d = norm(display);
    const g = norm(goal);
    if (!d || !g) return false;
    if (d.includes(g) || (g.includes(d) && d.length >= 2)) return true;
    const parts = goalParts(goal).map(norm).filter(p => p.length >= 2);
    if (!parts.length) return false;
    const need = parts.slice(-Math.min(3, parts.length));
    return need.every(p => d.includes(p));
  }

  async function ask(observation) {
    const resp = await chrome.runtime.sendMessage({ type: 'ai:pageAct', observation });
    if (!resp || !resp.ok || !resp.action) return { action: 'fail' };
    return resp.action;
  }

  async function openTrigger(trig, doc, ti) {
    const cands = [];
    const inner = triggerInner(trig);
    if (inner) cands.push(inner);
    if (trig && trig !== inner) cands.push(trig);
    if (trig.parentElement) cands.push(trig.parentElement);
    for (const c of cands) {
      if (!(await tapEl(c, 'click', ti))) continue;
      await sleep(280);
      const obs = observe(doc, trig);
      if (obs.openState === 'open' && (obs.columns.length || obs.footerActions.length)) return;
    }
  }

  function classBlob(el) {
    let s = '';
    let n = el;
    for (let i = 0; i < 5 && n; i++) {
      s += ' ' + String(n.className || '');
      n = n.parentElement;
    }
    return s;
  }

  function widgetRoot(input) {
    let el = input;
    for (let i = 0; i < 6 && el.parentElement; i++) {
      const p = el.parentElement;
      if (!p || p.tagName === 'BODY' || p.tagName === 'FORM') break;
      // 表格布局的单元格/行不是组件容器：爬进去会把整行当成控件，
      // 于是 innerText 读到标签文字、点击坐标落在空白处。
      if (p.tagName === 'TD' || p.tagName === 'TH' || p.tagName === 'TR' || p.tagName === 'TABLE') break;
      if (p.querySelectorAll('input, textarea, select').length > 1) break;
      el = p;
      if (/cascad|select|picker|dropdown/i.test(String(p.className || ''))) return p;
    }
    return el;
  }

  function findCustomFields(doc, taken) {
    const out = [];
    const seen = new Set();
    const skip = taken || new Set();
    for (const input of (doc || document).querySelectorAll('input')) {
      if (!visible(input) || input.disabled || input.closest(HOST + ', nav, [role="navigation"]')) continue;
      const type = (input.type || 'text').toLowerCase();
      if (['hidden', 'file', 'password', 'checkbox', 'radio', 'submit', 'button', 'search'].includes(type)) continue;
      const ph = input.getAttribute('placeholder') || '';
      const ro = input.readOnly || input.hasAttribute('readonly');
      const blob = classBlob(input);
      if (!(ro || /请选择|点击选择/.test(ph) || /cascad|picker/i.test(blob))) continue;
      const rootEl = widgetRoot(input);
      if (seen.has(rootEl) || skip.has(rootEl) || skip.has(input)) continue;
      seen.add(rootEl);
      const kind = /cascad/i.test(blob) || /地址|地区|籍贯|居住|户口|生源|城市|国籍/.test(ph + blob) ? 'cascader' : 'dropdown';
      out.push({ root: rootEl, input, kind });
    }
    for (const el of (doc || document).querySelectorAll('div, span')) {
      if (!visible(el) || el.closest(HOST + ', nav')) continue;
      const t = clean(el.innerText || el.textContent);
      if (!/^请选择/.test(t) || t.length > 14) continue;
      if (el.querySelectorAll('input, div, span').length > 6) continue;
      const rootEl = (el.parentElement && el.parentElement.getBoundingClientRect().height < 72)
        ? el.parentElement : el;
      if (seen.has(rootEl) || skip.has(rootEl)) continue;
      seen.add(rootEl);
      const blob = classBlob(rootEl) + labelNear(rootEl);
      const kind = /cascad/i.test(blob) || /地址|地区|籍贯|居住|户口|生源|城市|国籍/.test(blob) ? 'cascader' : 'dropdown';
      out.push({ root: rootEl, input: rootEl.querySelector('input') || rootEl, kind });
    }
    return out;
  }

  function labelNear(el) {
    const prev = el.previousElementSibling;
    return (prev && prev.innerText) || (el.parentElement && el.parentElement.innerText) || '';
  }

  function wrapTarget(el) {
    if (!el) return null;
    const input = el.tagName === 'INPUT' ? el : (el.querySelector && el.querySelector('input'));
    const seed = input || el;
    const hits = findCustomFields(seed.ownerDocument || document, new Set());
    const hit = hits.find(h => h.root === seed || h.root.contains(seed) || seed.contains(h.root) || (input && (h.input === input || h.root.contains(input))));
    if (!hit) return null;
    return { el: hit.root, trigger: hit.root, kind: hit.kind, signals: [] };
  }

  // 动作派发：可信输入可用时一律走真实事件，否则退回合成事件
  async function tapEl(el, mode, ti) {
    if (!el) return false;
    if (ti) {
      const r = mode === 'hover' ? await ti.hover(el) : await ti.click(el);
      return !!r.ok;
    }
    if (mode === 'hover') {
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, view: el.ownerDocument.defaultView || window,
        clientX: r.left + 4, clientY: r.top + r.height / 2, button: 0 };
      try { el.dispatchEvent(new PointerEvent('pointerover', opts)); } catch (e) {}
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mouseenter', Object.assign({}, opts, { bubbles: false })));
      el.dispatchEvent(new MouseEvent('mousemove', opts));
      return true;
    }
    clickOnce(el);
    return true;
  }

  // 定位选项：优先按「列 + 列内序号」（新提示词），兼容旧的扁平 index
  function locateOption(obs, act) {
    const ci = Number(act.col);
    if (Number.isFinite(ci) && obs.columns[ci]) return obs.columns[ci].options[Number(act.index)] || null;
    let n = Number(act.index);
    if (!Number.isFinite(n)) return null;
    for (const c of obs.columns) {
      if (n < c.options.length) return c.options[n];
      n -= c.options.length;
    }
    return null;
  }

  const COMMIT_TEXT = /完成选择|完成|确定|确认/;

  async function exec(act, ctx) {
    const { trig, doc, obs, ti } = ctx;
    if (act.action === 'click_option' || act.action === 'hover_option') {
      const opt = locateOption(obs, act);
      if (!opt) return false;
      return tapEl(opt.el, act.action === 'hover_option' ? 'hover' : 'click', ti);
    }
    if (act.action === 'click_action') {
      const a = obs.footerActions[Number(act.index)];
      if (!a) return false;
      return tapEl(a.el, 'click', ti);
    }
    if (act.action === 'commit') {
      const a = obs.footerActions.find(x => COMMIT_TEXT.test(x.text));
      if (!a) return false;
      return tapEl(a.el, 'click', ti);
    }
    if (act.action === 'click_at') {
      if (!ti) return false;
      const r = await ti.clickPoint(Number(act.x) || 0, Number(act.y) || 0);
      return !!r.ok;
    }
    if (act.action === 'scroll_column' || act.action === 'scroll') {
      const ci = Number.isFinite(Number(act.col)) ? Number(act.col) : obs.columns.length - 1;
      const col = obs.columns[ci];
      const box = col && (col.container || (col.options[0] && col.options[0].el.parentElement));
      if (!box) return false;
      const dy = act.direction === 'up' ? -160 : 160;
      if (ti) return !!(await ti.wheel(dy, box)).ok;
      box.scrollBy({ top: dy });
      return true;
    }
    if (act.action === 'type') {
      const input = (obs.columns[0] && obs.columns[0].container && obs.columns[0].container.querySelector('input'))
        || (trig.querySelector && trig.querySelector('input'));
      if (!input || !root.FieldFiller) return false;
      if (ti && ti.available && await ti.available()) {
        input.focus();
        return !!(await ti.typeText(String(act.text || '').slice(0, 80))).ok;
      }
      root.FieldFiller.setNativeValue(input, String(act.text || '').slice(0, 80));
      return true;
    }
    if (act.action === 'wait') {
      await sleep(Math.min(1200, Math.max(50, Number(act.ms) || 200)));
      return true;
    }
    if (act.action === 'retry_open') { await openTrigger(trig, doc, ti); return true; }
    if (act.action === 'done' || act.action === 'fail') return true;
    void doc;
    return false;
  }

  function summarize(act, obs) {
    if (act.action === 'click_option' || act.action === 'hover_option') {
      const o = locateOption(obs, act);
      return (act.action === 'hover_option' ? '悬停 ' : '点选项 ') + ((o && o.text) || ('#' + act.index));
    }
    if (act.action === 'click_action') {
      const a = obs.footerActions[Number(act.index)];
      return '点按钮 ' + ((a && a.text) || ('#' + act.index));
    }
    if (act.action === 'commit') return '点确认按钮';
    if (act.action === 'click_at') return '点坐标 ' + act.x + ',' + act.y;
    if (act.action === 'type') return '输入 ' + String(act.text || '').slice(0, 20);
    if (act.action === 'scroll' || act.action === 'scroll_column') return act.direction === 'up' ? '向上滚动' : '向下滚动';
    return act.action;
  }

  async function enabled() {
    try {
      const s = await root.ResumeStore.getSettings();
      return !!(s && s.aiEnabled && s.aiApiKey && s.aiDomAgentEnabled !== false);
    } catch (e) {
      return false;
    }
  }

  // L2：AI 单步规划。观察给到「列 + 状态」，动作经可信输入或合成事件派发。
  async function fillField(field, value, opts) {
    if (!(await enabled())) return false;
    const o = opts || {};
    const cancelled = typeof o.cancelled === 'function' ? o.cancelled : () => false;
    const trig = (field && (field.trigger || field.el)) || null;
    if (!trig || value == null || !String(value).trim()) return false;
    const doc = trig.ownerDocument || document;
    const before = displayOf(trig);
    const history = [];
    const goal = String(value).slice(0, 200);
    let ti = null;
    if (root.TrustedInput && await root.TrustedInput.available()) ti = root.TrustedInput;

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (cancelled()) return false;
      const shown = displayOf(trig);
      if (satisfied(shown, goal) && shown !== before) return true;

      let obs = observe(doc, trig);
      if (obs.openState !== 'open' || !obs.columns.length) {
        await openTrigger(trig, doc, ti);
        obs = observe(doc, trig);
      }
      const aiObs = observeForAi(obs);
      const observation = {
        goal,
        fieldLabel: o.label || ((field.signals || [])[0] || ''),
        step,
        openState: obs.openState,
        display: aiObs.display,
        placeholder: aiObs.placeholder,
        columns: aiObs.columns,
        actions: aiObs.actions,
        // 旧字段留着：自建解析服务按 options/actions 扁平结构规划
        options: obs.options.map((it, i) => ({ index: i, text: it.text })),
        history: history.slice(-6)
      };
      if (o.onStep) o.onStep(step, observation);

      let act;
      try { act = await ask(observation); } catch (e) { return false; }
      if (!act || act.action === 'fail') return false;
      if (act.action === 'done') {
        const after = displayOf(trig);
        return satisfied(after, goal) || (!!after && after !== before);
      }
      const acted = Object.assign({}, obs);
      await exec(act, { trig, doc, obs: acted, ti });
      history.push(summarize(act, acted));
      await sleep(200);
    }
    return satisfied(displayOf(trig), goal);
  }

  root.DomAgent = {
    fillField, satisfied, displayOf, findCustomFields, wrapTarget,
    observe, observeForAi, panelsOf, clickOnce, triggerInner, openTrigger, optionText
  };
})(typeof window !== 'undefined' ? window : self);
