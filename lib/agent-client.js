// 简历智能解析客户端：
// 1) 解析服务（FastAPI + LangGraph）→ 2) 直连插件设置的 AI 模型逐板块抽取 → 3) 纯规则
(function (root) {
  'use strict';

  // ---------------- 工具
  function withTimeout(promise, ms, what) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(
        () => rej(Object.assign(new Error(what + '超时（' + Math.round(ms / 1000) + ' 秒）'),
          { code: 'timeout' })), ms)),
    ]);
  }

  // ---------------- 链路一：解析服务
  async function parseByService(file, settings) {
    const form = new FormData();
    form.append('file', file);
    form.append('base_url', settings.aiBaseUrl || '');
    form.append('api_key', settings.aiApiKey || '');
    form.append('model', settings.aiModel || '');
    form.append('use_ocr', settings.useOcr ? 'true' : 'false');
    const url = settings.parserBaseUrl.replace(/\/+$/, '') + '/api/resume/parse';
    const resp = await withTimeout(
      fetch(url, { method: 'POST', body: form }),
      (settings.aiTimeoutMs || 20000) + 40000,
      '解析服务响应',
    );
    let json = null;
    try { json = await resp.json(); } catch (e) {
      throw new Error('解析服务返回无法解析（HTTP ' + resp.status + '）');
    }
    if (!resp.ok) throw new Error(json.detail || ('解析服务错误 HTTP ' + resp.status));
    return {
      data: json.data,
      warnings: json.warnings || [],
      confidence: json.confidence || {},
      observations: json.observations || [],
    };
  }

  // ---------------- 链路二：直连 LLM 逐板块抽取
  const EXTRACT_SYSTEM = [
    '你是资深中文简历信息抽取专家。从简历文本中抽取指定板块的结构化字段。',
    '规则：1) 只依据文本中明确出现的信息，无依据字段输出空字符串，禁止编造；',
    '2) 日期统一为 YYYY-MM-DD，只知月份用该月1日；',
    '3) 多条经历按出现顺序逐条输出，不要合并；4) 严格只输出 JSON。',
  ].join('\n');

  // 按板块标题切文本（精确匹配 schema 标题）
  function splitSectionText(text) {
    const titles = root.ResumeSchema.SCHEMA.sections.map(s => s.title);
    const map = {};
    let cur = 'basic';
    map[cur] = [];
    for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
      if (!line) continue;
      const idx = titles.indexOf(line);
      if (idx >= 0) {
        cur = root.ResumeSchema.SCHEMA.sections[idx].key;
        map[cur] = map[cur] || ['## ' + line];
      } else {
        (map[cur] = map[cur] || []).push(line);
      }
    }
    for (const k of Object.keys(map)) map[k] = map[k].join('\n');
    return map;
  }

  // 板块 JSON Schema（驱动 LLM 输出）
  function sectionSchema(section) {
    const props = {};
    for (const f of section.fields) {
      props[f.key] = { type: 'string', description: f.label, default: '' };
    }
    if (section.kind === 'object') {
      return { type: 'object', properties: props, required: section.fields.map(f => f.key) };
    }
    return {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: props, required: section.fields.map(f => f.key) },
        },
      },
      required: ['items'],
    };
  }

  function extractJson(text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('模型输出未找到 JSON');
    return JSON.parse(m[0]);
  }

  async function llmExtractSection(section, evidence) {
    const schema = JSON.stringify(sectionSchema(section));
    const user = [
      '请抽取简历中的「' + section.title + '」板块。',
      '简历文本（## 为板块标题）：',
      '--------------------',
      evidence,
      '--------------------',
      '数组板块输出 {"items": [{...}]}，对象板块直接输出 {...}；没有内容时 items 为 []。',
      '严格按以下 JSON Schema 输出，只输出 JSON：' + schema,
    ].join('\n');
    const resp = await chrome.runtime.sendMessage({
      type: 'ai:chat',
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: user },
      ],
    });
    if (!resp || !resp.ok) throw new Error(resp && resp.error || 'AI 请求失败');
    return extractJson(resp.content);
  }

  async function llmExtractAll(text, settings, onEvent) {
    const sectionMap = splitSectionText(text);
    const out = {};
    for (const section of root.ResumeSchema.SCHEMA.sections) {
      const evidence = sectionMap[section.key];
      if (!evidence || !evidence.trim()) continue;
      onEvent && onEvent('llm', 'AI 抽取「' + section.title + '」…');
      try {
        const r = await llmExtractSection(section, evidence);
        out[section.key] = section.kind === 'array' ? (r.items || []) : r;
      } catch (e) {
        // 单板块失败不影响其它板块
        console.warn('[速填] 板块抽取失败', section.key, e.message);
      }
    }
    return out;
  }

  // ---------------- 合并：只补空（数组按签名追加）
  function signature(item) {
    return [
      item.start || item.date || '',
      item.end || item.endDate || '',
      item.company || item.name || item.school || item.title || '',
    ];
  }

  function mergeBlank(data, llmData) {
    for (const section of root.ResumeSchema.SCHEMA.sections) {
      const part = llmData[section.key];
      if (part == null) continue;
      if (section.kind === 'object') {
        for (const f of section.fields) {
          if (!String(data[section.key][f.key] || '').trim() && String(part[f.key] || '').trim()) {
            data[section.key][f.key] = String(part[f.key]).trim();
          }
        }
      } else if (Array.isArray(part)) {
        const existing = data[section.key];
        for (const item of part) {
          const sig = signature(item);
          const hit = existing.some(e => {
            const es = signature(e);
            return (sig[2] && es[2] && (sig[2].includes(es[2]) || es[2].includes(sig[2])))
              || (sig[0] && sig[0] === es[0]);
          });
          if (!hit) existing.push(item);
          // 命中的同组记录：字段互补
          else {
            const target = existing.find(e => {
              const es = signature(e);
              return (sig[2] && es[2] && (sig[2].includes(es[2]) || es[2].includes(sig[2])))
                || (sig[0] && sig[0] === es[0]);
            });
            for (const f of section.fields) {
              if (!String(target[f.key] || '').trim() && String(item[f.key] || '').trim()) {
                target[f.key] = String(item[f.key]).trim();
              }
            }
          }
        }
      }
    }
  }

  // ---------------- 主编排
  async function parseResumeWithAgent(file, settings, onEvent, opts) {
    const o = opts || {};
    const emit = (phase, msg) => onEvent && onEvent(phase, msg);
    emit('read', '读取本地简历…');

    // 链路一：解析服务
    if (settings.parserBaseUrl) {
      try {
        emit('understand', '解析服务理解文档…');
        return await parseByService(file, settings);
      } catch (e) {
        emit('fallback', '解析服务不可用，改用本地 AI：' + e.message);
      }
    }

    // 本地规则基线（不依赖网络）
    emit('rule', '规则引擎抽取基线…');
    const rule = await root.ResumeParser.parseFile(file, { onLine: o.onLine });
    let warnings = rule.warnings;

    // 链路二：直连 LLM
    if (settings.aiEnabled && settings.aiApiKey) {
      try {
        const text = await root.ResumeParser.extractText(file);
        const llmData = await llmExtractAll(text, settings, onEvent);
        mergeBlank(rule.data, llmData);
      } catch (e) {
        warnings = warnings.concat('AI 抽取失败：' + e.message);
      }
    }

    return {
      data: root.ResumeSchema.normalizeData(rule.data),
      warnings,
      confidence: {},
      observations: [],
    };
  }

  root.AgentClient = { parseResumeWithAgent, parseByService };
})(typeof window !== 'undefined' ? window : self);
