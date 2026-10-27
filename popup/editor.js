'use strict';

const S = ResumeStore;
const $ = sel => document.querySelector(sel);

let resume = null;
let dirty = false;
let onlyMissing = false;      // 「查看未补齐项」过滤模式
let statsTimer = null;

async function init() {
  const id = new URLSearchParams(location.search).get('id');
  const resumes = await S.getResumes();
  resume = resumes.find(r => r.id === id) || (id ? null : await S.getActiveResume());
  if (!resume) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center">未找到该简历，请从插件弹窗重新打开。</p>';
    return;
  }
  resume.data = ResumeSchema.normalizeData(resume.data);
  $('#resumeName').value = resume.name;
  document.title = `编辑「${resume.name}」- 央国企网申速填`;
  renderNav();
  renderForm();
  bindNavActions();
  // 从进度窗的「去补齐缺项」进来时直接落在未补齐视图（等一帧让字段类名就位再跳转）
  if (new URLSearchParams(location.search).get('missing') === '1') setTimeout(() => setOnlyMissing(true), 150);
  window.addEventListener('scroll', onScrollSpy, { passive: true });
  // 平滑滚动（scrollIntoView behavior:smooth）收尾时的 scroll 事件不保证触发，
  // 加 300ms 轮询兜底，保证导航高亮最终与所在模块一致
  setInterval(onScrollSpy, 300);
}

// ---------- 完成度统计 ----------
// 字段口径：object 段按字段计；array 段按「条目 × 字段」计；无条目的数组段记为尚未新增内容
function computeStats() {
  const perSection = {};
  let filled = 0, total = 0;
  for (const s of ResumeSchema.SCHEMA.sections) {
    let sf = 0, st = 0, items = 0;
    if (s.kind === 'object') {
      for (const f of s.fields) {
        st++;
        if (String(resume.data[s.key][f.key] || '').trim()) sf++;
      }
    } else {
      items = resume.data[s.key].length;
      for (const item of resume.data[s.key]) {
        for (const f of s.fields) {
          st++;
          if (String(item[f.key] || '').trim()) sf++;
        }
      }
    }
    perSection[s.key] = { filled: sf, total: st, items };
    filled += sf; total += st;
  }
  return { filled, total, missing: total - filled, percent: total ? Math.round(filled / total * 100) : 0, perSection };
}

function refreshStats() {
  statsTimer = null;
  const st = computeStats();
  // 总览
  $('#navFilled').textContent = st.filled;
  $('#navTotal').textContent = st.total;
  $('#navPercent').textContent = st.percent + '%';
  $('#navProgress').style.width = st.percent + '%';
  const miss = $('#navMissing');
  if (st.missing > 0) { miss.textContent = `未补齐 ${st.missing} 项`; miss.classList.remove('done'); }
  else { miss.textContent = '已全部补齐'; miss.classList.add('done'); }

  // 模块导航项
  for (const s of ResumeSchema.SCHEMA.sections) {
    const sec = st.perSection[s.key];
    const item = $(`.nav-item[data-sec="${s.key}"]`);
    if (!item) continue;
    const badge = item.querySelector('.nav-badge');
    const cnt = item.querySelector('.cnt');
    const ring = item.querySelector('.nav-ring');
    const pct = sec.total ? Math.round(sec.filled / sec.total * 100) : 0;
    if (cnt) cnt.textContent = sec.total ? `${sec.filled}/${sec.total}` : '—';
    if (ring) {
      const C = 2 * Math.PI * 14;
      const fill = ring.querySelector('.fill');
      fill.style.strokeDasharray = `${(pct / 100 * C).toFixed(1)} ${C.toFixed(1)}`;
      ring.classList.toggle('done', sec.total > 0 && sec.filled === sec.total);
      ring.querySelector('.ring-text').textContent = sec.total ? pct : '–';
    }
    if (badge) {
      if (sec.total === 0) { badge.textContent = '尚未新增内容'; badge.className = 'nav-badge empty'; }
      else if (sec.filled === sec.total) { badge.textContent = '已完成'; badge.className = 'nav-badge done'; }
      else { badge.textContent = `未补齐 ${sec.total - sec.filled} 项`; badge.className = 'nav-badge missing'; }
    }
    // 表单卡片角标
    const card = $('#sec-' + s.key);
    if (card) {
      const cardBadge = card.querySelector('.sec-missing-badge');
      if (cardBadge) {
        if (sec.total === 0) { cardBadge.textContent = '尚未新增内容'; cardBadge.className = 'sec-missing-badge'; }
        else if (sec.filled === sec.total) { cardBadge.textContent = '已完成'; cardBadge.className = 'sec-missing-badge done'; }
        else { cardBadge.textContent = `未补齐 ${sec.total - sec.filled} 项`; cardBadge.className = 'sec-missing-badge'; }
      }
      card.classList.toggle('done-sec', onlyMissing && sec.total > 0 && sec.filled === sec.total);
      card.classList.toggle('empty-sec', onlyMissing && sec.total === 0);
    }
  }
}

function scheduleStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(refreshStats, 120);
}

// ---------- 左侧内容导航 ----------
function renderNav() {
  const nav = $('#sectionNav');
  nav.innerHTML = '';
  for (const s of ResumeSchema.SCHEMA.sections) {
    const a = document.createElement('a');
    a.className = 'nav-item';
    a.href = '#sec-' + s.key;
    a.dataset.sec = s.key;
    a.innerHTML = `
      <svg class="nav-ring" viewBox="0 0 32 32">
        <circle class="track" cx="16" cy="16" r="14" fill="none" stroke-width="4"/>
        <circle class="fill" cx="16" cy="16" r="14" fill="none" stroke-width="4"
          stroke-linecap="round" stroke-dasharray="0 88" transform="rotate(-90 16 16)"/>
        <text class="ring-text" x="16" y="19" text-anchor="middle">0</text>
      </svg>
      <span class="nav-item-body">
        <span class="nav-item-title">${s.title}</span>
        <span class="nav-item-meta"><span class="cnt">—</span><span class="nav-badge empty">…</span></span>
      </span>`;
    a.addEventListener('click', e => {
      e.preventDefault();
      const card = $('#sec-' + s.key);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    nav.appendChild(a);
  }
  refreshStats();
}

function setOnlyMissing(on) {
  onlyMissing = !!on;
  const btn = $('#btnOnlyMissing');
  document.body.classList.toggle('only-missing', onlyMissing);
  btn.classList.toggle('active', onlyMissing);
  btn.textContent = onlyMissing ? '显示全部字段' : '查看未补齐项';
  refreshStats();
  if (onlyMissing) jumpToFirstMissing();
}

function bindNavActions() {
  $('#btnOnlyMissing').addEventListener('click', () => setOnlyMissing(!onlyMissing));
  $('#btnJumpMissing').addEventListener('click', jumpToFirstMissing);
}

function jumpToFirstMissing() {
  const el = document.querySelector('#formRoot .field.empty input, #formRoot .field.empty select, #formRoot .field.empty textarea');
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => el.focus(), 350); }
}

// 滚动监听：高亮当前所在模块
function setActiveNav(key) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.sec === key));
}

function onScrollSpy() {
  const cards = Array.from(document.querySelectorAll('.section-card'));
  if (!cards.length) return;
  // 触底：末段可能因页面到底而无法滚到贴顶（矮末段 + 无下方内容），此时末段即当前段
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (window.scrollY >= maxScroll - 4) {
    setActiveNav(cards[cards.length - 1].id.replace('sec-', ''));
    return;
  }
  let current = cards[0];
  for (const c of cards) {
    if (c.getBoundingClientRect().top <= 100) current = c;
  }
  setActiveNav(current.id.replace('sec-', ''));
}

// ---------- 表单渲染 ----------
// 起止时间展示：只读；教育/工作用 start/end，获奖用 date/endDate
function spanText(item) {
  const s = (item && (item.start || item.date) || '').trim();
  const e = (item && (item.end || item.endDate) || '').trim();
  if (s && e) return s + ' ~ ' + e;
  return s || e || '';
}
const PERIOD_HINTS = {
  education: '入学时间-毕业时间',
  work: '工作开始时间-工作结束时间',
  internship: '实习开始时间-实习结束时间',
  project: '项目开始时间-项目结束时间',
  campus: '任职开始时间-任职结束时间',
  practice: '实践开始时间-实践结束时间',
  awards: '获奖时间-结束时间'
};
function makePeriodField(sectionKey) {
  const wrap = document.createElement('div');
  wrap.className = 'field wide field-note';
  const label = document.createElement('label');
  label.textContent = '起止时间';
  wrap.appendChild(label);
  const input = document.createElement('input');
  input.type = 'text';
  input.readOnly = true;
  input.dataset.period = '1';
  const hintText = PERIOD_HINTS[sectionKey] || '开始时间-结束时间';
  input.placeholder = hintText;
  wrap.appendChild(input);
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = hintText;
  wrap.appendChild(hint);
  return wrap;
}

