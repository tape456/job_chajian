// 简历解析单元测试：txt + docx（Node 环境）
const fs = require('fs');
const path = require('path');
global.self = global;

require(path.join(__dirname, '..', 'lib', 'resume-schema.js'));
require(path.join(__dirname, '..', 'lib', 'resume-parser.js'));

const P = self.ResumeParser;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
}

function makeFile(fp) {
  const buf = fs.readFileSync(fp);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { name: path.basename(fp), arrayBuffer: async () => ab };
}

function checkResume(tag, data) {
  ok(tag + ' 姓名', data.basic.name === '张三');
  ok(tag + ' 性别', data.basic.gender === '男');
  ok(tag + ' 手机', data.basic.phone === '13900139000');
  ok(tag + ' 邮箱', data.basic.email === 'zhangsan.dev@example.com');
  ok(tag + ' 籍贯', data.basic.nativePlace === '江苏南京');
  ok(tag + ' 政治面貌', data.basic.politicalStatus === '中共党员');
  ok(tag + ' 期望岗位', data.intention.expectedJob === '软件开发工程师');
  ok(tag + ' 期望城市', data.intention.expectedCity === '上海');
  ok(tag + ' 期望薪资', /15-20K|15/.test(data.intention.expectedSalary));
  ok(tag + ' 教育条数', data.education.length >= 2);
  const w = data.work[0] || {};
  ok(tag + ' 公司名拆分', w.company === '中国移动通信集团有限公司');
  ok(tag + ' 职务拆分', w.position === '软件开发工程师');

  // ---- 四期新增字段：KV 与板块解析覆盖 ----
  ok(tag + ' 姓名拼音', data.basic.namePinyin === 'Zhang San', data.basic.namePinyin);
  ok(tag + ' 身高/体重', data.basic.height === '175' && data.basic.weight === '68', data.basic.height + '/' + data.basic.weight);
  ok(tag + ' 户口性质', data.basic.hukouType === '城镇', data.basic.hukouType);
  ok(tag + ' 英语等级', data.basic.englishLevel === 'CET-6', data.basic.englishLevel);
  ok(tag + ' 期望行业', data.intention.expectedIndustry === '互联网/IT', data.intention.expectedIndustry);
  ok(tag + ' 是否接受调剂', data.intention.acceptAdjust === '是', data.intention.acceptAdjust);
  const it = data.internship[0] || {};
  ok(tag + ' 实习经历独立成条', data.internship.length >= 1 && /字节/.test(it.company || ''), it.company);
  ok(tag + ' 实习职位', /实习生/.test(it.position || ''), it.position);
  ok(tag + ' 社会实践板块', (data.practice[0] || {}).name === '南京市人社局实习实践队', (data.practice[0] || {}).name);
  ok(tag + ' 证书条目', data.certificate.length >= 1 && /六级/.test(data.certificate[0].name), (data.certificate[0] || {}).name);
  ok(tag + ' 获奖条目', data.awards.length >= 2 && data.awards.some(a => /国家奖学金/.test(a.name)), data.awards.length);
  ok(tag + ' 论文条目', (data.paper[0] || {}).title.includes('缓存优化'), (data.paper[0] || {}).title);
  ok(tag + ' 专利号', (data.patent[0] || {}).number === 'CN202420123456.7', (data.patent[0] || {}).number);
  ok(tag + ' 外语条目', (data.language[0] || {}).certName === 'CET-6', JSON.stringify(data.language[0] || {}));
  ok(tag + ' 家庭成员关系', (data.family[0] || {}).relation === '父亲', (data.family[0] || {}).relation);
  ok(tag + ' 家庭成员单位', /机械厂/.test((data.family[0] || {}).company || ''), (data.family[0] || {}).company);
  ok(tag + ' 技能落到技术技能', /Java/.test(data.skill.computer || ''), (data.skill.computer || '').slice(0, 16));
}

