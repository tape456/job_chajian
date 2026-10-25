// 本地记录页：投递记录 / 不适配反馈 的查看与导出
(function () {
  'use strict';
  const S = ResumeStore;

  const fmt = ts => new Date(ts || Date.now()).toLocaleString();

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function table(cols, rows) {
    if (!rows.length) return null;
    const t = document.createElement('table');
    t.className = 'rec-table';
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const c of cols) { const th = document.createElement('th'); th.textContent = c; tr.appendChild(th); }
    thead.appendChild(tr); t.appendChild(thead);
    return t;
  }

  async function renderJobs() {
    const list = await S.getJobRecords();
    document.getElementById('jobCount').textContent = list.length;
    const box = document.getElementById('jobsBox');
    box.replaceChildren();
    if (!list.length) {
      const p = document.createElement('div'); p.className = 'rec-empty';
      p.textContent = '还没有记录。在职位页面点击悬浮球 →「记录职位」即可保存。';
      box.appendChild(p); return;
    }
    const t = document.createElement('table');
    t.className = 'rec-table';
    t.innerHTML = '<thead><tr><th>时间</th><th>职位</th><th>链接</th><th>备注</th><th></th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const r of list) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td'); td1.textContent = fmt(r.ts);
      const td2 = document.createElement('td'); td2.textContent = r.title || '(未命名)';
      const td3 = document.createElement('td'); td3.className = 'url';
      if (r.url) { const a = document.createElement('a'); a.href = r.url; a.textContent = r.url; a.target = '_blank'; a.rel = 'noreferrer'; td3.appendChild(a); }
      const td4 = document.createElement('td'); td4.textContent = r.note || '';
      const td5 = document.createElement('td');
      const del = document.createElement('span'); del.className = 'rec-del'; del.textContent = '删除';
      del.addEventListener('click', async () => { await S.deleteJobRecord(r.id); renderJobs(); });
      td5.appendChild(del);
      tr.append(td1, td2, td3, td4, td5);
      tb.appendChild(tr);
    }
    t.appendChild(tb); box.appendChild(t);
  }

  async function renderFeedback() {
    const list = await S.getHelperFeedback();
    document.getElementById('fbCount').textContent = list.length;
    const box = document.getElementById('fbBox');
    box.replaceChildren();
    if (!list.length) {
      const p = document.createElement('div'); p.className = 'rec-empty';
      p.textContent = '还没有反馈。在「辅助填写」面板点击「反馈不适配」即可提交。';
      box.appendChild(p); return;
    }
    const t = document.createElement('table');
    t.className = 'rec-table';
    t.innerHTML = '<thead><tr><th>时间</th><th>来源</th><th>页面</th><th>问题描述</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const r of list) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td'); td1.textContent = fmt(r.ts);
      const td2 = document.createElement('td'); td2.textContent = r.source === 'progress' ? '填写完成' : '辅助填写';
      const td3 = document.createElement('td'); td3.className = 'url'; td3.textContent = r.title || r.url || '';
      const td4 = document.createElement('td'); td4.textContent = r.desc || '';
      tr.append(td1, td2, td3, td4);
      tb.appendChild(tr);
    }
    t.appendChild(tb); box.appendChild(t);
  }

  document.getElementById('exportJobs').addEventListener('click', async () => download('投递记录.json', await S.getJobRecords()));
  document.getElementById('clearJobs').addEventListener('click', async () => {
    if (!confirm('确定清空全部投递记录？该操作不可恢复。')) return;
    await S.clearJobRecords(); renderJobs();
  });
  document.getElementById('exportFb').addEventListener('click', async () => download('不适配反馈.json', await S.getHelperFeedback()));

  renderJobs(); renderFeedback();
})();
