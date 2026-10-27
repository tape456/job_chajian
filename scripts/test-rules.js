// matchSignal 短信号误匹配修复的单元测试（Node 环境）
const fs = require('fs');
const path = require('path');
global.self = global;
require('../lib/rules.js');
const FR = global.self.FieldRules;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

console.log('[短信号误匹配修复]');
// 回归 bug：「是」曾被包含匹配进别名「是否交换生」→ isExchange → 误填"否"
const t1 = FR.matchSignal('是');
check('「是」不再命中任何规则', t1 === null, t1 && t1.ruleId);
const t2 = FR.matchSignal('否');
check('「否」不再命中任何规则', t2 === null, t2 && t2.ruleId);
const t3 = FR.matchSignal('男');
check('「男」不再命中任何规则', t3 === null, t3 && t3.ruleId);

console.log('\n[精确匹配不受影响]');
check('姓名 → name', FR.matchSignal('姓名').ruleId === 'name');
check('性别 → gender', FR.matchSignal('性别').ruleId === 'gender');
check('民族 → ethnicity', FR.matchSignal('民族').ruleId === 'ethnicity');
check('出生日期 → birthDate', FR.matchSignal('出生日期').ruleId === 'birthDate');

console.log('\n[包含匹配仍生效（信号≥3字）]');
check('「您的姓名」→ name', FR.matchSignal('您的姓名').ruleId === 'name');
check('「姓名：」→ name', FR.matchSignal('姓名：').ruleId === 'name');
check('「政治面貌（必填）」→ politicalStatus', FR.matchSignal('政治面貌（必填）').ruleId === 'politicalStatus');
check('「最高学历」→ degree', FR.matchSignal('最高学历').ruleId === 'degree');
check('「毕业院校名称」→ school', FR.matchSignal('毕业院校名称').ruleId === 'school');
check('「请输入手机号」→ phone', FR.matchSignal('请输入手机号').ruleId === 'phone');
check('「是否交换生」→ isExchange', FR.matchSignal('是否交换生').ruleId === 'isExchange');
check('「是否服从调剂」不误配 isExchange', (FR.matchSignal('是否服从调剂') || {}).ruleId !== 'isExchange', FR.matchSignal('是否服从调剂') && FR.matchSignal('是否服从调剂').ruleId);

console.log('\n[ option 值同义词不受影响 ]');
check('男 ↔ male', FR.matchOptionValue('male', '男'));
check('中共党员 ↔ 党员', FR.matchOptionValue('党员', '中共党员'));
check('硕士研究生 ↔ 硕士', FR.matchOptionValue('硕士研究生', '硕士'));
check('大学本科 ↔ 本科', FR.matchOptionValue('大学本科', '本科'));

// ============================================================
// 选区填写回归：规则路径写 `education.0.school`，fillRegion 发的是 `education.*.school`，
// 精确相等匹配不上 → 教育经历选区填写必然 0 项填入且整组标红。
// ============================================================
global.self = global;
require('../lib/resume-schema.js');
const RS = global.self.ResumeSchema;

console.log('\n[ 路径方言等价 pathEq ]');
const pe = FR.pathEq || (() => false);   // 未实现时让断言变红而不是崩掉，便于看清缺什么
check('pathEq 已导出', typeof FR.pathEq === 'function');
check('education.0.school ≡ education.*.school', pe('education.0.school', 'education.*.school'));
check('work.*.company ≡ work.3.company', pe('work.*.company', 'work.3.company'));
check('两个具体索引不同则不等', !pe('work.0.company', 'work.2.company'));
check('两段 vs 三段不等价', !pe('education.school', 'education.*.school'));
check('object 段不参与归一化', !pe('basic.name', 'basic.*.name'));
check('不同字段名不等价', !pe('education.0.school', 'education.0.major'));
check('不同板块不等价', !pe('education.0.school', 'work.0.school'));
check('derived.* 逐字相等', pe('derived.age', 'derived.age') && !pe('derived.age', 'derived.school'));

console.log('\n[ 数组段集合与 SCHEMA 一致（防两处真相漂移）]');
const arrKeys = RS.SCHEMA.sections.filter(s => s.kind === 'array').map(s => s.key).sort().join(',');
const declared = (FR.ARRAY_SECTIONS ? Array.from(FR.ARRAY_SECTIONS).sort().join(',') : '(未导出)');
check('ARRAY_SECTIONS === SCHEMA 数组段', declared === arrKeys, { declared, arrKeys });

