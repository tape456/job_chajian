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
  console.log('\nTOTAL', pass + fail, 'PASS', pass, 'FAIL', fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
