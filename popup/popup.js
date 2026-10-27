'use strict';

const S = ResumeStore;

const $ = sel => document.querySelector(sel);
const els = {
  list: $('#resumeList'), emptyTip: $('#emptyTip'),
  btnAdd: $('#btnAdd'), btnImport: $('#btnImport'), fileImport: $('#fileImport'), btnExport: $('#btnExport'),
  btnParse: $('#btnParse'), fileParse: $('#fileParse'), btnFillNow: $('#btnFillNow'),
  autoDetect: $('#autoDetect'), aiEnabled: $('#aiEnabled'), aiConfig: $('#aiConfig'),
  aiBaseUrl: $('#aiBaseUrl'), aiApiKey: $('#aiApiKey'), aiModel: $('#aiModel'),
  btnTestAi: $('#btnTestAi'), aiTestResult: $('#aiTestResult'),
  parserBaseUrl: $('#parserBaseUrl'), useOcr: $('#useOcr'),
  aiDomAgent: $('#aiDomAgent'), trustedInput: $('#trustedInput'), motionFx: $('#motionFx')
};

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function resumeSummary(r) {
  const d = r.data || {};
  const parts = [];
  if (d.basic && d.basic.name) parts.push(d.basic.name);
  const edu = (d.education || [])[0];
  if (edu && edu.school) parts.push(edu.school);
  if (d.basic && d.basic.phone) parts.push(d.basic.phone);
  return parts.join(' · ') || '未填写';
}

async function renderList() {
  const [resumes, active, bindings] = await Promise.all([S.getResumes(), S.getActiveResume(), S.getSiteBindings()]);
  const boundDomains = {};
  for (const [domain, rid] of Object.entries(bindings)) {
    (boundDomains[rid] = boundDomains[rid] || []).push(domain);
  }
  els.list.innerHTML = '';
  els.emptyTip.classList.toggle('hidden', resumes.length > 0);
  for (const r of resumes) {
    const domains = boundDomains[r.id] || [];
    const li = document.createElement('li');
    li.className = 'resume-item' + (active && r.id === active.id ? ' active' : '');
    li.innerHTML = `
      <div class="r-info">
        <div class="r-name"></div>
        <div class="r-meta">${resumeSummary(r)}<br>更新于 ${fmtTime(r.updatedAt)}</div>
        ${domains.length ? `<div class="r-meta" style="color:#2563eb">站点记忆：${domains.map(d => d.replace(/^www\./, '')).join('、')}</div>` : ''}
      </div>
      ${active && r.id === active.id ? '<span class="r-badge">默认</span>' : ''}
      <div class="r-actions">
        <button data-act="edit" class="btn sm">编辑</button>
        <button data-act="use" class="btn sm ${active && r.id === active.id ? '' : 'primary'}">设为默认</button>
        <button data-act="dup" class="btn sm">复制</button>
        <button data-act="del" class="btn sm danger">删除</button>
      </div>`;
    li.querySelector('.r-name').textContent = r.name;
    li.addEventListener('click', e => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      e.stopPropagation();
      handleAction(act, r);
    });
    els.list.appendChild(li);
  }
}

async function handleAction(act, r) {
  const resumes = await S.getResumes();
  if (act === 'edit') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/editor.html?id=' + r.id) });
  } else if (act === 'use') {
    await S.setActiveResume(r.id);
    chrome.runtime.sendMessage({ type: 'resume:changed' }).catch(() => {});
    renderList();
  } else if (act === 'dup') {
    const copy = JSON.parse(JSON.stringify(r));
    copy.id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    copy.name = r.name + '（副本）';
    await S.saveResumes(resumes.concat(copy));
    renderList();
  } else if (act === 'del') {
    if (!confirm(`确定删除简历「${r.name}」？此操作不可恢复。`)) return;
    await S.deleteResume(r.id);
    chrome.runtime.sendMessage({ type: 'resume:changed' }).catch(() => {});
    renderList();
  }
}

els.btnAdd.addEventListener('click', async () => {
  const name = prompt('简历名称（如：国网一批-技术岗）', '我的简历');
  if (name === null) return;
  const r = ResumeSchema.newResume(name || '我的简历');
  const resumes = await S.getResumes();
  await S.saveResumes(resumes.concat(r));
  await S.setActiveResume(r.id);
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/editor.html?id=' + r.id) });
  renderList();
});

// ---------- 上传简历解析（Agent 链路） ----------
els.btnParse.addEventListener('click', () => els.fileParse.click());
els.fileParse.addEventListener('change', async () => {
  const file = els.fileParse.files[0];
  if (!file) return;
  els.btnParse.disabled = true;
  els.btnParse.textContent = '解析中…';
  ParseScan.begin(file.name);
  try {
    const settings = await S.getSettings();
    const { data, warnings } = await AgentClient.parseResumeWithAgent(
      file, settings,
      (phase, msg) => { els.btnParse.textContent = msg; },
      { onLine: ParseScan.onLine },
    );
    // 先把逐行扫描放完再开编辑器：新标签页一抢焦点，popup 就被系统关掉了
    await ParseScan.finish();
    const r = ResumeSchema.newResume(file.name.replace(/\.[^.]+$/, '') + '-解析');
    r.data = ResumeSchema.normalizeData(data);
    const resumes = await S.getResumes();
    resumes.push(r);
    await S.saveResumes(resumes);
    await S.setActiveResume(r.id);
    chrome.runtime.sendMessage({ type: 'resume:changed' }).catch(() => {});
    renderList();
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/editor.html?id=' + r.id) });
    if (warnings.length) {
      alert('解析完成，已创建新简历并打开编辑器。\n请核对并补充以下内容：\n- ' + warnings.join('\n- '));
    }
  } catch (e) {
    ParseScan.fail('解析失败：' + e.message);
  }
  els.btnParse.disabled = false;
  els.btnParse.textContent = '上传简历解析';
  els.fileParse.value = '';
});

