// Service Worker：消息路由、AI 请求代理、简历变更广播
importScripts('lib/resume-schema.js', 'lib/rules.js', 'lib/storage.js');

const S = self.ResumeStore;

// ---------- 安装初始化：播种示例简历 ----------
chrome.runtime.onInstalled.addListener(async () => {
  const resumes = await S.getResumes();
  if (resumes.length) return;
  const demo = ResumeSchema.newResume('示例简历（请替换为你的信息）');
  const d = demo.data;
  Object.assign(d.basic, {
    name: '张三', namePinyin: 'Zhang San', nameEn: 'Zhang San',
    gender: '男', birthDate: '2000-05-20', nationality: '中国', ethnicity: '汉族',
    nativePlace: '山东济南', birthPlace: '山东济南', politicalStatus: '中共党员',
    maritalStatus: '未婚', height: '175', weight: '68', bloodType: 'O',
    idType: '身份证', idNumber: '370102200005200011', phone: '13800138000',
    email: 'zhangsan@example.com',
    currentAddress: '北京市海淀区学院路30号', hukouType: '城镇', hukou: '山东济南',
    postalCode: '100083', wechat: 'zhangsan_wx', qq: '123456789', hobbies: '篮球、长跑、摄影',
    highestDegree: '硕士研究生', highestDiploma: '硕士', gradSchool: '中国人民大学',
    gradMajor: '企业管理', studyMode: '全日制', gradDate: '2025-06-30',
    isFresher: '是', workStatus: '在校', workYears: '0', lastCompany: '无',
    englishLevel: 'CET-6', advantages: '严谨细致、执行力强，具备较强的数据整理与跨部门协调能力',
    careerPlan: '立足本职踏实履职，长期在能源电力行业深耕发展',
    health: '健康', hasChronicDisease: '否', hasCriminalRecord: '否', hasMilitaryService: '否',
    isVeteran: '否', isRecommendPostgrad: '否', hasOverseaStudy: '否', isPoorStudent: '否',
    isColorBlind: '否', hasOverseaId: '否', leagueJoinDate: '2015-06-01',
    archiveLocation: '北京市/海淀区', techTitle: '无'
  });
  Object.assign(d.intention, {
    expectedJob: '综合管理岗', expectedCity: '北京', expectedSalary: '10-15K',
    expectedIndustry: '电力/能源', currentIndustry: '无', interviewCity: '北京市/海淀区',
    expectedAnnualSalary: '15', currentSalary: '0',
    jobType: '全职', availableTime: '随时到岗', hasRelativeInCompany: '否',
    jobSource: '官网', acceptAdjust: '是'
  });
  d.education.push({
    start: '2018-09', end: '2022-06', school: '北京科技大学', degree: '本科',
    diploma: '学士', major: '工商管理', department: '经济管理学院', majorCategory: '工商管理类',
    schoolCity: '北京市/海淀区', schoolType: '普通本科', eduStatus: '毕业', duration: '4',
    gpa: '3.6', classRank: '10', majorRank: '15', studentNumber: '2018010203',
    courses: '管理学、微观经济学、宏观经济学、会计学、财务管理、人力资源管理、市场营销、统计学',
    isExchange: '否', exchangeSchool: ''
  });
  d.education.push({
    start: '2022-09', end: '2025-06', school: '中国人民大学', degree: '硕士研究生',
    diploma: '硕士', major: '企业管理', department: '商学院', majorCategory: '工商管理类',
    schoolCity: '北京市/海淀区', schoolType: '普通本科', eduStatus: '在读', duration: '3',
    degreeType: '学术学位', degreeCategory: '管理学硕士', eduMode: '全日制', enrollCategory: '统招',
    isUnifiedEnroll: '是', gpa: '3.7', failedCount: '0', classRank: '8', majorRank: '12', majorStudentCount: '120',
    studentNumber: '2022010203', supervisor: '王教授', supervisorContact: 'wangprof@ruc.edu.cn', labName: '企业管理实验室',
    isKeyLab: '否', isJointProgram: '否', isOverseaSchool: '否',
    courses: '企业战略管理、组织行为学、运营管理、公司治理',
    researchDirection: '国有企业人力资源管理', thesis: '数字化转型下央企人才梯队建设研究',
    isExchange: '否', exchangeSchool: ''
  });
  d.work.push({
    start: '2025-07-01', end: '', company: '国家电网有限公司', department: '人力资源部',
    position: '人事专员', companyScale: '10000人以上', isOversea: '否',
    city: '北京市/西城区', industry: '电力/能源', employmentType: '正式',
    monthlySalary: '12000', annualSalary: '150000',
    referrerName: '王主任', referrerContact: '13900000009', referrerPosition: '人力资源部主任',
    description: '负责校招简历初筛与入职手续办理，维护员工信息台账。',
    leaveReason: ''
  });
  d.internship.push({
    start: '2024-06-01', end: '2024-09-01', company: '中国华能集团有限公司', department: '人力资源部',
    position: '人事实习生', companyScale: '10000人以上', isOversea: '否',
    city: '北京市/西城区', industry: '电力/能源', employmentType: '实习',
    monthlySalary: '3000', annualSalary: '36000',
    referrerName: '李老师', referrerContact: '13900000000', referrerPosition: '人力资源主管',
    description: '1. 协助完成集团校招简历初筛，累计处理简历2000余份；\n2. 参与新员工入职培训组织工作，负责300人会场协调；\n3. 整理人事档案，维护员工信息台账，确保数据准确率100%。',
    leaveReason: '实习期满，返校完成学业'
  });
  d.project.push({
    start: '2023-09', end: '2024-01', name: '国有企业数字化转型课题研究', role: '核心成员',
    description: '参与国务院发展研究中心子课题，负责5家央企案例调研与数据分析，撰写报告2万字，成果获课题优秀评价。',
    responsibility: '负责案例访谈、数据清洗与报告第三章撰写',
    achievement: '课题获评优秀，成果被集团内参采纳'
  });
  d.campus.push({
    start: '2022-09', end: '2023-06', name: '校研究生会', level: '校级', position: '副主席',
    description: '统筹组织校园招聘会、学术讲座等活动20余场，服务同学3000余人次，获"优秀学生干部"称号。',
    duty: '负责活动统筹与外联，带领20人团队'
  });
  d.practice.push({
    start: '2023-07', end: '2023-08', name: '济南市人社局实习实践队', position: '实践队长',
    description: '参与政务窗口材料与群众接待工作，完成调研报告2份，服务办事群众500余人次。'
  });
  d.certificate.push({ name: '大学英语六级（CET-6）', type: '职业资格证书', date: '2023-06-01', number: '251236038004471', issuer: '教育部教育考试院', score: '550' });
  d.certificate.push({ name: '全国计算机等级考试二级', type: '职业资格证书', date: '2021-03-01', issuer: '教育部教育考试院', score: '优秀' });
  d.certificate.push({ name: '校级一等奖学金', type: '其他资质证书', date: '2023-12-01', issuer: '中国人民大学', score: '一等奖' });
  Object.assign(d.basic, {
    emergencyContactName: '张建国', emergencyContactRelation: '父亲', emergencyContactPhone: '13900139000'
  });
  (d.awards || (d.awards = [])).push({
    name: '国家励志奖学金', date: '2023-11-01', endDate: '2023-11-01',
    level: '国家级', rewardType: '个人', rewardLevel: '特等奖', issuer: '教育部',
    description: '教育部颁发的国家励志奖学金'
  });
  (d.awards || (d.awards = [])).push({
    name: '校级优秀毕业生', date: '2025-06-01', endDate: '2025-06-01',
    level: '校级', rewardType: '个人', rewardLevel: '优秀奖', issuer: '中国人民大学',
    description: '中国人民大学校级优秀毕业生'
  });
  (d.patent || (d.patent = [])).push({ name: '一种人力资源数据可视化分析装置', type: '实用新型', number: 'CN202420123456.7', date: '2024-05-01', status: '已受理', inventor: '张三' });
  (d.paper || (d.paper = [])).push({ title: '数字化转型背景下国有企业人力资源管理创新研究', journal: '现代管理科学', authors: '张三，李四', date: '2024-03-01', level: '其他', authorship: '第一作者', volume: '2024年第3期' });
  d.language.push({ name: '英语', certName: 'CET-6', score: '550', level: '精通', listening: '熟练', reading: '精通', date: '2023-06-01' });
  Object.assign(d.skill, {
    computer: '熟练使用 Office/WPS 办公软件，掌握 Python 数据分析基础',
    software: 'Office、WPS、Python、SPSS、PowerBI',
    languageSkill: '英语（CET-6 550分）',
    certificates: '大学英语六级、计算机二级',
    softSkill: '沟通协调、活动策划、团队协作',
    other: '公文写作、活动策划、驾驶证C1'
  });
  d.selfEvaluation.selfIntro = '面试官您好，我是张三，中国人民大学企业管理专业2025届硕士毕业生，中共党员。研究生期间在国家电网、中国华能完成人力资源方向的两段实习，熟悉央企人事流程与公文写作，希望应聘贵司综合管理类岗位。';
  d.selfEvaluation.content = '中共党员，硕士研究生学历，具备央企人力资源实习经验。工作严谨细致，责任心与执行力强，熟练掌握公文写作与办公软件，具有良好的沟通协调能力和团队协作精神，志愿投身能源电力行业，服从组织安排。';
  d.family.push({ relation: '父亲', name: '张建国', gender: '男', age: '52', education: '大专', politicalStatus: '中共党员', company: '济南市某机械厂', position: '车间主任', phone: '13900000001', address: '山东省/济南市' });
  d.family.push({ relation: '母亲', name: '李秀英', gender: '女', age: '50', education: '本科', politicalStatus: '群众', company: '济南市某小学', position: '教师', phone: '13900000002', address: '山东省/济南市' });
  await S.saveResumes([demo]);
  await S.setActiveResume(demo.id);
});

