// 生成测试用样例简历：txt 与 docx（zip store 方式手工打包）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEXT = `张三
个人信息
姓名：张三    性别：男    出生年月：2000年5月
姓名拼音：Zhang San    身高：175    体重：68
电话：13900139000  邮箱：zhangsan.dev@example.com
籍贯：江苏南京  政治面貌：中共党员  民族：汉族
户口性质：城镇    血型：O    英语等级：CET-6
求职意向
期望岗位：软件开发工程师  期望城市：上海  期望薪资：15-20K
期望行业：互联网/IT    是否接受调剂：是
教育背景
2018.09-2022.06 南京大学 计算机科学与技术 本科
主修课程：数据结构、操作系统、计算机网络、数据库原理
2022.09-2025.06 上海交通大学 计算机科学与技术 硕士
工作经历
2024.06-2024.12 中国移动通信集团有限公司 软件开发工程师
1. 参与CRM系统核心模块开发，完成12个接口的设计与实现；
2. 优化慢查询SQL，接口响应速度提升40%。
实习经历
2023.06-2023.09 字节跳动技术有限公司 后端开发实习生
参与内容推荐后台的接口联调与压测，独立完成两个服务的日志改造。
项目经历
2023.03-2023.12 智慧校园管理平台 项目负责人
带领5人团队完成平台开发，采用微服务架构，服务师生1万余人。
社会实践
2022.07-2022.08 南京市人社局实习实践队 实践队长
参与政务窗口材料整理与群众接待，完成调研报告2份。
证书
2023.06 大学英语六级 550分
获奖经历
2023.12 国家奖学金
2022.06 校级优秀学生干部
论文发表
2024.03 面向高并发的推荐系统缓存优化研究
专利信息
2024.05 一种推荐系统日志采集装置 CN202420123456.7
外语能力
英语 CET-6 550分
家庭成员
父亲 张建国 南京市机械厂 车间主任
母亲 李秀英 南京市小学 教师
技能特长
熟练掌握Java/Python，熟悉Spring Boot、MySQL；英语CET-6。
自我评价
专业基础扎实，工程实践能力强，具有良好的团队协作精神与责任心。`;

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);   // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    central.push({ nameBuf, crc, size: data.length, offset });
    offset += local.length + nameBuf.length + data.length;
  }
  const cdChunks = [];
  let cdSize = 0;
  for (const c of central) {
    const rec = Buffer.alloc(46);
    rec.writeUInt32LE(0x02014b50, 0);
    rec.writeUInt16LE(20, 4);
    rec.writeUInt16LE(20, 6);
    rec.writeUInt16LE(0, 8);
    rec.writeUInt16LE(0, 10);
    rec.writeUInt16LE(0, 12);
    rec.writeUInt16LE(0, 14);
    rec.writeUInt32LE(c.crc, 16);
    rec.writeUInt32LE(c.size, 20);
    rec.writeUInt32LE(c.size, 24);
    rec.writeUInt16LE(c.nameBuf.length, 28);
    rec.writeUInt32LE(c.offset, 42);
    cdChunks.push(rec, c.nameBuf);
    cdSize += rec.length + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...cdChunks, eocd]);
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paras = TEXT.split('\n').map(line =>
  `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`).join('');
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr/></w:body></w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const dir = path.join(__dirname, '..', 'test');
fs.writeFileSync(path.join(dir, 'sample-resume.txt'), TEXT, 'utf8');
fs.writeFileSync(path.join(dir, 'sample-resume.docx'), zipStore({
  '[Content_Types].xml': contentTypes,
  '_rels/.rels': rels,
  'word/document.xml': documentXml
}));
console.log('sample-resume.txt / sample-resume.docx written');