console.log('\n[ 选区填写方言用例：当前必红，修复后必须全绿 ]');
const regionEntries = [
  { path: 'education.*.school', label: '学校', value: '北京科技大学' },
  { path: 'education.*.degree', label: '学历', value: '本科' },
  { path: 'education.*.diploma', label: '学位', value: '学士' },
  { path: 'education.*.major', label: '专业', value: '工商管理' },
  { path: 'education.*.department', label: '院系', value: '经济管理学院' },
  { path: 'education.*.gpa', label: '成绩绩点', value: '3.6' },
  { path: 'education.*.start', label: '入学时间', value: '2018-09' },
  { path: 'education.*.end', label: '毕业时间', value: '2022-06' },
  { path: 'education.*.period', label: '时间段', value: '2018-09 至 2022-06' }
];
for (const f of ['school', 'degree', 'diploma', 'major', 'department', 'gpa', 'start', 'end', 'period']) {
  const got = FR.resolveValue(['education.0.' + f], regionEntries);
  check('resolveValue(education.0.' + f + ') 命中通配条目', !!got && got.path === 'education.*.' + f, got && got.value);
}
// 规则词典里真实存在的教育规则也要能取到值
for (const sig of ['毕业院校', '专业', '学位', '院系', '入学时间', '毕业时间', 'GPA']) {
  const m = FR.matchSignal(sig);
  const got = m && FR.resolveValue(m.paths, regionEntries);
  check(`信号「${sig}」在选区 entries 里取到值`, !!got, m && m.ruleId + ' → ' + (got ? got.value : 'null'));
}

console.log('\n[ 回退链空值语义 ]');
const chain = [
  { path: 'basic.hukou', label: '户口所在地', value: '' },
  { path: 'basic.nativePlace', label: '籍贯', value: '山东济南' }
];
const chained = FR.resolveValue(['basic.hukou', 'basic.nativePlace'], chain);
check('空值条目不截断回退链', !!chained && chained.path === 'basic.nativePlace', chained && chained.path);

console.log('\n[ 一键填写零漂移：归一化不得改变既有取值 ]');
const demo = RS.emptyData();
demo.basic.name = '张三'; demo.basic.phone = '13800138000'; demo.basic.hukou = '';
demo.basic.nativePlace = '山东济南';
demo.education.push({ school: '北京科技大学', degree: '本科', diploma: '学士', major: '工商管理', department: '经济管理学院', start: '2018-09', end: '2022-06', gpa: '3.6' });
demo.education.push({ school: '中国人民大学', degree: '硕士研究生', diploma: '硕士', major: '企业管理', department: '商学院', start: '2022-09', end: '2025-06', gpa: '3.7' });
demo.work.push({ company: '国家电网有限公司', position: '人事专员', start: '2025-07-01', end: '', description: '负责校招简历初筛' });
demo.internship.push({ company: '中国华能集团有限公司', position: '人事实习生', start: '2024-06-01', end: '2024-09-01', description: '协助简历初筛' });
demo.certificate.push({ name: '大学英语六级', score: '550' });
demo.awards.push({ name: '国家励志奖学金', level: '国家级' });
demo.family.push({ relation: '父亲', name: '张建国', company: '济南市某机械厂', position: '车间主任' });
demo.language.push({ name: '英语', certName: 'CET-6', score: '550' });
const E = RS.buildFlatEntries(RS.normalizeData(demo));
// 参考实现：修复前的纯精确相等匹配
function strictResolve(paths, entries) {
  for (const p of paths) { const h = entries.find(e => e.path === p); if (h && String(h.value).trim()) return h; }
  return null;
}
let drift = 0, improved = 0, hitCount = 0;
for (const rule of FR.RULES) {
  const a = strictResolve(rule.paths, E);
  const b = FR.resolveValue(rule.paths, E);
  if (a && b) hitCount++;
  // 不变量：修复前能取到的值，修复后必须一模一样（不许丢值、不许改值）；
  // 修复前取不到而现在取到了，是本次要修的 bug（如 educationAll），计入 improved。
  if (a && (!b || a.value !== b.value || a.path !== b.path)) {
    drift++; console.log('    · 漂移', rule.id, JSON.stringify(a.path), '→', JSON.stringify(b && b.path));
  } else if (!a && b) improved++;
}
check('既有取值零回归（不丢值、不改值）', drift === 0, { drift, 命中规则数: hitCount });
check('通配规则由取不到变为可取到（本次修复的收益）', improved > 0, { 修复的规则数: improved });
check('一键填写仍能取到教育经历（latest 策略 → education.0.*）',
  (FR.resolveValue(['education.0.school'], E) || {}).value === '中国人民大学',
  (FR.resolveValue(['education.0.school'], E) || {}).value);
