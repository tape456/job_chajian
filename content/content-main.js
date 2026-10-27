// 内容脚本入口：编排识别、匹配、AI 增强、填写与悬浮球
(function () {
  'use strict';

  // 防重复注入：手动 chrome.scripting 补注入时，同一帧只跑一份，避免出现两个悬浮球
  if (window.__qfContentLoaded) return;
  window.__qfContentLoaded = true;

  const isTop = window.self === window.top;
  const S = ResumeStore;

  const SECTION_ICONS = {
    basic: '👤', intention: '🎯', education: '🎓', work: '💼', internship: '🎩', project: '📁',
    campus: '🏫', practice: '🧭', certificate: '📜', awards: '🏆', patent: '💡', paper: '📄',
    language: '🌐', skill: '🛠', selfEvaluation: '✍️', family: '👪'
  };

  let settings = null;
  let resume = null;
  let resumeBound = false;   // 当前简历是否来自站点绑定
  let entries = [];
  let learned = {};
  let fields = [];
  let matchResult = null;
  let mounted = false;
  let frameExtra = {};   // 顶层 frame 汇总子 frame 统计: frameId -> stats
  let fillDone = false;
  let mode = 'idle';        // idle | select | helper | agent
  let helperEntry = null;
  let selectionClean = null;
  let myFrameId = null;     // 由 background 回执（sender.frameId）
  let ballHiddenByUser = false;
  let aiWarned = false;      // AI 失败提示一次就够，别每轮都弹
  let fillSummary = { count: 0, failed: 0, requiredMissing: 0 };
  // 取消结算用的两个数：一键填写是跨轮异步过程，onStop 拿不到 doFill 的局部变量，只能挂在模块上
  let fillStat = { filled: 0, remaining: 0 };
  // 其它 iframe 区域上报过来的进度（frameId → { ok, done }），lead 帧据此汇总
  let otherFrames = new Map();
  let lastStepSent = 0;

  function otherFilledText() {
    let ok = 0, n = 0;
    for (const v of otherFrames.values()) { ok += v.ok || 0; n++; }
    return ok > 0 ? '其它 ' + n + ' 个区域已填 ' + ok + ' 项' : '';
  }
  // 非 lead 帧只报「完成一项」，且最快 350ms 一次（最后一项必报），避免逐字段消息风暴
  function reportFillStep(leadId, info, okSoFar, done, total) {
    if (leadId == null || myFrameId === null) return;
    const now = Date.now();
    if (done < total && now - lastStepSent < 350) return;
    lastStepSent = now;
    try {
      chrome.runtime.sendMessage({
        type: 'frame:fillStep', leadId, done, ok: okSoFar,
        label: (info && info.label) || ''
      }).catch(() => {});
    } catch (e) {}
  }

  // 进度窗的「第几项」：跨帧只填本帧的控件，所以写「本区域」而不是笼统的「共 N 项」
  function stepText(handled, total) {
    return '本区域 第 ' + handled + '/' + total + ' 项';
  }
  function fieldLine(info) {
    const name = info.label || '未命名字段';
    if (info.state === 'end') {
      if (info.ok === true) return '已填 ' + name + ' → ' + (info.value || '（空）');
      return name + ' 没填上：' + (FieldFiller.reasonText(info.reason) || '需人工处理');
    }
    return '正在填 ' + name + ' → ' + (info.value || '（空）');
  }

  // 动效开关：Shadow DOM 里的那套由 overlay 自己关，宿主页面的描边动画靠 documentElement 上的标记
  function applyMotion(s) {
    const on = !s || s.motionEnabled !== false;
    try { QuickFillOverlay.setMotion(on); } catch (e) {}
    if (on) delete document.documentElement.dataset.qfMotion;
    else document.documentElement.dataset.qfMotion = 'off';
  }

  async function loadContext() {
    settings = await S.getSettings();
    applyMotion(settings);
    const resumes = await S.getResumes();
    // 站点绑定优先：同一网站始终复用上次选定的简历
    const { resume: bound, bound: isBound } = await S.getResumeForDomain(location.hostname, resumes);
    resume = bound || (await S.getActiveResume());
    resumeBound = isBound && !!bound;
    entries = resume ? ResumeSchema.allEntries(resume.data) : [];
    learned = await S.getLearnedRules();
  }

  // ---------- 分析 ----------
  async function analyze() {
    await loadContext();
    fields = FieldMatcher.collectFields(document);
    matchResult = FieldMatcher.matchFields(fields, entries, learned, resume ? resume.data : null);
    fillDone = false;
    if (settings.aiEnabled && settings.aiApiKey && matchResult.unmatched.length && entries.length) {
      try { await applyAi(); }
      catch (e) {
        // 不静默：AI 没参与要让用户知道，否则只会以为"识别不准"
        console.warn('[速填] AI 匹配失败：', e.message);
        if (isTop && mounted && !aiWarned) {
          aiWarned = true;
          QuickFillOverlay.toast('AI 增强未参与（' + e.message + '），已改用本地词典匹配。', 'warn');
        }
      }
    }
    await updateOverlay();
    reportFieldCount();
    if (!isTop) reportFrameStats();
    return matchResult;
  }

  async function applyAi() {
    const unmatched = matchResult.unmatched;
    const payload = unmatched.map((f, i) => ({
      id: 'f' + i,
      kind: f.kind,
      inputType: f.inputType || null,
      signals: (f.signals || []).slice(0, 4),
      options: (f.options || []).slice(0, 200).map(o => ({ text: o.text }))
    }));
    const entryList = entries.map(e => ({
      path: e.path, label: e.label, value: e.value
    }));
    const resp = await chrome.runtime.sendMessage({
      type: 'ai:pageUnderstand', fields: payload, entries: entryList
    });
    if (!resp || !resp.ok) {
      if (resp && resp.error) console.warn('[速填] AI 错误：', resp.error);
      return;
    }
    const mapping = resp.result || {};
    const still = [];
    for (let i = 0; i < unmatched.length; i++) {
      const p = mapping['f' + i];
      const entry = p ? entries.find(e => e.path === p) : null;
      if (entry) {
        matchResult.matched.push({
          field: unmatched[i], ruleId: 'ai', path: p, entry,
          confidence: 0.8, signal: (unmatched[i].signals || [])[0], ai: true
        });
      } else {
        still.push(unmatched[i]);
      }
    }
    matchResult.unmatched = still;
    learned = await S.getLearnedRules();
  }

  // ---------- 统计 ----------
  function short(v, n) {
    v = String(v == null ? '' : v).replace(/\n/g, ' ');
    return v.length > (n || 30) ? v.slice(0, n || 30) + '…' : v;
  }

  function computeStats() {
    let matched = 0, missing = 0, unmatched = 0;
    const rows = [];
    if (matchResult) {
      matched = matchResult.matched.length;
      missing = matchResult.noValue.length;
      unmatched = matchResult.unmatched.length;
      for (const m of matchResult.matched) {
        rows.push({
          state: 'ok', ai: !!m.ai, el: m.field.el,
          label: m.entry.label, value: short(m.entry.value)
        });
      }
      for (const nv of matchResult.noValue) {
        rows.push({
          state: 'miss', req: !!nv.field.required, el: nv.field.el,
          label: short(nv.signal || '未知字段', 12), value: '简历缺此项，请在简历中补充'
        });
      }
      for (const f of matchResult.unmatched) {
        rows.push({
          state: 'unk', req: !!f.required, el: f.el,
          label: short((f.signals || [])[0] || '未知字段', 12), value: '未识别，请手动填写'
        });
      }
      // 同组里把必填项排前面：面板列表只显示前 60 行，别让「一定会卡住的字段」沉底
      const RANK = { ok: 0, miss: 1, unk: 2 };
      rows.sort((a, b) => (RANK[a.state] - RANK[b.state]) || ((b.req ? 1 : 0) - (a.req ? 1 : 0)));
    }
    for (const fs of Object.values(frameExtra)) {
      matched += fs.matched || 0;
      missing += fs.missing || 0;
      unmatched += fs.unmatched || 0;
      rows.push(...(fs.rows || []));
    }
    return { matched, missing, unmatched, rows };
  }

  function reportFrameStats() {
    const st = computeStats();
    chrome.runtime.sendMessage({
      type: 'frame:matchStats',
      stats: { matched: st.matched, missing: st.missing, unmatched: st.unmatched, rows: st.rows.map(r => ({ state: r.state, label: r.label, value: r.value, ai: r.ai })) }
    }).catch(() => {});
  }

  function reportFieldCount() {
    try {
      chrome.runtime.sendMessage({ type: 'frame:fieldReport', count: fields.length }).catch(() => {});
    } catch (e) {}
  }

  async function updateOverlay() {
    if (!isTop || !mounted) return;
    const resumes = await S.getResumes();
    QuickFillOverlay.setResumes(resumes, resume ? resume.id : null);
    QuickFillOverlay.setResumeHint(resumeBound ? '本网站记忆的简历（切换后将记住）' : '全局默认简历（切换后本网站将记住）');
    const st = computeStats();
    QuickFillOverlay.setStats(st);
    QuickFillOverlay.setBusy(filling);   // iframe 统计上报也会走到这里，不能据此提前解除忙碌
  }

  let fillToken = 0;
  let filling = false;
  let startedAt = 0;   // 本次填写开始时间，用于「还在进行中」的提示

  function meaningfulValue(t) {
    const s = String(t || '').replace(/\s/g, '');
    if (!s || /^(请选择|请输入|点击选择|选择地区|选择)/.test(s)) return '';
    return s;
  }

  function fieldHasValue(f) {
    if (f.kind === 'radio' || f.kind === 'checkbox' || f.kind === 'checkboxGroup') return (f.group || [f.el]).some(el => el.checked);
    if (f.kind === 'dropdown' || f.kind === 'cascader') {
      // 组件的"有没有值"必须按组件自己的回显读。用 innerText 会读到整行/整格的标签文字
      // （例如控件根节点被识别成 <tr> 时，行文本永远非空 → 字段被误判"已填"直接跳过）。
      const shown = (window.DomAgent && window.DomAgent.displayOf)
        ? window.DomAgent.displayOf(f.el)
        : (f.el.getAttribute('data-value') || (f.el.querySelector('input') || {}).value || '');
      return !!meaningfulValue(shown);
    }
    if (f.kind === 'contenteditable') return !!f.el.textContent.trim();
    return !!meaningfulValue(f.el.value);
  }

  // 失败原因聚合：只报「N 项需人工处理」用户还是不知道该干什么，得说清为什么
  function bumpReason(map, reason) {
    if (!map) return;
    const k = reason || 'exception';
    map[k] = (map[k] || 0) + 1;
  }

  function whyText(map) {
    if (!map) return '';
    const parts = Object.keys(map)
      .sort((a, b) => map[b] - map[a])
      .slice(0, 3)
      .map(k => map[k] + ' 项' + FieldFiller.reasonText(k));
    return parts.length ? '（' + parts.join('；') + '）' : '';
  }

  // 动态表单最多重扫三轮；仅处理空字段、新字段，绝不覆盖用户已有输入。
  // msg.leadId：点球帧担任 lead 显示进度，其余帧静默填写；缺省时顶层即 lead（兼容旧行为）。
  async function doFill(msg) {
    if (filling) return;
    const m = msg || {};
    const leadId = m.leadId === undefined ? null : m.leadId;
    const isLead = leadId === null
      ? isTop
      : (leadId === myFrameId) || (leadId === 0 && isTop) || (myFrameId === null && isTop);
    const showUi = isLead && !m.silent;

    const myToken = ++fillToken;
    const cancelled = () => myToken !== fillToken;
    const processed = new Set();
    const failedEls = new Set();   // 填写失败的控件保留「失败」标记，不被必填提醒覆盖
    filling = true; startedAt = Date.now();
    fillStat = { filled: 0, remaining: 0 };
    otherFrames = new Map();
    if (showUi) {
      QuickFillOverlay.setBusy(true);
      QuickFillOverlay.showProgress('读取本地简历', '读取你保存在本机的简历，不会上传到服务器。', 7, { phase: 'read' });
    }
    try {
      await loadContext();
      if (!resume || !entries.length) {
        if (showUi) QuickFillOverlay.completeProgress('请先编辑并保存简历', '当前没有可填写的信息。点击面板的「编辑简历」补充后再试。');
        return;
      }
      const maxRounds = isTop ? 3 : 1;
      let count = 0, failed = 0;
      let okFilled = 0, seenTotal = 0;   // 跨轮累计：给「取消结算」用的两个数
      const reasons = {};
      for (let round = 1; round <= maxRounds && !cancelled(); round++) {
        // 每一轮都回到「理解页面」：拆结构找可填区域 → 再进入「填写页面」
        if (showUi) QuickFillOverlay.showProgress('理解页面',
          `第 ${round} 轮：拆解页面结构，寻找可填写区域。`, 12 + (round - 1) * 24, { phase: 'understand' });
        const result = await analyze();
        if (cancelled()) return;
        const candidates = result.matched.filter(m2 => !processed.has(m2.field.el) && !fieldHasValue(m2.field));
        if (!candidates.length) break;
        for (const nv of result.noValue) if (!fieldHasValue(nv.field)) FieldFiller.markField(nv.field, 'missing', null);
        for (const f of result.unmatched) if (!fieldHasValue(f)) FieldFiller.markField(f, 'unmatched', null);
        const handledBefore = seenTotal;
        seenTotal += candidates.length;
        if (showUi) QuickFillOverlay.showProgress('填写页面',
          `Agent 正在填写剩余字段（第 ${round} 轮），共 ${candidates.length} 项。`,
          19 + (round - 1) * 24, { phase: 'fill', count: stepText(handledBefore, seenTotal) });
        const done = await FieldFiller.fillAll(candidates, cancelled, (index, info) => {
          const handled = handledBefore + index;
          if (info && info.state === 'end') {
            if (info.ok === true) okFilled++;
            if (!isLead) reportFillStep(leadId, info, okFilled, handled, seenTotal);
          }
          if (!showUi) return;
          fillStat.filled = okFilled;
          fillStat.remaining = Math.max(0, seenTotal - handled);
          QuickFillOverlay.showProgress('填写页面',
            info ? fieldLine(info) : `Agent 正在填写剩余字段（第 ${round} 轮）。`,
            19 + (round - 1) * 24 + Math.round(20 * index / candidates.length),
            { phase: 'fill', count: stepText(handled, seenTotal) });
        }, step => {
          if (showUi) QuickFillOverlay.showProgress('AI 辅助点击',
            `启发式与可信输入都没点中，正在第 ${step} 步观察面板并点击。`,
            Math.min(92, 40 + step * 4),
            { phase: 'fill' });
        }, phase => {
          if (showUi && phase === 'trusted') QuickFillOverlay.showProgress('可信输入点选',
            '合成事件点不开该组件，改用真实鼠标事件（页面顶部可能出现调试横幅）。',
            36, { phase: 'fill' });
        });
        done.forEach(r => {
          processed.add(r.match.field.el);
          count++;
          if (r.ok !== true) { failed++; failedEls.add(r.match.field.el); bumpReason(reasons, r.reason); }
        });
        if (cancelled()) return;
        if (round < maxRounds && isTop) await new Promise(resolve => setTimeout(resolve, 180));
      }
      if (cancelled()) return;
      // 必填项提醒：页面上标了 * / required 但最终仍为空的字段（含未识别）单独标红并在完成提示里计数
      const requiredEmpty = (fields || []).filter(f => f.required && !fieldHasValue(f));
      for (const f of requiredEmpty) {
        if (!failedEls.has(f.el)) FieldFiller.markField(f, 'required', null);
      }
      const requiredMissing = requiredEmpty.length;
      fillDone = true;
      // 上报本帧结果（lead 帧据此汇总其他帧的完成情况）
      try { chrome.runtime.sendMessage({ type: 'frame:fillDone', count, failed, requiredMissing, leadId }).catch(() => {}); } catch (e) {}
      if (showUi) {
        const reqText = requiredMissing ? `，${requiredMissing} 个必填项为空（已红框标出）` : '';
        const elapsedS = Math.max(1, Math.round(QuickFillOverlay.getElapsed() / 1000));
        const timeTag = `本次用时 ${elapsedS} 秒`;
        if (leadId !== null && !isTop) {
          QuickFillOverlay.completeProgress('✓ 简历填写完成',
            `本区域已处理 ${count} 项${reqText}，${timeTag}。请检查页面中的填写结果。${failed ? whyText(reasons) : ''}`, 0);
        } else if (leadId !== null) {
          await new Promise(resolve => setTimeout(resolve, 400));   // 等待其他帧上报
          const total = count + fillSummary.count, totalFailed = failed + fillSummary.failed;
          const totalReq = requiredMissing + fillSummary.requiredMissing;
          fillSummary = { count: 0, failed: 0, requiredMissing: 0 };
          const saved = total * 4;   // 人工录一项约 4 秒，这是「省了多少」的估算口径（不是本次用时）
          const reqSuffix = totalReq ? `已标出 ${totalReq} 个必填项为空，请重点核对。` : '';
          QuickFillOverlay.completeProgress('✓ 简历填写完成',
            `${timeTag}，按每项约 4 秒估算，手动录入这 ${total} 项大约要 ${saved} 秒。`
            + (totalFailed ? `（${totalFailed} 项需人工处理）` : '') + (reqSuffix ? ' ' + reqSuffix : ''), saved);
        } else {
          QuickFillOverlay.completeProgress('✓ 简历填写完成',
            `已处理 ${count} 项${failed ? `，${failed} 项需人工处理` + whyText(reasons) : ''}${reqText}。${timeTag}。请逐项核对后自行提交。`,
            count * 4);
        }
        // 简历里缺的项：给一条直达编辑器「未补齐视图」的路，而不是只把格子标红
        const missingNow = document.querySelectorAll('.__qf_missing').length;
        if (missingNow) QuickFillOverlay.offerFixMissing(missingNow);
        // 光晕给一次短提示：有失败/缺必填就橙，全部顺利就绿，5 秒后自己回到常态慢呼吸
        QuickFillOverlay.setBallState((failed || requiredMissing) ? 'warn' : 'ok');
      } else if (!isTop) {
        reportFrameStats();
      }
    } catch (e) {
      console.warn('[速填] 填写失败', e);
      if (showUi) QuickFillOverlay.completeProgress('部分填写未完成', `发生错误：${e.message}。请核对已填内容并手动处理剩余字段。`);
    } finally {
      if (myToken === fillToken) { filling = false; if (isTop) updateOverlay(); }
    }
  }

  function doClear() {
    fillToken++;
    filling = false;
    releaseSelectionClean();
    QuickFillOverlay.stopSelection();
    if (isTop && mounted) { QuickFillOverlay.setBusy(false); QuickFillOverlay.closeProgress(); }
    FieldFiller.clearFilling();
    FieldFiller.clearMarks(document);
    otherFrames = new Map();
    fillDone = false;
  }

  // 中止但保留现场：不清结果标记、不销毁进度窗，让用户看得见「哪些已填、哪些失败」。
  // doClear 是「一键填写 + 清除标记」两件事，取消只该做前一件。
  function doStop() {
    fillToken++;
    filling = false;
    releaseSelectionClean();
    QuickFillOverlay.stopSelection();
    FieldFiller.clearFilling();
    otherFrames = new Map();
    if (isTop && mounted) QuickFillOverlay.setBusy(false);
  }

  // ---------- 选区填写 ----------
  // 「占用中」要说话：以前五处 if (filling) return 是静默返回，用户只会觉得"点了没反应"
  function busyGuard(what) {
    if (filling) {
      const secs = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
      QuickFillOverlay.toast('「' + what + '」暂时不可用：' + (secs ? '一键填写已进行 ' + secs + ' 秒，' : '上一次填写还在进行中，')
        + '可点进度窗的「停止填写」中止，或等它结束后再试。', 'warn');
      return true;
    }
    if (mode === 'select') {
      QuickFillOverlay.toast('请先完成当前框选，或按 Esc 取消。', 'warn');
      return true;
    }
    return false;
  }

  // 关闭选区确认弹窗：showRegionPicker 返回的清理函数以前存了却从不调用，导致 Esc/遮罩残留
  function releaseSelectionClean() {
    if (typeof selectionClean === 'function') { try { selectionClean(); } catch (e) {} }
    selectionClean = null;
  }

  async function startRegionFill() {
    if (busyGuard('选区填写')) return;
    releaseSelectionClean();
    await loadContext();
    if (!resume || !entries.length) { QuickFillOverlay.toast('请先在插件里编辑并保存简历，再使用选区填写。', 'warn'); return; }
    mode = 'select';
    QuickFillOverlay.startSelection(rect => {
      const regionFields = FieldMatcher.collectFields(document).filter(f => {
        const r = f.el.getBoundingClientRect();
        return r.width && r.height && r.right > rect.left && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom;
      });
      mode = 'idle';
      if (!regionFields.length) {
        QuickFillOverlay.toast('框选范围内没有可填写的控件。请框住真正的输入框区域（注意：网页内嵌框架里的表单目前还选不到）。', 'warn');
        QuickFillOverlay.togglePanel(true);
        return;
      }
      const sections = buildRegionSections(resume.data);
      if (!sections.length) { QuickFillOverlay.toast('简历里还没有可填写的内容，请先在「编辑简历」里补充并保存。', 'warn'); return; }
      selectionClean = QuickFillOverlay.showRegionPicker({
        rect, fields: regionFields, sections,
        onRepick: () => { selectionClean = null; startRegionFill(); },
        onCancel: () => { selectionClean = null; QuickFillOverlay.togglePanel(true); },
        onConfirm: (key, index) => { selectionClean = null; fillRegion(regionFields, key, index); }
      });
    });
  }

  // 模块列表：数组段逐条记录（保留原始索引），对象段单组
  function buildRegionSections(rawData) {
    const data = ResumeSchema.normalizeData(rawData);
    const out = [];
    for (const s of ResumeSchema.SCHEMA.sections) {
      if (s.kind === 'object') {
        const has = s.fields.some(f => String((data[s.key] || {})[f.key] || '').trim());
        if (has) out.push({ key: s.key, title: s.title, icon: SECTION_ICONS[s.key], items: [{ index: -1, label: '（单组）' + s.title }] });
      } else {
        const rows = (data[s.key] || []).map((it, i) => ({ it, i }))
          .filter(x => s.fields.some(f => String(x.it[f.key] || '').trim()));
        if (rows.length) {
          out.push({
            key: s.key, title: s.title, icon: SECTION_ICONS[s.key],
            items: rows.map(x => ({ index: x.i, label: '第 ' + (x.i + 1) + ' 组-' + (x.it.company || x.it.name || x.it.title || x.it.school || s.title) }))
          });
        }
      }
    }
    return out;
  }

  // 只以选中「单条记录」为数据源（不含 .* 聚合），天然满足「一次只填一组」
  async function fillRegion(regionFields, sectionKey, index) {
    mode = 'idle';
    const sec = ResumeSchema.SCHEMA.sections.find(s => s.key === sectionKey);
    if (!sec) { QuickFillOverlay.toast('没找到这个简历板块，请重新框选。', 'danger'); return; }
    const data = ResumeSchema.normalizeData(resume.data);
    const record = sec.kind === 'array' ? (data[sec.key] || [])[index] : data[sec.key];
    if (!record) { QuickFillOverlay.toast('这一组记录是空的，请先在「编辑简历」里填写。', 'warn'); return; }
    const regionEntries = [];
    const agg = sec.kind === 'array';   // 路径用规则词典的聚合格式（.* ），值仍取自这一条记录
    for (const f of sec.fields) {
      const v = record[f.key];
      if (String(v == null ? '' : v).trim()) {
        regionEntries.push({
          path: sec.key + (agg ? '.*.' : '.') + f.key,
          label: f.label, value: String(v).trim()
        });
      }
    }
    // 时间段（规则词典里的 work.*.period / awards.*.period 等）
    const pStart = record.start || record.date;
    const pEnd = record.end || record.endDate;
    if (agg && (pStart || pEnd)) {
      const s0 = String(pStart || '').replace(/[./]/g, '-');
      const e0 = String(pEnd || '').replace(/[./]/g, '-');
      regionEntries.push({ path: sec.key + '.*.period', label: '时间段', value: s0 && e0 ? s0 + ' 至 ' + e0 : (s0 || e0) });
    }
    if (!regionEntries.length) {
      QuickFillOverlay.toast('「' + sec.title + '」这一组没有可填的内容，请先在「编辑简历」里补充。', 'warn');
      return;
    }

    const scope = '「' + sec.title + (sec.kind === 'array' ? '·第 ' + (index + 1) + ' 组' : '') + '」';
    const myToken = ++fillToken;
    const cancelled = () => myToken !== fillToken;
    filling = true; startedAt = Date.now();
    let res;
    if (isTop && mounted) {
      QuickFillOverlay.setBusy(true);
      QuickFillOverlay.showProgress('填写选区', '正在把' + scope + '写入选中的控件。', 18, { phase: 'fill' });
    }
    try {
      const { matched, noValue, unmatched } = FieldMatcher.matchFields(regionFields, regionEntries, learned, null);
      for (const nv of noValue) FieldFiller.markField(nv.field, 'missing', null);
      // 圈进来但跟所选记录无关的控件：灰虚线「不属于这一组」，不要再用橙红吓人
      for (const f of unmatched) FieldFiller.markField(f, 'skipped', null);
      res = { matched: matched.length, noValue: noValue.length, skipped: unmatched.length, ok: 0, other: 0, failed: 0, had: 0, reasons: {} };
      let done = 0;
      const regionLine = (state, mm, r) => {
        const name = (mm.entry && mm.entry.label) || '未命名字段';
        const val = mm.entry ? String(mm.entry.value).slice(0, 24) : '';
        if (state === 'start') return '正在填 ' + name + ' → ' + (val || '（空）');
        if (state === 'had') return name + ' 已有内容，未覆盖';
        if (r && r.ok === true) return '已填 ' + name + ' → ' + (val || '（空）');
        if (r && r.ok === 'other') return name + ' 选了「其他」，请人工确认';
        return name + ' 没填上：' + (FieldFiller.reasonText(r && r.reason) || '需人工处理');
      };
      for (const mm of matched) {
        if (cancelled()) break;
        if (fieldHasValue(mm.field)) {
          res.had++;
          if (isTop && mounted) QuickFillOverlay.showProgress('填写选区', regionLine('had', mm),
            18 + Math.round(70 * done / Math.max(1, matched.length)), { phase: 'fill', count: stepText(done, matched.length) });
          continue;
        }
        FieldFiller.markField(mm.field, 'filling', mm);
        if (isTop && mounted) QuickFillOverlay.showProgress('填写选区', regionLine('start', mm),
          18 + Math.round(70 * done / Math.max(1, matched.length)), { phase: 'fill', count: stepText(done, matched.length) });
        let r = { ok: false, reason: 'exception' };
        try { r = await FieldFiller.fillMatch(mm, { label: mm.entry && mm.entry.label, cancelled }); } catch (e) { /* 保持失败态 */ }
        if (cancelled()) { FieldFiller.dropFilling(mm.field); break; }
        if (r.ok === true) { res.ok++; FieldFiller.markField(mm.field, 'filled', mm); }
        else if (r.ok === 'other') { res.other++; FieldFiller.markField(mm.field, 'filled-other', mm); }
        else {
          res.failed++;
          bumpReason(res.reasons, r.reason);
          FieldFiller.markField(mm.field, 'failed', mm, r.reason);
          // 组件类失败把值放剪贴板，和「一键填写」的兜底保持一致
          if (mm.field.kind === 'dropdown' || mm.field.kind === 'cascader') {
            try { await navigator.clipboard.writeText(String(mm.entry.value)); } catch (e) {}
          }
        }
        FieldFiller.flashLand(mm.field);
        done++;
        if (isTop && mounted) {
          QuickFillOverlay.showProgress('填写选区', regionLine('end', mm, r),
            18 + Math.round(70 * done / Math.max(1, matched.length)), { phase: 'fill', count: stepText(done, matched.length) });
        }
      }
    } finally {
      if (myToken === fillToken) {
        filling = false;
        // 选区路径的进度窗用完仍必须销毁（region-helper 断言选区结束后 .qf-shade 数为 0）
        if (isTop && mounted) { QuickFillOverlay.setBusy(false); QuickFillOverlay.closeProgress(); updateOverlay(); }
      }
    }
    if (cancelled()) return;

    // 反馈必须区分「没匹配到」「已有内容」「填好了」——以前一律报"完成"，用户无法判断发生了什么
    const total = res.matched + res.noValue + res.skipped;
    if (res.ok > 0) {
      const tail = [res.other && (res.other + ' 项选了「其他」需确认'),
        res.failed && (res.failed + ' 项填写失败' + whyText(res.reasons)),
        res.noValue && (res.noValue + ' 项简历缺该项，已标红'),
        res.had && (res.had + ' 项已有内容未覆盖'),
        res.skipped && (res.skipped + ' 项不属于这一组，已灰标')].filter(Boolean).join('，');
      QuickFillOverlay.toast('选区填写：' + scope + ' 已填入 ' + res.ok + ' 项（共识别 ' + total +
        ' 个控件）' + (tail ? '；' + tail : '') + '。请逐项核对后再提交。', res.failed ? 'warn' : 'ok');
    } else if (res.had > 0) {
      QuickFillOverlay.toast('选区填写：' + scope + ' 命中 ' + res.matched + ' 项，但这些控件里已经有内容，'
        + '速填不覆盖你填过的值。要换一组记录请点「重新框选」。', 'warn');
    } else if (res.noValue > 0) {
      QuickFillOverlay.toast('选区填写：' + scope + ' 没有填入任何内容——命中 ' + total + ' 个控件，其中 '
        + res.noValue + ' 项标红表示这一组简历里缺该内容。请换一组记录，或先去「编辑简历」补齐。', 'danger');
    } else {
      QuickFillOverlay.toast('选区填写：' + scope + ' 与框选区域内的 ' + total +
        ' 个控件都对不上（灰虚线=不属于这一组）。请确认框的是同一组表单，或改用「辅助填写」逐项填。', 'danger');
    }
  }

  // ---------- 辅助填写 ----------
  async function openHelper() {
    if (busyGuard('辅助填写')) return;
    releaseSelectionClean();
    await loadContext();
    if (!resume || !entries.length) { QuickFillOverlay.toast('请先编辑并保存简历，再使用辅助填写'); return; }
    mode = 'helper';
    const sections = resumeSections();
    if (!sections.length) { QuickFillOverlay.toast('简历里还没有内容，请先在编辑器中填写并保存'); return; }
    QuickFillOverlay.showHelper({
      sections,
      onPick: entry => QuickFillOverlay.toast('已复制「' + entry.label + '」的值，请点击网页中要填写的输入框'),
      onFillTarget: (el, entry) => fillHelperTarget(el, entry),
      onFeedback: () => overlayHandlers.onFeedback('helper'),
      onClose: () => { mode = 'idle'; }
    });
  }

  function resumeSections() {
    const data = ResumeSchema.normalizeData(resume.data);
    const sections = [];
    for (const s of ResumeSchema.SCHEMA.sections) {
      const list = [];
      if (s.kind === 'object') {
        for (const f of s.fields) {
          const v = (data[s.key] || {})[f.key];
          if (String(v || '').trim()) list.push({ path: s.key + '.' + f.key, label: f.label, value: String(v) });
        }
      } else {
        (data[s.key] || []).forEach((it, i) => {
          for (const f of s.fields) {
            const v = it[f.key];
            if (String(v || '').trim()) list.push({ path: s.key + '.' + i + '.' + f.key, label: '第' + (i + 1) + '组·' + f.label, value: String(v) });
          }
        });
      }
      if (list.length) sections.push({ title: s.title, entries: list });
    }
    return sections;
  }

  async function openAgentClick() {
    if (busyGuard('AI 辅助点击')) return;
    releaseSelectionClean();
    await loadContext();
    if (!resume || !entries.length) { QuickFillOverlay.toast('请先编辑并保存简历，再使用 AI 辅助点击'); return; }
    if (!settings || !settings.aiEnabled || !settings.aiApiKey) {
      QuickFillOverlay.toast('请先在扩展弹窗开启 AI 并填写 API Key', 'warn');
      return;
    }
    if (settings.aiDomAgentEnabled === false) {
      QuickFillOverlay.toast('已关闭 AI 辅助点击，请在扩展弹窗重新开启', 'warn');
      return;
    }
    const sections = resumeSections();
    if (!sections.length) { QuickFillOverlay.toast('简历里还没有内容，请先在编辑器中填写并保存'); return; }
    mode = 'agent';
    QuickFillOverlay.showHelper({
      mode: 'agent',
      sections,
      onPick: entry => QuickFillOverlay.toast('已选择「' + entry.label + '」，请点击网页中的下拉或级联控件'),
      onFillTarget: (el, entry) => fillAgentTarget(el, entry),
      onFeedback: () => overlayHandlers.onFeedback('agent'),
      onClose: () => { mode = 'idle'; }
    });
  }

  async function fillAgentTarget(el, entry) {
    if (!el || !entry) return;
    if (busyGuard('AI 辅助点击')) return;
    const myToken = ++fillToken;
    filling = true;
    startedAt = Date.now();
    QuickFillOverlay.setBusy(true);
    QuickFillOverlay.showProgress('AI 辅助点击', '正在观察「' + entry.label + '」对应控件。', 18, { phase: 'understand' });
    try {
      const r = await FieldFiller.fillWidgetTarget(el, entry.value, {
        label: entry.label,
        cancelled: () => myToken !== fillToken,
        onPhase: phase => {
          if (phase === 'trusted') {
            QuickFillOverlay.showProgress('可信输入点选', '合成事件点不开该组件，改用真实鼠标事件。', 40, { phase: 'fill' });
          } else if (phase === 'ai') {
            QuickFillOverlay.showProgress('AI 辅助点击', '可信输入也没点中，交给 AI 逐步观察面板。', 55, { phase: 'fill' });
          }
        },
        onStep: step => QuickFillOverlay.showProgress('AI 辅助点击',
          '第 ' + step + ' 步：观察面板并点击。', Math.min(90, 55 + step * 4), { phase: 'fill' })
      });
      if (myToken !== fillToken) return;
      if (r.ok) {
        FieldFiller.markField({ el }, 'filled', { entry });
        QuickFillOverlay.completeProgress('✓ AI 辅助点击完成',
          '已通过' + ({ synthetic: '常规点选', trusted: '真实鼠标事件', ai: 'AI 逐步点选' }[r.layer] || '自动点选')
          + '填入「' + entry.label + '」，请核对页面展示是否正确。');
      } else {
        try { await navigator.clipboard.writeText(String(entry.value)); } catch (e) {}
        FieldFiller.markField({ el }, 'failed', { entry }, r.reason);
        QuickFillOverlay.completeProgress('未能自动点选',
          '「' + entry.label + '」：' + (FieldFiller.reasonText(r.reason) || '未成功')
          + '。值已复制到剪贴板，可手动粘贴。');
      }
    } catch (e) {
      if (myToken !== fillToken) return;
      try { await navigator.clipboard.writeText(String(entry.value)); } catch (err) {}
      QuickFillOverlay.completeProgress('AI 辅助点击未完成', String(e && e.message || e));
    } finally {
      if (myToken === fillToken) { filling = false; QuickFillOverlay.setBusy(false); }
    }
  }

  async function fillHelperTarget(el, entry) {
    if (!el || !entry) return;
    try {
      const r = await FieldFiller.setTextValue(el, entry.value);
      if (r === true || r === 'other') {
        FieldFiller.markField(
          { el, kind: el.tagName === 'SELECT' ? 'select' : el.isContentEditable ? 'contenteditable' : 'input' },
          r === 'other' ? 'filled-other' : 'filled', { entry });
        QuickFillOverlay.toast('已填入「' + entry.label + '」');
      } else {
        QuickFillOverlay.toast('「' + entry.label + '」未能填入该控件，值已复制可手动粘贴');
      }
    } catch (e) {
      QuickFillOverlay.toast('「' + entry.label + '」未能填入该控件，值已复制可手动粘贴');
    }
  }

  // ---------- 工具 ----------
  function downloadJson(name, data) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      QuickFillOverlay.toast('已导出 ' + name);
    } catch (e) { QuickFillOverlay.toast('导出失败'); }
  }

  // ---------- 悬浮球 ----------
  const overlayHandlers = {
    onOpen: async () => { if (!filling) await analyze(); },
    onFill: () => {
      if (busyGuard('一键填写')) return;
      releaseSelectionClean();
      QuickFillOverlay.setBusy(true);
      chrome.runtime.sendMessage({ type: 'frame:fill' }).catch(() => { QuickFillOverlay.setBusy(false); QuickFillOverlay.toast('消息发送失败，请刷新网页后重试。', 'danger'); });
    },
    onStop: () => {
      const wasFilling = filling;
      const stat = { filled: fillStat.filled, remaining: fillStat.remaining };
      doStop();
      if (!wasFilling) { QuickFillOverlay.toast('这一轮填写已经跑完了，无需停止；要看结果请核对页面。', 'info'); return; }
      QuickFillOverlay.showCancelled(stat);
      chrome.runtime.sendMessage({ type: 'frame:stop' }).catch(() => {});
      QuickFillOverlay.toast('已停止继续填写：本区域已填 ' + stat.filled + ' 项、这一轮还有 ' + stat.remaining
        + ' 项没处理。页面上已写入的内容和描边都保持不变，可以接着手动补，或再点一次一键填写。', 'warn');
    },
    onClear: () => {
      doClear();
      chrome.runtime.sendMessage({ type: 'frame:clear' }).catch(() => {});
    },
    onRefresh: async () => {
      if (busyGuard('重新识别')) return;
      frameExtra = {};
      await analyze();
    },
    onSelectResume: async id => {
      await S.setSiteBinding(location.hostname, id);
      resumeBound = true;
      await analyze();
    },
    onManage: () => {
      const url = chrome.runtime.getURL('popup/editor.html') + (resume ? '?id=' + resume.id : '');
      window.open(url, '_blank');
    },
    onFixMissing: () => {
      // 带 missing=1 打开编辑器，进去直接是「只看未补齐项」的视图
      const url = chrome.runtime.getURL('popup/editor.html')
        + (resume ? '?id=' + resume.id + '&missing=1' : '?missing=1');
      window.open(url, '_blank');
    },
    onRegion: () => { startRegionFill(); },
    onHelper: () => { openHelper(); },
    onAgent: () => { openAgentClick(); },
    onRecord: () => {
      QuickFillOverlay.showRecordJob({ url: location.href, title: document.title }, async rec => {
        if (!rec.title && !rec.url) { QuickFillOverlay.toast('职位名称或链接不能为空'); return; }
        await ResumeStore.addJobRecord(rec);
        QuickFillOverlay.toast('已记录：' + (rec.title || rec.url));
      });
    },
    onJobs: () => {
      QuickFillOverlay.showJobsPanel(() => ResumeStore.getJobRecords(), {
        onDelete: id => ResumeStore.deleteJobRecord(id),
        onClear: () => ResumeStore.clearJobRecords(),
        onUpdateStatus: (id, status) => ResumeStore.updateJobRecord(id, { status }),
        onExport: list => downloadJson('投递记录.json', list)
      });
    },
    onSwitch: () => {
      QuickFillOverlay.toggleMore(true);
      QuickFillOverlay.toast('在「识别统计与简历」中选择要使用的简历，本网站会记住你的选择。');
    },
    onTools: () => QuickFillOverlay.toast('「求职神器」规划中：面试题库 / 笔试模拟即将上线'),
    onHelp: () => QuickFillOverlay.toast('一键填写：自动匹配并填写空字段，自定义下拉失败时会自动 AI 辅助点击；选区填写：只填框选的一组；辅助填写：逐项写入；AI 辅助点击：选简历值后点复杂控件，由模型多轮点选。数据仅存本地，不会自动提交。'),
    onHideBall: () => {
      ballHiddenByUser = true;
      QuickFillOverlay.hideBall();
      QuickFillOverlay.showMini(() => { ballHiddenByUser = false; QuickFillOverlay.showBall(); });
    },
    onFeedback: source => {
      QuickFillOverlay.showFeedback({ url: location.href, title: document.title, source: source || 'helper' }, async f => {
        await ResumeStore.saveHelperFeedback(f);
        QuickFillOverlay.toast('已提交反馈，谢谢！');
      });
    }
  };

  function ensureMounted() {
    if (mounted) return;
    QuickFillOverlay.mount(overlayHandlers);
    mounted = true;
  }

  // ---------- 帧身份 ----------
  async function whoami() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'frame:hello', url: location.href, fieldCount: fields.length });
      if (r && typeof r.frameId === 'number') myFrameId = r.frameId;
    } catch (e) {}
  }

  // ---------- 消息 ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg && msg.type) {
        case 'settings:updated':
          // 动效开关之类要立刻可见，不能等下一次点开面板或跑完一轮填写
          await loadContext();
          if (isTop && mounted) updateOverlay();
          break;
        case 'resume:updated':
          await analyze();
          break;
        case 'doFill':
          await doFill(msg);
          break;
        case 'doClear':
          doClear();
          break;
        case 'doStop':
          doStop();
          break;
        case 'frame:fillSummary':
          fillSummary.count += msg.count || 0;
          fillSummary.failed += msg.failed || 0;
          fillSummary.requiredMissing += msg.requiredMissing || 0;
          break;
        case 'frame:stepSummary':
          if (msg.from != null) otherFrames.set(msg.from, { ok: msg.ok || 0, done: msg.done || 0 });
          QuickFillOverlay.setProgressOther(otherFilledText());
          break;
        case 'forceShow': {
          ensureMounted();
          await analyze();
          QuickFillOverlay.showBall();
          QuickFillOverlay.togglePanel(true);
          sendResponse({ ok: true });
          return;
        }
        case 'frame:stats':
          if (isTop) {
            frameExtra[msg.frameId] = msg.stats;
            updateOverlay();
          }
          break;
        // 自测钩子：只在夹具页存在 #ti-probe-box 时响应，用可信输入点它一次，
        // 页面里的 isTrusted 探针即可断言「事件真的是浏览器发的」。
        case 'qf:tiSelfTest': {
          const probe = document.getElementById('ti-probe-box');
          if (!probe || !window.TrustedInput) { sendResponse({ ok: false, reason: 'no_probe' }); break; }
          sendResponse(await window.TrustedInput.click(probe));
          break;
        }
      }
      sendResponse({ ok: true });
    })();
    return true;
  });

  // ---------- 启动 ----------
  // 悬浮球常驻：顶层帧一进入页面就把球挂出来，不等后台回执、不依赖表单识别、不受任何裁决影响。
  function showBallNow() {
    if (!isTop) return;
    try {
      ensureMounted();
      QuickFillOverlay.showBall();
    } catch (e) { console.warn('[速填] 悬浮球挂载失败', e); }
  }

  async function boot() {
    showBallNow();
    await whoami();
    try {
      await loadContext();
      if (!isTop) {
        // 子帧只上报统计，不出球（球由顶层帧常驻持有）
        if (settings.autoDetect) await analyze(); else reportFieldCount();
        return;
      }
      await updateOverlay();
      if (settings.autoDetect) {
        const det = FormDetector.detect(document, location.hostname);
        if (det.isForm) await analyze();
      }
      reportFieldCount();
    } catch (e) {
      console.warn('[速填] 页面初始化失败，悬浮球仍可手动使用', e);
      if (isTop) QuickFillOverlay.toast('自动识别暂不可用，点击悬浮球可重试。');
    }
    if (isTop) watchPageChanges();
  }

  // SPA / 异步渲染表单支持
  let moTimer = null;
  function watchPageChanges() {
    if (!isTop) return;
    const mo = new MutationObserver(() => {
      clearTimeout(moTimer);
      moTimer = setTimeout(async () => {
        if (matchResult) {
          // 已在分析状态：字段数变化超过阈值时重新分析
          const n = FieldMatcher.collectFields(document).length;
          if (Math.abs(n - fields.length) >= 2) await analyze();
        } else if (settings.autoDetect) {
          const det = FormDetector.detect(document, location.hostname);
          if (det.isForm) { await analyze(); }
        }
      }, 1200);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 球先出来、识别后到：document_idle 时 body 通常已就绪；提前注入时等 DOMContentLoaded 再挂
  if (document.body) showBallNow();
  else document.addEventListener('DOMContentLoaded', showBallNow, { once: true });

  // 视口变小（分屏、缩放、弹窗）时把球拉回可见区域，避免"球跑到屏幕外"
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (isTop && mounted) QuickFillOverlay.reclampBall(); }, 200);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