// ---------- 内容脚本补注入：扩展刚安装/更新后，已打开的标签页里没有球，这里主动补一份 ----------
// 顺序必须与 manifest.json 的 content_scripts 一致：filler 依赖 trusted-input，
// content-main 依赖 dom-agent；漏一个会让补注入的页面里 root.DomAgent/TrustedInput 是 undefined。
const CS_FILES = ['content/overlay.js', 'lib/resume-schema.js', 'lib/rules.js', 'lib/storage.js',
  'content/trusted-input.js', 'content/matcher.js', 'content/filler.js', 'content/dom-agent.js',
  'content/detector.js', 'content/content-main.js'];

async function injectIntoTab(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: ['content/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CS_FILES });
    return true;
  } catch (e) { return false; }   // 浏览器内部页 / 商店页 / 未授权 file:// 会失败，忽略
}

async function hasContentScript(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'ext:ping' }, { frameId: 0 }); return true; }
  catch (e) { return false; }
}

// 悬浮球常驻：安装/更新后给所有已打开的普通网页补注入，避免"改了扩展要刷新页面才出球"
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.id || !/^(https?|file):/.test(t.url || '')) continue;
      if (!(await hasContentScript(t.id))) await injectIntoTab(t.id);
    }
  } catch (e) {}
});

