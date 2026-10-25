// 招聘表单自动识别
(function (root) {
  'use strict';

  const FR = root.FieldRules;

  function detect(doc, hostname) {
    doc = doc || document;
    hostname = hostname || location.hostname;
    const result = { isForm: false, score: 0, reasons: [] };

    // 1) ATS 域名白名单
    const onAts = FR.ATS_DOMAINS.some(d => hostname.includes(d));
    if (onAts) { result.score += 40; result.reasons.push('招聘系统域名'); }

    // 排除明显非表单页
    if (/^(accounts?|passport|login|mail|pan|www\.baidu|www\.google)/i.test(hostname)) {
      // 登录页也可能在 ATS 域下，仅降分不否决
      result.score -= 20;
    }

    // 2) 可见表单控件数量
    const FM = root.FieldMatcher;
    const fields = FM ? FM.collectFields(doc) : [];
    const n = fields.length;
    if (n >= 3) result.score += Math.min(n * 3, 30);
    if (n >= 3) result.reasons.push(`检测到 ${n} 个表单字段`);

    // 3) 字段信号关键词命中
    let kwHits = 0;
    const strong = ['政治面貌', '籍贯', '生源地', '毕业院校', '家庭成员', '应聘', '网申', '简历', '申请职位', '期望岗位', '最高学历'];
    for (const f of fields) {
      const text = (f.signals || []).join(' ');
      if (FR.DETECT_KEYWORDS.some(k => text.includes(k))) kwHits++;
      if (strong.some(k => text.includes(k))) { kwHits += 2; }
    }
    if (kwHits >= 3) {
      result.score += Math.min(kwHits * 3, 30);
      result.reasons.push(`${kwHits} 个招聘特征字段`);
    }

    // 4) 页面标题/正文关键词
    const title = (doc.title || '') + ' ' + (doc.querySelector('h1, h2') ? doc.querySelector('h1, h2').textContent : '');
    if (/招聘|应聘|网申|简历|职位申请|校园招聘|社会招聘|报名|apply|career|recruit|job/i.test(title)) {
      result.score += 15;
      result.reasons.push('页面标题含招聘关键词');
    }

    result.isForm = result.score >= 45 && n >= 3;
    result.fieldCount = n;
    return result;
  }

  root.FormDetector = { detect };
})(typeof window !== 'undefined' ? window : self);