// 归一化的真正收益：educationAll 这类写成通配的聚合规则现在也能命中了
const eduAll = FR.RULES.find(r => r.id === 'educationAll');
check('educationAll（education.*.period）现在可命中', !!FR.resolveValue(eduAll.paths, E), (FR.resolveValue(eduAll.paths, E) || {}).value);

// ============================================================
// 竞品教育经历截图标签：主标签必须精确命中对应规则（防别名漏配）
// ============================================================
console.log('\n[ 竞品教育标签 → ruleId ]');
const eduLabelHits = [
  ['专业课程', 'courses'],
  ['起止时间', 'eduPeriod'],
  ['入学时间-毕业时间', 'eduPeriod'],
  ['学校城市', 'schoolCity'],
  ['挂科数', 'failedCount'],
  ['挂科科目数量', 'failedCount'],
  ['是否统招', 'isUnifiedEnroll'],
  ['辅导员联系方式', 'counselorPhone'],
  ['研究方向', 'researchDirection'],
  ['毕业论文', 'thesis'],
  ['学历授予日期', 'degreeDate'],
  ['招生类别', 'enrollCategory'],
  ['是否国家重点实验室', 'isKeyLab'],
  ['学制', 'duration'],
  ['学制（年）', 'duration'],
  ['教育方式', 'eduMode'],
  ['成绩绩点', 'gpa'],
  ['班级排名', 'classRank'],
  ['专业排名', 'majorRank'],
  ['学历证书编号', 'diplomaNumber'],
  ['学位证书编号', 'degreeNumber'],
  ['是否联合培养', 'isJointProgram'],
  ['是否海外学校', 'isOverseaSchool'],
  ['教育描述', 'eduDescription'],
  ['专业描述', 'majorDescription']
];
for (const [sig, want] of eduLabelHits) {
  const m = FR.matchSignal(sig);
  check(`「${sig}」→ ${want}`, !!m && m.ruleId === want, m && m.ruleId);
}
const eduSec = RS.SCHEMA.sections.find(s => s.key === 'education');
check('板块标题为教育背景', eduSec && eduSec.title === '教育背景');
const schoolTypeField = eduSec.fields.find(f => f.key === 'schoolType');
check('schoolType 选项含「其他」', !!(schoolTypeField && schoolTypeField.options && schoolTypeField.options.includes('其他')));
const failedHint = eduSec.fields.find(f => f.key === 'failedCount');
check('failedCount hint 为挂科科目数量', failedHint && failedHint.hint === '挂科科目数量');
const startField = eduSec.fields.find(f => f.key === 'start');
const endField = eduSec.fields.find(f => f.key === 'end');
check('入学/毕业时间为 date', startField && startField.type === 'date' && endField && endField.type === 'date');
const classRankField = eduSec.fields.find(f => f.key === 'classRank');
const majorRankField = eduSec.fields.find(f => f.key === 'majorRank');
check('班级/专业排名带 % 后缀', classRankField && classRankField.suffix === '%' && majorRankField && majorRankField.suffix === '%');

console.log('\n[ 教育起止日：旧 YYYY-MM 归一化为日期 ]');
const monthEdu = RS.emptyData();
monthEdu.education.push({ school: '测试大学', start: '2017-09', end: '2020-06' });
const normEdu = RS.normalizeData(monthEdu);
check('start YYYY-MM → YYYY-MM-01', normEdu.education[0].start === '2017-09-01', normEdu.education[0].start);
check('end YYYY-MM → YYYY-MM-01', normEdu.education[0].end === '2020-06-01', normEdu.education[0].end);
const dateEntries = RS.buildFlatEntries(normEdu);
check('resolveValue education.0.start 取到完整日期',
  (FR.resolveValue(['education.0.start'], dateEntries) || {}).value === '2017-09-01',
  (FR.resolveValue(['education.0.start'], dateEntries) || {}).value);