// ---------- 可信输入：chrome.debugger 会话管理 ----------
// content 侧只管「点哪个元素、在什么坐标」；attach、命令排队、放手都收在这里。
// 一个标签页只允许一个调试客户端（用户开 F12 就互斥），所以必须串行、必须及时 detach。
const DBG_VERSION = '1.3';
const DBG_IDLE_DETACH_MS = 8000;
// 单条 CDP 命令上限：太短会把「刚 attach 完的第一条命令」误判成卡死，太长会让填写挂住。
// 首次 attach 后浏览器要建会话，实测第一条可能慢到数秒，所以另外做预热 + 一次重试。
const DBG_COMMAND_TIMEOUT_MS = 10000;
// 冲突后多久允许再试：用户点了横幅「取消」就让他清净几分钟，F12 互斥则很快重试
const DBG_COOLDOWN_MS = { canceled_by_user: 300000, debugger_busy: 15000, denied: 20000 };
const dbgSessions = new Map();   // tabId -> { attached, chain, timer, blocked, blockedAt, blockedFor }

function dbgSession(tabId) {
  let s = dbgSessions.get(tabId);
  if (!s) {
    s = { attached: false, chain: Promise.resolve(), timer: null, blocked: '', blockedAt: 0, blockedFor: 0 };
    dbgSessions.set(tabId, s);
  }
  return s;
}

function dbgBlock(s, reason) {
  s.blocked = reason;
  s.blockedAt = Date.now();
  s.blockedFor = DBG_COOLDOWN_MS[reason] || DBG_COOLDOWN_MS.denied;
}

function dbgBlockedReason(s) {
  if (!s.blocked) return '';
  if (Date.now() - s.blockedAt > s.blockedFor) { s.blocked = ''; return ''; }
  return s.blocked;
}

function dbgArmIdleDetach(tabId) {
  const s = dbgSession(tabId);
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => { s.timer = null; dbgDetach(tabId); }, DBG_IDLE_DETACH_MS);
}

// attach 失败不代表不是我们挂的：service worker 被回收后内存里的 attached 标记会丢，
// 而 Chrome 侧会话可能还在。用 getTargets() 复核，否则会把自己判成永久不可用。
async function dbgAttachedByUs(tabId) {
  try {
    const targets = await chrome.debugger.getTargets();
    const t = targets.find(x => x.tabId === tabId);
    return !!(t && t.attached);
  } catch (e) { return false; }
}