// 多标签字段（如期望城市）：值仍存成顿号分隔字符串，匹配与填写链路不变
/** 把 data 里已更新的字段写回对应输入框（不整表重绘） */
function refreshPaths(paths) {
  for (const path of paths) {
    const wrap = document.querySelector('[data-path="' + path + '"]');
    if (!wrap) continue;
    const [sec, key] = path.split('.');
    const val = (resume.data[sec] && resume.data[sec][key]) || '';
    const input = wrap.querySelector('input, select, textarea');
    if (input && input.value !== String(val)) input.value = String(val);
    syncFieldState(wrap, val);
  }
  scheduleStats();
}

function applyEducationSync(silent) {
  const changed = ResumeSchema.syncEducationToBasic(resume.data);
  if (changed.length) {
    refreshPaths(changed.map(k => 'basic.' + k));
    if (!silent) markDirty();
  }
}

function applyAgeSync(silent) {
  if (ResumeSchema.syncAgeFromBirthDate(resume.data)) {
    refreshPaths(['basic.age']);
    if (!silent) markDirty();
  }
}

// 证书名称 → 技能「证书认证」：记住上次自动值，手改后不覆盖
const certSkillState = { lastAuto: null };
function applyCertSkillSync(silent) {
  if (ResumeSchema.syncCertificatesSkill(resume.data, certSkillState)) {
    refreshPaths(['skill.certificates']);
    if (!silent) markDirty();
  }
}

function makeSelfIntroNote() {
  const wrap = document.createElement('div');
  wrap.className = 'field wide field-note';
  const label = document.createElement('label');
  label.textContent = '自我介绍（自我评价）';
  wrap.appendChild(label);
  const p = document.createElement('p');
  p.className = 'field-hint';
  p.textContent = '完整自我介绍请在下方「自我评价」板块填写';
  wrap.appendChild(p);
  return wrap;
}

function makeTagsField(section, field, getVal, setVal) {
  const wrap = document.createElement('div');
  wrap.className = 'field wide';
  wrap.dataset.path = section.key + '.' + field.key;
  const label = document.createElement('label');
  label.textContent = field.label;
  const tag = document.createElement('span');
  tag.className = 'tag-missing';
  tag.textContent = '未填';
  label.appendChild(tag);
  wrap.appendChild(label);

  const box = document.createElement('div');
  box.className = 'tags-box';
  const chips = document.createElement('div');
  chips.className = 'tags-chips';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '输入后回车添加';
  box.append(chips, input);

  const any = document.createElement('label');
  any.className = 'tags-any';
  const anyBox = document.createElement('input');
  anyBox.type = 'checkbox';
  const anyText = document.createElement('span');
  anyText.textContent = field.anyLabel || '任意城市';
  any.append(anyBox, anyText);

  const max = field.max || 5;
  const readList = () => String(getVal() || '').split(/[、，,;；]/).map(x => x.trim()).filter(Boolean);
  const writeList = list => { setVal(list.join('、')); syncFieldState(wrap, list.join('、')); markDirty(); scheduleStats(); };

  function draw() {
    const list = readList();
    chips.replaceChildren();
    for (const v of list) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = v;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tag-del';
      del.textContent = '×';
      del.title = '移除 ' + v;
      del.addEventListener('click', () => writeList(readList().filter(x => x !== v)));
      chip.appendChild(del);
      chips.appendChild(chip);
    }
    const isAny = anyBox.checked;
    box.classList.toggle('qf-disabled', isAny);
    input.disabled = isAny;
    chips.querySelectorAll('.tag-del').forEach(b => { b.disabled = isAny; });
    tag.style.display = (isAny || list.length) ? 'none' : '';
  }

  function add() {
    const v = input.value.trim().replace(/[、，,;；]+$/, '');
    if (!v) return;
    const list = readList();
    if (list.includes(v)) { input.value = ''; return; }
    if (list.length >= max) { input.placeholder = '最多 ' + max + ' 个，先移除一个再添加'; input.value = ''; return; }
    list.push(v);
    input.value = '';
    writeList(list);
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === '，' || e.key === ',' || e.key === '、') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !input.value) { const l = readList(); if (l.length) writeList(l.slice(0, -1)); }
  });
  input.addEventListener('blur', add);
  anyBox.addEventListener('change', () => {
    if (anyBox.checked) writeList([]);
    draw();
  });
  wrap.append(box, any);
  anyBox.checked = String(getVal() || '').includes('任意');
  draw();
  return wrap;
}