check('resolveValue education.0.end 取到完整日期',
  (FR.resolveValue(['education.0.end'], dateEntries) || {}).value === '2020-06-01',
  (FR.resolveValue(['education.0.end'], dateEntries) || {}).value);

console.log('\n[ 竞品对齐：个人主页 / 英语等级规则路径 ]');
const hpRule = FR.matchSignal('个人主页');
check('「个人主页」→ personalHomepage', hpRule && hpRule.ruleId === 'personalHomepage', hpRule && hpRule.ruleId);
check('personalHomepage paths 含 basic.homepage', hpRule && hpRule.paths.includes('basic.homepage'), hpRule && hpRule.paths);
const enRule = FR.matchSignal('英语等级');
check('「英语等级」→ englishLevel', enRule && enRule.ruleId === 'englishLevel', enRule && enRule.ruleId);
check('englishLevel 优先 basic.englishLevel', enRule && enRule.paths[0] === 'basic.englishLevel', enRule && enRule.paths);
demo.basic.homepage = 'https://github.com/demo';
demo.basic.englishLevel = 'CET-6';
const E2 = RS.allEntries(RS.normalizeData(demo));
const hpVal = FR.resolveValue(hpRule.paths, E2);
const enVal = FR.resolveValue(enRule.paths, E2);
check('个人主页取到 basic.homepage', hpVal && hpVal.value === 'https://github.com/demo', hpVal && hpVal.value);
check('英语等级优先取 basic.englishLevel', enVal && enVal.value === 'CET-6', enVal && enVal.value);

console.log('\n[ 竞品对齐：项目/校园/工作经历标签 → ruleId ]');
const expLabelHits = [
  ['项目名称', 'projectName'],
  ['项目职务', 'projectRole'],
  ['团队规模', 'projectTeamSize'],
  ['实践方式', 'projectPracticeMethod'],
  ['项目地址', 'projectCity'],
  ['项目链接', 'projectLink'],
  ['项目起止时间', 'projectPeriod'],
  ['项目开始时间', 'projectStart'],
  ['项目结束时间', 'projectEnd'],
  ['项目证明人姓名', 'projectReferrerName'],
  ['项目证明人联系方式', 'projectReferrerContact'],
  ['项目证明人职位', 'projectReferrerPosition'],
  ['项目详细描述', 'projectDescription'],
  ['项目职责与贡献', 'projectResponsibility'],
  ['项目交付结果与量化成果', 'projectAchievement'],
  ['组织名称', 'campusName'],
  ['任职组织', 'campusName'],
  ['组织级别', 'campusLevel'],
  ['校园职务', 'campusPosition'],
  ['个人职责与成果', 'campusDuty'],
  ['主要工作内容', 'campusDescription'],
  ['任职起止时间', 'campusPeriod'],
  ['公司规模', 'companyScale'],
  ['用工性质', 'employmentType'],
  ['离职原因', 'leaveReason'],
  ['工作城市', 'workCity'],
  ['年薪薪资', 'annualSalary']
];
for (const [sig, want] of expLabelHits) {
  const m = FR.matchSignal(sig);
  check(`「${sig}」→ ${want}`, !!m && m.ruleId === want, m && m.ruleId);
}
const projSec = RS.SCHEMA.sections.find(s => s.key === 'project');
const projKeys = projSec.fields.map(f => f.key);
check('项目经历含团队规模/实践方式/地址/链接/证明人',
  ['teamSize', 'practiceMethod', 'city', 'link', 'referrerName', 'referrerContact', 'referrerPosition', 'isOversea']
    .every(k => projKeys.includes(k)),
  projKeys);
check('项目职务标签为「项目职务」', projSec.fields.find(f => f.key === 'role').label === '项目职务');
check('项目经历字段数 ≥ 15', projSec.fields.length >= 15, projSec.fields.length);
const workOversea = RS.SCHEMA.sections.find(s => s.key === 'work').fields.find(f => f.key === 'isOversea');
check('工作海外 hint 对齐竞品', workOversea && workOversea.hint === '该工作经历是否发生在海外', workOversea && workOversea.hint);