async function dbgSendOnce(tabId, method, params, timeoutMs) {
  return await Promise.race([
    chrome.debugger.sendCommand({ tabId }, method, params || {}),
    new Promise((_, rej) => setTimeout(() => rej(new Error('debugger command timeout')), timeoutMs || DBG_COMMAND_TIMEOUT_MS))
  ]);
}

async function dbgAttach(tabId) {
  const s = dbgSession(tabId);
  if (s.attached) return { ok: true };
  const blocked = dbgBlockedReason(s);
  if (blocked) return { ok: false, reason: blocked };
  try {
    await chrome.debugger.attach({ tabId }, DBG_VERSION);
    s.attached = true; s.blocked = '';
    // 预热：新会话的第一条命令实测可能慢到数秒，先用一次廉价读命令趟通，
    // 否则真正的点击会被超时误判（表现就是"可信输入没起作用"）。
    try { await dbgSendOnce(tabId, 'Page.getFrameTree', {}, 3000); } catch (e) {}
    return { ok: true };
  } catch (e) {
    const msg = String(e && e.message || e);
    s.attached = false;
    if (await dbgAttachedByUs(tabId)) { s.attached = true; s.blocked = ''; return { ok: true }; }
    if (/already attached|in use/i.test(msg)) { dbgBlock(s, 'debugger_busy'); return { ok: false, reason: 'debugger_busy', error: msg }; }
    dbgBlock(s, 'debugger_denied');
    return { ok: false, reason: 'debugger_denied', error: msg };
  }
}

async function dbgDetach(tabId) {
  const s = dbgSession(tabId);
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (!s.attached) return { ok: true };
  s.attached = false;
  try { await chrome.debugger.detach({ tabId }); } catch (e) {}
  return { ok: true };
}

async function dbgCommand(tabId, method, params) {
  const s = dbgSession(tabId);
  const attempt = async () => {
    const a = await dbgAttach(tabId);
    if (!a.ok) return a;
    try {
      const result = await dbgSendOnce(tabId, method, params);
      dbgArmIdleDetach(tabId);
      return { ok: true, result };
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/not attached|detached|target closed/i.test(msg)) s.attached = false;
      // 卡住一次的会话不可信：摘掉重连，交给外层重试
      if (/timeout/i.test(msg)) {
        s.attached = false;
        try { await chrome.debugger.detach({ tabId }); } catch (e2) {}
      }
      return { ok: false, reason: /timeout/i.test(msg) ? 'timeout' : 'debugger_denied', error: msg };
    }
  };
  const run = async () => {
    let r = await attempt();
    // 会话刚建立时偶发一次不响应，重连一次再试；仍失败才认罚
    if (!r.ok && r.reason === 'timeout') r = await attempt();
    return r;
  };
  const out = s.chain.then(run, run);
  s.chain = out.then(() => undefined, () => undefined);
  return out;
}

async function dbgStatus(tabId) {
  const settings = await S.getSettings();
  const enabled = settings.trustedInputEnabled !== false;
  const s = tabId == null ? null : dbgSession(tabId);
  const reason = s ? dbgBlockedReason(s) : '';
  return {
    ok: true, enabled,
    attached: !!(s && s.attached),
    reason,
    usable: enabled && !reason
  };
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!source || source.tabId == null) return;
  const s = dbgSession(source.tabId);
  s.attached = false;
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (reason === 'canceled_by_user') dbgBlock(s, 'canceled_by_user');
  else if (reason === 'target_closed') dbgSessions.delete(source.tabId);
  else s.blocked = '';
});

chrome.tabs.onRemoved.addListener(tabId => {
  const s = dbgSessions.get(tabId);
  if (s && s.timer) clearTimeout(s.timer);
  dbgSessions.delete(tabId);
});