function makeField(section, field, getVal, setVal) {
  if (field.type === 'tags') return makeTagsField(section, field, getVal, setVal);
  const wrap = document.createElement('div');
  wrap.className = 'field' + (field.type === 'textarea' ? ' wide' : '');
  wrap.dataset.path = section.key + '.' + field.key;
  const label = document.createElement('label');
  label.textContent = field.label;
  const tag = document.createElement('span');
  tag.className = 'tag-missing';
  tag.textContent = '未填';
  tag.style.display = 'none';
  label.appendChild(tag);
  wrap.appendChild(label);

  let input;
  if (field.type === 'select' && field.options && !field.freeText) {
    input = document.createElement('select');
    input.appendChild(new Option('', ''));
    for (const o of field.options) input.appendChild(new Option(o, o));
    input.value = getVal() || '';
    input.addEventListener('change', () => { setVal(input.value); onChange(wrap, input.value); });
  } else if (field.type === 'select' && field.freeText) {
    // 可输入的组合框：input + datalist
    const holder = document.createElement('div');
    holder.className = 'with-datalist';
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'combo';
    input.value = getVal() || '';
    const dlId = 'dl-' + section.key + '-' + field.key + '-' + Math.random().toString(36).slice(2, 7);
    input.setAttribute('list', dlId);
    const dl = document.createElement('datalist');
    dl.id = dlId;
    for (const o of field.options) dl.appendChild(new Option(o));
    holder.appendChild(input);
    holder.appendChild(dl);
    input.addEventListener('change', () => { setVal(input.value); onChange(wrap, input.value); });
    wrap.appendChild(holder);
    if (field.hint) {
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.textContent = field.hint;
      wrap.appendChild(hint);
    }
    syncFieldState(wrap, getVal());
    return wrap;
  } else if (field.type === 'textarea') {
    input = document.createElement('textarea');
    input.value = getVal() || '';
    input.addEventListener('input', () => { setVal(input.value); onChange(wrap, input.value); });
  } else {
    input = document.createElement('input');
    input.type = field.type === 'date' ? 'date' : field.type === 'month' ? 'month' : field.type === 'number' ? 'number' : 'text';
    if (field.type === 'region') input.className = 'region';
    if (field.type === 'region') input.placeholder = '省 / 市 / 区';
    else if (field.placeholder) input.placeholder = field.placeholder;
    if (field.type === 'month') {
      // month 输入框要求 yyyy-MM，存储兼容 yyyy.MM / yyyy/MM
      input.value = normalizeMonth(getVal());
      input.addEventListener('change', () => { setVal(input.value); onChange(wrap, input.value); });
    } else if (field.type === 'date') {
      // date 控件要求 yyyy-MM-dd；旧简历仅有 yyyy-MM 时升为该月首日
      input.value = normalizeDate(getVal());
      input.addEventListener('change', () => { setVal(input.value); onChange(wrap, input.value); });
    } else {
      input.value = getVal() || '';
      input.addEventListener('input', () => { setVal(input.value); onChange(wrap, input.value); });
    }
  }
  if (field.suffix) {
    const holder = document.createElement('div');
    holder.className = 'with-suffix';
    holder.appendChild(input);
    const suf = document.createElement('span');
    suf.className = 'field-suffix';
    suf.textContent = field.suffix;
    holder.appendChild(suf);
    wrap.appendChild(holder);
  } else {
    wrap.appendChild(input);
  }
  // 说明文字：仅在该字段还没填时显示，填好后收起，保证长表单的密度
  if (field.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = field.hint;
    wrap.appendChild(hint);
  }
  syncFieldState(wrap, getVal());
  return wrap;
}

// 字段值变化：脏标记 + 填充态 + 统计刷新
function onChange(wrap, value) {
  markDirty();
  syncFieldState(wrap, value);
  scheduleStats();
}

// 填充态：filled / empty + 「未填」角标
function syncFieldState(wrap, value) {
  const has = String(value == null ? '' : value).trim() !== '';
  wrap.classList.toggle('filled', has);
  wrap.classList.toggle('empty', !has);
  const tag = wrap.querySelector('.tag-missing');
  if (tag) tag.style.display = has ? 'none' : '';
}