console.log('\n[ 竞品实习标签 → ruleId / schema ]');
const internLabelHits = [
  ['实习公司', 'internCompany'],
  ['实习公司名称', 'internCompany'],
  ['实习地址', 'internCity'],
  ['实习所在地区', 'internCity'],
  ['实习所在行业', 'internIndustry'],
  ['职位年薪', 'annualSalary'],
  ['实习证明人', 'internReferrer'],
  ['实习离职原因', 'internLeaveReason'],
  ['实习开始时间', 'internStart'],
  ['实习结束时间', 'internEnd'],
  ['实习开始时间-实习结束时间', 'internPeriod'],
  ['实习起止时间', 'internPeriod']
];
for (const [sig, want] of internLabelHits) {
  const m = FR.matchSignal(sig);
  check(`「${sig}」→ ${want}`, !!m && m.ruleId === want, m && m.ruleId);
}
const internSec = RS.SCHEMA.sections.find(s => s.key === 'internship');
const internStart = internSec.fields.find(f => f.key === 'start');
const internEnd = internSec.fields.find(f => f.key === 'end');
check('实习开始/结束为 date', internStart && internStart.type === 'date' && internEnd && internEnd.type === 'date');
check('实习开始 hint', internStart && internStart.hint === '实习开始时间');
check('实习结束 hint', internEnd && internEnd.hint === '实习结束时间');
const scaleField = internSec.fields.find(f => f.key === 'companyScale');
check('公司规模含 21-99人', !!(scaleField && scaleField.options && scaleField.options.includes('21-99人')));
const indField = internSec.fields.find(f => f.key === 'industry');
check('所属行业为 select', indField && indField.type === 'select');
check('行业选项含专业服务与互联网/IT',
  !!(indField && indField.options && indField.options.includes('专业服务') && indField.options.includes('互联网/IT')));
const internOversea = internSec.fields.find(f => f.key === 'isOversea');
check('实习海外 hint 对齐竞品', internOversea && internOversea.hint === '该实习经历是否发生在海外');
const refContact = internSec.fields.find(f => f.key === 'referrerContact');
const refPos = internSec.fields.find(f => f.key === 'referrerPosition');
check('证明人联系方式 hint', refContact && refContact.hint === '证明人联系方式');
check('证明人职位 hint', refPos && refPos.hint === '证明人职位');

console.log('\n[ 实习起止日：旧 YYYY-MM 归一化为日期 ]');
const monthIntern = RS.emptyData();
monthIntern.internship.push({ company: '测试公司', start: '2024-06', end: '2024-09' });
const normIntern = RS.normalizeData(monthIntern);
check('internship start YYYY-MM → YYYY-MM-01', normIntern.internship[0].start === '2024-06-01', normIntern.internship[0].start);
check('internship end YYYY-MM → YYYY-MM-01', normIntern.internship[0].end === '2024-09-01', normIntern.internship[0].end);

console.log('\n[ 竞品对齐：教育经历回填基本信息 / 年龄 ]');
check('syncEducationToBasic 已导出', typeof RS.syncEducationToBasic === 'function');
check('ageFromBirthDate 已导出', typeof RS.ageFromBirthDate === 'function');
const syncDemo = RS.emptyData();
syncDemo.education.push({
  school: '南京大学', degree: '硕士研究生', diploma: '硕士', major: '计算机科学与技术',
  start: '2024-09', end: '2027-06', eduMode: '全日制'
});
syncDemo.education.push({
  school: '某本科院校', degree: '本科', diploma: '学士', major: '软件工程',
  start: '2020-09', end: '2024-06', eduMode: '全日制'
});
const filled = RS.syncEducationToBasic(syncDemo);
check('空 basic 被最高学历回填', syncDemo.basic.gradSchool === '南京大学' && syncDemo.basic.gradMajor === '计算机科学与技术'
  && syncDemo.basic.highestDegree === '硕士研究生' && syncDemo.basic.highestDiploma === '硕士'
  && syncDemo.basic.studyMode === '全日制' && /^2027-06-\d{2}$/.test(syncDemo.basic.gradDate), {
  filled, basic: {
    gradSchool: syncDemo.basic.gradSchool, gradMajor: syncDemo.basic.gradMajor,
    highestDegree: syncDemo.basic.highestDegree, gradDate: syncDemo.basic.gradDate
  }
});
syncDemo.basic.gradMajor = '手改专业';
RS.syncEducationToBasic(syncDemo);
check('已手填的毕业专业不被覆盖', syncDemo.basic.gradMajor === '手改专业', syncDemo.basic.gradMajor);
const age = RS.ageFromBirthDate('2002-06-22');
check('生日推算年龄合理', Number(age) >= 20 && Number(age) <= 30, age);
const ageData = RS.emptyData();
ageData.basic.birthDate = '2002-06-22';
check('syncAgeFromBirthDate 写入 age', RS.syncAgeFromBirthDate(ageData) && ageData.basic.age === age, ageData.basic.age);