// 顶层导航后旧会话已失效：放手让下一条命令重连，同时给被 F12 挤掉的冲突一次重试机会
if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener(d => {
    if (d.frameId !== 0) return;
    const s = dbgSessions.get(d.tabId);
    if (!s) return;
    if (s.blocked && s.blocked !== 'canceled_by_user') s.blocked = '';
    if (s.attached) dbgDetach(d.tabId);
  });
}

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'dbg:status': {
          const tabId = (sender.tab && sender.tab.id) != null ? sender.tab.id : msg.tabId;
          sendResponse(await dbgStatus(tabId));
          break;
        }
        case 'dbg:cmd': {
          const tabId = (sender.tab && sender.tab.id) != null ? sender.tab.id : msg.tabId;
          if (tabId == null) { sendResponse({ ok: false, reason: 'debugger_denied', error: 'no tab' }); break; }
          const settings = await S.getSettings();
          if (settings.trustedInputEnabled === false) { sendResponse({ ok: false, reason: 'disabled' }); break; }
          const r = await dbgCommand(tabId, msg.method, msg.params);
          sendResponse(r);
          break;
        }
        case 'dbg:release': {
          const tabId = (sender.tab && sender.tab.id) != null ? sender.tab.id : msg.tabId;
          sendResponse(tabId == null ? { ok: false } : await dbgDetach(tabId));
          break;
        }
        case 'ai:matchFields': {
          const result = await aiMatchFields(msg.fields, msg.entries, !!msg.probe);
          sendResponse({ ok: true, result });
          break;
        }
        case 'ai:chat': {
          const content = await aiChat(msg);
          sendResponse({ ok: true, content });
          break;
        }
        case 'ai:pageUnderstand': {
          const result = await aiPageUnderstand(msg);
          sendResponse({ ok: true, result });
          break;
        }
        case 'ai:pageAct': {
          const action = await aiPageAct(msg.observation || {});
          sendResponse({ ok: true, action });
          break;
        }
        case 'ai:pickOption': {
          sendResponse(await aiPickOption(msg));
          break;
        }
        case 'resume:changed': {
          await broadcastToTabs({ type: 'resume:updated' });
          sendResponse({ ok: true });
          break;
        }
        case 'frame:matchStats': {
          // iframe 汇总：仅转发给顶层 frame 的 overlay
          if (sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'frame:stats',
              frameId: sender.frameId,
              stats: msg.stats
            }, { frameId: 0 }).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }
        case 'frame:hello': {
          // 子帧只需要自己的 frameId（判断本次填写谁是 lead），不再参与悬浮球裁决
          sendResponse({ ok: true, frameId: sender.frameId, tabId: sender.tab && sender.tab.id });
          break;
        }
        case 'ext:ping': {
          sendResponse({ ok: true });
          break;
        }
        case 'ext:ensureInjected': {
          const ok = msg.tabId != null ? await injectIntoTab(msg.tabId) : false;
          sendResponse({ ok });
          break;
        }
        case 'frame:fieldReport': {
          sendResponse({ ok: true });
          break;
        }
        case 'frame:fillDone': {
          // 非 lead 帧的完成统计转给 lead 帧，用于汇总「填写完成」弹窗
          if (sender.tab && msg.leadId != null && msg.leadId !== sender.frameId) {
            chrome.tabs.sendMessage(sender.tab.id,
              { type: 'frame:fillSummary', from: sender.frameId, count: msg.count, failed: msg.failed, requiredMissing: msg.requiredMissing },
              { frameId: msg.leadId }).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }
        // 逐字段进度：非 lead 帧节流上报，这里定向转给 lead 帧聚合成「其它区域已填 N 项」
        case 'frame:fillStep': {
          if (sender.tab && msg.leadId != null && msg.leadId !== sender.frameId) {
            chrome.tabs.sendMessage(sender.tab.id,
              { type: 'frame:stepSummary', from: sender.frameId, ok: msg.ok, done: msg.done },
              { frameId: msg.leadId }).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }
        case 'frame:fill': {
          if (sender.tab) {
            // 点球帧担任 lead（显示进度），其余帧静默填写
            chrome.tabs.sendMessage(sender.tab.id, { type: 'doFill', leadId: sender.frameId }, {}).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }
        case 'frame:clear': {
          if (sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, { type: 'doClear' }, {}).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }
        // 中止填写但保留描边（取消 ≠ 清除标记）：广播给所有帧，各自的 fillToken 才会前进
        case 'frame:stop': {
          if (sender.tab) {
            chrome.tabs.sendMessage(sender.tab.id, { type: 'doStop' }, {}).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // 异步响应
});

async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(t =>
    chrome.tabs.sendMessage(t.id, message).catch(() => {})
  ));
}

// ---------- AI 代理：OpenAI 兼容 chat/completions ----------
// 兼容各类中转站地址：自动补 /v1；若某路径返回网页(HTML)而非接口则回退尝试下一候选
function chatUrlCandidates(baseUrl) {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) return [base];
  if (/\/v\d+$/i.test(base)) return [base + '/chat/completions'];
  return [base + '/v1/chat/completions', base + '/chat/completions'];
}