(async () => {
  const txtPath = path.join(__dirname, '..', 'test', 'sample-resume.txt');
  const docxPath = path.join(__dirname, '..', 'test', 'sample-resume.docx');

  const txtRes = await P.parseFile(makeFile(txtPath));
  checkResume('txt', txtRes.data);

  const docxRes = await P.parseFile(makeFile(docxPath));
  checkResume('docx', docxRes.data);

  console.log('\n== txt warnings:', JSON.stringify(txtRes.warnings));
  console.log('== 公司:', JSON.stringify((txtRes.data.work[0] || {}).company),
    '| 职务:', JSON.stringify((txtRes.data.work[0] || {}).position),
    '| 期望岗位:', JSON.stringify(txtRes.data.intention.expectedJob));
  console.log('\n[逐行扫描 trace]');
  {
    const src = fs.readFileSync(txtPath, 'utf8');
    const evs = [];
    const traced = P.parseText(src, {}, { onLine: e => evs.push(e) });
    const keptLines = src.split(/\r?\n/).map(l => l.trim()).filter(l => l && l.length < 300);
    ok('trace 覆盖到每一个有效行', new Set(evs.map(e => e.n)).size === keptLines.length, evs.length);
    ok('板块标题行标成 section', evs.some(e => e.kind === 'section' && /个人信息/.test(e.text)));
    ok('命中行带「字段名 → 值」', evs.some(e => e.hits.some(h => h.label === '姓名' && h.value === '张三')));
    ok('全文兜底的手机号标回它所在行', evs.some(e => e.hits.some(h => h.label === '手机号')));
    ok('归入板块的行有 record 事件', evs.some(e => e.kind === 'record'));
    ok('开 onLine 与不开的结果完全一致（trace 零副作用）', JSON.stringify(txtRes.data) === JSON.stringify(traced.data));
    const byFile = [];
    await P.parseFile(makeFile(txtPath), { onLine: e => byFile.push(e) });
    ok('parseFile 透传 opts.onLine', byFile.length === evs.length, byFile.length);
  }

  console.log('\n[脏排版收紧]');
  {
    const one = txt => P.parseText(txt, {});
    const edu = one('教育背景\n2021年9月-2022年6月 中国人民大学 工商管理 硕士').data.education[0];
    ok('中文年月区间能抽出起止', edu.start === '2021-09' && edu.end === '2022-06', edu.start + '~' + edu.end);
    const open = one('工作经历\n2021年9月-至今 中国移动通信集团有限公司 后端工程师').data.work[0];
    ok('「至今」开放式区间：起始有值、结束留空', open.start === '2021-09' && !open.end, open.start + '~[' + open.end + ']');
    ok('「至今」不会把日期粘进公司名', open.company === '中国移动通信集团有限公司', open.company);
    ok('标签里的单位括号不影响抽取（身高（cm））', one('身高（cm）：175').data.basic.height === '175');
    ok('PDF 断行：标签与值分两行也能接上', one('姓名：\n张三').data.basic.name === '张三');
    ok('断行接不上时不会把冒号当成交值', one('姓名：\n\n联系方式').data.basic.name === '', JSON.stringify(one('姓名：\n\n联系方式').data.basic.name));
    ok('行首项目符号会被剥掉', one('- 姓名：张三').data.basic.name === '张三');
    ok('期望城市的空格分隔归一成顿号', one('期望城市：北京 上海 广州').data.intention.expectedCity === '北京、上海、广州');
    const en = one('Name: Zhang San\nGender: Male\nPhone: 13900138000').data.basic;
    ok('英文 Name 落到姓名字段（不是英文姓名）', en.name === 'Zhang San', en.name);
    ok('英文 Gender/Phone 也认', en.gender === 'Male' && en.phone === '13900138000', en.gender + '/' + en.phone);
    ok('出生日期保留「日」', one('出生日期：2000年5月1日 政治面貌：中共党员').data.basic.birthDate === '2000年5月1日');
    ok('裸「学历」按最高学历处理', one('学历：硕士').data.basic.highestDegree === '硕士');
    ok('「学历学校」不会被裸「学历」抢走', one('学历学校：中国人民大学').data.basic.highestDegree === '');
    ok('点号区间仍然正常（回归保护）', one('工作经历\n2024.06-2024.12 国家电网有限公司 工程师').data.work[0].start === '2024-06');
  }

  console.log('\nTOTAL', pass + fail, 'PASS', pass, 'FAIL', fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