console.log('\n[ 竞品对齐：外语 / 家庭 / 获奖标签 → ruleId ]');
const alignLabelHits = [
  ['语言种类', 'languages'],
  ['考试成绩或级别', 'langScore'],
  ['语言成绩', 'langScore'],
  ['外语证书名称', 'langCertName'],
  ['掌握程度', 'proficiency'],
  ['听说能力', 'listening'],
  ['读写能力', 'reading'],
  ['家庭成员民族', 'familyEthnicity'],
  ['成员民族', 'familyEthnicity'],
  ['家庭成员出生日期', 'familyBirthDate'],
  ['成员出生日期', 'familyBirthDate'],
  ['颁发机构', 'awardIssuer'],
  ['获奖结束时间', 'awardEndDate'],
  ['获奖时间-结束时间', 'awardPeriod'],
  ['获奖起止时间', 'awardPeriod'],
  ['获奖详细描述', 'awardDescription'],
  ['奖项级别', 'awardLevel'],
  ['奖励类型', 'rewardType'],
  ['奖励等级', 'rewardLevel']
];
for (const [sig, want] of alignLabelHits) {
  const m = FR.matchSignal(sig);
  check(`「${sig}」→ ${want}`, !!m && m.ruleId === want, m && m.ruleId);
}

console.log('\n[ 竞品对齐：获奖 schema / period flatten ]');
const awardSec = RS.SCHEMA.sections.find(s => s.key === 'awards');
check('板块标题为获奖经历（奖学金）', awardSec && awardSec.title === '获奖经历（奖学金）');
const awardKeys = awardSec.fields.map(f => f.key);
check('获奖不含 detailDescription（并入获奖描述）', !awardKeys.includes('detailDescription'));
check('奖项名称 hint 对齐竞品奖学金说明',
  awardSec.fields.find(f => f.key === 'name')?.hint?.includes('请直接填写奖学金的名字'));
const descF = awardSec.fields.find(f => f.key === 'description');
check('获奖描述 hint 提示详细描述也取此字段',
  descF && descF.hint === '获奖描述；「获奖详细描述」类表单项也由此字段取值');
const awardDemo = RS.emptyData();
awardDemo.awards.push({
  name: '华为杯数模', issuer: '中国学位与研究生教育学会',
  date: '2025-09-01', endDate: '2025-09-01',
  level: '国家级', rewardType: '团体', rewardLevel: '三等奖',
  description: '详细描述'
});
const awardEntries = RS.buildFlatEntries(RS.normalizeData(awardDemo));
const awardPeriodHit = awardEntries.find(e => e.path === 'awards.*.period');
check('awards.*.period 由 date+endDate 生成',
  !!awardPeriodHit && /2025-09-01/.test(awardPeriodHit.value),
  awardPeriodHit && awardPeriodHit.value);
const detailHit = FR.resolveValue(['awards.*.description'], awardEntries);
check('resolveValue 获奖描述', detailHit && /详细描述/.test(detailHit.value), detailHit && detailHit.value);
const endHit = FR.resolveValue(['awards.*.endDate'], awardEntries);
check('resolveValue endDate', endHit && endHit.value === '2025-09-01', endHit && endHit.value);
const familyAge = RS.ageFromBirthDate('1976-06-18');
check('家庭成员生日可推算年龄', Number(familyAge) >= 40 && Number(familyAge) <= 60, familyAge);