// 通用 chat 调用：返回 {json, content}，带超时与候选地址重试
async function callChat(messages, settings, extraBody) {
  const candidates = chatUrlCandidates(settings.aiBaseUrl);
  const body = JSON.stringify(Object.assign({
    model: settings.aiModel || 'deepseek-chat',
    messages,
    temperature: 0
  }, extraBody || {}));

  // AI 请求必须有超时：以前 fetch 挂住会让内容侧 await 永不返回，filling 永久为 true，
  // 之后选区填写/辅助填写点了完全没反应。超时后按"AI 未参与"继续走规则填写。
  const perTry = Math.max(3000, Number(settings.aiTimeoutMs) || 20000);
  const deadline = Date.now() + Math.max(perTry + 5000, 45000);
  const withTimeout = (p, ms, what) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(
      new Error(what + '超时（' + Math.round(ms / 1000) + ' 秒）'), { code: 'timeout' })), ms))
  ]);
  const readText = resp => withTimeout(resp.text().catch(() => ''), perTry, 'AI 响应读取');

  let resp = null, usedUrl = '';
  for (const url of candidates) {
    const left = deadline - Date.now();
    if (left <= 0) throw Object.assign(new Error('AI 整体超时'), { code: 'timeout' });
    const ac = new AbortController();
    const killer = setTimeout(() => ac.abort(), Math.min(perTry, left));
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.aiApiKey
        },
        body,
        signal: ac.signal
      });
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 'timeout')) {
        throw Object.assign(new Error('AI 接口无响应（' + url + '）'), { code: 'timeout' });
      }
      throw e;
    } finally {
      clearTimeout(killer);
    }
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('text/html')) { await readText(r); continue; } // 命中网页而非接口
    resp = r; usedUrl = url; break;
  }
  if (!resp) throw new Error('AI 地址返回的是网页(HTML)而非接口，请确认 API 地址（中转站接口通常形如 http://主机:端口/v1）');
  if (!resp.ok) throw new Error('AI 接口错误 ' + resp.status + '（' + usedUrl + '）: ' + (await readText(resp)).slice(0, 200));
  const json = JSON.parse(await readText(resp));
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || '';
  return { json, content };
}

async function aiChat(payload) {
  const settings = await S.getSettings();
  if (!settings.aiApiKey) throw new Error('未填写 API Key');
  const { content } = await callChat(payload.messages || [], settings);
  return content;
}

// 自学习缓存：必须按「单个信号」逐条写入。matchFields 查询用的是每个信号各自的
// 归一键；以前存的是拼接信号（"姓名 | name"）的键，两边对不上，学到的映射永远不命中。
async function learnMappings(fields, mapping, validPaths) {
  for (const f of fields || []) {
    const p = mapping && mapping[f.id];
    if (typeof p !== 'string' || !validPaths.has(p)) continue;
    const sigs = Array.isArray(f.signals) ? f.signals.slice(0, 2) : (f.signal ? [f.signal] : []);
    for (const sig of sigs) {
      const n = FieldRules.normalize(sig);
      if (n && n.length >= 2) await S.saveLearnedRule(n, p).catch(() => {});
    }
  }
}

async function aiMatchFields(fields, entries, probe) {
  const settings = await S.getSettings();
  if ((!settings.aiEnabled && !probe) || !settings.aiApiKey || !fields || !fields.length) return {};

  const entryList = entries.map(e => ({ path: e.path, label: e.label }));
  const prompt = [
    '你是招聘表单字段映射助手。给定一组网页表单字段的描述信号，以及一份简历数据的字段路径列表，',
    '请为每个表单字段选择最合适的简历路径。若无法确定或简历中没有对应数据，输出 null。',
    '带 options 的字段是下拉/单选控件：所选 path 的值应能对应其中某个选项，对应不上就输出 null。',
    '严格输出 JSON 对象，键为字段 id，值为简历 path 或 null，不要输出其他内容。',
    '',
    '简历字段路径列表：',
    JSON.stringify(entryList),
    '',
    '表单字段（id + 信号文本，如 label/placeholder/name；下拉/单选附选项摘要）：',
    JSON.stringify(fields),
    '',
    '输出 JSON：'
  ].join('\n');

  const { content } = await callChat([{ role: 'user', content: prompt }], settings);
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 返回无法解析: ' + content.slice(0, 200));
  let mapping;
  try { mapping = JSON.parse(m[0]); } catch (e) { throw new Error('AI 返回 JSON 解析失败'); }

  // 校验并写入自学习缓存
  const validPaths = new Set(entries.map(e => e.path));
  const result = {};
  for (const f of fields) {
    const p = mapping[f.id];
    if (typeof p === 'string' && validPaths.has(p)) result[f.id] = p;
  }
  await learnMappings(fields, result, validPaths);
  return result;
}

