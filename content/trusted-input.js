// 可信输入层：把「点这个元素」翻译成 chrome.debugger 的 CDP 输入命令，
// 让页面收到 isTrusted=true 的事件——等同人手点击。自绘组件的 hover 展开、
// ClickOutside 判定、框架的焦点管理都会吞掉合成事件，只有这一层能兜住。
// 依赖：background.js 的 dbg:* 消息（会话管理在扩展后台，content 只管坐标）。
(function (root) {
  'use strict';

  const IDLE_HINT_MS = 60;       // 滚动后等一帧布局稳定的时间
  const MAX_RETRY = 2;           // 命中校验失败后重滚重试次数
  // 真实输入的节奏：移动 → 按下 → 抬起 之间必须留出间隔，否则 Edge 会把事件合并掉，
  // 只送达 mousedown 而丢掉 mouseReleased（于是永远合成不出 click）。
  const MOVE_HOLD_MS = 60;
  const PRESS_HOLD_MS = 200;
  const PROBE_TTL_MS = 15000;   // 可信输入可用性探测的有效期

  let enabledPref = true;        // 用户开关（popup 设置）
  let probed = null;             // 最近一次握手结果 {ok, reason}
  let probedAt = 0;
  let lastReason = '';

  // ---------- 基础工具 ----------
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function send(payload) {
    try { return Promise.resolve(chrome.runtime.sendMessage(payload)); }
    catch (e) { return Promise.resolve({ ok: false, reason: 'debugger_denied', error: String(e && e.message || e) }); }
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // 本帧视口坐标 → 顶层视口坐标。
  // 同源嵌套：子帧沿 window.frameElement 链自己上溯即可，无需逐帧通信。
  // 跨域嵌套：拿不到 frameElement，返回 null 让上层降级为合成事件（原因码 frame_offset_unavailable）。
  function toTopFrame(x, y) {
    let dx = 0, dy = 0, w = window;
    try {
      while (w !== w.parent) {
        const fe = w.frameElement;
        if (!fe) return null;
        const r = fe.getBoundingClientRect();
        const cs = w.parent.getComputedStyle(fe);
        dx += r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
        dy += r.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
        w = w.parent;
      }
    } catch (e) { return null; }
    // 顶层的捏合缩放：CDP 用的是布局视口 CSS 像素，需要还原 scale 与偏移
    const vv = w.visualViewport;
    if (vv && vv.scale && vv.scale !== 1) {
      return { x: (x + dx - vv.offsetLeft) / vv.scale, y: (y + dy - vv.offsetTop) / vv.scale };
    }
    return { x: x + dx, y: y + dy };
  }

  function centerOf(el) {
    const r = rectOf(el);
    if (!r.width || !r.height) return null;
    // 大面板取中心可能落在滚动区外，夹到边缘内侧 4px 更稳
    const px = Math.min(Math.max(r.width / 2, 4), r.width - 4);
    const py = Math.min(Math.max(r.height / 2, 4), r.height - 4);
    const top = toTopFrame(r.left + px, r.top + py);
    return top ? Object.assign({ localX: r.left + px, localY: r.top + py, rect: r }, top) : null;
  }

  // 命中校验：本帧里这个点是不是真的落在目标（或其祖先/后代）上。
  // 这是"点中了没"的第一道证据——被遮挡、滚出视口、映射算错都会在这里露出来。
  function hitOk(el, localX, localY) {
    const doc = el.ownerDocument || document;
    let hit = null;
    try { hit = doc.elementFromPoint(localX, localY); } catch (e) { return true; }
    if (!hit) return false;
    return hit === el || el.contains(hit) || hit.contains(el);
  }

  // 自家浮层（悬浮球/进度窗/完成对话框）会盖在页面控件上。Shadow DOM 把命中的内部元素
  // 重定向成宿主，所以可信点击的命中校验会被"我们自己的 UI"挡死。
  // 派发前临时让宿主对指针透明——它对 elementFromPoint 和真实输入事件同时失效，且不改布局、不闪。
  const HOST_ID = '__qf_overlay_host__';
  function suppressOwnOverlay(pt) {
    let hit = null;
    try { hit = document.elementFromPoint(pt.localX, pt.localY); } catch (e) { return null; }
    if (!hit || hit.id !== HOST_ID || !hit.style) return null;
    const prev = hit.style.pointerEvents;
    hit.style.setProperty('pointer-events', 'none', 'important');
    return function restore() {
      if (prev) hit.style.pointerEvents = prev;
      else hit.style.removeProperty('pointer-events');
    };
  }

  async function scrollToReveal(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {
      try { el.scrollIntoView(); } catch (e2) {}
    }
    await sleep(IDLE_HINT_MS);
  }

  // ---------- CDP 命令封装 ----------
  async function cmd(method, params) {
    const resp = await send({ type: 'dbg:cmd', method, params: params || {} });
    if (!resp || !resp.ok) {
      lastReason = (resp && resp.reason) || 'debugger_denied';
      probed = { ok: false, reason: lastReason, error: resp && resp.error };
      return null;
    }
    lastReason = '';
    probed = { ok: true };
    return resp.result;
  }

  const BUTTON = 'left';

  async function move(x, y) {
    return cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  }

  async function mouseDown(x, y, clickCount) {
    return cmd('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: BUTTON, buttons: 1, clickCount: clickCount || 1
    });
  }

  async function mouseUp(x, y, clickCount) {
    return cmd('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: BUTTON, buttons: 0, clickCount: clickCount || 1
    });
  }

  // 元素级动作：滚动露出 → 算坐标 → 命中校验 → 派发
  async function actOn(el, kind, opts) {
    const o = opts || {};
    if (!el) return { ok: false, reason: 'no_element' };
    if (!enabledPref) return { ok: false, reason: 'disabled' };

    let pt = null;
    let restore = null;
    for (let i = 0; i <= MAX_RETRY; i++) {
      if (i > 0) await scrollToReveal(el);
      const c = centerOf(el);
      if (!c) return { ok: false, reason: 'frame_offset_unavailable' };
      pt = c;
      if (!restore) restore = suppressOwnOverlay(c);
      if (o.force || hitOk(el, c.localX, c.localY)) break;
    }
    try {
      if (!o.force && !hitOk(el, pt.localX, pt.localY)) return { ok: false, reason: 'hit_test_failed' };

      const x = pt.x, y = pt.y;
      if (kind === 'hover') {
        // CDP 的 mouseMoved 会自己走完 pointerover/mouseenter 链，不用合成 hover 事件
        return (await move(x, y)) === null ? { ok: false, reason: lastReason } : { ok: true, point: pt };
      }
      const clickCount = kind === 'double' ? 2 : 1;
      if ((await move(x, y)) === null) return { ok: false, reason: lastReason };
      await sleep(MOVE_HOLD_MS);
      if ((await mouseDown(x, y, clickCount)) === null) return { ok: false, reason: lastReason };
      // 按下与抬起之间必须留出足够间隔：实测 Edge 会把间隔过短的 press/release 合并掉，
      // 结果只有 mousedown 送达、永远合成不出 click（组件面板根本打不开）。
      await sleep(o.holdMs || PRESS_HOLD_MS);
      if (clickCount === 2) {
        if ((await mouseDown(x, y, 2)) === null) return { ok: false, reason: lastReason };
        await sleep(10);
      }
      if ((await mouseUp(x, y, clickCount)) === null) return { ok: false, reason: lastReason };
      return { ok: true, point: pt };
    } finally {
      if (restore) restore();
    }
  }

  async function click(el, opts) { return actOn(el, 'click', opts); }
  async function doubleClick(el, opts) { return actOn(el, 'double', opts); }
  async function hover(el, opts) { return actOn(el, 'hover', opts); }

  // 顶层视口坐标直接派发（视觉模型返回点位时用）
  async function clickPoint(x, y) {
    if ((await move(x, y)) === null) return { ok: false, reason: lastReason };
    await sleep(MOVE_HOLD_MS);
    if ((await mouseDown(x, y, 1)) === null) return { ok: false, reason: lastReason };
    await sleep(PRESS_HOLD_MS);
    if ((await mouseUp(x, y, 1)) === null) return { ok: false, reason: lastReason };
    return { ok: true };
  }

  const KEY_CODES = {
    Escape: { code: 'Escape', vk: 27 }, Enter: { code: 'Enter', vk: 13 },
    Tab: { code: 'Tab', vk: 9 }, ArrowDown: { code: 'ArrowDown', vk: 40 },
    ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 },
    ArrowRight: { code: 'ArrowRight', vk: 39 }, Backspace: { code: 'Backspace', vk: 8 },
    ' ': { code: 'Space', vk: 32 }
  };

  async function key(k, opts) {
    const o = opts || {};
    const info = KEY_CODES[k] || { code: '', vk: 0 };
    const modifiers = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
    let mask = 0;
    (o.modifiers || []).forEach(m => { mask |= (modifiers[m] || 0); });
    const base = { key: k, code: info.code, windowsVirtualKeyCode: info.vk, nativeVirtualKeyCode: info.vk, modifiers: mask };
    if ((await cmd('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base))) === null) return { ok: false, reason: lastReason };
    if ((await cmd('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base))) === null) return { ok: false, reason: lastReason };
    return { ok: true };
  }

  // insertText 快且能绕过部分框架的按键白名单；带搜索联想的组件要逐字符发 keyDown 才有 input 事件
  async function typeText(text, opts) {
    const o = opts || {};
    const s = String(text == null ? '' : text);
    if (!s) return { ok: true };
    if (o.mode !== 'keys') {
      if ((await cmd('Input.insertText', { text: s })) !== null) return { ok: true };
    }
    for (const ch of s) {
      if ((await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch })) === null) return { ok: false, reason: lastReason };
      if ((await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })) === null) return { ok: false, reason: lastReason };
      await sleep(8);
    }
    return { ok: true };
  }

  async function wheel(dy, el) {
    let x = Math.round(window.innerWidth / 2), y = Math.round(window.innerHeight / 2);
    if (el) {
      const c = centerOf(el);
      if (!c) return { ok: false, reason: 'frame_offset_unavailable' };
      x = c.x; y = c.y;
      await move(x, y);
    }
    if ((await cmd('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: Math.round(dy || 0), pointerType: 'mouse' })) === null) {
      return { ok: false, reason: lastReason };
    }
    await sleep(40);
    return { ok: true };
  }

  // ---------- 会话状态 ----------
  async function probe() {
    const resp = await send({ type: 'dbg:status' });
    probed = resp && resp.ok ? { ok: !!resp.usable, reason: resp.reason || '', attached: !!resp.attached } : { ok: false, reason: 'debugger_denied' };
    enabledPref = !(resp && resp.enabled === false);
    if (!enabledPref) probed = { ok: false, reason: 'disabled' };
    probedAt = Date.now();
    return probed;
  }

  async function available() {
    if (!enabledPref) return false;
    // 探测结论不能永久缓存：用户在设置里关掉开关后，已打开的页面也要能跟上
    if (probed && probed.ok && Date.now() - probedAt < PROBE_TTL_MS) return true;
    if (probed && !probed.ok && /debugger_busy|disabled|not_allowed|denied/.test(probed.reason || '')
      && Date.now() - probedAt < PROBE_TTL_MS) return false;
    const r = await probe();
    return !!r.ok;
  }

  async function release() {
    probed = null;
    const resp = await send({ type: 'dbg:release' });
    return !!(resp && resp.ok);
  }

  // 供 popup/自测直接调用的临时探针：把本帧事件计数回传给页面，便于断言 isTrusted
  async function selfTest() {
    const host = document.getElementById('ti-probe-box');
    if (!host) return { ok: false, reason: 'no_probe_element' };
    const r = await click(host);
    return r;
  }

  root.TrustedInput = {
    click, doubleClick, hover, clickPoint, key, typeText, wheel,
    probe, available, release, selfTest,
    // 命令失败原因优先；没有失败原因时用探测结论（例如用户在设置里关掉了开关 → disabled）
    get reason() { return lastReason || (probed && probed.reason) || ''; },
    toTopFrame
  };
})(typeof window !== 'undefined' ? window : self);