console.log('\n[ 竞品对齐：社会实践 / 技能 / 证书标签 → ruleId ]');
const practiceSkillHits = [
  ['实践单位', 'practiceUnit'],
  ['实践岗位/身份', 'practicePosition'],
  ['实践开始时间', 'practiceStart'],
  ['实践结束时间', 'practiceEnd'],
  ['实践开始时间-实践结束时间', 'practicePeriod'],
  ['实践起止时间', 'practicePeriod'],
  ['技术技能', 'techSkill'],
  ['语言能力', 'languageSkill'],
  ['掌握的语言', 'languageSkill'],
  ['软件技能', 'softwareSkill'],
  ['证书认证', 'certSkill'],
  ['软技能', 'softSkill'],
  ['软技能和沟通能力', 'softSkill'],
  ['证书描述', 'certDescription'],
  ['资质证书名称', 'certificates'],
  ['资质证书类型', 'certType']
];
for (const [sig, want] of practiceSkillHits) {
  const m = FR.matchSignal(sig);
  check(`「${sig}」→ ${want}`, !!m && m.ruleId === want, m && m.ruleId);
}
const practiceSec = RS.SCHEMA.sections.find(s => s.key === 'practice');
const pStart = practiceSec.fields.find(f => f.key === 'start');
const pEnd = practiceSec.fields.find(f => f.key === 'end');
check('实践开始 hint', pStart && pStart.hint === '实践开始时间');
check('实践结束 hint', pEnd && pEnd.hint === '实践结束时间');
const skillSec = RS.SCHEMA.sections.find(s => s.key === 'skill');
const skillKeys = skillSec.fields.map(f => f.key);
check('技能特长含技术/语言/软件/证书/软技能',
  ['computer', 'languageSkill', 'software', 'certificates', 'softSkill'].every(k => skillKeys.includes(k)),
  skillKeys);
const certSec = RS.SCHEMA.sections.find(s => s.key === 'certificate');
check('证书含 description', certSec.fields.some(f => f.key === 'description'));

console.log('\n[ 竞品对齐：证书认证自动同步 ]');
check('syncCertificatesSkill 已导出', typeof RS.syncCertificatesSkill === 'function');
check('buildCertificatesSkill 已导出', typeof RS.buildCertificatesSkill === 'function');
const certSync = RS.emptyData();
certSync.certificate.push({ name: '大学英语六级' });
certSync.certificate.push({ name: '计算机二级' });
const st = { lastAuto: null };
check('空 certificates 自动写入', RS.syncCertificatesSkill(certSync, st)
  && certSync.skill.certificates === '大学英语六级、计算机二级', certSync.skill.certificates);
check('lastAuto 记住自动值', st.lastAuto === '大学英语六级、计算机二级', st.lastAuto);
certSync.certificate.push({ name: '普通话二级甲等' });
check('仍为自动值时随证书列表更新', RS.syncCertificatesSkill(certSync, st)
  && certSync.skill.certificates === '大学英语六级、计算机二级、普通话二级甲等',
  certSync.skill.certificates);
certSync.skill.certificates = '手改证书认证';
check('手改后不再覆盖', !RS.syncCertificatesSkill(certSync, st)
  && certSync.skill.certificates === '手改证书认证', certSync.skill.certificates);
const customFirst = RS.emptyData();
customFirst.certificate.push({ name: '六级' });
customFirst.skill.certificates = '自定义文案';
const st2 = { lastAuto: null };
check('首次加载手改内容不覆盖', !RS.syncCertificatesSkill(customFirst, st2)
  && customFirst.skill.certificates === '自定义文案');

console.log('\n[ 选项数值边界（"1" 不再命中 "10"） ]');
check('1 不匹配 10', !FR.matchOptionValue('10', '1'));
check('1 不匹配 10000人以上', !FR.matchOptionValue('10000人以上', '1'));
check('8 匹配 8', FR.matchOptionValue('8', '8'));
check('15 匹配 15万', FR.matchOptionValue('15万', '15'));
check('15 不匹配 150', !FR.matchOptionValue('150', '15'));
check('10000人以上 仍匹配自身', FR.matchOptionValue('10000人以上', '10000人以上'));

console.log('\n[ 日期格式自适应 ]');
const FD = FR.formatDate;
check('date 类型补日', FD('2024-06', { type: 'date' }) === '2024-06-01', FD('2024-06', { type: 'date' }));
check('month 类型截断', FD('2024-06-15', { type: 'month' }) === '2024-06', FD('2024-06-15', { type: 'month' }));
check('YYYYMM 提示', FD('2024-06-15', { hint: '请输入 yyyymm 格式' }) === '202406');
check('YYYYMMDD 提示', FD('2024-06-15', { hint: 'yyyymmdd' }) === '20240615');
check('斜杠格式提示', FD('2024-06-15', { hint: 'yyyy/mm/dd' }) === '2024/06/15', FD('2024-06-15', { hint: 'yyyy/mm/dd' }));
check('点分隔格式提示', FD('2024-06', { hint: 'yyyy.mm' }) === '2024.06');
check('中文年月', FD('2024-06', { hint: 'yyyy年mm月' }) === '2024年06月');
check('maxlength=6 → YYYYMM', FD('2024/6', { maxLength: 6 }) === '202406');
check('maxlength=8 → YYYYMMDD', FD('2024.6', { maxLength: 8 }) === '20240601');
check('无提示保持原值', FD('2024-06-15', {}) === '2024-06-15');