// 解析服务的页面理解（失败时调用方回退本地映射）
async function callParserPage(settings, payload) {
  const body = JSON.stringify({
    fields: payload.fields.map(f => ({
      id: f.id, kind: f.kind || null,
      signals: f.signals || [],
      options: (f.options || []).map(o => ({ text: o.text || '' })),
    })),
    entries: payload.entries.map(e => ({
      path: e.path, label: e.label,
      value: e.value != null ? String(e.value).slice(0, 200) : null,
    })),
    config: {
      base_url: settings.aiBaseUrl || null,
      api_key: settings.aiApiKey || null,
      model: settings.aiModel || null,
      timeout: Math.max(15, Math.round((settings.aiTimeoutMs || 20000) / 1000)),
    },
  });
  const url = settings.parserBaseUrl.replace(/\/+$/, '') + '/api/page/understand';
  const perTry = Math.max(15000, Number(settings.aiTimeoutMs) || 20000);
  const resp = await Promise.race([
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    new Promise((_, rej) => setTimeout(
      () => rej(Object.assign(new Error('解析服务响应超时'), { code: 'timeout' })), perTry + 10000)),
  ]);
  let json;
  try { json = await resp.json(); } catch (e) {
    throw new Error('解析服务返回异常（HTTP ' + resp.status + '）');
  }
  if (!resp.ok) throw new Error(json.detail || ('解析服务错误 HTTP ' + resp.status));
  const result = {};
  for (const m of json.mappings || []) result[m.id] = m.path;
  return result;
}

async function aiPageUnderstand(payload) {
  const settings = await S.getSettings();
  if (!settings.aiApiKey) return {};
  if (settings.parserBaseUrl) {
    try {
      const result = await callParserPage(settings, payload);
      // 解析服务链路同样要写自学习缓存：否则只有直连模型的链路在学习
      await learnMappings(payload.fields, result, new Set(payload.entries.map(e => e.path)));
      return result;
    } catch (e) {
      console.warn('[速填] 解析服务页面理解失败，回退本地映射：', e.message);
    }
  }
  // 回退：复用旧的一次性映射链路（带选项摘要，帮模型避开对应不上选项的 path）
  const flatFields = payload.fields.map(f => ({
    id: f.id,
    signal: (f.signals || []).slice(0, 3).join(' | '),
    options: (f.options || []).slice(0, 20).map(o => o.text || '')
  }));
  return aiMatchFields(flatFields, payload.entries, true);
}

const PAGE_ACT_ACTIONS = new Set([
  'click_option', 'hover_option', 'click_action', 'commit', 'click_at',
  'scroll_column', 'type', 'wait', 'retry_open', 'done', 'fail',
  'scroll'                                   // 旧名，等价于 scroll_column
]);

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }

function normalizePageAct(raw) {
  const action = raw && PAGE_ACT_ACTIONS.has(raw.action) ? raw.action : 'fail';
  const out = {
    action,
    index: num(raw && raw.index) === undefined ? -1 : num(raw.index),
    text: typeof (raw && raw.text) === 'string' ? raw.text.slice(0, 80) : '',
    direction: raw && raw.direction === 'up' ? 'up' : 'down'
  };
  const col = num(raw && raw.col);
  if (col !== undefined) out.col = col;
  const x = num(raw && raw.x), y = num(raw && raw.y);
  if (x !== undefined && y !== undefined) { out.x = x; out.y = y; }
  const ms = num(raw && raw.ms);
  if (ms !== undefined) out.ms = Math.min(1500, Math.max(50, ms));
  return out;
}

function parsePageActContent(content) {
  const m = String(content || '').match(/\{[\s\S]*\}/);
  if (!m) return { action: 'fail' };
  try { return normalizePageAct(JSON.parse(m[0])); } catch (e) { return { action: 'fail' }; }
}