// ---------- 导入 / 导出 ----------
els.btnImport.addEventListener('click', () => els.fileImport.click());
els.fileImport.addEventListener('change', async () => {
  const file = els.fileImport.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    const items = Array.isArray(obj) ? obj : [obj];
    const resumes = await S.getResumes();
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const r = ResumeSchema.newResume(it.name || file.name.replace(/\.json$/i, ''));
      r.data = ResumeSchema.normalizeData(it.data || it); // 兼容直接导出的 data 或整份简历
      resumes.push(r);
    }
    await S.saveResumes(resumes);
    if (!await S.get('activeResumeId')) await S.setActiveResume(resumes[0].id);
    renderList();
    alert('导入成功');
  } catch (e) {
    alert('导入失败：' + e.message);
  }
  els.fileImport.value = '';
});

els.btnExport.addEventListener('click', async () => {
  const active = await S.getActiveResume();
  if (!active) { alert('请先创建或选择简历'); return; }
  const blob = new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (active.name || 'resume') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- 设置 ----------
async function loadSettings() {
  const s = await S.getSettings();
  els.autoDetect.checked = s.autoDetect;
  els.aiEnabled.checked = s.aiEnabled;
  els.aiBaseUrl.value = s.aiBaseUrl;
  els.aiApiKey.value = s.aiApiKey;
  els.aiModel.value = s.aiModel;
  els.parserBaseUrl.value = s.parserBaseUrl || '';
  els.useOcr.checked = !!s.useOcr;
  els.aiDomAgent.checked = s.aiDomAgentEnabled !== false;
  els.trustedInput.checked = s.trustedInputEnabled !== false;
  els.motionFx.checked = s.motionEnabled !== false;
  els.aiConfig.classList.toggle('hidden', !s.aiEnabled);
}

async function saveSettings() {
  await S.saveSettings({
    autoDetect: els.autoDetect.checked,
    aiEnabled: els.aiEnabled.checked,
    aiBaseUrl: els.aiBaseUrl.value.trim(),
    aiApiKey: els.aiApiKey.value.trim(),
    aiModel: els.aiModel.value.trim(),
    parserBaseUrl: els.parserBaseUrl.value.trim(),
    useOcr: els.useOcr.checked,
    aiDomAgentEnabled: els.aiDomAgent.checked,
    trustedInputEnabled: els.trustedInput.checked,
    motionEnabled: els.motionFx.checked
  });
  els.aiConfig.classList.toggle('hidden', !els.aiEnabled.checked);
}

for (const el of [els.autoDetect, els.aiEnabled, els.aiBaseUrl, els.aiApiKey, els.aiModel,
                   els.parserBaseUrl, els.useOcr, els.aiDomAgent, els.trustedInput]) {
  el.addEventListener('change', saveSettings);
}

els.btnTestAi.addEventListener('click', async () => {
  await saveSettings();
  els.aiTestResult.className = 'ai-test-result';
  if (!els.aiApiKey.value.trim()) {
    els.aiTestResult.textContent = '请先填写 API Key';
    els.aiTestResult.classList.add('fail');
    return;
  }
  els.aiTestResult.textContent = '测试中…';
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'ai:matchFields',
      probe: true,
      fields: [{ id: 'test', signal: '姓名' }],
      entries: [{ path: 'basic.name', label: '姓名' }]
    });
    if (resp && resp.ok) {
      els.aiTestResult.textContent = '连接成功 ✓';
      els.aiTestResult.classList.add('ok');
    } else {
      throw new Error(resp && resp.error || '未知错误');
    }
  } catch (e) {
    els.aiTestResult.textContent = '失败：' + e.message;
    els.aiTestResult.classList.add('fail');
  }
});

// ---------- 手动触发当前页填写 ----------
$('#btnFillNow').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (!/^https?:|^file:/.test(tab.url || '')) {
    alert('当前页面（' + (tab.url || '').slice(0, 40) + '）不支持内容脚本。\n请在普通网页上使用；file:// 页面需在扩展详情中开启"允许访问文件 URL"。');
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'forceShow' }, { frameId: 0 });
    window.close();
  } catch (e) {
    // 页面还没注入脚本（扩展刚安装/更新）：先补注入，再唤出悬浮球
    const r = await chrome.runtime.sendMessage({ type: 'ext:ensureInjected', tabId: tab.id }).catch(() => null);
    try {
      await new Promise(res => setTimeout(res, 350));
      await chrome.tabs.sendMessage(tab.id, { type: 'forceShow' }, { frameId: 0 });
      window.close();
    } catch (e2) {
      alert(r && r.ok
        ? '已尝试注入，但该页面拒绝运行脚本。\n请刷新页面后再点，或检查扩展详情中的站点访问权限。'
        : '该页面禁止脚本注入（浏览器内部页 / 商店页 / 未开启 file:// 访问）。请刷新网页后重试。');
    }
  }
});

// ---------- 本地记录页 ----------
function openRecords(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/records.html' + (hash || '')) });
}
$('#btnRecords').addEventListener('click', () => openRecords());
$('#btnFeedback').addEventListener('click', () => openRecords());

renderList();
loadSettings();