console.log('\n[ 板块上下文 ]');
check('实习经历标题 → internship', FR.scopeOf('十、实习经历（板块上下文）') === 'internship', FR.scopeOf('十、实习经历（板块上下文）'));
check('工作经历标题 → work', FR.scopeOf('七、工作经历') === 'work', FR.scopeOf('七、工作经历'));
check('教育背景标题 → education', FR.scopeOf('二、教育背景') === 'education');
check('家庭成员 → family', FR.scopeOf('家庭成员') === 'family');
check('无关标题 → 空', FR.scopeOf('九、扩展字段') === '', FR.scopeOf('九、扩展字段'));
const scopedPaths = ['work.*.referrerName', 'internship.*.referrerName', 'project.*.referrerName'];
check('实习区块优先取实习证明人', FR.preferScope(scopedPaths, 'internship')[0] === 'internship.*.referrerName', FR.preferScope(scopedPaths, 'internship'));
check('无板块时保持原顺序', FR.preferScope(scopedPaths, '') === scopedPaths);
check('板块没有对应路径时保持原顺序', JSON.stringify(FR.preferScope(['basic.name'], 'internship')) === JSON.stringify(['basic.name']));

console.log('\n[ 英文信号的词边界 ]');
check('constellation 不再命中电话', !FR.matchSignal('constellation') || FR.matchSignal('constellation').ruleId !== 'phone', FR.matchSignal('constellation') && FR.matchSignal('constellation').ruleId);
check('hotelName 不再命中电话', !FR.matchSignal('hotelName') || FR.matchSignal('hotelName').ruleId !== 'phone');
check('contactTel 仍命中电话', (FR.matchSignal('contactTel') || {}).ruleId === 'phone', FR.matchSignal('contactTel') && FR.matchSignal('contactTel').ruleId);
check('userName 仍命中姓名', (FR.matchSignal('userName') || {}).ruleId === 'name', FR.matchSignal('userName') && FR.matchSignal('userName').ruleId);
check('中文包含匹配不受影响', (FR.matchSignal('请输入手机号') || {}).ruleId === 'phone');

console.log('\n[ 设计令牌一致性（popup/tokens.css ↔ overlay.js）]');
// Shadow DOM 用不了 <link>，overlay.js 里是同一套值的拷贝；漂了就会出现「页面内外两套品牌色」
const tokensCss = fs.readFileSync(path.join(__dirname, '../popup/tokens.css'), 'utf8');
const overlayJs = fs.readFileSync(path.join(__dirname, '../content/overlay.js'), 'utf8');
const SYNC_TOKENS = [
  'qf-brand', 'qf-brand-2', 'qf-brand-deep', 'qf-ok', 'qf-ok-2',
  'qf-t1', 'qf-t2', 'qf-t3', 'qf-bg', 'qf-bg-soft', 'qf-border', 'qf-border-2',
  'qf-warn', 'qf-bad', 'qf-r-lg', 'qf-r-md', 'qf-r-sm', 'qf-r-pill',
];
const pick = (src, name) => {
  const m = src.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);'));
  return m ? m[1].replace(/\s+/g, '').toLowerCase() : null;
};
for (const name of SYNC_TOKENS) {
  const a = pick(tokensCss, name), b = pick(overlayJs, name);
  check('--' + name + ' 两边一致', a !== null && a === b, { tokens: a, overlay: b });
}
check('缓动函数两边一致', pick(tokensCss, 'qf-ease') === pick(overlayJs, 'qf-ease'));
check('弹窗阴影令牌两边一致', pick(tokensCss, 'qf-sp-panel') === pick(overlayJs, 'qf-sp-panel'));
const legacy = ['popup/popup.css', 'popup/editor.css', 'popup/records.html', 'popup/tokens.css']
  .filter(f => /#3b6ef5|#6b93ff/i.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
check('扩展页不再残留旧品牌蓝 #3b6ef5/#6b93ff', legacy.length === 0, legacy);

console.log(`\nTOTAL ${pass + fail} PASS ${pass} FAIL ${fail}`);
process.exit(fail ? 1 : 0);