function pageActPrompt(obs) {
  return [
    '你是网页表单控件操作助手。根据当前浮层观察，只规划下一步，不要一次规划多级。',
    '只输出一个 JSON 对象，不要其它文字。',
    'action 只能是：click_option | hover_option | click_action | commit | click_at | scroll_column | type | wait | retry_open | done | fail。',
    '观察里的 columns 是浮层的每一列（级联选择器从左到右），options 带 col 与 index：',
    '  selected=true 表示该列已选中它；expandable=true 表示点/悬停它会展开下一列；disabled=true 不要点。',
    'click_option / hover_option 必须带 col 和 index；click_action 带 index（对应 actions）。',
    'commit 用于点「完成选择 / 确定」这类确认按钮——很多自绘组件不点它就不写回值。',
    '目标值里没出现的中间级（例如要填「北京市海淀区」，但某列只有「市辖区」）：',
    '  若本列只有一个 expandable 选项，直接 hover/click 它往下钻。',
    '  若本列有多个候选且都不匹配目标，按出现顺序先试第一个（地区类第一列通常是「中国」）。',
    '列太长看不到目标值时用 scroll_column（col + direction）。',
    'type 带 text（搜索框输入）；wait 带 ms（50~1500）；面板没打开用 retry_open。',
    '目标值已体现在 display（控件回显）中时输出 {"action":"done"}。',
    '看不出可点选项、也无法继续时输出 {"action":"fail"}。',
    '',
    '观察：',
    JSON.stringify(obs)
  ].join('\n');
}

async function callParserAct(settings, obs) {
  const body = JSON.stringify({
    goal: obs.goal || '',
    field_label: obs.fieldLabel || '',
    step: obs.step || 1,
    open_state: obs.openState || 'closed',
    display: obs.display || '',
    placeholder: obs.placeholder || '',
    // columns 是列感知观察；服务未升级时会被 Pydantic 忽略，退回按 options 规划
    columns: obs.columns || [],
    options: obs.options || [],
    actions: obs.actions || [],
    history: obs.history || [],
    config: {
      base_url: settings.aiBaseUrl || null,
      api_key: settings.aiApiKey || null,
      model: settings.aiModel || null,
      timeout: Math.max(15, Math.round((settings.aiTimeoutMs || 20000) / 1000)),
    },
  });
  const url = settings.parserBaseUrl.replace(/\/+$/, '') + '/api/page/act';
  const perTry = Math.max(8000, Number(settings.aiTimeoutMs) || 20000);
  const resp = await Promise.race([
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
    new Promise((_, rej) => setTimeout(
      () => rej(Object.assign(new Error('解析服务响应超时'), { code: 'timeout' })), perTry)),
  ]);
  let json;
  try { json = await resp.json(); } catch (e) {
    throw new Error('解析服务返回异常（HTTP ' + resp.status + '）');
  }
  if (!resp.ok) throw new Error(json.detail || ('解析服务错误 HTTP ' + resp.status));
  return normalizePageAct(json);
}

async function aiPageAct(obs) {
  const settings = await S.getSettings();
  if (!settings.aiEnabled || !settings.aiApiKey || settings.aiDomAgentEnabled === false) {
    return { action: 'fail' };
  }
  if (settings.parserBaseUrl) {
    try { return await callParserAct(settings, obs); } catch (e) {
      console.warn('[速填] 解析服务 page/act 失败，回退本地规划：', e.message);
    }
  }
  const { content } = await callChat([
    { role: 'system', content: '你只输出一步操作 JSON。' },
    { role: 'user', content: pageActPrompt(obs) }
  ], settings);
  return parsePageActContent(content);
}

// 选项兜底：select/radio 本地匹配失败时，让模型从选项列表里挑一个序号。
// 各站点选项口径五花八门（「硕士」/「研究生」/「硕士研究生学历」），本地归一覆盖不全。
async function aiPickOption(msg) {
  const settings = await S.getSettings();
  const opts = (msg.options || []).map(t => String(t || '').trim()).filter(Boolean).slice(0, 120);
  if (!settings.aiEnabled || !settings.aiApiKey || !opts.length) {
    return { ok: false, reason: 'ai_unavailable' };
  }
  const prompt = [
    '你是表单选项匹配助手。给定简历里的字段值和网页下拉/单选控件的选项列表，',
    '选出与简历值语义最匹配的选项序号（index，从 0 开始）。',
    '允许合理等价：「硕士研究生」≈「硕士」「研究生」；「中共党员」≈「党员」；「985工程院校」≈「985」。',
    '选项里实在没有对应项时输出 -1，不要硬凑。',
    '只输出 JSON：{"index": 0}',
    '',
    '字段名：' + String(msg.label || ''),
    '简历值：' + String(msg.value || ''),
    '选项列表：' + JSON.stringify(opts)
  ].join('\n');
  const { content } = await callChat([{ role: 'user', content: prompt }], settings);
  const m = String(content || '').match(/\{[\s\S]*\}/);
  let i = -1;
  try { i = Number(JSON.parse(m[0]).index); } catch (e) {}
  if (!Number.isInteger(i) || i < -1 || i >= opts.length) i = -1;
  return { ok: i >= 0, index: i };
}