function normalizeMonth(v) {
  if (!v) return '';
  const m = String(v).match(/(\d{4})\D?(\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : '';
}

function normalizeDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{4})\D?(\d{1,2})(?:\D+(\d{1,2}))?/);
  if (!m) return '';
  const y = m[1], mo = String(Number(m[2])).padStart(2, '0');
  const day = m[3] != null ? String(Number(m[3])).padStart(2, '0') : '01';
  return y + '-' + mo + '-' + day;
}

function renderForm() {
  const root = $('#formRoot');
  root.innerHTML = '';
  for (const s of ResumeSchema.SCHEMA.sections) {
    const card = document.createElement('section');
    card.className = 'section-card';
    card.id = 'sec-' + s.key;
    const h2 = document.createElement('h2');
    h2.textContent = s.title;
    const badge = document.createElement('span');
    badge.className = 'sec-missing-badge';
    h2.appendChild(badge);
    card.appendChild(h2);
    const sub = document.createElement('p');
    sub.className = 'section-sub';
    if (s.key === 'education') {
      sub.textContent = '教育背景按学历层次从高到低排列；填写后会自动回填基本信息中的毕业院校/专业等空字段。';
    } else if (s.key === 'work' || s.key === 'internship') {
      sub.textContent = '点击「上移」可将当前经历向上移动一条。';
    } else {
      sub.textContent = s.kind === 'array' ? '条目越完整，网申命中率越高' : '';
    }
    card.appendChild(sub);

    if (s.kind === 'object') {
      const grid = document.createElement('div');
      grid.className = 'field-grid';
      for (const f of s.fields) {
        if (s.key === 'basic' && f.key === 'advantages') grid.appendChild(makeSelfIntroNote());
        grid.appendChild(makeField(s, f,
          () => resume.data[s.key][f.key],
          v => {
            resume.data[s.key][f.key] = v;
            if (s.key === 'basic' && f.key === 'birthDate') applyAgeSync();
          }));
      }
      card.appendChild(grid);
    } else {
      const listBox = document.createElement('div');
      listBox.className = 'array-items';
      const renderItems = () => {
        listBox.innerHTML = '';
        const arr = resume.data[s.key];
        arr.forEach((item, idx) => {
          const box = document.createElement('div');
          box.className = 'array-item';
          const head = document.createElement('div');
          head.className = 'item-head';
          const titleBox = document.createElement('div');
          titleBox.className = 'item-title-box';
          const titleEl = document.createElement('span');
          titleEl.className = 'item-title';
          if (s.key === 'work' || s.key === 'internship') {
            const company = String(item.company || '').trim();
            titleEl.textContent = company || s.title;
            const subEl = document.createElement('span');
            subEl.className = 'item-sub';
            subEl.textContent = '第 ' + (idx + 1) + ' 条 ' + s.title;
            titleBox.appendChild(titleEl);
            titleBox.appendChild(subEl);
          } else {
            titleEl.textContent = s.title + ' ' + (idx + 1);
            titleBox.appendChild(titleEl);
          }
          const actions = document.createElement('div');
          actions.className = 'item-actions';
          const upBtn = document.createElement('button');
          upBtn.className = 'btn sm';
          upBtn.dataset.act = 'up';
          upBtn.disabled = idx === 0;
          upBtn.textContent = (s.key === 'work' || s.key === 'internship') ? '上移' : '↑';
          const downBtn = document.createElement('button');
          downBtn.className = 'btn sm';
          downBtn.dataset.act = 'down';
          downBtn.disabled = idx === arr.length - 1;
          downBtn.textContent = '↓';
          const delBtn = document.createElement('button');
          delBtn.className = 'btn sm danger';
          delBtn.dataset.act = 'del';
          delBtn.textContent = '删除';
          actions.appendChild(upBtn);
          actions.appendChild(downBtn);
          actions.appendChild(delBtn);
          head.appendChild(titleBox);
          head.appendChild(actions);
          head.addEventListener('click', e => {
            const act = e.target.dataset.act;
            if (!act) return;
            if (act === 'up' && idx > 0) [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
            if (act === 'down' && idx < arr.length - 1) [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
            if (act === 'del') { arr.splice(idx, 1); }
            markDirty();
            renderItems();
            if (s.key === 'education') applyEducationSync();
            if (s.key === 'certificate') applyCertSkillSync();
            scheduleStats();
          });
          box.appendChild(head);
          const grid = document.createElement('div');
          grid.className = 'field-grid';
          const hasStartEnd = s.fields.some(x => x.key === 'start') && s.fields.some(x => x.key === 'end');
          const hasDateEnd = s.fields.some(x => x.key === 'date') && s.fields.some(x => x.key === 'endDate');
          const hasSpan = hasStartEnd || hasDateEnd;
          const periodAfterKey = hasStartEnd ? 'end' : (hasDateEnd ? 'endDate' : '');
          for (const f of s.fields) {
            grid.appendChild(makeField(s, f,
              () => arr[idx][f.key],
              v => {
                arr[idx][f.key] = v;
                if (s.key === 'education') applyEducationSync();
                if (s.key === 'certificate' && f.key === 'name') applyCertSkillSync();
                if ((s.key === 'work' || s.key === 'internship') && f.key === 'company') {
                  titleEl.textContent = String(v || '').trim() || s.title;
                }
                // 家庭成员：出生日期变更时自动计算年龄
                if (s.key === 'family' && f.key === 'birthDate') {
                  const age = ResumeSchema.ageFromBirthDate(v);
                  if (age) {
                    arr[idx].age = age;
                    const ageWrap = grid.querySelector('[data-path="family.age"]');
                    if (ageWrap) {
                      const ageInput = ageWrap.querySelector('input');
                      if (ageInput) ageInput.value = age;
                      syncFieldState(ageWrap, age);
                    }
                  }
                }
              }));
            // 起止时间：与竞品一致，作为只读展示行跟在结束时间后面
            if (hasSpan && f.key === periodAfterKey) grid.appendChild(makePeriodField(s.key));
          }
          box.appendChild(grid);
          const refreshPeriods = () => {
            box.querySelectorAll('[data-period]').forEach(el => { el.value = spanText(arr[idx]); });
          };
          box.addEventListener('input', refreshPeriods);
          box.addEventListener('change', refreshPeriods);
          refreshPeriods();
          listBox.appendChild(box);
        });
      };
      renderItems();
      card.appendChild(listBox);

      const addBtn = document.createElement('button');
      addBtn.className = 'btn sm add-item-btn';
      addBtn.textContent = '+ 添加一条' + s.title;
      addBtn.addEventListener('click', () => {
        const row = {};
        for (const f of s.fields) row[f.key] = '';
        resume.data[s.key].push(row);
        markDirty();
        renderItems();
        if (s.key === 'education') applyEducationSync();
        if (s.key === 'certificate') applyCertSkillSync();
        scheduleStats();
      });
      card.appendChild(addBtn);
    }
    root.appendChild(card);
  }
  // 打开编辑器时：空字段用教育经历回填；有生日则刷新年龄；证书认证静默对齐（静默，不标未保存）
  certSkillState.lastAuto = null;
  applyEducationSync(true);
  applyAgeSync(true);
  applyCertSkillSync(true);
  refreshStats();
  onScrollSpy();
}

// ---------- 解析导入（Agent 链路） ----------
$('#btnParse').addEventListener('click', () => $('#fileParse').click());
$('#fileParse').addEventListener('change', async () => {
  const file = $('#fileParse').files[0];
  if (!file) return;
  ParseScan.begin(file.name);
  try {
    const settings = await S.getSettings();
    const { data, warnings } = await AgentClient.parseResumeWithAgent(
      file, settings,
      (phase, msg) => {
        const btn = $('#btnParse');
        if (btn) btn.textContent = msg;
      },
      { onLine: ParseScan.onLine },
    );
    await ParseScan.finish();
    if (!confirm('用解析结果覆盖当前简历内容？建议先导出备份。')) return;
    resume.data = ResumeSchema.normalizeData(data);
    renderForm();
    markDirty();
    if (warnings.length) alert('解析完成，请核对以下项：\n- ' + warnings.join('\n- '));
  } catch (e) {
    ParseScan.fail('解析失败：' + e.message);
  }
  $('#fileParse').value = '';
  $('#btnParse').textContent = '解析导入';
});

function markDirty() {
  dirty = true;
  $('#saveState').textContent = '● 未保存';
  $('#saveState').style.color = '#d97706';
}

async function save() {
  resume.name = $('#resumeName').value.trim() || '未命名简历';
  await S.upsertResume(resume);
  await S.setActiveResume(resume.id);
  chrome.runtime.sendMessage({ type: 'resume:changed' }).catch(() => {});
  dirty = false;
  $('#saveState').textContent = '已保存 ' + new Date().toLocaleTimeString();
  $('#saveState').style.color = '#16a34a';
}

$('#btnSave').addEventListener('click', save);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

init();
