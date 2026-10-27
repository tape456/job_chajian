// 临时探针：数组板块（项目/论文/专利/证书/获奖/语言/家庭/社会实践）的脏排版覆盖
global.self = global;
require('../lib/resume-schema.js');
require('../lib/resume-parser.js');
const P = self.ResumeParser;

const CASES = [
  ['证书', '资格证书\n2023.06 大学英语六级 550分\n2022.11 计算机软考中级 系统集成项目管理工程师'],
  ['获奖', '荣誉奖项\n2023年国家励志奖学金\n2022-05 校级优秀学生干部'],
  ['专利', '专利信息\n一种基于图神经网络的简历匹配方法 ZL202310123456.7 发明专利 第一发明人'],
  ['论文', '论文发表\n《面向央企网申的结构化信息抽取》 核心期刊 2023年12月 第一作者'],
  ['语言', '外语能力\n英语 CET-6 550分\n法语 DELF B2'],
  ['家庭', '家庭成员\n父亲 张国强 1968.03 济南市某机械厂 车间主任\n母亲 李秀英 1970.07 群众 济南市某小学 教师'],
  ['社会实践', '社会实践\n2022.07-2022.08 南京市人社局实习实践队 实践队长\n参与政务窗口材料整理与群众接待，完成调研报告2份'],
  ['项目', '项目经历\n2023.03-2023.09 基于微服务的风控系统 技术负责人\n负责服务拆分与链路追踪，QPS 提升 40%'],
];

for (const [name, text] of CASES) {
  const d = P.parseText(text, {}).data;
  const key = { '证书': 'certificate', '获奖': 'awards', '专利': 'patent', '论文': 'paper',
    '语言': 'language', '家庭': 'family', '社会实践': 'practice', '项目': 'project' }[name];
  const arr = d[key] || [];
  console.log('\n【' + name + '→' + key + '】条数 ' + arr.length);
  for (const r of arr) {
    const filled = Object.entries(r).filter(([, v]) => v).map(([k, v]) => k + '=' + String(v).slice(0, 22));
    console.log('  ' + (filled.join(' | ') || '(空记录)'));
  }
}
