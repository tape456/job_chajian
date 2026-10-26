// 常驻悬浮球、复刻式操作面板、进度窗口与辅助工具。所有 UI 隔离在 Shadow DOM 内。
// 依赖：无（可最先加载；位置持久化直写 chrome.storage.local，不经 ResumeStore）。
(function (root) {
  'use strict';

  // 已注入过就保留原实例：重复执行会让旧宿主失联（页面上出现"点不开的球"）。
  if (root.QuickFillOverlay) return;

  // ---------------- 设计令牌与样式（视觉基准：cv.playoffer.cn 来个简历闪填） ----------------
  const TOKENS = `
    :host { all: initial;
      --qf-brand:#1565FF; --qf-brand-2:#4A8DFF; --qf-brand-deep:#0F52D9;
      --qf-brand-grad: linear-gradient(135deg, var(--qf-brand), var(--qf-brand-2));
      --qf-ok:#16A34A; --qf-ok-2:#22C55E; --qf-ok-grad: linear-gradient(90deg, #1565FF, #22C55E);
      --qf-primary:var(--qf-brand); --qf-primary-hover:var(--qf-brand-deep);
      --qf-t1:#0B1B33; --qf-t2:#475569; --qf-t3:#94A3B8;
      --qf-bg:#F7FAFF; --qf-bg-soft:#EFF5FF; --qf-border:#E3EBF7; --qf-border-2:#CFE0FA;
      --qf-glass: rgba(255,255,255,.78); --qf-glass-tint: rgba(239,245,255,.34);
      --qf-r-lg:18px; --qf-r-md:12px; --qf-r-sm:9px; --qf-r-pill:999px;
      --qf-sp-panel:0 18px 44px rgba(11,27,51,.16), 0 2px 6px rgba(11,27,51,.06);
      --qf-sp-ball:0 10px 26px rgba(21,101,255,.42);
      --qf-warn:#D97706; --qf-bad:#DC2626;
      --qf-ease: cubic-bezier(.22,.61,.36,1);
      --qf-ease-spring: cubic-bezier(.34,1.56,.64,1);
      --qf-dur: 200ms;
    }`;
  const BASE = `
    * { box-sizing: border-box; font-family: "PingFang SC", "SF Pro Text", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif; }
    button, select, input, textarea { font: inherit; }
    button { cursor: pointer; border: none; background: none; color: inherit; }
    button:focus-visible, .qf-chip:focus-visible, .qf-select:focus-visible, input:focus-visible, textarea:focus-visible {
      outline: 2px solid var(--qf-brand-2); outline-offset: 2px; }
    .qf-hidden { display: none !important; }`;
  const BALL = `
    /* 悬浮球吸附在浏览器右边框：横向锁死（right:0），只允许沿边框上下滑动 */
    .qf-ball { position: fixed; right: 0; bottom: 78px; z-index: 2147483000;
      width: 54px; height: 54px; border-radius: 27px 0 0 27px; display: grid; place-items: center;
      color: #fff; background: var(--qf-brand-grad); box-shadow: var(--qf-sp-ball);
      border: 2px solid rgba(255,255,255,.72); border-right: none;
      user-select: none; touch-action: none; cursor: pointer;
      transition: transform .18s var(--qf-ease), box-shadow .25s;
      animation: qf-pop-in .5s var(--qf-ease-spring); }
    .qf-ball::before { content: ''; position: absolute; inset: -9px -4px -9px -9px; border-radius: inherit; pointer-events: none;
      background: radial-gradient(circle, transparent 74%, rgba(21,101,255,.42) 80%, rgba(21,101,255,0) 96%);
      animation: qf-halo 3.4s ease-in-out infinite; }
    .qf-ball:hover { transform: translateX(-4px) scale(1.04); box-shadow: -10px 0 26px rgba(21,101,255,.5); }
    .qf-ball:not(.dragging):active { transform: translateX(-4px) scale(.94); cursor: grabbing; }
    .qf-ball.dragging { transition: none; cursor: grabbing; }
    .qf-ball.dragging::before { animation-play-state: paused; }
    .qf-ball .icon { font-size: 24px; line-height: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,.28)); pointer-events: none; }
    @keyframes qf-pop-in { from { opacity: 0; transform: scale(.3); } 70% { opacity: 1; transform: scale(1.08); } to { transform: scale(1); } }
    @keyframes qf-halo { 0%,100% { opacity: .35; transform: scale(1); } 50% { opacity: .9; transform: scale(1.07); } }
    .qf-mini { position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 2147483000;
      width: 28px; height: 54px; border-radius: var(--qf-r-pill) 0 0 var(--qf-r-pill); background: var(--qf-brand-grad); color: #fff;
      display: grid; place-items: center; font-size: 15px; cursor: pointer; opacity: .92;
      box-shadow: -2px 0 12px rgba(21,101,255,.35); transition: width .18s var(--qf-ease), opacity .18s, transform .12s; }
    .qf-mini:hover { width: 34px; opacity: 1; }
    .qf-mini:active { transform: translateY(-50%) scale(.93); }`;
  const PANEL = `
    .qf-panel { position: fixed; z-index: 2147483001; right: 20px; bottom: 145px;
      width: 320px; max-width: calc(100vw - 16px); max-height: min(85vh, 660px);
      display: flex; flex-direction: column; color: var(--qf-t1); border-radius: var(--qf-r-lg);
      background: var(--qf-glass); box-shadow: var(--qf-sp-panel); border: 1px solid var(--qf-border);
      -webkit-backdrop-filter: blur(18px) saturate(1.35); backdrop-filter: blur(18px) saturate(1.35);
      overflow: hidden; font-size: 12px;
      transform-origin: 100% 100%; animation: qf-panel-in .24s var(--qf-ease) both; }
    /* 不支持背景模糊的浏览器退回接近不透明，避免文字压在花哨页面上不可读 */
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .qf-panel { background: rgba(255,255,255,.97); }
    }
    .qf-panel.qf-out { animation: qf-panel-out .18s ease-in both; pointer-events: none; }
    @keyframes qf-panel-in { from { opacity: 0; transform: translateY(12px) scale(.96); } }
    @keyframes qf-panel-out { to { opacity: 0; transform: translateY(10px) scale(.96); } }
    .qf-head { padding: 11px 13px; color: #fff; background: var(--qf-brand-grad);
      display: flex; align-items: center; gap: 9px; }
    .qf-head .symbol { width: 26px; height: 26px; border-radius: 9px; background: rgba(255,255,255,.22);
      display: grid; place-items: center; font-size: 14px; font-weight: 800; }
    .qf-head .t { flex: 1; font-size: 13.5px; font-weight: 700; line-height: 1.25; letter-spacing: .2px; }
    .qf-head .t small { display: block; font-size: 10px; font-weight: 400; color: #e8f0ff; letter-spacing: .3px; }
    .qf-head button { width: 24px; height: 24px; border-radius: var(--qf-r-pill); background: rgba(255,255,255,.18); color: #fff; font-size: 14px;
      transition: background .15s, transform .12s var(--qf-ease); }
    .qf-head button:hover { background: rgba(255,255,255,.34); }
    .qf-head button:active { transform: scale(.86); }
    .qf-hero { padding: 12px 13px 10px; background:
      radial-gradient(120% 90% at 0% 0%, rgba(21,101,255,.10), rgba(255,255,255,0) 62%);
      border-bottom: 1px solid var(--qf-border); }
    .qf-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: var(--qf-r-pill);
      background: var(--qf-bg-soft); border: 1px solid var(--qf-border-2); color: var(--qf-brand); font-size: 10.5px; font-weight: 700; }
    .qf-hero .h1 { margin: 8px 0 2px; font-size: 17px; font-weight: 800; letter-spacing: -.3px; color: var(--qf-t1); }
    .qf-hero .h2 { margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--qf-brand); font-weight: 600; }
    .qf-hero .h2 em { font-style: normal; color: var(--qf-t2); font-weight: 400; }
    /* 球位置较高、面板被压扁时：收起宣传区，优先保证操作按钮可见 */
    .qf-panel.qf-compact .qf-hero { display: none; }
    .qf-body { padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; background: var(--qf-glass-tint); }
    .qf-lead { text-align: center; color: var(--qf-t2); margin: 0; font-size: 12px; }
    .qf-main-actions { display: grid; gap: 8px; }
    .qf-btn { border: 1px solid var(--qf-border-2); color: #2f4c78; background: #fff;
      padding: 9px 12px; border-radius: var(--qf-r-pill); font-weight: 600;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      transition: background .15s, box-shadow .2s, transform .12s var(--qf-ease); }
    .qf-btn:hover { background: var(--qf-bg-soft); }
    .qf-btn:active { transform: scale(.96); }
    .qf-btn.primary { color: #fff; background: var(--qf-brand-grad); border-color: transparent;
      box-shadow: 0 8px 20px rgba(21,101,255,.26); }
    .qf-btn.primary:hover { background: linear-gradient(135deg, var(--qf-brand-deep), var(--qf-brand));
      transform: translateY(-1px); box-shadow: 0 10px 24px rgba(21,101,255,.32); }
    .qf-btn.primary:active { transform: translateY(0) scale(.97); }
    .qf-btn.ghost { color: var(--qf-brand); background: #fff; border-color: var(--qf-border-2); }
    .qf-btn.ghost:hover { background: var(--qf-bg-soft); }
    .qf-btn.pale { background: var(--qf-bg-soft); border-color: var(--qf-border); color: #2b5aa5; }
    .qf-btn.pale:hover { background: #e3eeff; }
    .qf-btn.danger { color: var(--qf-bad); border-color: #FBD5D0; background: #FFF5F4; box-shadow: none; }
    .qf-btn.danger:hover { background: #ffeae7; }
    .qf-btn:disabled { opacity: .55; cursor: wait; }
    .qf-btn.is-loading { pointer-events: none; }
    .qf-btn.is-loading::before { content: ''; width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.45); border-top-color: #fff;
      display: inline-block; margin-right: 7px; vertical-align: -2px;
      animation: qf-spin .7s linear infinite; }
    @keyframes qf-spin { to { transform: rotate(360deg); } }
    .qf-main-actions .qf-btn { width: 100%; font-size: 13px; padding: 11px; }
    .qf-main-actions .qf-btn .sub { display: block; font-size: 10px; font-weight: 400; opacity: .82; }
    .qf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .qf-grid .qf-btn { font-size: 11.5px; padding: 8px 6px; }
    .qf-more-toggle { text-align: center; color: var(--qf-t2); font-size: 11px; padding: 3px;
      transition: color .15s; }
    .qf-more-toggle:hover { color: var(--qf-primary); }
    .qf-more-toggle .arr { display: inline-block; transition: transform .22s var(--qf-ease); }
    .qf-more-toggle.open .arr { transform: rotate(180deg); }
    .qf-more { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .26s var(--qf-ease); }
    .qf-more.qf-collapsed { grid-template-rows: 0fr; }
    .qf-more-inner { min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 9px; }
    .qf-row { display: flex; align-items: center; gap: 7px; }
    .qf-row label { white-space: nowrap; color: var(--qf-t2); }
    .qf-select { flex: 1; min-width: 0; padding: 6px 9px; border: 1px solid var(--qf-border-2); border-radius: var(--qf-r-pill); background: #fff; color: #263a5b; }
    .qf-note { margin: 0; padding: 8px 10px; background: var(--qf-bg-soft); color: #4c6585;
      border: 1px solid #e0ebfb; border-radius: var(--qf-r-md); line-height: 1.5; }
    .qf-note.warning { background: #FFF7E9; border-color: #ffe1a8; color: #925b12; }
    .qf-stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; }
    .qf-stat { text-align: center; background: #fff; border: 1px solid var(--qf-border); border-radius: var(--qf-r-md); padding: 6px 4px; }
    .qf-stat b { display: block; color: var(--qf-brand); font-size: 16px; line-height: 1.2; }
    .qf-stat b.pulse { animation: qf-num .32s var(--qf-ease-spring); }
    .qf-stat span { color: var(--qf-t3); font-size: 10px; }
    .qf-stat.miss b { color: var(--qf-bad); } .qf-stat.unk b { color: var(--qf-warn); }
    @keyframes qf-num { 0% { transform: scale(1); } 45% { transform: scale(1.35); } 100% { transform: scale(1); } }
    .qf-list { max-height: 132px; overflow-y: auto; background: #fff; border: 1px solid var(--qf-border);
      border-radius: var(--qf-r-md); padding: 4px; }
    .qf-list .li { padding: 4px 6px; display: flex; gap: 5px; align-items: center; cursor: pointer; border-radius: 6px;
      transition: background .12s; }
    .qf-list .li:hover { background: var(--qf-bg-soft); }
    .qf-list .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--qf-warn); }
    .qf-list .dot.ok { background: var(--qf-ok); } .qf-list .dot.miss { background: var(--qf-bad); }
    .qf-list .lab { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qf-list .val { margin-left: auto; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8b98aa; }
    .qf-list .more, .qf-empty { text-align: center; color: #8995a7; padding: 6px; font-size: 11px; }
    .qf-ai-tag { font-size: 10px; color: #6545d4; }
    .qf-tool-card { display: flex; align-items: center; gap: 8px; border: 1px solid var(--qf-border-2);
      border-radius: var(--qf-r-pill); padding: 9px 12px; background: #fff; cursor: pointer; text-align: left; width: 100%;
      transition: background .15s, border-color .15s, transform .12s var(--qf-ease); }
    .qf-tool-card:hover { background: var(--qf-bg-soft); }
    .qf-tool-card:active { transform: scale(.98); }
    .qf-tool-card .tc-title { font-weight: 700; color: var(--qf-t1); }
    .qf-tool-card .tc-sub { flex: 1; color: var(--qf-t3); font-size: 11px; }
    .qf-tool-card .tc-arrow { color: var(--qf-t3); font-size: 16px; transition: transform .18s var(--qf-ease); }
    .qf-tool-card:hover .tc-arrow { transform: translateX(3px); color: var(--qf-primary); }
    .qf-foot { border-top: 1px solid var(--qf-border); padding: 8px 12px; text-align: center; background: transparent; }
    .qf-foot a { color: var(--qf-t3); cursor: pointer; text-decoration: none; font-size: 11px; }
    .qf-foot a:hover { color: var(--qf-primary); }`;
  const SELECT = `
    /* 层级低于悬浮球：框选期间仍能点球中止（以前 2147483400 盖住球，只能靠 Esc） */
    .qf-select-mask { position: fixed; inset: 0; z-index: 2147482900; cursor: crosshair;
      background: rgba(9,26,58,.07); touch-action: none; animation: qf-fade .15s ease-out both; }
    .qf-select-tip { position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      max-width: calc(100vw - 24px); padding: 9px 18px; border-radius: 999px; color: #fff; font-size: 12.5px;
      background: linear-gradient(135deg, #1565FF, #4A8DFF); box-shadow: 0 8px 24px rgba(21,101,255,.36);
      pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .qf-selection { position: fixed; border: 2px dashed #1565FF; border-radius: 8px;
      background: rgba(21,101,255,.10); box-shadow: 0 0 0 9999px rgba(9,26,58,.06); pointer-events: none; }`;
  const DIALOG = `
    .qf-shade { position: fixed; inset: 0; z-index: 2147483500; display: grid; place-items: center; background: #0c204d70;
      animation: qf-fade .18s ease-out both; }
    .qf-dialog { width: min(420px, calc(100vw - 32px)); max-height: min(86vh, 760px); overflow: auto;
      background: #fff; color: var(--qf-t1); padding: 18px; box-shadow: 0 20px 55px #10295655;
      border-radius: var(--qf-r-lg); font-size: 13px;
      animation: qf-rise .26s var(--qf-ease) both; }
    @keyframes qf-fade { from { opacity: 0; } }
    @keyframes qf-rise { from { opacity: 0; transform: translateY(14px) scale(.98); } }
    .qf-dialog h3 { margin: 0 0 4px; text-align: center; font-size: 16px; }
    .qf-dialog .qf-sub { text-align: center; color: var(--qf-t3); font-size: 11.5px; margin: 0 0 12px; }
    .qf-dialog p { line-height: 1.6; margin: 7px 0; color: var(--qf-t2); }
    .qf-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .qf-dialog-actions .qf-btn { min-width: 84px; }
    .qf-dialog input[type=text], .qf-dialog textarea { width: 100%; padding: 8px; border: 1px solid #cad8ee;
      border-radius: 7px; color: var(--qf-t1); background: #fff; resize: vertical; }
    .qf-dialog input[readonly] { background: #f5f8fc; color: var(--qf-t2); }
    .qf-dialog label.qf-fl { display: block; margin: 10px 0 4px; color: var(--qf-t2); font-size: 11.5px; }
    .qf-rk { width: min(580px, calc(100vw - 28px)); }
    .qf-rk-cols { display: grid; grid-template-columns: 134px 1fr; gap: 10px; }
    .qf-rk-modules { display: flex; flex-direction: column; gap: 3px; max-height: 250px; overflow-y: auto;
      border: 1px solid var(--qf-border); border-radius: var(--qf-r-sm); padding: 5px; }
    .qf-rk-mod { display: flex; align-items: center; gap: 6px; padding: 6px 7px; border-radius: 6px;
      font-size: 12px; color: var(--qf-t1); text-align: left; width: 100%; }
    .qf-rk-mod:hover { background: #f2f7ff; }
    .qf-rk-mod.on { background: var(--qf-bg-soft); color: var(--qf-primary); font-weight: 700; }
    .qf-rk-mod .mk { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qf-rk-mod .ck { color: var(--qf-primary); }
    .qf-rk-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .qf-rk-preview { min-height: 66px; border: 1px dashed #98bbed; background: #f7fbff; border-radius: var(--qf-r-sm);
      padding: 9px; display: flex; flex-wrap: wrap; gap: 4px; align-content: flex-start; }
    .qf-rk-preview .ph { color: var(--qf-t3); font-size: 11.5px; }
    .qf-rk-fchip { background: #e8f1ff; color: #2b5aa5; border-radius: 5px; padding: 2px 6px; font-size: 11px; }
    .qf-rk-items { border: 1px solid var(--qf-border); border-radius: var(--qf-r-sm); max-height: 138px; overflow-y: auto; }
    .qf-rk-item { display: flex; align-items: center; gap: 8px; padding: 9px 10px; font-size: 12px; border-bottom: 1px solid #eef3fb; cursor: pointer; }
    .qf-rk-item:last-child { border-bottom: none; }
    .qf-rk-item:hover { background: #f7faff; }
    .qf-rk-item.on { background: var(--qf-bg-soft); color: var(--qf-primary); font-weight: 700; }
    .qf-rk-item .lb { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qf-rk-item .ck { color: var(--qf-primary); }
    .qf-rk-empty { padding: 12px; text-align: center; color: var(--qf-t3); font-size: 11.5px; }
    .qf-warn-bar { margin-top: 9px; padding: 8px 10px; background: #fff7e8; border: 1px solid #ffe0a6;
      color: #8a5a10; border-radius: var(--qf-r-sm); font-size: 11.5px; line-height: 1.5; }`;
  const PROGRESS = `
    .qf-progress-symbol { width: 54px; height: 54px; margin: 0 auto; border-radius: 50%; display: grid; place-items: center;
      background: var(--qf-brand-grad); color: #fff; font-size: 24px; box-shadow: 0 10px 24px rgba(21,101,255,.32); }
    .qf-progress-symbol .lens { font-size: 15px; margin-left: -3px; }
    .qf-dialog.is-busy .qf-progress-symbol { animation: qf-pulse 1.6s ease-in-out infinite; }
    @keyframes qf-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.07); } }
    .qf-progress-track { height: 8px; border-radius: var(--qf-r-pill); background: #EAF0FA; overflow: hidden; margin: 16px 0 10px; }
    .qf-progress-fill { height: 100%; width: 4%; border-radius: var(--qf-r-pill); position: relative; overflow: hidden;
      background: var(--qf-ok-grad); transition: width .3s ease; }
    .qf-dialog.is-busy .qf-progress-fill::after { content: ''; position: absolute; inset: 0;
      background: linear-gradient(100deg, transparent 32%, rgba(255,255,255,.55) 50%, transparent 68%);
      transform: translateX(-100%); animation: qf-shimmer 1.2s ease-in-out infinite; }
    @keyframes qf-shimmer { to { transform: translateX(100%); } }
    .qf-steps { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--qf-t3); }
    .qf-steps span { flex: 1; text-align: center; padding: 5px 2px; border-radius: var(--qf-r-pill);
      background: #F3F7FE; border: 1px solid var(--qf-border); transition: all .2s; }
    .qf-steps .on { color: #fff; font-weight: 700; background: var(--qf-brand-grad); border-color: transparent;
      box-shadow: 0 6px 14px rgba(21,101,255,.26); }
    .qf-steps .done { color: var(--qf-ok); background: #ECFDF3; border-color: #cdeeda; }
    .qf-progress-count { text-align: center; font-weight: 700; color: var(--qf-brand); margin: 10px 0 0; min-height: 1em; font-size: 13px; }
    .qf-progress-comment { text-align: center; color: var(--qf-t3); font-size: 11px; margin: 8px 0 0; }
    .qf-done-ask { text-align: center; color: var(--qf-t2); margin: 14px 0 0; }
    .qf-done-ask .qf-btn { padding: 6px 16px; margin: 0 4px; display: inline-flex; }`;
  const HELPER = `
    .qf-helper { position: fixed; z-index: 2147483200; top: 12vh; left: 16px;
      width: min(340px, calc(100vw - 25px)); max-height: 72vh; display: flex; flex-direction: column;
      background: #fff; color: var(--qf-t1); border: 1px solid #cbdaf5; border-radius: var(--qf-r-lg);
      box-shadow: 0 12px 32px #173f8644; font-size: 12px; overflow: hidden;
      animation: qf-rise .26s var(--qf-ease) both; }
    .qf-helper-head { display: flex; align-items: center; gap: 8px; padding: 10px 11px;
      background: var(--qf-brand-grad); color: #fff; font-weight: 700; }
    .qf-helper-head .cnt { font-size: 11px; font-weight: 400; color: #e9f3ff; }
    .qf-helper-head .grow { flex: 1; }
    .qf-helper-head button { width: 22px; height: 22px; border-radius: 5px; background: rgba(255,255,255,.2); color: #fff; font-size: 14px; }
    .qf-helper-head button:hover { background: rgba(255,255,255,.38); }
    .qf-helper-tip { padding: 8px 11px; background: var(--qf-bg-soft); color: #567093;
      line-height: 1.45; overflow-wrap: anywhere; font-size: 11px; }
    .qf-helper-tip.on { background: #e9f7f0; color: #1a7a4f; }
    .qf-helper-search { margin: 9px 10px 0; padding: 8px; border: 1px solid #d3dfed; border-radius: 6px; }
    .qf-helper-content { overflow-y: auto; padding: 4px 10px 10px; }
    .qf-helper-content h4 { margin: 10px 0 4px; color: #59718d; font-size: 11px; display: flex; gap: 6px; }
    .qf-helper-content h4 .n { color: var(--qf-t3); font-weight: 400; }
    .qf-chip { display: inline-block; margin: 3px 3px 0 0; background: #f5f9ff; border: 1px solid #cddcf4;
      color: #285485; border-radius: 5px; padding: 5px 7px; font-size: 11px; max-width: 100%;
      transition: background .14s, border-color .14s, transform .12s var(--qf-ease); }
    .qf-chip:hover { background: #e8f1ff; }
    .qf-chip:active { transform: scale(.95); }
    .qf-chip.selected { background: var(--qf-primary); border-color: var(--qf-primary); color: #fff;
      animation: qf-chip-pick .25s var(--qf-ease-spring); }
    @keyframes qf-chip-pick { 45% { transform: scale(1.07); } }
    .qf-helper-foot { border-top: 1px solid #e7edf7; padding: 8px 10px; text-align: right; background: #f9fbff; }
    .qf-helper-foot button { color: var(--qf-t2); font-size: 11px; }
    .qf-helper-foot button:hover { color: var(--qf-bad); }`;
  const JOBS = `
    .qf-jobs { width: min(460px, calc(100vw - 30px)); }
    .qf-jobs-filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 10px; }
    .qf-jobs-filter { font-size: 11px; padding: 3px 9px; border-radius: var(--qf-r-pill);
      border: 1px solid var(--qf-border-2); background: #fff; color: var(--qf-t2); cursor: pointer; }
    .qf-jobs-filter.on { background: var(--qf-brand-grad); border-color: transparent; color: #fff; }
    .qf-jobs-filter .n { opacity: .8; margin-left: 3px; }
    .qf-jobs-list { max-height: 300px; overflow-y: auto; border: 1px solid var(--qf-border); border-radius: var(--qf-r-sm); }
    .qf-job { display: flex; gap: 8px; align-items: flex-start; padding: 9px 10px; border-bottom: 1px solid #eef3fb; }
    .qf-job:last-child { border-bottom: none; }
    .qf-job .info { flex: 1; min-width: 0; }
    .qf-job .top { display: flex; align-items: center; gap: 6px; }
    .qf-job .ti { flex: 1; min-width: 0; font-weight: 600; color: var(--qf-t1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qf-job .st-sel { flex: none; font-size: 11px; padding: 2px 4px; border-radius: var(--qf-r-pill);
      border: 1px solid var(--qf-border-2); background: #fff; color: var(--qf-t1); cursor: pointer; }
    .qf-job .st-sel.st-offer { color: #15803d; border-color: #c7f0d8; background: #ecfdf3; }
    .qf-job .st-sel.st-interview { color: #7c3aed; border-color: #e0d4ff; background: #f5f0ff; }
    .qf-job .st-sel.st-written { color: #b45309; border-color: #ffe0a6; background: #fff7e8; }
    .qf-job .st-sel.st-closed { color: #64748b; background: #f4f6fa; }
    .qf-job .meta { color: var(--qf-t3); font-size: 11px; margin-top: 2px; overflow-wrap: anywhere; }
    .qf-job .note { color: var(--qf-t2); font-size: 11.5px; margin-top: 3px; overflow-wrap: anywhere; }
    .qf-job .del { color: var(--qf-t3); font-size: 16px; padding: 0 4px; line-height: 1; }
    .qf-job .del:hover { color: var(--qf-bad); }`;
  const TOAST = `
    .qf-toast { position: fixed; z-index: 2147483646; right: 18px; bottom: 22px; max-width: 360px;
      border-radius: 9px; color: #fff; background: #264379; box-shadow: 0 6px 25px #152f4d66;
      padding: 10px 14px; line-height: 1.5; font-size: 12px; overflow-wrap: anywhere;
      animation: qf-toast-in .28s var(--qf-ease-spring) both; }
    .qf-toast.qf-out { animation: qf-toast-out .18s ease-in both; }
    .qf-toast-ok { background: #14603a; }
    .qf-toast-warn { background: #7d4f06; }
    .qf-toast-danger { background: #8c1d18; }
    @keyframes qf-toast-in { from { opacity: 0; transform: translateY(14px) scale(.97); } }
    @keyframes qf-toast-out { to { opacity: 0; transform: translateY(10px); } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    }`;
  const STYLE = [TOKENS, BASE, BALL, PANEL, SELECT, DIALOG, PROGRESS, HELPER, JOBS, TOAST].join('\n');

  const POS_KEY = 'qfBallPosition';
  // 投递状态（与 lib/storage.js 的 JOB_STATUS 保持一致；overlay 先加载，不能反向引用）
  const JOB_STATUSES = [
    { key: 'applied', label: '已投递' },
    { key: 'written', label: '笔试' },
    { key: 'interview', label: '面试' },
    { key: 'offer', label: 'Offer' },
    { key: 'closed', label: '已结束' }
  ];
  const HELPER_TIP = '第一步：点击字段按钮；第二步：在网页中点击要填写的输入框。';

  let host, shadow, ui = {}, handlers = {};
  let dragState, selectMask, selectionCallback, toastTimer, toastOutTimer, panelAnimTimer, savePosTimer, watchdogTimer, removalObserver, miniEl;
  let miniTop = NaN;   // 隐藏球时记下球的中心高度，让边缘恢复把手出现在同一位置
  let helperWait = null;

  function node(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // ---------------- 挂载与自愈 ----------------
  function mount(h) {
    handlers = h || handlers;
    if (!host || !host.isConnected) buildUI();
    placeHost();
    ensureWatchdog();
    return api;
  }

  function buildUI() {
    ui = {};
    // 扩展重载后旧 world 的宿主会失效并留下"点不开的球"：先清掉页面上所有旧宿主
    let stale = 0;
    try {
      document.querySelectorAll('#__qf_overlay_host__').forEach(el => { stale++; el.remove(); });
    } catch (e) {}
    if (stale) setTimeout(() => toast('检测到旧版悬浮球残留（扩展刚更新过），刷新页面即可清理。'), 900);
    host = node('div'); host.id = '__qf_overlay_host__';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(node('style', '', STYLE));
    buildBall();
    buildPanel();
    const toastEl = node('div', 'qf-toast qf-hidden');
    shadow.appendChild(toastEl); ui.toast = toastEl;
  }

  // 扩展被重载/卸载后，本 world 的 chrome API 全部失效，此时必须主动消失，让新脚本接管。
  // 连续两次探测失败才拆台，避免偶发的 undefined 把正常的球弄没。
  let deadChecks = 0;
  function isContextAlive() { try { return !!(window.chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; } }
  function contextLooksDead() {
    if (isContextAlive()) { deadChecks = 0; return false; }
    return ++deadChecks >= 2;
  }
  function teardown() {
    try { if (watchdogTimer) clearInterval(watchdogTimer); } catch (e) {}
    watchdogTimer = null;
    try { if (removalObserver) removalObserver.disconnect(); } catch (e) {}
    removalObserver = null;
    try { if (host) host.remove(); } catch (e) {}
    host = null; shadow = null; ui = {};
  }

  function placeHost() {
    if (!host || host.isConnected) return;
    if (!isContextAlive()) return;   // 扩展已重载：孤儿脚本不再把宿主塞回页面，交给新脚本
    if (document.body) { document.body.appendChild(host); return; }
    // body 尚未就绪：先挂 documentElement，等 body 出现再迁入
    try { document.documentElement.appendChild(host); } catch (e) {}
    const mo = new MutationObserver(() => {
      if (document.body && host && host.parentNode !== document.body) document.body.appendChild(host);
    });
    try { mo.observe(document.documentElement, { childList: true }); } catch (e) {}
    setTimeout(() => { try { mo.disconnect(); } catch (e) {} }, 15000);
  }

  function ensureWatchdog() {
    if (!removalObserver && document.documentElement) {
      removalObserver = new MutationObserver(() => { if (host && !host.isConnected) placeHost(); });
      try { removalObserver.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    }
    if (!watchdogTimer) watchdogTimer = setInterval(() => {
      if (contextLooksDead()) { teardown(); return; }
      if (host && !host.isConnected) placeHost();
    }, 1000);
  }

  // ---------------- 悬浮球 ----------------
  function buildBall() {
    const ball = node('div', 'qf-ball qf-hidden');
    ball.setAttribute('role', 'button');
    ball.setAttribute('aria-label', '打开网申速填助手');
    ball.setAttribute('aria-expanded', 'false');
    ball.title = '点击打开助手｜可沿右边框上下拖动';
    ball.tabIndex = 0;
    ball.innerHTML = '<span class="icon">\u26A1\uFE0E</span>';
    shadow.appendChild(ball);
    ui.ball = ball;
    initDrag(ball);
    restoreBallPos();
  }

  // 横向不给任何自由度（永远贴右边框），只纵向限位
  function clampY(top, h) { return Math.max(4, Math.min(innerHeight - h - 4, top)); }

  function saveBallTop(top) {
    if (!isFinite(top)) return;
    clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
      try { chrome.storage.local.set({ [POS_KEY]: { top, ts: Date.now() } }); } catch (e) {}
    }, 300);
  }
  function restoreBallPos() {
    try {
      chrome.storage.local.get(POS_KEY, res => {
        const p = res && res[POS_KEY];
        if (!p || !ui.ball || !isFinite(p.top)) return;
        const r = ui.ball.getBoundingClientRect();
        applyBallTop(clampY(p.top, r.height || 54));
      });
    } catch (e) {}
  }
  function applyBallTop(top) {
    if (!ui.ball) return;
    ui.ball.style.top = top + 'px';
    ui.ball.style.bottom = 'auto';
  }
  // 球的图标跟着面板开合切换：⚡ = 可打开，× = 可收起，避免"点了球不知道会发生什么"
  function setBallOpen(open) {
    if (!ui.ball) return;
    ui.ball.classList.toggle('is-open', !!open);
    ui.ball.setAttribute('aria-expanded', open ? 'true' : 'false');
    ui.ball.setAttribute('aria-label', open ? '收起网申速填助手' : '打开网申速填助手');
    ui.ball.title = open ? '点击收起助手｜可沿右边框上下拖动' : '点击打开助手｜可沿右边框上下拖动';
    const icon = ui.ball.querySelector('.icon');
    if (icon) icon.textContent = open ? '\u00D7' : '\u26A1\uFE0E';
  }

  function resetBallPos() {
    if (!ui.ball) return;
    Object.assign(ui.ball.style, { left: '', top: '', right: '', bottom: '' });
    try { chrome.storage.local.remove(POS_KEY); } catch (e) {}
    positionPanelNearBall();
    toast('悬浮球已复位到右边框');
  }

  function initDrag(ball) {
    let lastDragEnd = 0;
    ball.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = ball.getBoundingClientRect();
      dragState = { id: e.pointerId, y: e.clientY, top: r.top, h: r.height, moved: false, panelWasOpen: false };
      try { ball.setPointerCapture(e.pointerId); } catch (err) {}
    });
    ball.addEventListener('pointermove', e => {
      if (!dragState || dragState.id !== e.pointerId) return;
      const dy = e.clientY - dragState.y;
      if (Math.abs(dy) > 6) {
        if (!dragState.moved) {
          ball.classList.add('dragging');
          dragState.moved = true;
          // 拖动期间收起面板：面板比球大得多，跟着挪会一路盖住球和页面
          dragState.panelWasOpen = !!ui.panel && !ui.panel.classList.contains('qf-hidden');
          if (dragState.panelWasOpen) { ui.panel.classList.add('qf-hidden'); setBallOpen(false); }
        }
      }
      if (!dragState.moved) return;
      applyBallTop(clampY(dragState.top + dy, dragState.h));
    });
    const end = () => {
      if (dragState && dragState.moved) {
        lastDragEnd = Date.now();
        ball.classList.remove('dragging');
        saveBallTop(parseFloat(ball.style.top));
        if (dragState.panelWasOpen) {
          ui.panel.classList.remove('qf-hidden', 'qf-out');
          setBallOpen(true);
          positionPanelNearBall();
        }
      }
      dragState = null;
    };
    ball.addEventListener('pointerup', end);
    ball.addEventListener('pointercancel', end);
    ball.addEventListener('lostpointercapture', end);
    ball.addEventListener('click', () => {
      if (Date.now() - lastDragEnd < 300) return;
      // 退场动画进行中（qf-out）也视为"已关"，这次点击应当重新打开而不是维持关闭
      const show = ui.panel.classList.contains('qf-hidden') || ui.panel.classList.contains('qf-out');
      togglePanel(show);
      if (show) handlers.onOpen?.();
    });
    ball.addEventListener('dblclick', resetBallPos);
    ball.addEventListener('keydown', e => { if (e.key === 'ArrowUp') { e.preventDefault(); nudgeBall(-40); } else if (e.key === 'ArrowDown') { e.preventDefault(); nudgeBall(40); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ball.click(); } });
  }

  // 键盘微调：吸附态下唯一能改变位置的方式，供无鼠标/无障碍场景使用
  function nudgeBall(delta) {
    if (!ui.ball) return;
    const r = ui.ball.getBoundingClientRect();
    const top = clampY((ui.ball.style.top ? parseFloat(ui.ball.style.top) : r.top) + delta, r.height || 54);
    applyBallTop(top);
    saveBallTop(top);
    positionPanelNearBall();
  }

  // ---------------- 面板 ----------------
  const ACTIONS = {
    close: () => togglePanel(false),
    help: () => handlers.onHelp?.(),
    refresh: () => handlers.onRefresh?.(),
    fill: () => handlers.onFill?.(),
    region: () => handlers.onRegion?.(),
    helper: () => handlers.onHelper?.(),
    agent: () => handlers.onAgent?.(),
    record: () => handlers.onRecord?.(),
    jobs: () => handlers.onJobs?.(),
    manage: () => handlers.onManage?.(),
    clear: () => handlers.onClear?.(),
    'switch': () => handlers.onSwitch?.(),
    tools: () => handlers.onTools?.(),
    toggleMore: () => toggleMore(),
    hideBall: () => handlers.onHideBall?.()
  };

  function buildPanel() {
    const panel = node('div', 'qf-panel qf-hidden');
    panel.innerHTML = `<div class="qf-head"><span class="symbol">速</span>
        <span class="t">网申速填<small>简历闪填助手 · 数据仅存本地</small></span>
        <button data-act="help" title="使用帮助">?</button><button data-act="close" title="收起">×</button></div>
      <div class="qf-hero"><span class="qf-badge">✦ 求职提效 UP！</span>
        <p class="h1">简历自动填写助手</p>
        <p class="h2">自动识别招聘表单，一键把简历写进去<br><em>已适配 1000+ 校招网申网站</em></p></div>
      <div class="qf-body">
        <div class="qf-main-actions">
          <button class="qf-btn primary" data-act="fill">⚡︎ 一键填写</button>
          <button class="qf-btn ghost" data-act="region">▣ 选区填写</button>
          <button class="qf-btn ghost" data-act="helper">◧ 辅助填写</button>
          <button class="qf-btn ghost" data-act="agent">✦ AI 辅助点击</button>
        </div>
        <p class="qf-note">用之前先在「编辑简历」里把信息填全并保存——插件是把你填的简历搬到网申表单上，填得越全，命中越准。</p>
        <div class="qf-grid">
          <button class="qf-btn pale" data-act="record">＋ 记录职位</button>
          <button class="qf-btn pale" data-act="jobs">▤ 管理投递</button>
          <button class="qf-btn pale" data-act="manage">✎ 编辑简历</button>
          <button class="qf-btn pale" data-act="switch">⇄ 切换简历</button>
        </div>
        <button class="qf-more-toggle" data-act="toggleMore">识别统计与简历 <span class="arr">▾</span></button>
        <div class="qf-more qf-collapsed" data-role="more"><div class="qf-more-inner">
          <div class="qf-row"><label>使用简历</label><select class="qf-select" data-role="resume"></select></div>
          <p class="qf-note" data-role="resumeNote">请先编辑并保存简历，填写越完整，匹配越准确。</p>
          <div class="qf-stats"><div class="qf-stat ok"><b data-role="nMatched">0</b><span>可填写</span></div>
            <div class="qf-stat miss"><b data-role="nMissing">0</b><span>简历缺失</span></div>
            <div class="qf-stat unk"><b data-role="nUnmatched">0</b><span>未识别</span></div></div>
          <div class="qf-list" data-role="list"></div>
        </div></div>
        <button class="qf-tool-card" data-act="tools"><span class="tc-title">求职神器</span>
          <span class="tc-sub">面试 · 笔试实用工具</span><span class="tc-arrow">›</span></button>
      </div>
      <div class="qf-foot"><a data-act="clear">清除标记</a> · <a data-act="hideBall">隐藏闪电悬浮按钮</a></div>`;
    shadow.appendChild(panel);
    ui.panel = panel;
    ui.more = panel.querySelector('[data-role=more]');
    ui.resumeSelect = panel.querySelector('[data-role=resume]');
    ui.resumeNote = panel.querySelector('[data-role=resumeNote]');
    ui.list = panel.querySelector('[data-role=list]');
    ui.nMatched = panel.querySelector('[data-role=nMatched]');
    ui.nMissing = panel.querySelector('[data-role=nMissing]');
    ui.nUnmatched = panel.querySelector('[data-role=nUnmatched]');
    // 展开动画改变面板高度，结束后把面板重新贴回球边，避免盖住球
    ui.more.addEventListener('transitionend', e => {
      if (e.propertyName === 'grid-template-rows') positionPanelNearBall();
    });
    panel.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) ACTIONS[act]?.();
    });
    ui.resumeSelect.addEventListener('change', () => handlers.onSelectResume?.(ui.resumeSelect.value));
  }

  function togglePanel(show) {
    if (!ui.panel) return;
    clearTimeout(panelAnimTimer);
    if (show) {
      ui.panel.classList.remove('qf-out', 'qf-hidden');
      setBallOpen(true);
      positionPanelNearBall();
    } else {
      if (ui.panel.classList.contains('qf-hidden')) return;
      ui.panel.classList.add('qf-out');
      setBallOpen(false);
      panelAnimTimer = setTimeout(() => {
        ui.panel.classList.add('qf-hidden');
        ui.panel.classList.remove('qf-out');
      }, 190);
    }
  }
  function toggleMore(force) {
    if (!ui.more) return;
    const willShow = force === true ? true : force === false ? false : ui.more.classList.contains('qf-collapsed');
    ui.more.classList.toggle('qf-collapsed', !willShow);
    const btn = ui.panel?.querySelector('[data-act=toggleMore]');
    if (btn) btn.classList.toggle('open', willShow);
    if (willShow) positionPanelNearBall();
  }
  // 面板永远开在悬浮球上方：先把自身高度压进"球上方的可用空间"，再贴着球定位；
  // 球靠得太高时让球先往下避让一点（只改当前显示，不写进位置记忆），保证面板完整且不压住球。
  function positionPanelNearBall() {
    if (!ui.ball || !ui.panel) return;
    if (ui.panel.classList.contains('qf-hidden')) return;   // 关着的时候不必计算
    const GAP = 10, EDGE = 8, MIN_H = 120;
    let r = ui.ball.getBoundingClientRect();
    const cap = Math.min(innerHeight * 0.85, 660);
    let maxH = Math.min(cap, r.top - GAP - EDGE);
    if (maxH < MIN_H) {
      const yieldTop = Math.min(innerHeight - r.height - EDGE, MIN_H + GAP + EDGE);
      if (yieldTop > r.top) { applyBallTop(yieldTop); r = ui.ball.getBoundingClientRect(); }
      maxH = Math.max(80, Math.min(cap, r.top - GAP - EDGE));
    }
    ui.panel.style.maxHeight = maxH + 'px';
    // 上方空间紧张时收起 hero 宣传区，把位置让给操作按钮
    ui.panel.classList.toggle('qf-compact', maxH < 560);
    const pw = ui.panel.offsetWidth || Math.min(320, innerWidth - 16);
    const ph = ui.panel.offsetHeight || 480;
    const left = Math.max(EDGE, Math.min(innerWidth - pw - EDGE, r.right - pw));
    Object.assign(ui.panel.style, { left: left + 'px', top: Math.max(EDGE, r.top - ph - GAP) + 'px', right: 'auto', bottom: 'auto' });
  }

  // kind 决定配色与停留时间；warn/danger 要说清后果，给足阅读时间，也方便测试按 class 断言
  const TOAST_MS = { info: 4200, ok: 5200, warn: 8000, danger: 9000 };
  function toast(message, kind) {
    if (!ui.toast) return;
    const k = TOAST_MS[kind] ? kind : 'info';
    clearTimeout(toastTimer);
    clearTimeout(toastOutTimer);
    ui.toast.textContent = message;
    // 重写 className：摘掉 qf-hidden/qf-out 的瞬间 display 变化会重播入场动画
    ui.toast.className = 'qf-toast qf-toast-' + k;
    toastTimer = setTimeout(() => {
      ui.toast.classList.add('qf-out');
      toastOutTimer = setTimeout(() => ui.toast.classList.add('qf-hidden'), 190);
    }, TOAST_MS[k]);
  }

  // ---------------- 进度窗口 ----------------
  const PHASES = ['read', 'understand', 'fill'];
  const PHASE_ICON = { read: '\u26A1\uFE0E', understand: '⌕', fill: '✎' };

  function showProgress(stage, detail, ratio, opts) {
    const o = opts || {};
    let shade = ui.progress;
    if (!shade || !shade.isConnected) {
      shade = node('div', 'qf-shade');
      shade.innerHTML = `<div class="qf-dialog is-busy" role="status" aria-live="polite">
        <div class="qf-progress-symbol" data-role="sym">⌕</div>
        <h3 data-role="stage"></h3><p class="qf-sub" data-role="detail"></p>
        <div class="qf-progress-track"><div class="qf-progress-fill"></div></div>
        <div class="qf-steps"><span data-step="read">读取简历</span><span data-step="understand">理解页面</span><span data-step="fill">填写页面</span></div>
        <p class="qf-progress-count" data-role="progressCount"></p>
        <p class="qf-progress-comment">请保持当前页面打开，填写完成后请人工核对再提交</p>
        <div class="qf-dialog-actions"><button class="qf-btn danger" data-act="stop">停止填写</button>
          <button class="qf-btn primary qf-hidden" data-act="done">查看页面</button></div>
        <div class="qf-done-ask qf-hidden" data-role="doneAsk"><span>这次填写对你有帮助吗？</span>
          <button class="qf-btn" data-act="good">好用</button><button class="qf-btn" data-act="bad">反馈</button></div>
      </div>`;
      shade.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'stop') handlers.onStop?.();
        else if (act === 'done') shade.classList.add('qf-hidden');
        else if (act === 'good') { shade.classList.add('qf-hidden'); toast('感谢支持！'); }
        else if (act === 'bad') handlers.onFeedback?.('progress');
      });
      shadow.appendChild(shade); ui.progress = shade;
    }
    shade.classList.remove('qf-hidden');
    shade.querySelector('.qf-dialog').classList.add('is-busy');
    shade.querySelector('[data-role=stage]').textContent = stage;
    shade.querySelector('[data-role=detail]').textContent = detail || '';
    shade.querySelector('[data-role=progressCount]').textContent = o.count || '';
    shade.querySelector('.qf-progress-fill').style.width = Math.max(2, Math.min(100, ratio || 5)) + '%';
    const phase = PHASES.includes(o.phase) ? o.phase
      : (/简历|准备/.test(stage) ? 'read' : stage.includes('理解') ? 'understand' : 'fill');
    const idx = PHASES.indexOf(phase);
    shade.querySelector('[data-role=sym]').textContent = PHASE_ICON[phase];
    shade.querySelectorAll('[data-step]').forEach(el => {
      const i = PHASES.indexOf(el.dataset.step);
      el.classList.toggle('on', i === idx);
      el.classList.toggle('done', i < idx);
    });
    shade.querySelector('[data-act=stop]').classList.remove('qf-hidden');
    shade.querySelector('[data-act=done]').classList.add('qf-hidden');
    shade.querySelector('[data-role=doneAsk]').classList.add('qf-hidden');
  }
  function completeProgress(text, detail, savedSeconds) {
    if (!ui.progress) return;
    ui.progress.querySelector('.qf-dialog').classList.remove('is-busy');
    ui.progress.querySelector('[data-role=sym]').textContent = '✓';
    ui.progress.querySelector('[data-role=stage]').textContent = text;
    ui.progress.querySelector('[data-role=detail]').textContent = detail || '';
    ui.progress.querySelector('.qf-progress-fill').style.width = '100%';
    ui.progress.querySelectorAll('[data-step]').forEach(el => { el.classList.remove('on'); el.classList.add('done'); });
    ui.progress.querySelector('[data-act=stop]').classList.add('qf-hidden');
    ui.progress.querySelector('[data-act=done]').classList.remove('qf-hidden');
    ui.progress.querySelector('[data-role=doneAsk]').classList.toggle('qf-hidden', !(savedSeconds > 0));
  }
  // 进度窗用完即销毁：只加 qf-hidden 会在 shadowRoot 里留下一个隐藏遮罩，
  // 其它弹窗/测试按 .qf-shade 找元素时会先命中它
  function closeProgress() {
    if (!ui.progress) return;
    ui.progress.remove();
    ui.progress = null;
  }

  // ---------------- 选区填写 ----------------
  function startSelection(callback) {
    stopSelection();
    selectionCallback = callback;
    togglePanel(false);
    const mask = node('div', 'qf-select-mask');
    mask.innerHTML = '<div class="qf-select-tip">拖动框选「一组」表单字段 · Esc 取消 · 起框请避开右侧边框上的悬浮球</div><div class="qf-selection qf-hidden"></div>';
    const box = mask.querySelector('.qf-selection');
    shadow.appendChild(mask); selectMask = mask;
    let start = null;
    function update(e) {
      if (!start) return;
      const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
      Object.assign(box.style, {
        left: x + 'px', top: y + 'px',
        width: Math.abs(e.clientX - start.x) + 'px', height: Math.abs(e.clientY - start.y) + 'px'
      });
      box.classList.remove('qf-hidden');
    }
    function onEscape(e) {
      if (e.key === 'Escape') { e.preventDefault(); stopSelection(); togglePanel(true); }
    }
    mask.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY };
      try { mask.setPointerCapture(e.pointerId); } catch (err) {}
      update(e);
    });
    mask.addEventListener('pointermove', update);
    mask.addEventListener('pointerup', e => {
      if (!start) return;
      const rect = { left: Math.min(start.x, e.clientX), top: Math.min(start.y, e.clientY), right: Math.max(start.x, e.clientX), bottom: Math.max(start.y, e.clientY) };
      stopSelection();
      if (rect.right - rect.left < 24 || rect.bottom - rect.top < 18) {
        toast('选区太小，请重新点击「选区填写」框选一组字段'); togglePanel(true); return;
      }
      callback?.(rect);
    });
    mask.addEventListener('pointercancel', () => { stopSelection(); togglePanel(true); });
    document.addEventListener('keydown', onEscape, true);
    mask.__cleanup = () => document.removeEventListener('keydown', onEscape, true);
  }
  function stopSelection() { if (selectMask) { selectMask.__cleanup?.(); selectMask.remove(); selectMask = null; } selectionCallback = null; }

  function showRegionPicker(opts) {
    const { rect, fields = [], sections = [], onConfirm, onRepick, onCancel } = opts || {};
    const shade = node('div', 'qf-shade');
    const dialog = node('div', 'qf-dialog qf-rk');
    dialog.appendChild(node('h3', '', '确认选区填写'));
    dialog.appendChild(node('p', 'qf-sub', '选择要填入的简历模块和记录'));
    const cols = node('div', 'qf-rk-cols');
    const modules = node('div', 'qf-rk-modules');
    const right = node('div', 'qf-rk-right');
    const preview = node('div', 'qf-rk-preview');
    const items = node('div', 'qf-rk-items');
    let curSection = sections[0] || null;
    let curIndex = curSection && curSection.items && curSection.items.length ? curSection.items[0].index : -1;

    const labels = fields.map(f => (f.signals && f.signals[0]) || f.placeholder || '字段').slice(0, 14);
    if (labels.length) {
      for (const t of labels) preview.appendChild(node('span', 'qf-rk-fchip', String(t).slice(0, 12)));
    } else preview.appendChild(node('span', 'ph', '圈选区域内未识别到可填字段'));

    function renderModules() {
      modules.replaceChildren();
      for (const s of sections) {
        const on = curSection && s.key === curSection.key;
        const b = node('button', 'qf-rk-mod' + (on ? ' on' : ''));
        b.appendChild(node('span', '', s.icon || '📄'));
        b.appendChild(node('span', 'mk', s.title));
        if (on) b.appendChild(node('span', 'ck', '✓'));
        b.addEventListener('click', () => {
          curSection = s;
          curIndex = s.items && s.items.length ? s.items[0].index : -1;
          renderModules(); renderItems();
        });
        modules.appendChild(b);
      }
    }
    function renderItems() {
      items.replaceChildren();
      const list = (curSection && curSection.items) || [];
      if (!list.length) { items.appendChild(node('div', 'qf-rk-empty', '该模块暂无记录')); return; }
      for (const it of list) {
        const on = it.index === curIndex;
        const row = node('div', 'qf-rk-item' + (on ? ' on' : ''));
        row.appendChild(node('span', 'lb', it.label));
        if (on) row.appendChild(node('span', 'ck', '✓'));
        row.addEventListener('click', () => { curIndex = it.index; renderItems(); });
        items.appendChild(row);
      }
    }
    renderModules(); renderItems();

    right.append(preview, items);
    cols.append(modules, right);
    const warn = node('div', 'qf-warn-bar', '一次只能框选一组：选区填写的原理是把这一组经历填进对应组件，框选多组会导致经历重复填写。若圈内包含多组表单，请「重新框选」只保留一组。');
    const actions = node('div', 'qf-dialog-actions');
    const cancel = node('button', 'qf-btn', '重新框选');
    const confirm = node('button', 'qf-btn primary', '确认填写');
    actions.append(cancel, confirm);
    dialog.append(cols, warn, actions);
    shade.appendChild(dialog); shadow.appendChild(shade);

    // 弹窗阶段必须能取消：以前只返回一个裸 shade.remove，Esc 与点空白都没接，遮罩会残留把页面挡死
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      shade.remove();
    }
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      close();
      onCancel?.();
    }
    document.addEventListener('keydown', onKey, true);
    shade.addEventListener('click', e => { if (e.target === shade) { close(); onCancel?.(); } });
    cancel.addEventListener('click', () => { close(); onRepick?.(); });
    confirm.addEventListener('click', () => { close(); onConfirm?.(curSection ? curSection.key : null, curIndex); });
    return close;
  }

  // ---------------- 辅助填写 ----------------
  const AGENT_TIP = '第一步：点击简历字段；第二步：在网页中点击下拉、级联等控件，由 AI 多轮点选。';
  let helperCapture = null;
  let helperTipText = HELPER_TIP;

  function clearHelperWait() {
    if (!helperWait && !helperCapture) return;
    if (helperCapture) document.removeEventListener('click', helperCapture, true);
    document.removeEventListener('keydown', helperEscCapture, true);
    helperWait = null;
    helperCapture = null;
    const tip = ui.helper && ui.helper.querySelector('.qf-helper-tip');
    if (tip) { tip.classList.remove('on'); tip.textContent = helperTipText; }
  }
  function helperClickCapture(e) {
    const t = e.target;
    const el = t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    if (!el || el.closest('#__qf_overlay_host__')) return;
    const entry = helperWait;
    clearHelperWait();
    if (ui.helperPick) ui.helperPick(el, entry);
  }
  function agentClickCapture(e) {
    const t = e.target;
    if (!t || (t.closest && t.closest('#__qf_overlay_host__'))) return;
    e.preventDefault();
    e.stopPropagation();
    const entry = helperWait;
    const el = (t.closest && t.closest('.el-cascader, .ant-cascader, .el-select, .ant-select, [role="combobox"], .ant-picker, input, textarea, select, [contenteditable="true"], [contenteditable=""]')) || t;
    clearHelperWait();
    if (ui.helperPick) ui.helperPick(el, entry);
  }
  function helperEscCapture(e) { if (e.key === 'Escape') clearHelperWait(); }

  function copyValue(v) {
    const text = String(v == null ? '' : v);
    try {
      if (navigator.clipboard && document.hasFocus()) navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
      else legacyCopy(text);
    } catch (e) { legacyCopy(text); }
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    } catch (e) {}
  }

  function showHelper(opts) {
    const { sections = [], onPick, onFillTarget, onFeedback, onClose } = opts || {};
    const agentMode = opts && opts.mode === 'agent';
    closeHelper();
    helperTipText = agentMode ? AGENT_TIP : HELPER_TIP;
    const helper = node('div', 'qf-helper');
    const head = node('div', 'qf-helper-head');
    head.appendChild(node('span', '', agentMode ? 'AI 辅助点击' : '简历闪填'));
    const total = sections.reduce((n, s) => n + ((s.entries && s.entries.length) || 0), 0);
    head.appendChild(node('span', 'cnt', '共 ' + total + ' 项'));
    head.appendChild(node('span', 'grow', ''));
    const close = node('button', '', '×'); close.title = '关闭';
    head.appendChild(close);
    const tip = node('div', 'qf-helper-tip', helperTipText);
    const search = node('input', 'qf-helper-search');
    search.placeholder = '搜索简历字段，例如：籍贯 / 手机';
    search.setAttribute('aria-label', '搜索简历字段');
    const content = node('div', 'qf-helper-content');
    const foot = node('div', 'qf-helper-foot');
    const fb = node('button', '', '反馈不适配');
    foot.appendChild(fb);
    helper.append(head, tip, search, content, foot);
    shadow.appendChild(helper); ui.helper = helper;
    ui.helperPick = onFillTarget;

    function pick(entry, chip) {
      helper.querySelectorAll('.qf-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      copyValue(entry.value);
      clearHelperWait();
      helperWait = entry;
      tip.textContent = agentMode
        ? '已选择「' + entry.label + '」，请点击网页中的下拉或级联控件'
        : '已选择字段「' + entry.label + '」，请在网页中点击要填写的输入框';
      tip.classList.add('on');
      helperCapture = agentMode ? agentClickCapture : helperClickCapture;
      document.addEventListener('click', helperCapture, true);
      document.addEventListener('keydown', helperEscCapture, true);
      onPick?.(entry);
    }
    function draw() {
      content.replaceChildren();
      const q = search.value.trim().toLowerCase();
      let count = 0;
      for (const section of sections) {
        const entries = (section.entries || []).filter(entry =>
          !q || (entry.label + ' ' + entry.value + ' ' + section.title).toLowerCase().includes(q));
        if (!entries.length) continue;
        const h4 = node('h4');
        h4.appendChild(node('span', '', section.title));
        h4.appendChild(node('span', 'n', String(entries.length)));
        content.appendChild(h4);
        for (const entry of entries) {
          const chip = node('button', 'qf-chip', entry.label);
          chip.title = String(entry.value).slice(0, 100);
          chip.addEventListener('click', () => pick(entry, chip));
          content.appendChild(chip); count++;
        }
      }
      if (!count) content.appendChild(node('p', 'qf-empty', '没有可用字段，请在简历编辑器中填写并保存。'));
    }
    search.addEventListener('input', draw); draw();
    close.addEventListener('click', () => { clearHelperWait(); helper.remove(); ui.helper = null; ui.helperPick = null; onClose?.(); });
    fb.addEventListener('click', () => onFeedback?.());
    togglePanel(false);
    return helper;
  }
  function closeHelper() {
    clearHelperWait();
    if (ui.helper) ui.helper.remove();
    ui.helper = null; ui.helperPick = null;
  }

  // ---------------- 记录职位 / 管理投递 / 反馈 ----------------
  function showRecordJob(info, onSave) {
    const shade = node('div', 'qf-shade');
    const dialog = node('div', 'qf-dialog');
    dialog.appendChild(node('h3', '', '记录当前职位'));
    dialog.appendChild(node('p', 'qf-sub', '保存这条招聘信息，之后在「管理投递」里跟踪进度'));
    dialog.appendChild(node('label', 'qf-fl', '职位名称'));
    const i1 = node('input'); i1.type = 'text'; i1.value = (info && info.title) || '';
    dialog.appendChild(i1);
    dialog.appendChild(node('label', 'qf-fl', '职位链接'));
    const i2 = node('input'); i2.type = 'text'; i2.value = (info && info.url) || '';
    dialog.appendChild(i2);
    dialog.appendChild(node('label', 'qf-fl', '投递状态'));
    const st = document.createElement('select');
    st.className = 'qf-select';
    for (const s of JOB_STATUSES) {
      const op = document.createElement('option');
      op.value = s.key; op.textContent = s.label;
      st.appendChild(op);
    }
    dialog.appendChild(st);
    dialog.appendChild(node('label', 'qf-fl', '备注（可选）'));
    const i3 = node('textarea'); i3.rows = 2; i3.placeholder = '例如：岗位编号 / 联系人 / 下一步要准备的材料';
    dialog.appendChild(i3);
    const actions = node('div', 'qf-dialog-actions');
    const cancel = node('button', 'qf-btn', '取消');
    const save = node('button', 'qf-btn primary', '保存记录');
    cancel.addEventListener('click', () => shade.remove());
    save.addEventListener('click', () => {
      shade.remove();
      onSave?.({ title: i1.value.trim(), url: i2.value.trim(), note: i3.value.trim(), status: st.value });
    });
    actions.append(cancel, save);
    dialog.appendChild(actions);
    shade.appendChild(dialog); shadow.appendChild(shade);
    setTimeout(() => { try { i1.focus(); } catch (e) {} }, 30);
  }

  function showJobsPanel(getList, opts) {
    const o = opts || {};
    const shade = node('div', 'qf-shade');
    const dialog = node('div', 'qf-dialog qf-jobs');
    dialog.appendChild(node('h3', '', '管理投递'));
    const sub = node('p', 'qf-sub', '');
    dialog.appendChild(sub);
    const filters = node('div', 'qf-jobs-filters');
    dialog.appendChild(filters);
    const box = node('div', 'qf-jobs-list');
    dialog.appendChild(box);
    const actions = node('div', 'qf-dialog-actions');
    const exportBtn = node('button', 'qf-btn', '导出 JSON');
    const clearBtn = node('button', 'qf-btn danger', '清空');
    const closeBtn = node('button', 'qf-btn primary', '关闭');
    actions.append(exportBtn, clearBtn, closeBtn);
    dialog.appendChild(actions);
    let active = 'all';
    const statusOf = r => (JOB_STATUSES.some(s => s.key === r.status) ? r.status : 'applied');
    async function render() {
      const all = (await getList?.()) || [];
      const counts = { all: all.length };
      for (const s of JOB_STATUSES) counts[s.key] = 0;
      for (const r of all) counts[statusOf(r)] = (counts[statusOf(r)] || 0) + 1;

      filters.replaceChildren();
      for (const s of [{ key: 'all', label: '全部' }].concat(JOB_STATUSES)) {
        if (s.key !== 'all' && !counts[s.key]) continue;   // 没有记录的状态不占位置
        const chip = node('button', 'qf-jobs-filter' + (active === s.key ? ' on' : ''));
        chip.append(document.createTextNode(s.label), node('span', 'n', String(counts[s.key] || 0)));
        chip.title = '只看「' + s.label + '」的记录';
        chip.addEventListener('click', () => { active = s.key; render(); });
        filters.appendChild(chip);
      }

      const list = active === 'all' ? all : all.filter(r => statusOf(r) === active);
      box.replaceChildren();
      if (!list.length) {
        box.appendChild(node('div', 'qf-rk-empty',
          active === 'all' ? '还没有记录。在职位页面点击「记录职位」即可保存。' : '这个状态下还没有记录。'));
      }
      for (const r of list) {
        const row = node('div', 'qf-job');
        const info = node('div', 'info');
        const top = node('div', 'top');
        top.appendChild(node('div', 'ti', r.title || '(未命名职位)'));
        const sel = document.createElement('select');
        sel.className = 'st-sel st-' + statusOf(r);
        sel.title = '更新投递状态';
        for (const s of JOB_STATUSES) {
          const op = document.createElement('option');
          op.value = s.key; op.textContent = s.label;
          if (statusOf(r) === s.key) op.selected = true;
          sel.appendChild(op);
        }
        sel.addEventListener('change', async () => {
          await o.onUpdateStatus?.(r.id, sel.value);
          await render();
        });
        top.appendChild(sel);
        info.appendChild(top);
        info.appendChild(node('div', 'meta', new Date(r.updatedAt || r.ts || Date.now()).toLocaleString() + ' · ' + (r.url || '')));
        if (r.note) info.appendChild(node('div', 'note', r.note));
        const del = node('button', 'del', '×'); del.title = '删除这条记录';
        del.addEventListener('click', async () => { await o.onDelete?.(r.id); render(); });
        row.append(info, del); box.appendChild(row);
      }
      const ongoing = all.filter(r => ['applied', 'written', 'interview'].includes(statusOf(r))).length;
      sub.textContent = '共 ' + all.length + ' 条本地记录（进行中 ' + ongoing + ' 条，仅存本机）';
    }
    exportBtn.addEventListener('click', async () => o.onExport?.(await getList?.()));
    clearBtn.addEventListener('click', async () => { await o.onClear?.(); active = 'all'; render(); });
    closeBtn.addEventListener('click', () => shade.remove());
    shade.appendChild(dialog); shadow.appendChild(shade);
    render();
    return () => shade.remove();
  }

  function showFeedback(info, onSave) {
    const shade = node('div', 'qf-shade');
    const dialog = node('div', 'qf-dialog');
    dialog.appendChild(node('h3', '', '反馈不适配'));
    dialog.appendChild(node('p', 'qf-sub', '告诉我们这个网站或字段，我们会尽快适配'));
    dialog.appendChild(node('label', 'qf-fl', '当前网址'));
    const u = node('input'); u.type = 'text'; u.readOnly = true; u.value = (info && info.url) || '';
    dialog.appendChild(u);
    dialog.appendChild(node('label', 'qf-fl', '页面标题'));
    const t = node('input'); t.type = 'text'; t.readOnly = true; t.value = (info && info.title) || '';
    dialog.appendChild(t);
    dialog.appendChild(node('label', 'qf-fl', '问题描述'));
    const d = node('textarea'); d.rows = 3; d.placeholder = '例如：辅助填写点了输入框填不进去';
    dialog.appendChild(d);
    const actions = node('div', 'qf-dialog-actions');
    const cancel = node('button', 'qf-btn', '取消');
    const submit = node('button', 'qf-btn primary', '提交反馈');
    cancel.addEventListener('click', () => shade.remove());
    submit.addEventListener('click', () => {
      shade.remove();
      onSave?.({ url: u.value, title: t.value, desc: d.value.trim(), source: (info && info.source) || 'helper' });
    });
    actions.append(cancel, submit);
    dialog.appendChild(actions);
    shade.appendChild(dialog); shadow.appendChild(shade);
    setTimeout(() => { try { d.focus(); } catch (e) {} }, 30);
  }

  // ---------------- 对外 API ----------------
  const api = {
    mount, togglePanel, toggleMore, toast,
    showProgress, completeProgress, closeProgress,
    startSelection, stopSelection, showRegionPicker, showHelper, closeHelper,
    showRecordJob, showJobsPanel, showFeedback,
    showBall() {
      if (!ui.ball) return;
      ui.ball.classList.remove('qf-hidden');
    },
    hideBall() {
      if (ui.ball) {
        const r = ui.ball.getBoundingClientRect();
        if (r.height) miniTop = r.top + r.height / 2;
        ui.ball.classList.add('qf-hidden');
      }
      togglePanel(false);
    },
    showMini(onClick) {
      if (!miniEl || !miniEl.isConnected) {
        miniEl = node('div', 'qf-mini', '⚡︎');
        miniEl.title = '显示悬浮球';
        miniEl.addEventListener('click', () => { api.hideMini(); onClick?.(); });
        shadow.appendChild(miniEl);
      }
      if (isFinite(miniTop)) miniEl.style.top = Math.round(miniTop) + 'px';
      ui.mini = miniEl;
    },
    hideMini() { if (miniEl) miniEl.remove(); miniEl = null; ui.mini = null; },
    hideAllBalls() { api.hideBall(); api.hideMini(); },
    // 视口变化后把球拉回可视范围（球永远贴右边框，所以只需要纵向限位）
    reclampBall() {
      if (!ui.ball || ui.ball.classList.contains('qf-hidden')) return;
      const r = ui.ball.getBoundingClientRect();
      const top = clampY(r.top, r.height || 54);
      const moved = Math.abs(top - r.top) >= 1;
      ui.ball.style.left = '';       // 兜掉任何历史遗留的横向内联定位
      ui.ball.style.right = '';      // 横向一律交回 CSS 的 right:0（吸附到右边框）
      if (moved) {
        applyBallTop(top);
        saveBallTop(top);
      }
      positionPanelNearBall();
    },
    setResumes(list, id) {
      if (!ui.resumeSelect) return;
      ui.resumeSelect.replaceChildren();
      for (const r of list) { const option = new Option(r.name, r.id); option.selected = r.id === id; ui.resumeSelect.appendChild(option); }
      ui.resumeSelect.disabled = !list.length;
      const name = (list.find(r => r.id === id) || {}).name || '';
      ui.resumeNote.textContent = !list.length ? '还没有简历，请先点击「编辑简历」创建并保存。'
        : name.includes('示例简历') ? '当前是示例简历！请先编辑为自己的信息并保存，再开始填写。'
        : '请确认简历已编辑并保存。内容越完整，填写越准确。';
      ui.resumeNote.classList.toggle('warning', !list.length || name.includes('示例简历'));
    },
    setResumeHint(hint) { if (ui.resumeSelect) ui.resumeSelect.title = hint || ''; },
    setStats(stats) {
      if (!ui.nMatched) return;
      // 数字变化时弹一下：让「重新识别后统计变了」有可感知的反馈
      const setNum = (el, v) => {
        const s = String(v);
        if (el.textContent === s) return;
        el.textContent = s;
        if (s === '0') return;
        el.classList.remove('pulse');
        void el.offsetWidth;
        el.classList.add('pulse');
      };
      setNum(ui.nMatched, stats.matched || 0);
      setNum(ui.nMissing, stats.missing || 0);
      setNum(ui.nUnmatched, stats.unmatched || 0);
      ui.list.replaceChildren();
      const rows = stats.rows || [];
      for (const row of rows.slice(0, 60)) {
        const line = node('div', 'li');
        line.append(node('span', 'dot ' + (row.state || 'unk')), node('span', 'lab', row.label || '未识别'));
        if (row.ai) line.appendChild(node('span', 'qf-ai-tag', 'AI'));
        line.appendChild(node('span', 'val', row.value || ''));
        line.title = (row.label || '') + ' → ' + (row.value || '');
        if (row.el) line.addEventListener('click', () => { row.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.el.focus({ preventScroll: true }); });
        ui.list.appendChild(line);
      }
      if (rows.length > 60) ui.list.appendChild(node('div', 'more', '…其余 ' + (rows.length - 60) + ' 项'));
      if (!rows.length) ui.list.appendChild(node('div', 'qf-empty', '尚未识别字段，点击「一键填写」将重新扫描当前页面。'));
    },
    setBusy(busy) {
      const btn = ui.panel && ui.panel.querySelector('[data-act=fill]');
      if (btn) { btn.disabled = !!busy; btn.classList.toggle('is-loading', !!busy); btn.textContent = busy ? '填写中…' : '⚡︎ 一键填写'; }
    },
    isPanelOpen() { return !!ui.panel && !ui.panel.classList.contains('qf-hidden'); }
  };
  root.QuickFillOverlay = api;
})(typeof window !== 'undefined' ? window : self);
