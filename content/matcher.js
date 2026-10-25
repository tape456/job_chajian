// 表单字段采集与语义匹配
(function (root) {
  'use strict';

  const FR = root.FieldRules;

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'search']);

  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function isSkippable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (SKIP_TYPES.has(t)) return true;
    }
    if (el.disabled) return true;
    if (el.readOnly && tag !== 'select') return true;
    // 明显属于站点导航/搜索区的字段
    if (el.closest('nav, [role="navigation"], [role="search"]')) return true;
    return false;
  }

  // 采集单个字段的语义信号，按可靠度排序
  function extractSignals(el) {
    const signals = [];
    const seen = new Set();
    const push = txt => {
      const t = (txt || '').trim();
      if (t && t.length <= 60 && !seen.has(t)) { seen.add(t); signals.push(t); }
    };

    // 1. label[for] / 包裹 label
    if (el.id) {
      // 用元素自己的文档：collectFields 可以传别的 document（iframe 场景），写死全局 document 会查错树
      const lab = (el.ownerDocument || document).querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) push(lab.textContent);
    }
    const wrapLabel = el.closest('label');
    if (wrapLabel) {
      // 包裹 label：若其中含多个可填控件则为整组字段标签；只包一个 input 的通常是选项文本（如 radio 的"男/女"），不作字段信号
      if (wrapLabel.querySelectorAll('input, select, textarea').length > 1) {
        push(wrapLabel.textContent.replace(el.value || '', ''));
      }
    }

    // 2. aria-label / placeholder / title
    push(el.getAttribute('aria-label'));
    push(el.getAttribute('placeholder'));
    push(el.getAttribute('title'));

    // 3. 表格布局：左侧 td/th 文本（央国企老式表单最常见）
    const td = el.closest('td');
    if (td) {
      const row = td.closest('tr');
      if (row) {
        const cells = Array.from(row.cells);
        const idx = cells.indexOf(td);
        if (idx > 0) {
          const prev = cells[idx - 1];
          if (!prev.contains(el)) push(prev.textContent);
        }
      }
      // 列头 th（可能在 thead，也可能只是表格首行）
      const table = td.closest('table');
      if (table) {
        let ths = Array.from(table.querySelectorAll('thead th'));
        if (!ths.length) {
          const firstRow = table.querySelector('tr');
          if (firstRow && firstRow.querySelector('th')) ths = Array.from(firstRow.querySelectorAll('th'));
        }
        if (ths.length) {
          const colIdx = td.cellIndex;
          if (ths[colIdx]) {
            // 家庭成员类表格：加前缀消歧，且优先于普通列头信号
            const headerText = ths.map(t => t.textContent).join('');
            if (/称谓|与本人关系|工作单位及职务/.test(headerText)) {
              push('家庭成员' + ths[colIdx].textContent);
            }
            push(ths[colIdx].textContent);
          }
        }
      }
    }

    // 4. radio/checkbox：fieldset legend 或前置文本节点
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) push(legend.textContent);
    }

    // 5. 前置兄弟/父级文本（<span>姓名：</span><input> 或 <div>姓名<input></div>）
    let prev = el.previousElementSibling;
    let hop = 0;
    while (!prev && hop < 3) { prev = el.parentElement && el.parentElement.previousElementSibling; hop++; }
    if (prev) push(prev.textContent);
    const parent = el.parentElement;
    // 父级克隆文本：父级是 LABEL 时基本是选项文本（radio/checkbox），跳过
    if (parent && parent.tagName !== 'LABEL' && parent.children.length <= 3) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach(n => n.remove());
      push(clone.textContent);
    }

    // 6. name/id 属性（英文信号）
    push(el.getAttribute('name'));
    push(el.id);

    // radio/checkbox 组：组内所有选项文本也作为弱信号（帮助消歧）
    return signals.slice(0, 6);
  }

  // 采集页面所有可填字段（radio 按 name 分组）
  function collectFields(doc) {
    doc = doc || document;
    const nodes = doc.querySelectorAll('input, select, textarea, [contenteditable="true"], [contenteditable=""]');
    const fields = [];
    const radioGroups = new Map();

    for (const el of nodes) {
      if (!isVisible(el) || isSkippable(el)) continue;
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag;

      if (type === 'radio') {
        const key = el.name || el.id || 'radio_' + fields.length;
        if (radioGroups.has(key)) continue;
        const group = Array.from(doc.querySelectorAll(`input[type="radio"][name="${CSS.escape(key)}"]`)).filter(isVisible);
        if (!group.length) continue;
        radioGroups.set(key, true);
        fields.push({
          kind: 'radio', group, el: group[0],
          signals: extractSignals(group[0]),
          options: group.map(r => ({ el: r, text: radioLabelText(r) }))
        });
        continue;
      }
      if (type === 'checkbox') {
        // 单个 checkbox 视为布尔字段；一组同 name 的按选项集处理
        const key = el.name;
        if (key && radioGroups.has('cb_' + key)) continue;
        if (key) radioGroups.set('cb_' + key, true);
        const group = key
          ? Array.from(doc.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(key)}"]`)).filter(isVisible)
          : [el];
        fields.push({
          kind: group.length > 1 ? 'checkboxGroup' : 'checkbox',
          group, el,
          signals: extractSignals(el),
          options: group.map(c => ({ el: c, text: radioLabelText(c) }))
        });
        continue;
      }

      const kind = tag === 'select' ? 'select'
        : tag === 'textarea' ? 'textarea'
        : el.isContentEditable ? 'contenteditable'
        : 'input';
      const f = { kind, el, signals: extractSignals(el) };
      if (kind === 'input') f.inputType = type; // text/date/month/tel/email/number...
      if (kind === 'select') {
        f.options = Array.from(el.options).map(o => ({ el: o, text: o.textContent.trim(), value: o.value }));
      }
      fields.push(f);
    }

    // ---- 自定义下拉 / 级联控件（element-ui、ant-design、通用 combobox）----
    // 这类控件不是原生 select，需点击触发器再点选项；单独识别为 dropdown / cascader
    const consumed = new Set(fields.map(f => f.el));
    const CUSTOM_SEL = '.el-select, .ant-select, .el-cascader, .ant-cascader, [role="combobox"]';
    const cands = Array.from(doc.querySelectorAll(CUSTOM_SEL)).filter(isVisible);
    const tops = cands.filter(el => !cands.some(o => o !== el && o.contains(el)));
    for (const el of tops) {
      // 内部若已有被采集的原生可填字段（真实 select/textarea/可写 input），交给原生逻辑
      const innerNative = el.querySelector('select, textarea, input:not([readonly])');
      if (innerNative && consumed.has(innerNative)) continue;
      const cls = String(el.getAttribute('class') || '');
      const isCascader = /cascader/i.test(cls) || !!el.querySelector('.el-cascader, .ant-cascader');
      const isMulti = /ant-select-multiple/.test(cls) || el.hasAttribute('multiple') || /multiple/.test(cls);
      fields.push({
        kind: isCascader ? 'cascader' : 'dropdown',
        el, trigger: el, multi: isMulti,
        signals: extractSignals(el)
      });
    }

    // 非 Element/Ant 的自定义下拉、级联（只读 input + 自绘浮层，如截图站地区选择）
    if (root.DomAgent && root.DomAgent.findCustomFields) {
      const taken = new Set(fields.map(f => f.el));
      for (const hit of root.DomAgent.findCustomFields(doc, taken)) {
        fields.push({
          kind: hit.kind,
          el: hit.root,
          trigger: hit.root,
          signals: extractSignals(hit.input || hit.root)
        });
      }
    }
    return fields;
  }

  // radio/checkbox 的选项文本：紧邻 label 或包裹 label
  function radioLabelText(el) {
    if (el.id) {
      const lab = (el.ownerDocument || document).querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) return lab.textContent.trim();
    }
    const wrap = el.closest('label');
    if (wrap) return wrap.textContent.trim();
    const next = el.nextElementSibling;
    if (next && (next.tagName === 'LABEL' || next.tagName === 'SPAN') && next.textContent.trim().length < 30) {
      return next.textContent.trim();
    }
    const parent = el.parentElement;
    if (parent && parent.children.length <= 2) {
      const t = parent.textContent.trim();
      if (t.length < 30) return t;
    }
    return '';
  }

  // ---------- 匹配主流程 ----------
  // 返回 { matched: [{field, ruleId, path, entry, confidence, signal}], unmatched: [field], noValue: [{field, ruleId}] }
  function matchFields(fields, entries, learnedRules, data) {
    const matched = [];
    const unmatched = [];
    const noValue = [];
    const learned = learnedRules || {};

    for (const field of fields) {
      let hit = null;
      // 1) 自学习缓存优先
      for (const sig of field.signals) {
        const norm = FR.normalize(sig);
        if (norm && learned[norm]) {
          const entry = entries.find(e => e.path === learned[norm].path);
          if (entry) { hit = { ruleId: 'learned', path: entry.path, entry, confidence: 0.95, signal: sig }; break; }
        }
      }
      // 2) 规则词典
      if (!hit) {
        for (const sig of field.signals) {
          const m = FR.matchSignal(sig);
          if (m && m.paths && m.paths.length) {
            const entry = FR.resolveValue(m.paths, entries);
            if (entry) {
              hit = { ruleId: m.ruleId, path: entry.path, entry, confidence: m.confidence, signal: sig };
              break;
            } else if (m.ruleId === 'photo' || !m.paths.length) {
              // 命中规则但简历无该数据
              hit = { ruleId: m.ruleId, path: null, entry: null, confidence: m.confidence, signal: sig, missing: true };
            }
          }
        }
        // 命中了规则路径但简历值为空 → 记为缺失
        if (!hit) {
          for (const sig of field.signals) {
            const m = FR.matchSignal(sig);
            if (m && m.paths && m.paths.length) {
              noValue.push({ field, ruleId: m.ruleId, signal: sig });
              hit = { skippedNoValue: true };
              break;
            }
          }
        }
      }
      if (hit && !hit.skippedNoValue) {
        if (hit.missing) noValue.push({ field, ruleId: hit.ruleId, signal: hit.signal });
        else matched.push({ field, ...hit });
      } else if (!hit) {
        unmatched.push(field);
      }
    }
    // joinAll 聚合路径被多个字段命中（如家庭成员多行表格）→ 按出现顺序逐条取值
    if (data) {
      const byPath = new Map();
      for (const m of matched) {
        if (!m.entry || m.entry.index !== -1) continue;
        if (!byPath.has(m.entry.path)) byPath.set(m.entry.path, []);
        byPath.get(m.entry.path).push(m);
      }
      for (const ms of byPath.values()) {
        if (ms.length < 2) continue;
        ms.forEach((m, i) => {
          const v = itemValue(data, m.entry.sectionKey, m.entry.fieldKey, i);
          if (v != null && String(v).trim()) {
            m.entry = Object.assign({}, m.entry, { value: String(v).trim() });
          }
        });
      }
    }
    return { matched, unmatched, noValue };
  }

  function itemValue(data, sectionKey, fieldKey, i) {
    const arr = (data && data[sectionKey]) || [];
    const item = arr[i];
    if (!item) return null;
    if (fieldKey === 'period') {
      const s = (item.start || '').replace(/[./]/g, '-');
      const e = (item.end || '').replace(/[./]/g, '-');
      return s && e ? s + ' 至 ' + e : (s || e || '');
    }
    if (sectionKey === 'family' && fieldKey === 'company') {
      return [item.company, item.position].filter(Boolean).join(' ');
    }
    return item[fieldKey];
  }

  root.FieldMatcher = { collectFields, matchFields, extractSignals, radioLabelText, isVisible };
})(typeof window !== 'undefined' ? window : self);
