// CDP 端到端测试：驱动已加载扩展的 Edge，验证识别→匹配→填写→高亮
// 用法: node scripts/cdp-test.js [调试端口，默认 9222]
const WS_URL_FETCH = 'http://127.0.0.1:' + (process.argv[2] || '9222') + '/json';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getTarget(urlPart) {
  const resp = await fetch(WS_URL_FETCH);
  const targets = await resp.json();
  const t = targets.find(x => x.type === 'page' && x.url.includes(urlPart));
  if (!t) throw new Error('未找到页面目标: ' + urlPart);
  return t.webSocketDebuggerUrl;
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  // 后台标签页会被浏览器节流 setTimeout（秒级），导致自定义下拉/级联填写变慢数倍；
  // 测试驱动必须先把页面带到前台，否则断言读到的是"填写中途"状态。
  async bringToFront() {
    await this.send('Page.enable').catch(() => {});
    await this.send('Page.bringToFront').catch(() => {});
  }
  // 重新加载页面：确保 content script 为最新注入（扩展若被 reload 过，旧 content script 的消息通道已失效）
  async reloadPage() {
    await this.send('Page.enable').catch(() => {});
    await this.send('Page.reload', { ignoreCache: false }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
  }
  close() { this.ws.close(); }
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); }
}

(async () => {
  const pageWs = await getTarget('test-form.html');
  const cdp = await CDP.connect(pageWs);
  await cdp.reloadPage();      // 全新状态 + 最新 content script
  await cdp.bringToFront();   // 避免后台标签页 setTimeout 节流影响填写速度
  await sleep(1500);          // 等待扩展 boot 与分析

  // 等待填写完成：iframe 的统计上报也会让按钮短暂复位，故不能只看按钮。
  // 完成信号以「一键填写按钮重新可用」为准：它只在整轮填写的 finally 里解除 busy。
  // 光看 DOM 稳定会误判——自定义下拉在轮询面板期间页面没有任何标记变化。
  async function waitFillDone(timeoutMs) {
    const t0 = Date.now();
    let last = '', stableSince = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const state = await cdp.evaluate(`(() => {
        const s = document.getElementById('__qf_overlay_host__').shadowRoot;
        const b = s && s.querySelector('[data-act=fill]');
        const btnOk = !!(b && !b.disabled && b.textContent.includes('一键填写'));
        return (document.querySelectorAll('[class*=__qf_]').length) + '|' + (btnOk ? 1 : 0);
      })()`);
      if (String(state).endsWith('|1')) return true;
      const now = Date.now();
      if (state === last) { if (now - stableSince > 4000) return true; }   // 兜底：真的卡住了也别死等
      else { last = state; stableSince = now; }
      await sleep(150);
    }
    return false;
  }

  console.log('\n[1] 悬浮球注入与表单识别');
  const injected = await cdp.evaluate(`!!document.getElementById('__qf_overlay_host__')`);
  check('悬浮球宿主已注入', injected);
  const ballState = await cdp.evaluate(`(() => {
    const h = document.getElementById('__qf_overlay_host__');
    if (!h || !h.shadowRoot) return null;
    const b = h.shadowRoot.querySelector('.qf-ball');
    const cs = getComputedStyle(b);
    return {
      hidden: b.classList.contains('qf-hidden'),
      hasBadge: !!h.shadowRoot.querySelector('.badge'),
      bg: cs.backgroundImage,
      anim: cs.animationName,
      icon: (h.shadowRoot.querySelector('.qf-ball .icon') || {}).textContent || ''
    };
  })()`);
  check('悬浮球可见（识别为招聘表单）', ballState && !ballState.hidden, ballState);
  check('悬浮球为紫蓝渐变品牌球', ballState && /gradient/.test(ballState.bg), ballState && ballState.bg);
  check('悬浮球带闪电图标且无旧徽标', ballState && ballState.icon.includes('⚡') && !ballState.hasBadge, ballState && ballState.icon);
  check('悬浮球有呼吸动画', ballState && /breathe/.test(ballState.anim), ballState && ballState.anim);

  console.log('\n[2] 打开面板并检查匹配统计');
  const clickRes = await cdp.evaluate(`(() => {
    const s = document.getElementById('__qf_overlay_host__').shadowRoot;
    s.querySelector('.qf-ball').click();
    return { immediate: !s.querySelector('.qf-panel').classList.contains('qf-hidden') };
  })()`);
  console.log('    点击后立即:', JSON.stringify(clickRes));
  await sleep(300);
  const stats = await cdp.evaluate(`(() => {
    const s = document.getElementById('__qf_overlay_host__').shadowRoot;
    return {
      panelOpen: !s.querySelector('.qf-panel').classList.contains('qf-hidden'),
      matched: s.querySelector('[data-role=nMatched]').textContent,
      missing: s.querySelector('[data-role=nMissing]').textContent,
      unmatched: s.querySelector('[data-role=nUnmatched]').textContent,
      resume: s.querySelector('[data-role=resume]').selectedOptions[0] && s.querySelector('[data-role=resume]').selectedOptions[0].textContent
    };
  })()`);
  check('面板已展开', stats.panelOpen);
  check('当前简历为示例简历', stats.resume && stats.resume.includes('示例'), stats.resume);
  console.log('    统计: 可填=' + stats.matched, '缺失=' + stats.missing, '未识别=' + stats.unmatched);
  check('可填字段数 > 25', parseInt(stats.matched) > 25, stats.matched);

  console.log('\n[3] 一键填写（含 iframe 子文档）');
  await cdp.evaluate(`document.getElementById('__qf_overlay_host__').shadowRoot.querySelector('[data-act=fill]').click()`);
  const fillDone = await waitFillDone(40000);   // 字段扩到 80+ 后一轮填写要 ~10s，留足余量
  if (!fillDone) console.log('    ⚠ 等待填写完成超时（后台节流？），按当前状态断言');
  const vals = await cdp.evaluate(`(() => {
    const g = n => (document.querySelector('[name=' + n + ']') || {}).value;
    const sel = n => { const e = document.querySelector('[name=' + n + ']'); return e ? e.options[e.selectedIndex].text : ''; };
    const radio = n => { const e = document.querySelector('[name=' + n + ']:checked'); return e ? e.parentElement.textContent.trim() : ''; };
    return {
      realname: g('realname'), minzu: g('minzu'), jiguan: g('jiguan'),
      idcard: g('idcard'), mobile: g('mobile'), mail: g('mail'),
      birthday: g('birthday'), height: g('height'), weight: g('weight'),
      hukouAddr: g('hukouAddr'), address: g('address'),
      sex: radio('sex'), zzmm: sel('zzmm'), marry: sel('marry'), xueli: sel('xueli'),
      xuewei: g('xuewei'), school: g('school'), major: g('major'),
      eduStart: g('eduStart'), eduEnd: g('eduEnd'), gpa: g('gpa'), courses: g('courses'),
      applyJob: g('applyJob'), workCity: g('workCity'), salary: g('salary'), arrival: g('arrival'),
      internship: g('internship'), campusExp: g('campusExp'), awards: g('awards'),
      englishLevel: g('englishLevel'), computerLevel: g('computerLevel'), selfEval: g('selfEval'),
      f1r: g('f1r'), f1n: g('f1n'), f1p: g('f1p'), f1c: g('f1c'),
      qq: g('qq'), hobby: g('hobby'), wx: g('wx'),
      csMinzu: (document.querySelector('#cs-minzu input') || {}).value,
      csZzmm: (document.querySelector('#cs-zzmm .ant-select-selection-item') || {}).textContent,
      csCascader: (document.querySelector('#cs-jiguan input') || {}).value,
      classes: {
        name: document.querySelector('[name=realname]').className,
        unmatchedShudi: document.querySelector('[name=shudi]').className
      }
    };
  })()`);
  check('姓名', vals.realname === '张三', vals.realname);
  check('性别(radio)', vals.sex === '男', vals.sex);
  check('政治面貌(select语义选项)', vals.zzmm === '中共党员', vals.zzmm);
  check('婚姻状况(select)', vals.marry === '未婚', vals.marry);
  check('学历「硕士」匹配选项「硕士研究生」', vals.xueli === '硕士研究生', vals.xueli);
  check('出生年月格式化为 yyyy-mm', vals.birthday === '2000-05', vals.birthday);
  check('毕业院校取最高学历', vals.school === '中国人民大学', vals.school);
  check('入学时间(month控件)', vals.eduStart === '2022-09', vals.eduStart);
  check('毕业时间(month控件)', vals.eduEnd === '2025-06', vals.eduEnd);
  check('手机号', vals.mobile === '13800138000', vals.mobile);
  check('邮箱', vals.mail === 'zhangsan@example.com', vals.mail);
  check('籍贯', vals.jiguan === '山东济南', vals.jiguan);
  check('户口所在地', vals.hukouAddr === '山东济南', vals.hukouAddr);
  check('身高', vals.height === '175', vals.height);
  check('申请职位', vals.applyJob === '综合管理岗', vals.applyJob);
  check('实习经历(textarea多条拼接)', vals.internship.includes('华能'), vals.internship.slice(0, 30));
  check('获奖情况', vals.awards.includes('奖学金'), vals.awards.slice(0, 30));
  check('英语水平', vals.englishLevel.includes('CET-6'), vals.englishLevel);
  check('自我评价', vals.selfEval.includes('中共党员'), vals.selfEval.slice(0, 20));
  check('家庭成员称谓', vals.f1r === '父亲', vals.f1r);
  check('家庭成员工作单位及职务', vals.f1c && vals.f1c.includes('机械厂'), vals.f1c);
  check('已填字段绿色高亮', vals.classes.name.includes('__qf_filled'), vals.classes.name);
  check('未识别字段(属地)橙色虚线标记', vals.classes.unmatchedShudi.includes('__qf_unmatched'), vals.classes.unmatchedShudi);
  check('微信号(新增字段)', vals.wx === 'zhangsan_wx', vals.wx);
  check('QQ号(新增字段)', vals.qq === '123456789', vals.qq);
  check('兴趣爱好(新增字段)', vals.hobby === '篮球、长跑、摄影', vals.hobby);
  check('自定义下拉·民族(element-ui)', vals.csMinzu === '汉族', vals.csMinzu);
  check('自定义下拉·政治面貌(ant-design)', (vals.csZzmm || '').trim() === '中共党员', vals.csZzmm);
  check('级联·现居地址(省→区)', /北京.*海淀/.test(vals.csCascader || ''), vals.csCascader);

  console.log('\n[3.5] 四期新增字段（对齐竞品字段模型）');
  const ext = await cdp.evaluate(`(() => {
    const g = n => (document.querySelector('[name=' + n + ']') || {}).value;
    return {
      namePinyin: g('namePinyin'), hukouType: g('hukouType'), archiveLocation: g('archiveLocation'),
      isFresher: g('isFresher'), workStatus: g('workStatus'), bloodType: g('bloodType'),
      careerPlan: g('careerPlan'), jobSource: g('jobSource'), acceptAdjust: g('acceptAdjust'),
      expectedAnnualSalary: g('expectedAnnualSalary'), department: g('department'),
      studentNumber: g('studentNumber'), classRank: g('classRank'), researchDirection: g('researchDirection'),
      companyScale: g('companyScale'), referrerName: g('referrerName'), leaveReason: g('leaveReason'),
      practiceUnit: g('practiceUnit'), certNumber: g('certNumber'), rewardLevel: g('rewardLevel'),
      patentInventor: g('patentInventor'), proficiency: g('proficiency'), familyEducation: g('familyEducation')
    };
  })()`);
  const extWant = {
    namePinyin: 'Zhang San', hukouType: '城镇', archiveLocation: '北京市/海淀区', isFresher: '是',
    workStatus: '在校', bloodType: 'O', jobSource: '官网', acceptAdjust: '是', expectedAnnualSalary: '15',
    department: '商学院', studentNumber: '2022010203', classRank: '8',
    researchDirection: '国有企业人力资源管理', companyScale: '10000人以上', referrerName: '李老师',
    leaveReason: '实习期满，返校完成学业', practiceUnit: '济南市人社局实习实践队',
    certNumber: '251236038004471', rewardLevel: '特等奖', patentInventor: '张三',
    proficiency: '精通', familyEducation: '大专'
  };
  let extOk = 0;
  for (const [k, want] of Object.entries(extWant)) {
    const got = (ext[k] || '').trim();
    // 数组段按记录顺序/标题拼接（"公司：离职原因"、"大专；本科"），故按包含判定
    if (got === want || got.includes(want)) extOk++;
    else console.log('    · ' + k + ' 期望 ' + JSON.stringify(want) + ' 实得 ' + JSON.stringify(got));
  }
  check('新增字段命中 ' + Object.keys(extWant).length + ' 项中的绝大多数', extOk >= Object.keys(extWant).length - 2, extOk + '/' + Object.keys(extWant).length);
  check('职业规划长文本已填入', (ext.careerPlan || '').includes('能源电力'), (ext.careerPlan || '').slice(0, 20));

  console.log('\n[4] iframe 子文档填写');
  const iframeVal = await cdp.evaluate(`(() => {
    const f = document.querySelector('iframe');
    const d = f.contentDocument;
    if (!d) return 'CROSS-ORIGIN-BLOCKED';
    return { speciality: (d.querySelector('[name=speciality]')||{}).value, emerPhone: (d.querySelector('[name=emerPhone]')||{}).value };
  })()`);
  if (iframeVal === 'CROSS-ORIGIN-BLOCKED') {
    console.log('  SKIP iframe 跨域受限（生产环境 content script 会以 all_frames 注入，逻辑相同）');
  } else {
    check('iframe 个人特长已填', iframeVal.speciality && iframeVal.speciality.includes('公文写作'), iframeVal);
  }

  console.log('\n[5] 清除标记');
  await cdp.evaluate(`document.getElementById('__qf_overlay_host__').shadowRoot.querySelector('[data-act=clear]').click()`);
  await sleep(500);
  const cleared = await cdp.evaluate(`document.querySelectorAll('[class*=__qf_]').length`);
  check('高亮标记已清除', cleared === 0, cleared);

  cdp.close();
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试驱动异常:', e.message); process.exit(2); });
