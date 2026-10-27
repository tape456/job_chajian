// 简历「逐行扫描」可视化：把规则引擎按行抽取简历的过程放出来给人看。
// 解析本身是同步的（几十毫秒就跑完），所以这里不试图跟着真实进度走，而是
// 收集 parseText 通过 opts.onLine 吐出的行级事件，再按行号顺序回放一遍（总时长封顶 1.2s）。
// 走解析服务（parserBaseUrl）或纯 AI 链路时不会产生行事件，此时组件直接跳过动画。
(function (root) {
  'use strict';
  if (root.ParseScan) return;

  const TOTAL_MS_CAP = 1200;   // 再长的简历也只放 1.2 秒，别把「等解析」变成「等动画」
  const MAX_ROWS = 200;        // 超过这个行数只动画前 N 行，其余归并成一句提示
  const PER_ROW_MS = 18;

  let mask = null, rows = [], byLine = new Map(), stats = { hits: 0 };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function begin(fileName) {
    end();   // 上一次没收尾干净就先拆掉
    mask = el('div', 'qf-ps-mask');
    mask.innerHTML = `<div class="qf-ps-card" role="status" aria-live="polite">
      <div class="qf-ps-head"><b>逐行扫描简历</b><span data-role="file"></span><span class="qf-ps-spin"></span></div>
      <p class="qf-ps-tip" data-role="tip">规则引擎正在按行抽取字段…</p>
      <div class="qf-ps-body"><div class="qf-ps-rows" data-role="rows"></div><div class="qf-ps-band" data-role="band"></div></div>
      <p class="qf-ps-stat" data-role="stat">0 / 0 行</p>
    </div>`;
    mask.querySelector('[data-role=file]').textContent = fileName || '';
    document.body.appendChild(mask);
    rows = []; byLine = new Map(); stats = { hits: 0 };
  }

  // 同一行可能被报两次（键值命中 + 归入某板块），按行号合并
  function onLine(evt) {
    if (!mask || !evt) return;
    const key = evt.n === undefined ? ('#' + byLine.size) : evt.n;
    let row = byLine.get(key);
    if (!row) {
      if (rows.length >= MAX_ROWS) { stats.overflow = (stats.overflow || 0) + 1; return; }
      row = { n: key, text: String(evt.text || ''), hits: [], kind: evt.kind };
      byLine.set(key, row);
      rows.push(row);
    }
    if (evt.kind === 'record' && row.kind === 'plain') row.kind = 'record';
    for (const h of (evt.hits || [])) {
      if (!row.hits.some(x => x.label === h.label && x.value === h.value)) row.hits.push(h);
    }
  }

  function renderRow(row, i) {
    const r = el('div', 'qf-ps-row' + (row.hits.length ? ' hit' : '') + (row.kind === 'section' ? ' sec' : ''));
    r.style.setProperty('--i', String(i % 24));
    r.append(el('span', 'qf-ps-n', String(row.n)));
    r.append(el('span', 'qf-ps-text', row.text));
    if (row.hits.length) {
      const box = el('span', 'qf-ps-hits');
      for (const h of row.hits.slice(0, 3)) {
        box.append(el('i', '', h.label + (h.value ? ' → ' + h.value : '')));
      }
      if (row.hits.length > 3) box.append(el('i', 'more', ' +' + (row.hits.length - 3)));
      r.append(box);
    }
    if (row.hits.length) stats.shownHits = (stats.shownHits || 0) + row.hits.length;
    return r;
  }

  // 播完即拆；没有行事件（解析服务/AI 链路）就直接返回，不空转
  function finish(detail) {
    if (!mask) return Promise.resolve();
    const d = detail || {};
    const rowsBox = mask.querySelector('[data-role=rows]');
    const band = mask.querySelector('[data-role=band]');
    const stat = mask.querySelector('[data-role=stat]');
    const tip = mask.querySelector('[data-role=tip]');
    const spin = mask.querySelector('.qf-ps-spin');
    if (spin) spin.classList.add('done');
    if (!rows.length) {
      tip.textContent = d.tip || '本次由解析服务/AI 直接理解整份文档，没有逐行抽取过程。';
      band.style.display = 'none';
      stat.textContent = d.stat || '';
      return new Promise(res => setTimeout(() => { end(); res(); }, 700));
    }
    const fieldRows = rows.filter(r => r.hits.length && (r.kind === 'kv' || r.kind === 'section')).length;
    const recordRows = rows.filter(r => r.kind === 'record').length;
    tip.textContent = '扫描完 ' + rows.length + ' 行：' + fieldRows + ' 行抽到字段'
      + (recordRows ? '，' + recordRows + ' 行归入各板块' : '');
    const per = Math.min(PER_ROW_MS, TOTAL_MS_CAP / Math.max(1, rows.length));
    const t0 = performance.now();
    let shown = 0;
    return new Promise(res => {
      function frame(now) {
        const target = Math.min(rows.length, Math.floor((now - t0) / per) + 1);
        while (shown < target) {
          const node = renderRow(rows[shown], shown);
          rowsBox.append(node);
          shown++;
        }
        const last = rowsBox.lastElementChild;
        if (last) band.style.transform = 'translateY(' + (last.offsetTop + last.offsetHeight) + 'px)';
        stat.textContent = shown + ' / ' + rows.length + ' 行';
        if (shown < rows.length) { requestAnimationFrame(frame); return; }
        if (stats.overflow) stat.textContent += '（其余 ' + stats.overflow + ' 行未逐条展示）';
        band.classList.add('off');
        setTimeout(() => { end(); res(); }, 900);   // 留一点时间让人看清最后几行
      }
      requestAnimationFrame(frame);
    });
  }

  function fail(message) {
    if (!mask) return;
    const tip = mask.querySelector('[data-role=tip]');
    const spin = mask.querySelector('.qf-ps-spin');
    if (spin) spin.classList.add('done');
    mask.querySelector('.qf-ps-card').classList.add('bad');
    tip.textContent = message || '解析失败';
    setTimeout(end, 1800);
  }

  function end() {
    if (mask) { mask.classList.add('out'); const m = mask; mask = null; setTimeout(() => m.remove(), 200); }
  }

  root.ParseScan = { begin, onLine, finish, fail, end, isOpen: () => !!mask };
})(typeof window !== 'undefined' ? window : self);
