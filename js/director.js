/* ============================================================
 * 导播模式 · 转播板子控制器
 *
 * 职责边界：app.js 持有全部 BP 状态与规则，本模块只做「呈现」。
 * app.js 在启动时通过 Director.init(ctx) 注入一组只读访问器与
 * 少量动作函数（选人/确认），之后每次状态变化由 render() 末尾调用
 * Director.render(anim) 驱动本板重绘。
 *
 * 板子只在"导播模式"（设置界面里与单机/联机并列的第三种模式）里出现：
 * 一个人给蓝红双方点选，整局在板上走完，不进对局界面。
 * BP 顺序与合法性判定、胜率算法、英雄池与头像全部取自系统同一份数据，
 * 本模块只负责呈现 + 把点击转成 ctx.selectHero / ctx.confirmPick。
 *
 * 胜率一律取本系统算法（BPData.predictWinRate），并按 BO 赛制换算
 * 系列赛胜率（二项求和，与参考站 mgrSeriesWinProb 同一口径）。
 * ============================================================ */
(function () {
  "use strict";

  let ctx = null;
  let root = null;
  let active = false;

  // 本板自己的筛选状态（不复用主界面的 state.filterPos，避免互相干扰）
  let filterPos = "全部";
  let searchText = "";

  // 本手用时（导播看的是"这一手下了多久"，不是倒计时 —— 本系统没有
  // 出手机制，显示倒数会谎报状态）
  let stepStartedAt = 0;
  let stepKey = "";

  /* 上一帧每个 pick 槽的角色 + 待确认英雄换没换。
   *
   * 为什么需要记这个：板面每帧都是 innerHTML 重建的，新元素不会触发
   * transition，动画也会每次 render 从头播。所以"放大/缩小"和"飞入"这类
   * 一次性动效必须只在新旧状态真正交替的那一帧挂上去，否则每次重绘都会重播。 */
  let lastRoles = { blue: [], red: [] };
  let lastPendingHero = null;

  /* ---------------- 强调格的角色划分（按 BP 规则分组） ----------------
   *
   * 同一局里 BP 顺序允许一方连选两手（第一轮是 蓝1 → 红2 → 蓝2 → 红1），
   * 这几手属于**同一次强调**：组内空格一起闪烁，待选格放大，其他空格缩小让位，
   * 已确认格保持常态尺寸。
   * app.js 的 currentPickGroup() 给出本组的槽位区间 [start, end]（BP 规则只有
   * 那一处），这里翻译成每格的 class：
   *
   *   hold    组内已确定   → 保持常态尺寸
   *   pending 组内当前待选 → 英雄落格（preview）才放大 + 呼吸边框
   *   live    组内还没轮到 → 缩小让位 + 呼吸边框
   *   null    组外         → 常态
   *
   * "放大"的时机按用户口径：组一开先让这几格一起闪框（一个尺寸不变），
   * 只有 pick 待选时产生尺寸强调；Ban 和其他状态均使用常态尺寸。
   */
  function pickRoles(d, side) {
    const roles = [null, null, null, null, null];
    const g = ctx?.currentPickGroup ? ctx.currentPickGroup() : null;
    if (!g || !d || g.side !== side) return roles;
    const n = d.picks[side].length;
    for (let i = Math.max(0, g.start); i <= g.end && i < roles.length; i++) {
      roles[i] = i < n ? "hold" : (i === n ? "pending" : "live");
    }
    return roles;
  }

  let els = {};
  let slotObserver = null;
  let completionReady = false;
  let completionTimer = 0;
  /* ---------------- 巅峰对决定格（按路逐一揭晓） ----------------
   * 口径：双方 BP 都走完之后，先保留板子，然后**按 1→5 号位**播放定格：
   * 每一路把蓝红两侧**同一个位置**的两个英雄同时弹出来各占一框（左右并排），
   * 定格 2s 再切下一路；五路全部走完才把板子切成竖版阵容（.draft-complete）
   * 并放开"确定胜负方"。
   *
   * 呈现照搬单机/联机的 #freeze-overlay：同一套金色主题、粒子、海报与出场动画，
   * 区别只有"这里两张卡并排、并且要循环五路"。 */
  let peakRevealDraft = null;
  let peakRevealDone = false;
  let peakRevealTimer = 0;
  let peakRevealIndex = -1;

  /** 每一路在屏幕上停留多久（用户指定 2 秒）。 */
  const PEAK_HOLD_MS = 2000;

  function freezeOverlay() { return root && root.querySelector("#dir-freeze"); }

  function hidePeakFreeze() {
    const el = freezeOverlay();
    if (!el) return;
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
  }

  /** 把一路里的一个英雄画进一张定格卡（结构、动效与 app.js 的 showFreeze 一致） */
  function paintFreezeCard(card, ref, teamName) {
    if (!card || !ref) return;
    const h = ctx.heroByName(ref);
    const name = ctx.displayHero(ref);
    card.querySelector(".freeze-hero-name").textContent = name;
    card.querySelector(".freeze-hero-role").textContent =
      (h && h.role ? h.role : "辅助") + (h && h.pos ? " · " + h.pos : "");
    const teamEl = card.querySelector(".freeze-team");
    if (teamEl) teamEl.textContent = teamName;

    const poster = card.querySelector(".freeze-poster");
    const fallback = card.querySelector(".freeze-fallback");
    if (fallback) fallback.innerHTML = ctx.laneFallback(h, "freeze-lane");

    // 每路都新建 <img>：把上一路的英雄图连同它的 onload 一起丢掉，
    // 否则新一路会先闪出上一路的立绘（同 showFreeze 的处理）。
    card.querySelector(".freeze-img")?.remove();
    const img = new Image();
    img.className = "freeze-img";
    img.alt = name;
    img.style.opacity = "0"; // 加载完成前保持透明，回退图标垫底
    img.onload = function () {
      if (fallback) fallback.style.display = "none";
      img.style.opacity = "1";
      img.style.animation = "none";
      void img.offsetWidth;
      img.style.animation = "freezeHeroIn .65s cubic-bezier(.2,1,.3,1) both";
    };
    img.onerror = function () { /* 海报加载失败：保持回退图标 */ };
    // 拿不到 URL 不要赋 src（空 src 会再请求一次当前页面）
    const url = ctx.heroPosterUrl(ref);
    if (url) img.src = url; else img.style.display = "none";
    poster.insertBefore(img, fallback || poster.firstChild);

    // 金色亮闪 + 卡片出场（同名 keyframes 在 style.css，与单机/联机同一套）
    poster.style.animation = "none";
    void poster.offsetWidth;
    poster.style.animation = "freezeFlash .7s ease-out";
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";
  }

  /** 与 app.js 的 spawnParticles 同款金色粒子（每路重撒一次） */
  function spawnFreezeParticles(container) {
    if (!container) return;
    container.innerHTML = "";
    for (let i = 0; i < 42; i++) {
      const p = document.createElement("span");
      p.className = "particle";
      p.style.left = (Math.random() * 100).toFixed(1) + "%";
      p.style.top = (15 + Math.random() * 85).toFixed(1) + "%";
      p.style.animationDelay = (Math.random() * 2.5).toFixed(2) + "s";
      p.style.animationDuration = (2.2 + Math.random() * 3).toFixed(2) + "s";
      const size = (2 + Math.random() * 5).toFixed(1);
      p.style.width = size + "px";
      p.style.height = size + "px";
      container.appendChild(p);
    }
  }

  function showPeakFreeze(draft, index) {
    const el = freezeOverlay();
    if (!el) return;
    peakRevealIndex = index;
    paintFreezeCard(el.querySelector("#dir-freeze-blue"), draft.picks.blue[index], ctx.state.blueTeam);
    paintFreezeCard(el.querySelector("#dir-freeze-red"), draft.picks.red[index], ctx.state.redTeam);
    const pos = el.querySelector(".dir-freeze-pos");
    if (pos) pos.textContent = String(index + 1);
    spawnFreezeParticles(el.querySelector("#dir-freeze-particles"));
    el.classList.add("show");
    el.setAttribute("aria-hidden", "false");
  }

  /** 一路播完（或被打断）之后的收尾：最后一路结束后进"排列阵容"，切竖版另有一步 */
  function endPeakReveal() {
    clearTimeout(peakRevealTimer);
    peakRevealTimer = 0;
    peakRevealIndex = -1;
    hidePeakFreeze();
    peakRevealDone = true;
    root?.classList.remove("peak-reveal");
    openOrderPhase();
    render(null); // boardReady 还差 orderReady，这一帧仍是横向板 + 排列层
  }

  function playPeakPair(draft, index) {
    if (!active || ctx.state.draft !== draft || peakRevealDraft !== draft) return;
    if (index > 4 || !draft.picks.blue[index] || !draft.picks.red[index]) { endPeakReveal(); return; }
    els.phase && (els.phase.textContent = `巅峰定格 · ${index + 1}/5`);
    showPeakFreeze(draft, index);
    peakRevealTimer = setTimeout(() => {
      peakRevealTimer = 0;
      if (!active || ctx.state.draft !== draft || peakRevealDraft !== draft) return;
      if (index === 4) endPeakReveal();
      else playPeakPair(draft, index + 1);
    }, PEAK_HOLD_MS);
  }

  /** 点击定格层 = 直接跳到下一路（跟单机/联机的"点击任意处关闭"同一个手感） */
  function skipPeakPair() {
    const draft = peakRevealDraft;
    if (!draft || peakRevealDone) return;
    clearTimeout(peakRevealTimer);
    peakRevealTimer = 0;
    const next = peakRevealIndex + 1;
    if (next > 4) endPeakReveal();
    else playPeakPair(draft, next);
  }

  function startPeakReveal(draft) {
    if (peakRevealDraft === draft || peakRevealDone) return;
    cancelPeakReveal();
    peakRevealDraft = draft;
    root.classList.add("peak-reveal");
    playPeakPair(draft, 0);
  }

  function cancelPeakReveal() {
    clearTimeout(peakRevealTimer);
    peakRevealTimer = 0;
    peakRevealIndex = -1;
    hidePeakFreeze();
    root?.classList.remove("peak-reveal");
    peakRevealDraft = null;
    peakRevealDone = false;
    resetOrderPhase();
  }

  /* ---------------- 排列阵容顺序（每一局都要走） ----------------
   * BP 走完之后**不直接切竖版**，先让导播把双方的英雄排成想要的顺序
   * （从左到右就是竖版阵容里的排列），点"确认阵容"才切竖版。
   * 巅峰局是先播完五路定格再进这一步，普通小局是保留一拍横向板后直接进。
   *
   * 改顺序只有一种语义 = **两格互换**（点两张 / 把一张拖到另一格上）。
   * 不做"抽出来插进去"：那种整排会瞬间挤位，看着突兀；互换则其它格子全程不动。
   *
   * 顺序只存在这里（`lineupOrder`），**不改 `state.draft.picks`** —— 那两份数组
   * 是 BP 的账（撤销、分组规则、赛后面板都按它算），只为了画面顺序去动它，
   * 迟早会在别处对不上。所以只在"板子已经是竖版"那一帧拿它覆盖显示顺序。 */
  let lineupOrder = { blue: null, red: null };
  let orderReady = false;
  let orderSel = null;   // 点选互换的第一张 {side, index}
  let orderDrag = null;  // 拖拽中的状态 {side, index, startX, startY, moved, ghost, target}

  function orderOverlay() { return root && root.querySelector("#dir-order"); }

  function orderList(side) {
    const d = ctx.state.draft;
    if (!lineupOrder[side]) lineupOrder[side] = d ? d.picks[side].slice() : [];
    return lineupOrder[side];
  }

  /** 竖版要显示的顺序：只在"整局走完 + 顺序确认过"时才替换 picks 的原始顺序。 */
  function lineupNames(d, side) {
    const base = d ? d.picks[side] : [];
    if (!orderReady || !lineupOrder[side]) return base;
    const list = lineupOrder[side].filter(k => base.includes(k));
    return list.length === base.length ? list : base;
  }

  function orderCardHtml(side, key, index) {
    const h = ctx.heroByName(key);
    const name = ctx.displayHero(key);
    const avatar = ctx.heroAvatarUrl(key);
    const poster = (ctx.heroPosterUrl(key) || "").replace("-bigskin-", "-mobileskin-") || avatar;
    // draggable="false"：<img> 默认是可拖的，浏览器会抢去做原生拖放，
    // 拖到一半发 pointercancel（坐标还是 0），顺序就永远排不动
    let tag = ctx.heroImgTag(poster, "dor-img", ctx.esc(name), 'draggable="false"');
    // 海报 404 时退回方形头像（虚构英雄没有官方立绘；两者都没有就只剩分路图标）
    if (poster && poster !== avatar && avatar) {
      tag = tag.replace('onerror="', `data-fallback="${ctx.esc(avatar)}" onerror="if(!this.dataset.fallbackTried){this.dataset.fallbackTried='1';this.src=this.dataset.fallback;return;}`);
    }
    const role = (h && h.role ? h.role : "") + (h && h.pos ? " · " + h.pos : "");
    return `<div class="dir-order-card" data-key="${ctx.esc(key)}" data-index="${index}" data-side="${side}" title="${ctx.esc(name)}">
      ${tag}
      ${ctx.laneFallback(h)}
      <span class="dor-num">${index + 1}</span>
      <span class="dor-name">${ctx.esc(name)}</span>
      <span class="dor-role">${ctx.esc(role)}</span>
    </div>`;
  }

  function paintOrderRow(side) {
    const el = orderOverlay();
    if (!el) return;
    const track = el.querySelector(`#dir-order-${side}`);
    if (!track) return;
    const list = orderList(side);
    track.innerHTML = list.map((key, i) => orderCardHtml(side, key, i)).join("");
    const team = el.querySelector(`[data-order-team="${side}"]`);
    if (team) team.textContent = side === "blue" ? ctx.state.blueTeam : ctx.state.redTeam;
    team && team.classList.remove("blue", "red");
    team && team.classList.add(side);
    // 名字条上的颜色跟着队走，跟板子一致
    track.classList.toggle("blue-side", side === "blue");
    track.classList.toggle("red-side", side === "red");
    ctx.bindHeroImgs?.(root);
  }

  function clearOrderMarks() {
    const el = orderOverlay();
    if (!el) return;
    el.querySelectorAll(".drop-target,.selected").forEach(n => n.classList.remove("drop-target", "selected"));
  }

  /** 把行里的卡片按 lineupOrder 摆好；挪了窝的那几张用 FLIP 平滑过去。
   *  不走整行重建：重建不但看着突兀（其它格子会瞬间挤位），还会把卡片上的
   *  一次性效果重播一遍。 */
  function applyOrderDom(side) {
    const el = orderOverlay();
    const track = el?.querySelector(`#dir-order-${side}`);
    if (!track) return false;
    const list = orderList(side);
    const cards = [...track.querySelectorAll(".dir-order-card")];
    const byKey = new Map(cards.map(c => [c.dataset.key, c]));
    // 键对不上（重复/缺失）就不敢按 key 摆，交给整行重建兜底
    if (cards.length !== list.length || byKey.size !== list.length) return false;
    const before = new Map(cards.map(c => [c.dataset.key, c.getBoundingClientRect()]));
    // 按目标顺序逐个 append：append 已存在的节点 = 挪到末尾，依次下来正好排出目标序列
    list.forEach(key => track.appendChild(byKey.get(key)));
    [...track.children].forEach((c, i) => {
      c.dataset.index = i;
      const num = c.querySelector(".dor-num");
      if (num) num.textContent = String(i + 1);
    });
    // FLIP：只给真的换了位置的那两张播位移（其余本来就纹丝不动）
    [...track.children].forEach(c => {
      const r0 = before.get(c.dataset.key);
      const r1 = c.getBoundingClientRect();
      const dx = r0.left - r1.left, dy = r0.top - r1.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }],
        { duration: 300, easing: "cubic-bezier(.22,.78,.24,1)" });
    });
    return true;
  }

  /** 互换两格 = 改数组 + 平滑换位。顺序只影响呈现，不动 BP 的 picks 账。 */
  function swapOrder(side, a, b) {
    if (!swapHeroes(side, a, b)) return false;
    if (!applyOrderDom(side)) paintOrderRow(side);
    return true;
  }

  function swapHeroes(side, a, b) {
    const list = orderList(side);
    if (a === b || a < 0 || b < 0 || a >= list.length || b >= list.length) return false;
    [list[a], list[b]] = [list[b], list[a]];
    return true;
  }

  /** 指针压在哪个格子上 —— 落点就是"要跟它互换的那一格"。
   *  ghost 是 pointer-events:none，所以 elementFromPoint 直接穿过它量到底下的卡。 */
  function dropTargetCard(e, side) {
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".dir-order-card");
    return hit && hit.dataset.side === side ? hit : null;
  }

  function orderSideFromEvent(e) {
    const row = e.target?.closest?.(".dir-order-row");
    return row ? row.dataset.side : null;
  }

  function onOrderPointerDown(e) {
    if (!orderOverlay()?.classList.contains("show")) return;
    const card = e.target?.closest?.(".dir-order-card");
    const side = orderSideFromEvent(e);
    if (!card || !side) { orderSel = null; clearOrderMarks(); return; }
    const index = +card.dataset.index;
    e.preventDefault(); // 扼住原生拖放（图片默认可拖），否则中途会收到 pointercancel
    orderDrag = { side, index, startX: e.clientX, startY: e.clientY, moved: false, ghost: null, pointerId: e.pointerId };
    // 捕获挂在**整层**上：拖动过程中行会重绘，挂在卡片上的话指针一松就丢事件
    try { orderOverlay().setPointerCapture(e.pointerId); } catch {}
  }

  function onOrderPointerMove(e) {
    if (!orderDrag || e.pointerId !== orderDrag.pointerId) return;
    const dx = e.clientX - orderDrag.startX, dy = e.clientY - orderDrag.startY;
    if (!orderDrag.moved && Math.hypot(dx, dy) < 6) return; // 小抖动还算"点击"
    const el = orderOverlay();
    if (!orderDrag.moved) {
      orderDrag.moved = true;
      orderSel = null;
      clearOrderMarks();
      const card = el.querySelector(`.dir-order-card[data-side="${orderDrag.side}"][data-index="${orderDrag.index}"]`);
      const ghost = card?.cloneNode(true);
      if (ghost && card) {
        const r = card.getBoundingClientRect();
        // 只**加**一个跟手的类，别替换 className —— 替换会把 .dir-order-card 那套
        // 尺寸规则一起丢掉，里面的大立绘就按原图尺寸炸开
        ghost.classList.add("dir-order-ghost");
        ghost.style.width = r.width + "px";
        ghost.style.height = r.height + "px";
        el.appendChild(ghost);
        orderDrag.ghost = ghost;
        orderDrag.grabX = orderDrag.startX - r.left;
        orderDrag.grabY = orderDrag.startY - r.top;
        card.classList.add("dragging");
      }
    }
    if (orderDrag.ghost) {
      orderDrag.ghost.style.left = (e.clientX - orderDrag.grabX) + "px";
      orderDrag.ghost.style.top = (e.clientY - orderDrag.grabY) + "px";
    }
    // 悬到哪一格就亮哪一格：落点 = 互换对象。拖动全程整排纹丝不动，不突兀
    const hit = dropTargetCard(e, orderDrag.side);
    el.querySelectorAll(".drop-target").forEach(n => n.classList.remove("drop-target"));
    const at = hit ? +hit.dataset.index : -1;
    orderDrag.target = (at >= 0 && at !== orderDrag.index) ? at : -1;
    if (orderDrag.target >= 0) hit.classList.add("drop-target");
  }

  function onOrderPointerUp(e) {
    if (!orderDrag || e.pointerId !== orderDrag.pointerId) return;
    const drag = orderDrag;
    orderDrag = null;
    const el = orderOverlay();
    try { el?.releasePointerCapture(e.pointerId); } catch {}
    drag.ghost?.remove();
    const wasMoved = drag.moved;
    const target = drag.target;
    clearOrderMarks();
    el?.querySelectorAll(".dir-order-card.dragging").forEach(n => n.classList.remove("dragging"));
    // 把卡片盖到另一格上 = 两格互换（不是"抽出来插进去"，那样整排会瞬间挪位）
    if (wasMoved) {
      if (target >= 0 && target !== drag.index) swapOrder(drag.side, drag.index, target);
      return;
    }
    // 没挪动 = 点击：第一下选中，第二下与它互换
    if (orderSel && orderSel.side === drag.side && orderSel.index !== drag.index) {
      swapOrder(drag.side, orderSel.index, drag.index);
      orderSel = null;
      return;
    }
    orderSel = (orderSel && orderSel.side === drag.side && orderSel.index === drag.index) ? null : { side: drag.side, index: drag.index };
    clearOrderMarks();
    if (orderSel) el?.querySelector(`.dir-order-card[data-side="${orderSel.side}"][data-index="${orderSel.index}"]`)?.classList.add("selected");
  }

  /** 拖拽被浏览器打断（切窗口、原生拖放抢走等）：只清理，不提交顺序 */
  function onOrderPointerCancel(e) {
    if (!orderDrag || e.pointerId !== orderDrag.pointerId) return;
    const drag = orderDrag;
    orderDrag = null;
    const el = orderOverlay();
    try { el?.releasePointerCapture(e.pointerId); } catch {}
    drag.ghost?.remove();
    el?.querySelectorAll(".dir-order-card.dragging").forEach(n => n.classList.remove("dragging"));
    clearOrderMarks();
  }

  function openOrderPhase() {
    const el = orderOverlay();
    if (!el) { endOrderPhase(); return; }
    lineupOrder = { blue: null, red: null };
    orderReady = false;
    orderSel = null;
    orderDrag = null;
    el.classList.add("show");
    el.setAttribute("aria-hidden", "false");
    const peak = !!ctx.state.draft?.isPeak;
    const title = el.querySelector(".dir-order-title");
    if (title) title.textContent = peak ? "巅峰对决 · 排列阵容顺序" : "BP 完成 · 排列阵容顺序";
    paintOrderRow("blue");
    paintOrderRow("red");
    els.phase && (els.phase.textContent = peak ? "巅峰对决 · 排列阵容" : "排列阵容 · 待确认");
  }

  function hideOrderPhase() {
    const el = orderOverlay();
    if (!el) return;
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
    clearOrderMarks();
  }

  /** 确认阵容 → 这一步才切竖版（render 里 boardReady 的另一半条件） */
  function endOrderPhase() {
    orderReady = true;
    orderSel = null;
    hideOrderPhase();
    root?.classList.remove("peak-reveal");
    els.phase && (els.phase.textContent = "BP 完成 · 请确定胜负方");
    render(null);
  }

  function resetOrderPhase() {
    orderReady = false;
    orderSel = null;
    orderDrag = null;
    lineupOrder = { blue: null, red: null };
    hideOrderPhase();
  }

  function restoreOrder() {
    const d = ctx.state.draft;
    if (!d) return;
    lineupOrder = { blue: d.picks.blue.slice(), red: d.picks.red.slice() };
    orderSel = null;
    ["blue", "red"].forEach(side => { if (!applyOrderDom(side)) paintOrderRow(side); });
  }

  // Draft portraits are square originals. Match the frame width to its current
  // animated height instead of shrinking the portrait inside a wide rectangle.
  function fitDraftSlot(slot) {
    if (!slot.isConnected) return;
    if (root.classList.contains("draft-complete") || innerWidth <= 820) {
      slot.style.removeProperty("width");
      return;
    }
    const available = slot.parentElement.clientWidth;
    const width = Math.min(available, slot.offsetHeight) + "px";
    if (slot.style.width !== width) slot.style.width = width;
  }

  function armLockMotion(slot) {
    if (!slot.classList.contains("just-confirmed")) return;
    const img = slot.querySelector(".slot-img");
    let begun = false;
    const start = () => {
      if (begun || !slot.isConnected) return;
      begun = true;
      // Explicit layers survive preview renders and don't depend on a brief
      // pseudo-element animation, including on machines with OS motion disabled.
      const scan = document.createElement("span");
      scan.className = "dir-lock-scan";
      scan.setAttribute("aria-hidden", "true");
      const edge = document.createElement("span");
      edge.className = "dir-lock-edge";
      edge.setAttribute("aria-hidden", "true");
      slot.append(scan, edge);
      const a = scan.animate([
        { transform: 'translateY(110%)', opacity: 0, offset: 0 },
        { opacity: 1, offset: .16 },
        { opacity: 1, offset: .8 },
        { transform: 'translateY(-420%)', opacity: 0, offset: 1 },
      ], {duration: 760, delay: 100, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'both'});
      edge.animate([{opacity: 0},{opacity: 1, offset: .25},{opacity: .65, offset: .65},{opacity: 0}],{duration: 1200, fill:'both'});
      if (img?.naturalWidth && slot.classList.contains('dir-pick')) img.animate([
        {filter:'brightness(1)',transform:'scale(1)'},
        {filter:'brightness(1.3)',transform:'scale(1.045)',offset:.35},
        {filter:'brightness(1)',transform:'scale(1)'},
      ],{duration:1000,easing:'ease-out'});
      a.finished.then(() => scan.remove()).catch(() => scan.remove());
      setTimeout(() => {edge.remove();slot.classList.remove('just-confirmed');},1250);
    };
    if (!img || (img.complete && img.naturalWidth)) start();
    else { img.addEventListener('load',start,{once:true});img.addEventListener('error',start,{once:true}); }
  }

  /* -------------------- 工具 -------------------- */
  const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

  /** 单局胜率 → BO 系列赛胜率（先到 N=ceil(bo/2) 胜，负二项求和）。 */
  function seriesWinProb(p, bo) {
    p = clamp01(p);
    const N = Math.ceil((Number(bo) || 1) / 2);
    if (N <= 1) return p;
    let sum = 0, comb = 1;
    for (let k = 0; k < N; k++) {
      if (k > 0) comb = comb * (N - 1 + k) / k;
      sum += comb * Math.pow(p, N) * Math.pow(1 - p, k);
    }
    return clamp01(sum);
  }

  /* -------------------- 初始化 -------------------- */
  function init(context) {
    ctx = context;
    root = document.getElementById("director-screen");
    els = {
      event: root.querySelector(".dh-event"),
      game: root.querySelector(".dh-game"),
      chipRoom: root.querySelector(".dh-chip.room"),
      chipRole: root.querySelector(".dh-chip.role"),
      blueName: root.querySelector(".dir-team.blue .dt-name"),
      redName: root.querySelector(".dir-team.red .dt-name"),
      blueScore: root.querySelector(".dir-team.blue .dt-score"),
      redScore: root.querySelector(".dir-team.red .dt-score"),
      blueLogo: root.querySelector(".dir-team.blue .dt-logo"),
      redLogo: root.querySelector(".dir-team.red .dt-logo"),
      blueBans: root.querySelector(".dir-teamwrap.blue .dir-bans"),
      redBans: root.querySelector(".dir-teamwrap.red .dir-bans"),
      bluePicks: root.querySelector(".dir-col.blue .dir-picks"),
      redPicks: root.querySelector(".dir-col.red .dir-picks"),
      timer: root.querySelector(".dir-timer"),
      phase: root.querySelector(".dir-phase"),
      progress: root.querySelector(".dir-progress > i"),
      blueProb: root.querySelector(".dw-side.blue .dw-prob"),
      redProb: root.querySelector(".dw-side.red .dw-prob"),
      blueSub: root.querySelector(".dw-side.blue .dw-sub"),
      redSub: root.querySelector(".dw-side.red .dw-sub"),
      barBlue: root.querySelector(".dw-bar > i.b"),
      barRed: root.querySelector(".dw-bar > i.r"),
      verdict: root.querySelector(".dw-verdict"),
      grid: root.querySelector(".dir-grid"),
      search: root.querySelector(".dp-search"),
      confirm: root.querySelector(".dir-confirm"),
    };
    bindStaticUI();
    slotObserver = new ResizeObserver(entries => requestAnimationFrame(() => entries.forEach(({target}) => {
      if (root.classList.contains("draft-complete") || innerWidth <= 820) {
        target._sizeMotion?.cancel(); target._sizeMotion = null; target.style.removeProperty("flex-basis");
      }
      fitDraftSlot(target);
    })));
    return root;
  }

  function bindStaticUI() {
    // 分路筛选
    root.querySelectorAll(".dir-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        root.querySelectorAll(".dir-tabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      filterPos = btn.dataset.pos;
      renderPool();
      });
    });
    // 搜索
    els.search.addEventListener("input", (e) => {
      searchText = e.target.value.trim();
      renderPool();
    });
    // 退出导播
    root.querySelectorAll("[data-dir-exit]").forEach((b) => b.addEventListener("click", () => close()));
    // 撤销上一手（导播是一个人模拟，撤手是刚需；待确认状态先撤待确认）
    root.querySelectorAll("[data-dir-undo]").forEach((b) => b.addEventListener("click", () => ctx.undo()));
    root.querySelector("[data-dir-result]")?.addEventListener("click", () => ctx.openResultModal());
    // 板上的确认条
    els.confirm.querySelector("[data-dir-ok]")?.addEventListener("click", () => ctx.confirmPick());
    els.confirm.querySelector("[data-dir-cancel]")?.addEventListener("click", () => ctx.cancelPick());
    // 巅峰定格层：点一下直接跳到下一路（不必等满 2s）
    root.querySelector("#dir-freeze")?.addEventListener("click", skipPeakPair);
    // 排列阵容层：拖动排序 / 点两张互换；确认才切竖版
    const order = root.querySelector("#dir-order");
    if (order) {
      order.addEventListener("pointerdown", onOrderPointerDown);
      order.addEventListener("pointermove", onOrderPointerMove);
      order.addEventListener("pointerup", onOrderPointerUp);
      order.addEventListener("pointercancel", onOrderPointerCancel);
      order.querySelector("[data-dir-order-ok]")?.addEventListener("click", endOrderPhase);
      order.querySelector("[data-dir-order-reset]")?.addEventListener("click", restoreOrder);
    }
  }

  /* -------------------- 开关 -------------------- */
  function isActive() { return active; }

  function open() {
    if (!root) return;
    cancelPeakReveal();
    clearTimeout(completionTimer);
    completionTimer = 0;
    completionReady = false;
    active = true;
    root.classList.add("active");
    document.body.classList.add("dir-open");
    stepStartedAt = Date.now();
    stepKey = "";
    // 开板当成"全新的一帧"：当前该强调的格子会带放大进场动画
    lastRoles = { blue: [], red: [] };
    lastPendingHero = null;
    render(null);
  }

  /* silent: 由 resetToSetup() 调用 —— 界面已经在回设置界面了，不能再回调 onExit
   * （那会再进一次 resetToSetup，转成死循环）。 */
  function close(opts) {
    active = false;
    cancelPeakReveal();
    clearTimeout(completionTimer);
    completionTimer = 0;
    completionReady = false;
    window.BPAudio?.setActive(false);
    root?.classList.remove("active");
    document.body.classList.remove("dir-open");
    if (!opts || !opts.silent) ctx?.onExit?.();
  }

  /* -------------------- 渲染 -------------------- */
  function render(anim) {
    if (!active || !ctx) return;
    const state = ctx.state;
    const d = state.draft;
    const finishedBP = !!d && !ctx.currentStep();
    if (!finishedBP) {
      clearTimeout(completionTimer);
      completionTimer = 0;
      completionReady = false;
      cancelPeakReveal();
    } else if (!completionReady && !completionTimer) {
      // Keep the horizontal BP board visible through the final confirmation effect.
      completionTimer = setTimeout(() => {
        completionTimer = 0;
        completionReady = true;
        // 巅峰局先播五路定格（播完由 endPeakReveal 接上排列层）；普通小局直接进排列层
        if (d.isPeak && d.picks.blue.length === 5 && d.picks.red.length === 5) startPeakReveal(d);
        else { openOrderPhase(); render(null); }
      }, 1300);
    }
    // 每一局都要走"排列阵容"这一步：BP 走完还不算完，得等导播点确认阵容才切竖版
    const boardReady = finishedBP && completionReady && orderReady;
    root.classList.toggle("draft-complete", boardReady);

    // 强调格的交接：只在角色的确变了的那一帧挂一次性动画
    const prevRoles = lastRoles;
    lastRoles = { blue: pickRoles(d, "blue"), red: pickRoles(d, "red") };
    // 飞入只在换成另一个英雄时播（同一个英雄的重复回显不重播）
    const hero = ctx.getPendingPick()?.hero || null;
    const flyIn = hero !== lastPendingHero;
    // 上一帧待选位里有没有英雄：决定"上一帧那一格是不是放大的"，
    // 也就是这一帧该不该播放大/缩小交接动画
    const wasPendingHero = lastPendingHero;
    lastPendingHero = hero;
    const turn = { prevRoles, flyIn, wasPendingHero };

    renderHead(state);
    renderScore(state);
    renderBans(d, anim);
    renderPicks(d, anim, turn);
    renderHub(d);
    renderWinRate(d);
    renderPool(d);
    renderConfirmBar();
    const ready = boardReady && !state.seriesOver && !state.waiting;
    const result = root.querySelector("[data-dir-result]");
    if (result) result.disabled = !ready;
    root.querySelectorAll("[data-dir-undo]").forEach(b => { b.disabled = !d || state.seriesOver || !!state.waiting || (!d.actions.length && !hero); });
    // 头像懒加载重绑（本板用的是同一套 heroImgTag/data-src 机制）
    ctx.bindHeroImgs?.(root);
  }

  function renderHead(state) {
    els.game.textContent = `BO${state.bo} · 第 ${state.currentGame} 局${state.seriesOver ? " · 系列赛结束" : ""}`;
    // 导播模式不联机、不占席位，房间码这类"接入态"信息在这里没有意义；
    // 板上唯一的身份说明就是 head 里那个写死的 chip。
    if (els.chipRoom) els.chipRoom.style.display = "none";
    if (els.chipRole) els.chipRole.classList.add("live");
  }

  function renderScore(state) {
    els.blueName.textContent = state.blueTeam;
    els.redName.textContent = state.redTeam;
    els.blueScore.textContent = state.score.blue;
    els.redScore.textContent = state.score.red;
    ctx.setTeamLogoEl(els.blueLogo, state.blueTeam);
    ctx.setTeamLogoEl(els.redLogo, state.redTeam);
  }

  function renderBans(d, anim) {
    const peak = !!(d && d.isPeak);
    const step = ctx.currentStep();
    const pending = ctx.getPendingPick();

    const wrap = (side, container) => {
      if (!container) return;
      container.parentElement.style.display = peak ? "none" : "";
      const names = d ? d.bans[side] : [];
      const max = peak ? 0 : 5;
      const html = [];
      for (let i = 0; i < max; i++) {
        // 本手是 ban 且轮到此方时，下一个空槽进入待机（全局 BP 第一手就是 ban，
        // 所以这条分支必须和 pick 一样完整 —— 否则开局在板上看不到任何待确认提示）
        const isTurn = !!step && step.side === side && step.type === "ban" && i === names.length;
        if (i < names.length) {
          const name = names[i];
          const just = anim && anim.side === side && anim.type === "ban" && anim.index === i;
          const av = ctx.heroAvatarUrl(name);
          html.push(`<div class="dir-ban filled ${side}-side${just ? " just-confirmed" : ""}${av ? "" : " hero-image-failed"}" title="${ctx.esc(ctx.displayHero(name))}">
            ${ctx.heroImgTag(av, "slot-img", ctx.esc(ctx.displayHero(name)))}
            <span class="dir-ban-strike"></span>
            <span class="dir-ban-name">${ctx.esc(ctx.displayHero(name))}</span>
          </div>`);
        } else if (isTurn && pending) {
          const pav = ctx.heroAvatarUrl(pending.hero);
          html.push(`<div class="dir-ban pending preview ${side}-side${pav ? "" : " hero-image-failed"}" title="${ctx.esc(ctx.displayHero(pending.hero))}">
            ${ctx.heroImgTag(pav, "slot-img", ctx.esc(ctx.displayHero(pending.hero)))}
            <span class="dir-ban-name" style="opacity:.75">${ctx.esc(ctx.displayHero(pending.hero))}</span>
          </div>`);
        } else {
          html.push(`<div class="dir-ban ${side}-side${isTurn ? " pending" : ""}"><span class="dir-slot-empty">—</span></div>`);
        }
      }
      reconcileSlots(container, html);
    };
    wrap("blue", els.blueBans);
    wrap("red", els.redBans);
  }

  function renderPicks(d, anim, turn) {
    const pending = ctx.getPendingPick();
    const complete = !!d && !ctx.currentStep();
    const portrait = name => {
      const avatar = ctx.heroAvatarUrl(name);
      const url = complete ? (ctx.heroPosterUrl(name).replace('-bigskin-', '-mobileskin-') || avatar) : avatar;
      let tag = ctx.heroImgTag(url, "slot-img", ctx.esc(ctx.displayHero(name)));
      if (complete && url !== avatar && avatar) {
        tag = tag.replace('onerror="', `data-fallback="${ctx.esc(avatar)}" onerror="if(!this.dataset.fallbackTried){this.dataset.fallbackTried='1';this.src=this.dataset.fallback;return;}`);
      }
      return tag;
    };
    const { flyIn } = turn || {};

    const build = (side, container) => {
      // 顺序确认过就按 lineupOrder 排（只影响显示，不动 d.picks 那份 BP 账）
      const names = lineupNames(d, side);
      const roles = pickRoles(d, side);
      const focusIndex = roles.findIndex(role => role === "pending");
      const fixed = roles.reduce((n, role, i) => n + (i < names.length && (role === "hold" || !role) ? 1 : 0), 0);
      const yielding = 5 - fixed - (focusIndex >= 0 ? 1 : 0);
      const html = [];
      for (let i = 0; i < 5; i++) {
        const role = roles[i];
        const size = "";

        if (i < names.length) {
          const name = names[i];
          const just = anim && anim.side === side && anim.type === "pick" && anim.index === i;
          const av = ctx.heroAvatarUrl(name);
          // 组内刚确定的格子保持放大（.hold），等同伴走完再一起缩回
          html.push(`<div class="dir-pick filled ${side}-side${just ? " just-confirmed" : " stable"}${role === "hold" ? " hold" : ""}${av ? "" : " hero-image-failed"}${size}" title="${ctx.esc(ctx.displayHero(name))}">
            ${portrait(name)}
            ${ctx.laneFallback(ctx.heroByName(name))}
            <span class="dir-slot-name">${ctx.esc(ctx.displayHero(name))}</span>
          </div>`);
        } else if (role === "pending" && pending) {
          const pav = ctx.heroAvatarUrl(pending.hero);
          html.push(`<div class="dir-pick pending preview ${side}-side${pav ? "" : " hero-image-failed"}${size}${flyIn ? " fly-in" : ""}">
            ${ctx.heroImgTag(pav, "slot-img", ctx.esc(ctx.displayHero(pending.hero)))}
            <span class="dir-slot-name" style="opacity:.75">${ctx.esc(ctx.displayHero(pending.hero))}</span>
          </div>`);
        } else {
          // 空槽：live = 本组还没轮到的同伴（同样闪框，提示"这一手也是你的"）
          const cls = role === "pending" ? " pending" : (role === "live" ? " live" : "");
          const mark = role ? String(i + 1) : "?";
          html.push(`<div class="dir-pick ${side}-side${cls}${size}"><span class="dir-slot-empty">${mark}</span></div>`);
        }
      }
      reconcileSlots(container, html);
      const gap = parseFloat(getComputedStyle(container).rowGap) || 0;
      if (root.classList.contains("draft-complete") || innerWidth <= 820) {
        [...container.children].forEach(slot => { slot._sizeMotion?.cancel(); slot._sizeMotion = null; slot.style.removeProperty("flex-basis"); });
        return;
      }
      const usable = Math.max(0, container.clientHeight - 4 * gap);
      const unit = usable / 5.7;
      const enlarged = unit * 1.35;
      const reduced = yielding > 0 ? (unit * 5 - fixed * unit - (focusIndex >= 0 ? enlarged : 0)) / yielding : unit;
      [...container.children].forEach((slot, i) => {
        const role = roles[i];
        const locked = i < names.length && (role === "hold" || !role);
        const target = i === focusIndex ? enlarged : locked ? unit : (focusIndex >= 0 ? reduced : unit);
        const current = parseFloat(getComputedStyle(slot).flexBasis) || target;
        if (Math.abs(current - target) < 1) { slot.style.flexBasis = `${target}px`; return; }
        slot._sizeMotion?.cancel();
        slot.style.flexBasis = `${current}px`;
        const motion = slot.animate([{flexBasis:`${current}px`},{flexBasis:`${target}px`}],{duration:420,easing:'cubic-bezier(.22,.78,.24,1)',fill:'forwards'});
        slot._sizeMotion = motion;
        motion.onfinish = () => { if (slot._sizeMotion === motion) { slot.style.flexBasis = `${target}px`; slot._sizeMotion = null; motion.cancel(); } };
      });
      container.classList.toggle("all-filled", names.length >= 5);
    };
    build("blue", els.bluePicks);
    build("red", els.redPicks);
  }

  // Preserve loaded portraits and running animations during unrelated renders.
  // Replacing every slot interrupted the previous lock-in on the next preview.
  function reconcileSlots(container, markup) {
    markup.forEach((html, i) => {
      const template = document.createElement("template");
      template.innerHTML = html;
      const next = template.content.firstElementChild;
      const old = container.children[i];
      const signature = next.className.replace(/\b(just-confirmed|stable|fly-in|turn-enter|turn-leave)\b/g, "").replace(/\s+/g, " ").trim() + "|" + next.innerHTML;
      if (old?.dataset.signature === signature && !next.classList.contains("just-confirmed")) return;
      next.dataset.signature = signature;
      const portrait = next.querySelector(".slot-img");
      const previous = old?.querySelector(".slot-img");
      if (portrait && previous && portrait.dataset.src === previous.dataset.src) {
        portrait.replaceWith(previous);
        ["hero-image-ready", "hero-image-failed"].forEach(c => next.classList.toggle(c, old.classList.contains(c)));
      }
      if (old && next.classList.contains("dir-pick")) next.style.flexBasis = `${old.getBoundingClientRect().height}px`;
      if (next.classList.contains("preview")) next.classList.add("fly-in");
      next.addEventListener("animationend", e => {
        if (e.animationName === "dirIconFlyIn") next.classList.remove("fly-in");
        if (e.animationName === "dirSlotGrow") next.classList.remove("turn-enter");
        if (e.animationName === "dirSlotShrink") next.classList.remove("turn-leave");
      });
      if (old) old.replaceWith(next); else container.appendChild(next);
      if (old) slotObserver?.unobserve(old);
      if (next.classList.contains('dir-pick')) { slotObserver?.observe(next); fitDraftSlot(next); }
      armLockMotion(next);
    });
    while (container.children.length > markup.length) container.lastElementChild.remove();
  }

  function renderHub(d) {
    const step = ctx.currentStep();
    const peak = !!(d && d.isPeak);
    if (!step) {
      els.phase.textContent = ctx.state.seriesOver ? "系列赛结束" : ctx.state.waiting === "sideChoice" ? "败方选择下一局边路" : d ? "BP 完成 · 请确定胜负方" : "等待开局";
      els.timer.textContent = "--";
      els.timer.classList.remove("warning");
      els.progress.style.transform = "scaleX(1)";
      return;
    }
    const sideLabel = step.side === "blue" ? "蓝方" : "红方";
    const typeLabel = step.type === "ban" ? "禁用" : "选用";
    els.phase.textContent = peak ? "巅峰对决 · 盲选" : `${sideLabel} ${typeLabel}阶段`;

    // 本手用时（正计时）
    const key = `${step.side}-${step.type}-${d.actions.length}`;
    if (key !== stepKey) { stepKey = key; stepStartedAt = Date.now(); }
    const secs = Math.max(0, Math.floor((Date.now() - stepStartedAt) / 1000));
    els.timer.textContent = String(secs).padStart(2, "0");
    els.timer.classList.toggle("warning", secs >= 30);

    // 进度：以 30s 为视觉参考刻度，超过则填满（不作强制）
    els.progress.style.transform = `scaleX(${Math.min(1, secs / 30)})`;
  }

  /** 每秒刷新一次计时（只在导播板可见时运行）。 */
  function tick() {
    if (!active) return;
    const d = ctx.state.draft;
    if (d) renderHub(d);
  }

  function renderWinRate(d) {
    const blue = d ? d.picks.blue : [];
    const red = d ? d.picks.red : [];
    const stats = ctx.getHeroStats();
    const pred = window.BPData.predictWinRate(blue, red, stats);
    const single = clamp01(pred?.blueWinProb ?? 0.5);

    const started = blue.length + red.length > 0;
    if (!started) {
      els.blueProb.textContent = "--%";
      els.redProb.textContent = "--%";
      els.blueSub.textContent = "—";
      els.redSub.textContent = "—";
      els.barBlue.style.width = "50%";
      els.barRed.style.width = "50%";
      els.verdict.textContent = "等待阵容成形";
      return;
    }

    const bo = ctx.state.bo || 1;
    const sBlue = seriesWinProb(single, bo);
    els.blueProb.textContent = (single * 100).toFixed(1) + "%";
    els.redProb.textContent = ((1 - single) * 100).toFixed(1) + "%";
    els.blueSub.textContent = `BO${bo} 系列赛 ${(sBlue * 100).toFixed(1)}%`;
    els.redSub.textContent = `BO${bo} 系列赛 ${((1 - sBlue) * 100).toFixed(1)}%`;
    els.barBlue.style.width = (single * 100).toFixed(1) + "%";
    els.barRed.style.width = ((1 - single) * 100).toFixed(1) + "%";

    const lead = Math.abs(single - 0.5);
    const who = single >= 0.5 ? ctx.state.blueTeam : ctx.state.redTeam;
    els.verdict.textContent =
      lead < 0.02 ? "双方势均力敌" :
      lead < 0.06 ? `${who} 略占上风` :
      lead < 0.14 ? `${who} 优势明显` :
      `${who} 阵容压制`;
  }

  function renderPool(d) {
    if (!els.grid) return;
    const step = ctx.currentStep();
    const myTurn = ctx.isMyTurn();
    els.grid.classList.toggle("turn-locked", !myTurn);

    const items = ctx.heroItems().filter((h) => {
      if (filterPos !== "全部" && h.pos !== filterPos) return false;
      if (searchText && !String(h.name).includes(searchText)) return false;
      return true;
    });

    const html = items.map((h) => {
      let status = "available";
      if (step && ctx.isHeroBlocked(h.key, step.side, step.type)) status = "locked";
      if (d) {
        const inBan = ctx.includesHero(d.bans.blue, h.key) || ctx.includesHero(d.bans.red, h.key);
        const inPick = ctx.includesHero(d.picks.blue, h.key) || ctx.includesHero(d.picks.red, h.key);
        if (inBan) status = "banned";
        else if (inPick && !d.isPeak) status = "picked";
        else if (d.isPeak && step && ctx.includesHero(d.picks[step.side], h.key)) status = "picked";
      }
      const pending = ctx.getPendingPick();
      const sel = pending && pending.hero === h.key ? " selected" : "";
      /* 分路图标只在"头像没能显示"时出现：
       *  heroImgTag 会在 load/error 时给父元素挂 hero-image-ready / -failed，
       *  CSS 据此切换。没有可用的头像 URL 时（heroImgTag 直接不出 <img>，
       *  不会触发任何回调）由这里预先标上 failed，否则会永远空着。 */
      const avatarUrl = ctx.heroAvatarUrl(h.name);
      return `<div class="dir-hero ${status}${sel}" data-key="${ctx.esc(h.key)}" title="${ctx.esc(h.name + " · " + h.role + " · " + h.pos)}">
        <div class="dh-avatar${avatarUrl ? "" : " hero-image-failed"}">
          ${ctx.heroImgTag(avatarUrl, null, ctx.esc(h.name), 'loading="lazy"')}
          ${ctx.laneFallback(h, "dh-fallback")}
        </div>
        <span class="dh-name">${ctx.esc(h.name)}</span>
      </div>`;
    }).join("");

    els.grid.innerHTML = html || `<div style="grid-column:1/-1;color:var(--muted);text-align:center;padding:24px;">没有匹配的英雄</div>`;

    // 事件委托：只有可用且轮到自己时才可选
    els.grid.querySelectorAll(".dir-hero").forEach((card) => {
      card.addEventListener("click", () => {
        if (!ctx.isMyTurn() || card.classList.contains("locked") ||
            card.classList.contains("banned") || card.classList.contains("picked")) return;
        ctx.selectHero(card.dataset.key);
      });
    });
    // A lane-tab render rebuilds the cards without running the full director render.
    // Bind lazy avatar loading here so portraits appear immediately after filtering.
    ctx.bindHeroImgs?.(els.grid);
  }

  function renderConfirmBar() {
    const pending = ctx.getPendingPick();
    const show = !!pending && ctx.isMyTurn();
    els.confirm.classList.toggle("show", show);
    if (show) {
      const h = ctx.heroByName(pending.hero);
      els.confirm.querySelector(".dc-hero").textContent =
        ctx.displayHero(pending.hero) + (h ? ` · ${h.role} · ${h.pos}` : "");
    }
  }

  window.Director = {
    init,
    isActive,
    open,
    close,
    render,
    tick,
    _seriesWinProb: seriesWinProb, // 供自测
  };
})();
