// chrome.storage.local 封装（popup / editor / content 共用）
(function (root) {
  'use strict';

  const KEYS = {
    resumes: 'resumes',
    activeResumeId: 'activeResumeId',
    settings: 'settings',
    learnedRules: 'learnedRules',
    siteBindings: 'siteBindings',
    jobRecords: 'jobRecords',
    helperFeedback: 'helperFeedback'
  };

  const DEFAULT_SETTINGS = {
    autoDetect: true,        // 自动识别招聘表单并显示悬浮球
    aiEnabled: false,
    aiBaseUrl: 'https://api.deepseek.com/v1',
    aiApiKey: '',
    aiModel: 'deepseek-chat',
    aiTimeoutMs: 20000,      // 单次 AI 请求超时，超时则只用本地词典结果
    aiDomAgentEnabled: true, // 自定义下拉/级联失败时，以及独立「AI 辅助点击」
    trustedInputEnabled: true, // 可信输入：经 chrome.debugger 派发真实鼠标/键盘事件（页面顶部会出现调试横幅）
    parserBaseUrl: '',       // 解析服务地址（可选，如 http://localhost:8000），留空走本地规则+AI
    useOcr: false            // 扫描件/图片简历时启用 OCR
  };

  function get(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, res => resolve(res[key]));
    });
  }

  function set(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve));
  }

  async function getResumes() {
    return (await get(KEYS.resumes)) || [];
  }

  async function saveResumes(list) {
    await set({ [KEYS.resumes]: list });
  }

  async function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, (await get(KEYS.settings)) || {});
  }

  async function saveSettings(s) {
    await set({ [KEYS.settings]: s });
  }

  async function getActiveResume() {
    const [resumes, activeId] = await Promise.all([getResumes(), get(KEYS.activeResumeId)]);
    if (!resumes.length) return null;
    return resumes.find(r => r.id === activeId) || resumes[0];
  }

  async function setActiveResume(id) {
    await set({ [KEYS.activeResumeId]: id });
  }

  async function upsertResume(resume) {
    const list = await getResumes();
    const idx = list.findIndex(r => r.id === resume.id);
    resume.updatedAt = Date.now();
    if (idx >= 0) list[idx] = resume; else list.push(resume);
    await saveResumes(list);
    return resume;
  }

  async function deleteResume(id) {
    const list = (await getResumes()).filter(r => r.id !== id);
    await saveResumes(list);
    const activeId = await get(KEYS.activeResumeId);
    if (activeId === id) await setActiveResume(list.length ? list[0].id : null);
    // 清理站点绑定
    const bindings = await getSiteBindings();
    let changed = false;
    for (const [domain, rid] of Object.entries(bindings)) {
      if (rid === id) { delete bindings[domain]; changed = true; }
    }
    if (changed) await set({ [KEYS.siteBindings]: bindings });
  }

  // ---------- 站点 ↔ 简历绑定：不同网站复用不同简历 ----------
  async function getSiteBindings() {
    return (await get(KEYS.siteBindings)) || {};
  }

  async function setSiteBinding(domain, resumeId) {
    const map = await getSiteBindings();
    map[domain] = resumeId;
    await set({ [KEYS.siteBindings]: map });
  }

  async function getResumeForDomain(domain, resumes) {
    const map = await getSiteBindings();
    const boundId = map[domain];
    if (boundId) {
      const bound = (resumes || []).find(r => r.id === boundId);
      if (bound) return { resume: bound, bound: true };
    }
    return { resume: null, bound: false };
  }

  async function getLearnedRules() {
    return (await get(KEYS.learnedRules)) || {};
  }

  async function saveLearnedRule(signal, path) {
    const map = await getLearnedRules();
    map[signal] = { path, ts: Date.now() };
    await set({ [KEYS.learnedRules]: map });
  }

  // ---------- 投递记录（本地简单版：记录职位 / 管理投递） ----------
  async function getJobRecords() {
    return (await get(KEYS.jobRecords)) || [];
  }

  async function addJobRecord({ url, title, note }) {
    const list = await getJobRecords();
    const rec = {
      id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      url: url || '', title: title || '', note: note || '', ts: Date.now()
    };
    list.unshift(rec);
    await set({ [KEYS.jobRecords]: list.slice(0, 500) });
    return rec;
  }

  async function deleteJobRecord(id) {
    const list = (await getJobRecords()).filter(r => r.id !== id);
    await set({ [KEYS.jobRecords]: list });
    return list;
  }

  async function clearJobRecords() {
    await set({ [KEYS.jobRecords]: [] });
  }

  // ---------- 辅助填写「不适配」反馈 ----------
  async function getHelperFeedback() {
    return (await get(KEYS.helperFeedback)) || [];
  }

  async function saveHelperFeedback({ url, title, desc, source }) {
    const list = await getHelperFeedback();
    const rec = {
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      url: url || '', title: title || '', desc: desc || '', source: source || 'helper', ts: Date.now()
    };
    list.unshift(rec);
    await set({ [KEYS.helperFeedback]: list.slice(0, 500) });
    return rec;
  }

  root.ResumeStore = {
    KEYS, DEFAULT_SETTINGS,
    get, set,
    getResumes, saveResumes, upsertResume, deleteResume,
    getActiveResume, setActiveResume,
    getSettings, saveSettings,
    getLearnedRules, saveLearnedRule,
    getSiteBindings, setSiteBinding, getResumeForDomain,
    getJobRecords, addJobRecord, deleteJobRecord, clearJobRecords,
    getHelperFeedback, saveHelperFeedback
  };
})(typeof window !== 'undefined' ? window : self);
