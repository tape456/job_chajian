// 简历文件解析：PDF / DOCX / TXT → 文本 → 结构化简历数据
// DOCX 表格感知（标签/值配对），身份证号推断性别/生日/年龄，多策略姓名兜底
(function (root) {
  'use strict';

  // ---------- DOCX：手动解 zip（DecompressionStream deflate-raw） ----------
  async function readZipEntries(buffer, wanted) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // 找 EOCD
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip/docx 文件');
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const out = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOff = view.getUint32(ptr + 42, true);
      const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      if (wanted.includes(name)) {
        // local header
        const ln = view.getUint16(localOff + 26, true);
        const le = view.getUint16(localOff + 28, true);
        const dataStart = localOff + 30 + ln + le;
        const raw = bytes.subarray(dataStart, dataStart + compSize);
        if (method === 0) {
          out[name] = dec.decode(raw);
        } else if (method === 8) {
          const ds = new DecompressionStream('deflate-raw');
          const stream = new Blob([raw]).stream().pipeThrough(ds);
          out[name] = dec.decode(await new Response(stream).arrayBuffer());
        }
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  // ---------- DOCX XML：表格感知遍历 ----------
  function paraText(p) {
    let s = '';
    for (const c of p.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'r') {
        for (const rc of c.childNodes) {
          if (rc.nodeType !== 1) continue;
          if (rc.localName === 't') s += rc.textContent;
          else if (rc.localName === 'tab') s += '\t';
          else if (rc.localName === 'br') s += '\n';
        }
      }
    }
    return s;
  }

  // 直接子节点中的元素（localName 命中即取）
  function childElements(parent, name) {
    const out = [];
    for (const c of parent.childNodes) {
      if (c.nodeType === 1 && c.localName === name) out.push(c);
    }
    return out;
  }

  function cellText(tc) {
    const parts = childElements(tc, 'p').map(paraText).map(t => t.trim()).filter(Boolean);
    return parts.join(' ');
  }

  // 记录型表头（家庭成员/教育列表等）
  const RECORD_HEADER_TOKENS = new Set([
    '姓名', '关系', '称谓', '与本人关系', '工作单位', '单位', '职务', '职位',
    '部门', '联系电话', '电话', '学历', '政治面貌', '年龄', '工作单位及职务',
    '学校', '专业', '入学时间', '毕业时间'
  ]);

  function looksRecordHeader(cells) {
    if (cells.length < 3) return false;
    let hits = 0;
    for (const c of cells) if (RECORD_HEADER_TOKENS.has(c.trim())) hits++;
    return hits >= 2;
  }

  // 单元格 → 标签/值配对
  function pairCells(cells, isLabel) {
    const vals = cells.map(c => c.trim()).filter(Boolean);
    const strip = t => t.replace(/[:：\s]+$/, '').trim();
    const pairs = [];
    // 2 列：首格标签即可（第二格可能是“汉族”这类短词）
    if (vals.length === 2) {
      return isLabel(vals[0]) ? [[strip(vals[0]), vals[1]]] : [];
    }
    // 偶数列：严格相邻配对
    if (vals.length >= 4 && vals.length % 2 === 0) {
      let ok = true;
      for (let i = 0; i < vals.length; i += 2) {
        if (isLabel(vals[i]) && !isLabel(vals[i + 1])) pairs.push([strip(vals[i]), vals[i + 1]]);
        else { ok = false; break; }
      }
      if (ok) return pairs;
    }
    // 兜底：任意相邻标签/值
    let i = 0;
    while (i < vals.length - 1) {
      if (isLabel(vals[i]) && !isLabel(vals[i + 1])) {
        pairs.push([strip(vals[i]), vals[i + 1]]); i += 2;
      } else i++;
    }
    return pairs;
  }

  function tableLines(tbl, isLabel) {
    const out = [];
    const rows = childElements(tbl, 'tr');
    let recordMode = false;
    for (const tr of rows) {
      const cells = childElements(tr, 'tc').map(cellText);
      const nonempty = cells.filter(Boolean);
      if (!nonempty.length) continue;
      if (!recordMode && looksRecordHeader(nonempty)) { recordMode = true; continue; }
      if (recordMode) { out.push(nonempty.join(' | ')); continue; }
      const pairs = pairCells(cells, isLabel);
      if (pairs.length) {
        for (const [label, value] of pairs) out.push(label + '：' + value);
      } else {
        out.push(...nonempty);
      }
    }
    // 嵌套表（getElementsByTagName 会递归，去掉自身）
    const nested = tbl.getElementsByTagName('tbl');
    for (const n of nested) if (n !== tbl) out.push(...tableLines(n, isLabel));
    return out;
  }

  // w:body 顺序遍历：段落/表格
  // Node 环境（单元测试）没有 DOMParser：用轻量正则解析器兜底。浏览器里仍走真 DOMParser。
  // 节点形状只需覆盖用到的面：nodeType / localName / childNodes / textContent / getElementsByTagName。
  function parseXmlLite(xml) {
    const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');
    const clean = String(xml).replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '');
    const root = { nodeType: 1, localName: '', childNodes: [], textContent: '' };
    const byName = (node, qname) => {
      const local = qname.split(':').pop();
      const out = [];
      const walk = n => { for (const c of n.childNodes) { if (c.localName === local) out.push(c); walk(c); } };
      walk(node);
      return out;
    };
    root.getElementsByTagName = function (name) { return byName(this, name); };
    const stack = [root];
    const re = /<(\/)?([\w:.-]+)([^>]*?)(\/)?>|([^<]+)/g;
    let m;
    while ((m = re.exec(clean))) {
      if (m[5] != null) { stack[stack.length - 1].textContent += decode(m[5]); continue; }
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      const node = {
        nodeType: 1,
        localName: m[2].includes(':') ? m[2].split(':').pop() : m[2],
        childNodes: [], textContent: ''
      };
      node.getElementsByTagName = function (name) { return byName(this, name); };
      stack[stack.length - 1].childNodes.push(node);
      if (!m[4]) stack.push(node);
    }
    return root;
  }

  function docxXmlToLines(xml, isLabel) {
    const dom = typeof DOMParser !== 'undefined'
      ? new DOMParser().parseFromString(xml, 'application/xml')
      : parseXmlLite(xml);
    const body = dom.getElementsByTagName('w:body')[0];
    if (!body) return [];
    const out = [];
    for (const c of body.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'p') {
        const t = paraText(c);
        if (t.trim()) out.push(t);
      } else if (c.localName === 'tbl') {
        out.push(...tableLines(c, isLabel));
      }
    }
    return out;
  }

  async function extractDocx(buffer, isLabel) {
    const entries = await readZipEntries(buffer, ['word/document.xml', 'docProps/core.xml']);
    const doc = entries['word/document.xml'];
    if (!doc) throw new Error('docx 中未找到正文内容');
    const lines = docxXmlToLines(doc, isLabel);
    const core = entries['docProps/core.xml'] || '';
    const author = (core.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/) || [, ''])[1] || '';
    return { text: lines.join('\n'), author: author.trim() };
  }

  // ---------- PDF：pdf.js ----------
  async function extractPdf(buffer) {
    if (!root.pdfjsLib) throw new Error('PDF 解析库未加载');
    root.pdfjsLib.GlobalWorkerOptions.workerSrc =
      chrome.runtime.getURL('lib/vendor/pdf.worker.min.js');
    const doc = await root.pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      for (const item of content.items) {
        line += item.str;
        if (item.hasEOL) { lines.push(line); line = ''; }
      }
      if (line) lines.push(line);
      lines.push('');
    }
    return lines.join('\n');
  }

  // ---------- 身份证：性别/生日/年龄 ----------
  function parseIdCard(id) {
    const out = { gender: '', birthDate: '', age: '' };
    if (!/^\d{17}[\dXx]$/.test(id)) return out;
    const y = Number(id.slice(6, 10)), m = id.slice(10, 12), d = id.slice(12, 14);
    if (y >= 1900 && y <= 2100) {
      out.birthDate = `${y}-${m}-${d}`;
      out.gender = Number(id[16]) % 2 ? '男' : '女';
      const now = new Date();
      let age = now.getFullYear() - y;
      const bd = new Date(y, Number(m) - 1, Number(d));
      if (now < bd) age--;
      if (age > 0 && age < 100) out.age = String(age);
    }
    return out;
  }

  // ---------- 文本 → 结构化 ----------
  const KV_MAP = [
    [/^(?:姓\s*名)[:：\s]*(\S{1,6})/, 'basic.name'],
    [/^(?:姓名拼音|拼音)[:：\s]*(.{2,30}?)(?=[\s]{2,}|$)/, 'basic.namePinyin'],
    [/^(?:英文姓名|英文名)[:：\s]*(.{2,30}?)(?=[\s]{2,}|$)/, 'basic.nameEn'],
    [/^(?:性\s*别)[:：\s]*(\S{1,4})/, 'basic.gender'],
    [/^(?:出生年月?|出生日期)[:：\s]*([\d年月./\-]{6,12})/, 'basic.birthDate'],
    [/^(?:年\s*龄)[:：\s]*(\d{2,3})/, 'basic.age'],
    [/^(?:国\s*籍)[:：\s]*(\S{1,10})/, 'basic.nationality'],
    [/^(?:民\s*族)[:：\s]*(\S{1,6})/, 'basic.ethnicity'],
    [/^(?:籍\s*贯)[:：\s]*(\S{1,12})/, 'basic.nativePlace'],
    [/^(?:生源(?:地)?|毕业生源地)[:：\s]*(\S{1,12})/, 'basic.birthPlace'],
    [/^(?:政治面貌|党派)[:：\s]*(\S{1,10})/, 'basic.politicalStatus'],
    [/^(?:婚姻状况|婚否)[:：\s]*(\S{1,6})/, 'basic.maritalStatus'],
    [/^(?:证件类型)[:：\s]*(\S{1,8})/, 'basic.idType'],
    [/^(?:身\s*高)[:：\s]*(\d{2,3})/, 'basic.height'],
    [/^(?:体\s*重)[:：\s]*(\d{2,3})/, 'basic.weight'],
    [/^(?:血\s*型)[:：\s]*(\S{1,4})/, 'basic.bloodType'],
    [/^(?:电子邮箱|邮\s*箱|E-?mail)[:：\s]*([\w.+-]+@[\w-]+\.[\w.]+)/i, 'basic.email'],
    [/^(?:手机号码?|联系电话|电\s*话)[:：\s]*(1[3-9]\d{9})/, 'basic.phone'],
    [/^(?:微信号|微\s*信)[:：\s]*(\S{1,30})/, 'basic.wechat'],
    [/^(?:QQ\s*号?|Q\s*Q)[:：\s]*(\d{5,12})/, 'basic.qq'],
    [/^(?:邮政编码|邮\s*编)[:：\s]*(\d{6})/, 'basic.postalCode'],
    [/^(?:现居|居住地址|现住|通讯地址|联系地址)[:：\s]*(.{2,40})/, 'basic.currentAddress'],
    [/^(?:户口所在地|户\s*籍)[:：\s]*(.{2,20})/, 'basic.hukou'],
    [/^(?:户口性质)[:：\s]*(\S{1,8})/, 'basic.hukouType'],
    [/^(?:档案所在地|档案存放地)[:：\s]*(.{2,30})/, 'basic.archiveLocation'],
    [/^(?:最高学历)[:：\s]*(\S{1,10})/, 'basic.highestDegree'],
    [/^(?:最高学位|学\s*位)[:：\s]*(\S{1,10})/, 'basic.highestDiploma'],
    [/^(?:学习形式|培养方式)[:：\s]*(\S{1,10})/, 'basic.studyMode'],
    [/^(?:是否应届生|应届生身份)[:：\s]*(\S{1,4})/, 'basic.isFresher'],
    [/^(?:工作状态|求职状态)[:：\s]*(\S{1,12})/, 'basic.workStatus'],
    [/^(?:工作年限)[:：\s]*(\d{1,2})/, 'basic.workYears'],
    [/^(?:健康状况)[:：\s]*(\S{1,8})/, 'basic.health'],
    [/^(?:入团时间|入党(?:时间|日期)|入团\/入党时间)[:：\s]*([\d年月./\-]{6,12})/, 'basic.leagueJoinDate'],
    [/^(?:英语(?:等级|水平))[:：\s]*(\S{1,16})/, 'basic.englishLevel'],
    [/^(?:兴趣爱好|爱\s*好)[:：\s]*(.{2,40})/, 'basic.hobbies'],
    [/^(?:个人优势|优\s*势)[:：\s]*(.{2,80})/, 'basic.advantages'],
    [/^(?:职业规划)[:：\s]*(.{2,80})/, 'basic.careerPlan'],
    [/^(?:个人主页|主页|作品链接)[:：\s]*(\S{4,100})/, 'basic.homepage'],
    [/^(?:期望(?:薪资|月薪)|薪资要求)[:：\s]*(.{2,20})/, 'intention.expectedSalary'],
    [/^(?:期望年薪)[:：\s]*(.{2,20})/, 'intention.expectedAnnualSalary'],
    [/^(?:到岗时间|预计入职时间|入职时间)[:：\s]*(.{2,20})/, 'intention.availableTime'],
    [/^(?:期望岗位|目标岗位|求职意向|意向岗位)[:：\s]*(.{2,30})/, 'intention.expectedJob'],
    [/^(?:期望行业|意向行业)[:：\s]*(.{2,20})/, 'intention.expectedIndustry'],
    [/^(?:期望城市|期望工作地点|工作地点)[:：\s]*(.{2,30})/, 'intention.expectedCity'],
    [/^(?:是否接受调剂|服从调剂)[:：\s]*(\S{1,4})/, 'intention.acceptAdjust']
  ].map(([re, path]) => [re, new RegExp(re.source.replace(/^\^/, ''), re.flags), path]);

  // 从 KV_MAP 正则提取已知标签词（表格配对用）
  const KNOWN_LABELS = new Set();
  KV_MAP.forEach(([re]) => {
    const m = re.source.match(/\^\(\?:([^)]+)\)/);
    if (!m) return;
    m[1].split('|').forEach(tok => {
      tok = tok.replace(/\\s\*/g, '').replace(/\\\?/g, '');
      if (/^[\u4e00-\u9fa5A-Za-z]{1,10}$/.test(tok)) KNOWN_LABELS.add(tok);
    });
  });

  function isLabelText(text) {
    const t = String(text || '').replace(/[:：\s]+$/, '').trim();
    if (KNOWN_LABELS.has(t)) return true;
    return /^[\u4e00-\u9fa5A-Za-z0-9/（）()]{1,8}$/.test(t);
  }

  const SECTION_RE = {
    basic: /^(个人信息|基本信息|基本资料|联系方式|联系信息)$/,
    intention: /^(求职意向|应聘意向|意向)$/,
    education: /^(教育背景|教育经历|学历背景|学习经历)$/,
    work: /^(工作经历|工作经验|职业经历|就业经历)$/,
    internship: /^(实习经历|实习经验|实践经历|社会实践经历)$/,
    project: /^(项目经历|项目经验|科研经历|研究经历)$/,
    campus: /^(校园经历|校园活动|社团经历|学生工作|课外活动)$/,
    practice: /^(社会实践|实践活动|社会活动)$/,
    certificate: /^(资格证书|证书|职业证书|资质证书)$/,
    awards: /^(荣誉奖项|获奖情况|奖励情况|获奖经历(?:（奖学金）)?|荣誉)$/,
    patent: /^(专利信息|专利)$/,
    paper: /^(论文发表|论文|研究成果|发表文章)$/,
    language: /^(外语能力|语言能力|语言)$/,
    family: /^(家庭成员|家庭情况|家庭主要成员|直系亲属)$/,
    skill: /^(技能特长|专业技能|个人技能|技能|特长)$/,
    selfEvaluation: /^(自我评价|个人评价|自我描述|个人总结|自我介绍)$/
  };

  const TIME_RANGE = /(\d{4})[./年\-](\d{1,2})?\s*[-–—~至]+\s*(\d{4})[./年\-]?(\d{1,2})?/;

  function normMonth(y, m) {
    if (!y) return '';
    return y + '-' + String(m || 1).padStart(2, '0');
  }

  function parseText(text, meta) {
    meta = meta || {};
    const data = root.ResumeSchema.emptyData();
    const warnings = [];
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => l && l.length < 300);

    // 1) 全文联系方式兜底
    const full = lines.join('\n');
    const phoneM = full.match(/1[3-9]\d{9}/);
    const mailM = full.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    const idM = full.match(/\b\d{17}[\dXx]\b/);
    if (phoneM) data.basic.phone = phoneM[0];
    if (mailM) data.basic.email = mailM[0];
    if (idM) {
      data.basic.idNumber = idM[0].toUpperCase();
      const info = parseIdCard(idM[0]);
      if (!data.basic.gender && info.gender) data.basic.gender = info.gender;
      if (!data.basic.birthDate && info.birthDate) data.basic.birthDate = info.birthDate;
      if (!data.basic.age && info.age) data.basic.age = info.age;
    }

    // 2) 分段
    let section = 'basic';
    let selfIntroMode = false; // 自评板块原始标题是否为「自我介绍」（决定内容进 selfIntro 还是 content）
    const sections = {
      basic: [], intention: [], education: [], work: [], internship: [], project: [], campus: [],
      practice: [], certificate: [], awards: [], patent: [], paper: [], language: [],
      family: [], skill: [], selfEvaluation: []
    };
    for (const line of lines) {
      let matched = false;
      for (const [key, re] of Object.entries(SECTION_RE)) {
        if (line.length <= 14 && re.test(line)) {
          section = key; matched = true;
          if (key === 'selfEvaluation') selfIntroMode = /自我介绍|个人简介/.test(line);
          break;
        }
      }
      if (matched) continue;
      // 键值对（一行可含多个键值，以 2+ 空格/制表符分隔；仅填充尚未识别的字段）
      const segments = /[\t ]{2,}|\t/.test(line)
        ? line.split(/[\t ]{2,}|\t+/).map(s => s.trim()).filter(Boolean)
        : [line];
      let kvHit = false;
      for (const seg of segments) {
        for (const [reStart, reAny, path] of KV_MAP) {
          const [sec, field] = path.split('.');
          if (data[sec][field]) continue;
          const m = seg.match(reStart) || seg.match(reAny);
          if (m && m[1]) { data[sec][field] = m[1].trim(); kvHit = true; }
        }
      }
      if (kvHit && section === 'basic') continue;
      (sections[section] = sections[section] || []).push(line);
    }

    // 3) 教育经历
    let edu = null;
    for (const line of sections.education) {
      const tm = line.match(TIME_RANGE);
      const isSchool = /大学|学院|学校|研究院/.test(line);
      if (tm || (isSchool && !edu)) {
        if (tm && (!edu || edu.school)) {
          edu = { start: normMonth(tm[1], tm[2]), end: normMonth(tm[3], tm[4]), school: '', degree: '', diploma: '', major: '', gpa: '', courses: '', isExchange: '', exchangeSchool: '' };
          data.education.push(edu);
        }
        if (!edu) { edu = {}; for (const f of root.ResumeSchema.SCHEMA.sections.find(x => x.key === 'education').fields) edu[f.key] = ''; data.education.push(edu); }
        const sm = line.match(/([\u4e00-\u9fa5A-Za-z]+(?:大学|学院|学校|研究院))/);
        if (sm && !edu.school) edu.school = sm[1];
        const dm = line.match(/(博士|硕士|本科|大专|专科|学士)/);
        if (dm) { edu.degree = dm[1] === '学士' ? '本科' : dm[1]; if (!edu.diploma) edu.diploma = dm[1] === '本科' ? '学士' : dm[1]; }
        const mj = line.match(/专业[:：]\s*(\S+)/)
          || line.match(/(?:所学|主修)专业\s*(\S+)/)
          || line.match(/(大学|学院|学校|研究院)\s*([\u4e00-\u9fa5A-Za-z]{2,20}?)(?:专业)?\s*(?:本科|硕士|博士|大专|专科|学士)?\s*$/)
          || line.match(/([\u4e00-\u9fa5A-Za-z]{2,20}?)(?:本科|硕士|博士|大专|专科)\s*$/);
        const mjVal = mj ? (mj[2] || mj[1]) : '';
        if (mjVal && !edu.major && !/大学|学院|学校|研究院/.test(mjVal)) edu.major = mjVal;
      } else if (edu) {
        if (/主修|课程/.test(line) && !edu.courses) edu.courses = line.replace(/^(主修|主要)?课程[:：]?/, '');
        else if (/GPA|绩点|排名/i.test(line) && !edu.gpa) edu.gpa = line;
      }
    }

    // 4) 工作/实习/项目/校园/社会实践经历（同构解析）
    const POS_KEY = { project: 'role' };
    const parseExp = (linesArr, target, nameKey) => {
      let cur = null;
      const posKey = POS_KEY[target] || 'position';
      for (const line of linesArr) {
        const tm = line.match(TIME_RANGE);
        const looksTitle = /公司|集团|厂|银行|事务所|研究院|中心|项目|课题|会|部|大学|协会/.test(line) && line.length <= 60;
        if (tm || (looksTitle && !cur)) {
          if (cur && cur.description) cur = null;
          if (!cur) {
            cur = {};
            for (const f of root.ResumeSchema.SCHEMA.sections.find(s => s.key === target).fields) cur[f.key] = '';
            data[target].push(cur);
          }
          if (tm) { cur.start = normMonth(tm[1], tm[2]); cur.end = normMonth(tm[3], tm[4]); }
          let title = line.replace(TIME_RANGE, '').replace(/[-–—~至\s]*$/, '').trim();
          // 公司名与职务拆分：「XX集团有限公司 软件工程师」
          if (target === 'work' || target === 'internship') {
            const cm = title.match(/^(.*?(?:有限公司|股份公司|公司|集团|厂|银行|事务所|研究院|研究所|中心|院)(?=[\s]|$))\s+(.{2,20})$/);
            if (cm) { title = cm[1]; if (!cur.position) cur.position = cm[2]; }
          } else if (target === 'practice' || target === 'campus') {
            const cm = title.match(/^(\S{2,40})\s+(.{2,12})$/);
            if (cm && /队长|负责人|成员|志愿者|实习生|干事|部长|主席|实践|实习|服务/.test(cm[2])) {
              title = cm[1]; if (!cur.position) cur.position = cm[2];
            }
          }
          if (title && !cur[nameKey]) cur[nameKey] = title;
        } else if (cur) {
          // 键值行优先写入对应字段（尤其项目经历）
          const kvm = line.match(/^(.{2,12})[:：]\s*(.+)$/);
          let keyed = false;
          if (kvm) {
            const k = kvm[1].replace(/\s/g, '');
            const v = kvm[2].trim();
            const PROJECT_KV = {
              '项目职务': 'role', '担任角色': 'role', '项目角色': 'role',
              '团队规模': 'teamSize', '项目团队规模': 'teamSize',
              '实践方式': 'practiceMethod', '项目实践方式': 'practiceMethod',
              '项目链接': 'link', '项目在线链接': 'link', '项目网址': 'link',
              '项目地址': 'city', '项目所在地区': 'city',
              '是否海外经历': 'isOversea', '项目海外经历': 'isOversea',
              '证明人姓名': 'referrerName', '项目证明人姓名': 'referrerName', '项目证明人': 'referrerName',
              '证明人联系方式': 'referrerContact', '项目证明人联系方式': 'referrerContact',
              '证明人职位': 'referrerPosition', '项目证明人职位': 'referrerPosition',
              '项目职责': 'responsibility', '项目职责与贡献': 'responsibility',
              '项目成果': 'achievement', '项目交付结果与量化成果': 'achievement',
              '项目描述': 'description', '项目详细描述': 'description'
            };
            const CAMPUS_KV = {
              '组织名称': 'name', '任职组织': 'name',
              '级别': 'level', '组织级别': 'level',
              '职位': 'position', '担任职务': 'position',
              '工作内容': 'description', '主要工作内容': 'description',
              '本人职责': 'duty', '个人职责与成果': 'duty'
            };
            const map = target === 'project' ? PROJECT_KV : (target === 'campus' ? CAMPUS_KV : null);
            if (map && map[k] && v && !cur[map[k]]) {
              cur[map[k]] = v;
              keyed = true;
            }
          }
          if (!keyed) {
            if (!cur.description) cur.description = line;
            else cur.description += '\n' + line;
          }
          // 职务行
          if (!cur[posKey] && /职位|岗位|职务|担任|角色/.test(line) && line.length <= 30) {
            cur[posKey] = line.replace(/^(担任|职位|岗位|项目职务)[:：]?/, '');
          }
        }
      }
    };
    parseExp(sections.work, 'work', 'company');
    parseExp(sections.internship, 'internship', 'company');
    parseExp(sections.project, 'project', 'name');
    parseExp(sections.campus, 'campus', 'name');
    parseExp(sections.practice, 'practice', 'name');

    // 5.1) 获奖 / 专利 / 论文 / 外语 / 家庭：按「名称 + 时间 + 级别」的宽松行解析
    const simpleRow = line => {
      const tm = line.match(TIME_RANGE) || line.match(/(\d{4})[./年](\d{1,2})/);
      const date = tm ? normMonth(tm[1], tm[2]) : '';
      const clean = line.replace(TIME_RANGE, '').replace(/^\d{4}[./年]\d{1,2}\s*/, '').replace(/^[-–—~至\s]+/, '').trim();
      return { clean, date };
    };
    for (const line of sections.awards) {
      const { clean, date } = simpleRow(line);
      if (!clean) continue;
      const lv = (clean.match(/(国家级|省级|市级|校级|院级|特等奖|一等奖|二等奖|三等奖|优秀奖|奖学金|三好学生|优秀干部)/) || [])[1] || '';
      data.awards.push({
        name: clean.replace(/[（(].{0,8}[)）]/, ''), issuer: '', date, endDate: '',
        level: lv, rewardType: '', rewardLevel: '', description: ''
      });
    }
    for (const line of sections.patent) {
      const { clean, date } = simpleRow(line);
      if (!clean) continue;
      const no = (clean.match(/(?:CN|ZL)?\d{8,12}(?:\.\d)?X?/) || [])[0] || '';
      data.patent.push({ name: clean.replace(/(?:CN|ZL)?\d{8,12}(?:\.\d)?X?/, '').trim(), number: no, date, status: '', inventor: '', type: '', description: '' });
    }
    for (const line of sections.paper) {
      const { clean, date } = simpleRow(line);
      if (!clean) continue;
      data.paper.push({ title: clean, journal: '', authors: '', volume: '', impactFactor: '', level: '', authorship: '', date, doi: '', link: '', abstract: '' });
    }
    for (const line of sections.language) {
      const { clean, date } = simpleRow(line);
      if (!clean) continue;
      const cert = (clean.match(/(CET-?\s?[46]|TEM-?\s?[48]|四级|六级|专四|专八|IELTS|TOEFL|N1|N2)/i) || [])[0] || '';
      const score = (clean.match(/(\d{2,3})\s*分?/) || [])[1] || '';
      data.language.push({ name: clean.slice(0, 6), date, certName: cert, score, level: '', listening: '', reading: '' });
    }
    for (const line of sections.family) {
      const { clean } = simpleRow(line);
      if (!clean) continue;
      const REL = /(父亲|母亲|兄|弟|姐|妹|配偶|妻子|丈夫|儿子|女儿|父|母)/;
      const toks = clean.split(/\s+/).filter(Boolean);
      const row = {
        name: '', relation: '', gender: '', education: '', ethnicity: '', idNumber: '', birthDate: '', age: '',
        phone: '', company: '', position: '', politicalStatus: '', address: ''
      };
      if (toks.length && REL.test(toks[0])) {
        row.relation = (toks[0].match(REL) || [])[1] || '';
        toks.shift();
      }
      if (toks.length) row.name = toks.shift();
      if (toks.length && /厂|公司|局|学校|医院|集团|事务所|银行|队|所|行|部|中心/.test(toks[0])) row.company = toks.shift();
      if (toks.length) row.position = toks.shift();
      data.family.push(row);
    }

    // 5) 证书奖项
    for (const line of sections.certificate) {
      const tm = line.match(TIME_RANGE) || line.match(/(\d{4})[./年](\d{1,2})/);
      const clean = line.replace(TIME_RANGE, '').replace(/^\d{4}[./年]\d{1,2}\s*/, '').replace(/^[-–—~至\s]+/, '').trim();
      data.certificate.push({
        name: clean || line,
        date: tm ? normMonth(tm[1], tm[2]) : '',
        score: ''
      });
    }

    // 6) 技能 / 自评
    if (sections.skill.length) data.skill.computer = sections.skill.join('\n');
    if (sections.selfEvaluation.length) {
      const text = sections.selfEvaluation.join('\n');
      if (selfIntroMode) data.selfEvaluation.selfIntro = text;
      else data.selfEvaluation.content = text;
    }

    // 7) 称呼兜底：「张三 先生/女士」
    if (!data.basic.gender) {
      const gm = full.match(/([\u4e00-\u9fa5]{2,4})\s*(先生|女士)/);
      if (gm) data.basic.gender = gm[2] === '先生' ? '男' : '女';
    }

    // 7) 姓名兜底：docx 作者 → 文件名 → 首个标题前的短中文行
    if (!data.basic.name) {
      const candidates = [];
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(meta.author || '')) candidates.push(meta.author);
      const baseName = (meta.fileName || '').replace(/\.[^.]+$/, '');
      const nt = baseName.match(/^([\u4e00-\u9fa5]{2,4})(?:[-_·\s]*)?(?:个人简历|求职简历|简历|CV|cv|resume)/);
      if (nt) candidates.push(nt[1]);
      for (const l of lines) {
        if (Object.values(SECTION_RE).some(rx => l.length <= 14 && rx.test(l))) break;
        if (/^[\u4e00-\u9fa5]{2,4}$/.test(l)) { candidates.push(l); break; }
      }
      if (candidates.length) data.basic.name = candidates[0];
    }

    // 8) warnings
    const filled = Object.values(data.basic).filter(v => v).length
      + data.education.length + data.work.length + data.internship.length + data.project.length;
    if (!data.basic.name) warnings.push('未识别到姓名');
    if (!data.basic.phone && !data.basic.email) warnings.push('未识别到联系方式');
    if (!data.education.length) warnings.push('未识别到教育经历');
    if (filled < 3) warnings.push('解析内容过少，建议检查文件格式或手动填写');

    return { data, warnings };
  }

  async function parseFile(file) {
    const name = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();
    let text = '', author = '';
    if (name.endsWith('.docx')) {
      ({ text, author } = await extractDocx(buffer, isLabelText));
    } else if (name.endsWith('.pdf')) {
      text = await extractPdf(buffer);
    } else if (name.endsWith('.doc')) {
      throw new Error('暂不支持旧版 .doc 格式，请另存为 .docx 或 PDF 后上传');
    } else {
      text = new TextDecoder('utf-8').decode(buffer);
      if (text.slice(0, 5).includes('%PDF-')) text = await extractPdf(buffer);
    }
    const result = parseText(text, { author, fileName: file.name });
    result.textLength = text.length;
    return result;
  }

  async function extractText(file) {
    const name = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();
    if (name.endsWith('.docx')) return (await extractDocx(buffer, isLabelText)).text;
    if (name.endsWith('.pdf')) return extractPdf(buffer);
    if (name.endsWith('.doc')) {
      throw new Error('暂不支持旧版 .doc 格式，请另存为 .docx 或 PDF 后上传');
    }
    const text = new TextDecoder('utf-8').decode(buffer);
    if (text.slice(0, 5).includes('%PDF-')) return extractPdf(buffer);
    return text;
  }

  root.ResumeParser = { extractText, parseText, parseFile, parseIdCard };
})(typeof window !== 'undefined' ? window : self);
