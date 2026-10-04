/* ============================================================
 * 王者荣耀 KPL 全局BP模拟器 —— 主逻辑
 * ============================================================ */

(function () {
  "use strict";

  /* -------------------- 常量 -------------------- */
  const ROLE_EMOJI = {
    战士: "⚔️", 坦克: "🛡️", 刺客: "🗡️", 法师: "🔮", 射手: "🏹", 辅助: "✨",
  };
  const ROLE_COLOR = {
    战士: "#f97316", 坦克: "#a16207", 刺客: "#a855f7",
    法师: "#3b82f6", 射手: "#14b8a6", 辅助: "#84cc16",
  };
  const TIER_LABEL = { 4: "S", 3: "A", 2: "B", 1: "C" };
  const TIER_COLOR = { 4: "#f5c542", 3: "#22d3ee", 2: "#8b94b3", 1: "#5b6378" };

  /* 全局BP征召顺序（每局：蓝5Ban+5Pick，红5Ban+5Pick）
   * 第一轮禁用各2 → 第一轮选用各3 → 第二轮禁用各3 → 第二轮选用各2 */
  const DRAFT_ORDER = [
    // 第一轮禁用：各 2
    { side: "blue", type: "ban" },
    { side: "red",  type: "ban" },
    { side: "blue", type: "ban" },
    { side: "red",  type: "ban" },
    // 第一轮选用：各 3
    { side: "blue", type: "pick" },
    { side: "red",  type: "pick" },
    { side: "red",  type: "pick" },
    { side: "blue", type: "pick" },
    { side: "blue", type: "pick" },
    { side: "red",  type: "pick" },
    // 第二轮禁用：各 3（红方先 Ban，蛇形轮转）
    { side: "red",  type: "ban" },
    { side: "blue", type: "ban" },
    { side: "red",  type: "ban" },
    { side: "blue", type: "ban" },
    { side: "red",  type: "ban" },
    { side: "blue", type: "ban" },
    // 第二轮选用：各 2（红方先 Pick）
    { side: "red",  type: "pick" },
    { side: "blue", type: "pick" },
    { side: "blue", type: "pick" },
    { side: "red",  type: "pick" },
  ];

  /* 巅峰对决：无禁用，盲选5人，英雄全解禁、双方可重复 */
  const PEAK_ORDER = (() => {
    const order = [];
    for (let i = 0; i < 5; i++) {
      order.push({ side: "blue", type: "pick" });
      order.push({ side: "red", type: "pick" });
    }
    return order;
  })();

  /* -------------------- 状态 -------------------- */
  const state = {
    blueTeam: "蓝方",
    redTeam: "红方",
    bo: 7,
    score: { blue: 0, red: 0 },
    currentGame: 1,
    seriesOver: false,
    history: [], // 已完成的局：[{game, blueTeam, redTeam, blueLineup, redLineup, winner}]
    draft: null,
    filterPos: "全部",
    searchText: "",
    online: null, // 联机状态：{ code, side, connected } | null（单机）
    waiting: null, // 联机等待提示："result" | "sideChoice" | null
    currentPrediction: null, // 本局 赛前点评文本（BP 完成后生成）
  };

  let predictionInFlight = false; // 正在生成赛前点评（防重复生成）

  let heroStats = BPData.computeHeroStats();
  let freezeTimer = null;

  // 复盘状态
  let reviewState = { gameIndex: 0, draft: null };
  let swapTarget = null; // { side, type, index } 待换英雄的槽位

  // 一次性动效触发器：记录刚确定的那一格，渲染时附加对应动画 class
  let confirmAnim = null; // { side, type, index }

  // 待机（待确认）状态：点击英雄后先进入待机，点"确认"才真正提交并触发选/禁动效
  let pendingPick = null; // { hero }

  // 联机相关
  let roomStream = null; // { close() }: SSE + preview poll fallback
  let onlineStarted = false; // 本房间是否已开局
  let lastSeq = 0; // 已应用的服务器动作序号（断线重连去重）
  /* 设置界面当前模式："solo" | "online" | "director"。
   * 三个模式是同一维度（设置界面的 mode 按钮组）：
   *   solo     → 本机对局，进对局界面
   *   online   → 联机对局，靠房间按钮开局
   *   director → 导播模式，一个人模拟整局，直接进转播板子，不进对局界面 */
  let uiMode = "solo";

  /* -------------------- DOM -------------------- */
  const $ = (id) => document.getElementById(id);

  /* HTML 转义。
   * 队名是用户可控字符串（本机输入 / 联机时对手输入 / 导入的 JSON 记录），
   * 而多处渲染走的是 innerHTML 模板拼接 —— 不转义就是跨玩家的 stored XSS：
   * 对手把队名设成 <img src=x onerror=...>，房主一开"数据分析/复盘"面板即中招。 */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  /* -------------------- 战队 logo --------------------
   * 素材位于 js/teams/（本机收集的 KPL 队标）。按队名关键字匹配，
   * 命中就挂队标、未命中干净退化为纯文字队名（绝不出现裂图占位）。
   * 关键词里混了中文别名（超玩会 / 久竞 / 微博）提高真实队名的命中率。 */
  const TEAM_LOGOS = [
    { keys: ["超玩会", "ag"], file: "ag.webp" },
    { keys: ["ttg"], file: "ttg.webp" },
    { keys: ["estar", "e星"], file: "estar.webp" },
    { keys: ["hero", "久竞"], file: "hero.webp" },
    { keys: ["狼", "wolves"], file: "wolves.webp" },
    { keys: ["rng", "皇族"], file: "rng.webp" },
    { keys: ["tes"], file: "tes.webp" },
    { keys: ["dyg"], file: "dyg.png" },
    { keys: ["edg"], file: "edg.webp" },
    { keys: ["jdg"], file: "jdg.png" },
    { keys: ["ksg"], file: "ksg.webp" },
    { keys: ["lgd"], file: "lgd.webp" },
    { keys: ["rw"], file: "rw.webp" },
    { keys: ["wb", "微博"], file: "wb.webp" },
  ];
  function teamLogoFile(teamName) {
    return window.KPLTeams.logo(teamName);
  }
  function setTeamLogo(elId, teamName) {
    const el = $(elId);
    if (!el) return;
    const f = teamLogoFile(teamName);
    if (f) { el.src = "js/teams/" + f; el.style.display = ""; }
    else { el.removeAttribute("src"); el.style.display = "none"; }
  }

  /* -------------------- 工具 -------------------- */
  /* hero 数据已从「英雄名」升级为「英雄名×分路」条目：内部 key 形如
   * 李信@对抗路；裸名只用于兼容旧记录/旧导入数据。这里所有函数都
   * 接受 key 或裸名。 */
  function heroByName(ref) {
    return BPData.heroByRef ? BPData.heroByRef(ref) : (window.HEROES || []).find((h) => h.name === ref);
  }
  function heroCanonical(ref) { return BPData.heroName ? BPData.heroName(ref) : String(ref || ""); }
  function displayHero(ref) { return BPData.displayHero ? BPData.displayHero(ref) : String(ref || ""); }
  function heroItemKey(ref) { return BPData.heroKey ? BPData.heroKey(ref) : ref; }
  function includesHero(arr, ref) {
    const want = DraftRules.identity(ref);
    return (arr || []).some((x) => DraftRules.identity(x) === want);
  }
  function heroListText(arr) {
    return (arr || []).map(displayHero).join("、");
  }
  /* bpScore 现在返回 {score, raw, base, comp, synergy, counter} */
  function bpValue(v) { return v && typeof v === "object" ? v.score : v; }

  /* 英雄头像/立绘 URL（来自官方 pvp.qq.com 英雄列表，经 heroImages.js 映射） */
  function heroImageId(ref) {
    return (window.HERO_IMAGE || {})[heroCanonical(ref)] || null;
  }
  function heroAvatarUrl(name) {
    const id = heroImageId(name);
    return id ? `https://game.gtimg.cn/images/yxzj/img201606/heroimg/${id}/${id}.jpg` : "";
  }
  function heroPosterUrl(name) {
    const id = heroImageId(name);
    return id ? `https://game.gtimg.cn/images/yxzj/img201606/skin/hero-info/${id}/${id}-bigskin-1.jpg` : "";
  }
  /* <img src=""> 不是"什么都不做"：浏览器会把空 src 解析成当前页面地址再请求一次
   * （在 server.js 上就是又拉一遍 index.html），既浪费请求又可能显示裂图占位。
   * 统一走这个生成器：拿不到 URL 就干脆不发 <img>，只留回退图标/文字。
   * 另外，除球队 logo 外，英雄头像一律先写 data-src，由英雄图延迟加载器
   * （见 bindHeroImgs）在即将进入视口时才赋给 src —— 原因见该函数注释。 */
  function heroImgTag(url, cls, alt, extra) {
    if (!url) return "";
    return `<img${cls ? ` class="${cls}"` : ""} data-src="${url}" alt="${alt}"` +
      `${extra ? " " + extra : ""} onload="this.style.display='';this.parentElement.classList.remove('hero-image-failed');this.parentElement.classList.add('hero-image-ready')" onerror="this.style.display='none';this.parentElement.classList.remove('hero-image-ready');this.parentElement.classList.add('hero-image-failed')" />`;
  }
  // Use the user's five-spirit artwork as a sprite; keep the original asset intact.
  function laneFallback(h, cls = 'slot-fallback') {
    const lane = h?.pos || '游走';
    const key = {'对抗路':'clash','打野':'jungle','中路':'mid','发育路':'farm','游走':'roam'}[lane] || 'roam';
    return `<span class="${cls}" role="img" aria-label="${lane}"><span class="lane-symbol lane-${key}" aria-hidden="true"></span></span>`;
  }
  function slotImgHtml(ref) {
    const h = heroByName(ref);
    return heroImgTag(heroAvatarUrl(ref), "slot-img", displayHero(ref)) + laneFallback(h);
  }

  /* -------------------- 英雄图延迟加载 --------------------
   * 问题（实测）：进入主界面时英雄池一次要拉 130+ 张 game.gtimg.cn 头像。
   * 该 CDN 在放行约 84 张之后就不再放行新连接，剩下的请求一直停在 "pending"——
   * 既不成功也不失败（不是 404，所以 onerror 不触发，也报不出 network error）。
   * 结果：首次进入只有约 6 成头像能显示，其余是回退图标，观感上像"图挂了"。
   *
   * 试过两条无效路径（留作记录，别再走）：
   *   ① 把停滞的 <img> src 摘掉再挂回同一 URL —— 浏览器会把 URL 合并回那条已经
   *      stalled 的请求，等于什么都没做；
   *   ② 给 URL 加 ?kplr=N 破坏缓存 —— 新请求依旧卡在同一个并发闸门上。
   * 结论：这是 CDN 侧的并发限制，客户端唯一能做的就是"少要"。
   *
   * 正解：英雄头像先只写 data-src，用 IntersectionObserver 在元素即将进入视口时
   * 才赋给 src。首屏只请求真正可见的那一屏（约 30~40 张），滚动时按需补，
   * 于是不再触发闸门；已是可见区域的图（选/禁槽位）也会立刻加载，不影响观感。 */
  let heroImgObserver = null;
  function loadHeroImg(el) {
    if (!el || el.dataset.kplLoaded === "1") return;
    const src = el.getAttribute("data-src");
    if (!src) return;
    el.dataset.kplLoaded = "1";
    el.setAttribute("src", src);
  }
  function ensureHeroImgObserver() {
    if (heroImgObserver || typeof IntersectionObserver !== "function") return heroImgObserver;
    heroImgObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        loadHeroImg(en.target);
        heroImgObserver.unobserve(en.target);
      });
    }, { rootMargin: "320px 0px" });  // 提前一屏多开始加载，滚动时基本看不到空窗
    return heroImgObserver;
  }
  /* 用当前的布局位置做一次同步判定：IntersectionObserver 的回调是异步的，
   * 对"一渲染出来就在视口里"的元素（选/禁槽位）我们希望立刻发请求，不要等一帧。 */
  function heroImgInViewport(el) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    return r.bottom > -320 && r.top < vh + 320 && r.right > 0 && r.left < vw;
  }
  /* 绑定作用域内所有待加载的英雄图。scope 不传则整页扫描。 */
  function bindHeroImgs(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    const imgs = root.querySelectorAll("img[data-src]:not([data-kpl-loaded])");
    if (!imgs.length) return;
    const ob = ensureHeroImgObserver();
    if (!ob) { imgs.forEach(loadHeroImg); return; }   // 老引擎退化为全部加载
    imgs.forEach((el) => {
      if (heroImgInViewport(el)) loadHeroImg(el);
      else ob.observe(el);
    });
  }
  // 全局已用英雄按「队伍名」追踪（换边后英雄数据随队伍走，不随边路）
  function usedByTeam(teamName) {
    const set = [];
    state.history.forEach((g) => {
      if (g.blueTeam === teamName) g.blueLineup.forEach((n) => { if (!includesHero(set, n)) set.push(n); });
      if (g.redTeam === teamName) g.redLineup.forEach((n) => { if (!includesHero(set, n)) set.push(n); });
    });
    return set;
  }
  function usedByBlue() { return usedByTeam(state.blueTeam); }
  function usedByRed() { return usedByTeam(state.redTeam); }
  function usedBy(side) { return side === "blue" ? usedByBlue() : usedByRed(); }
  function isPeakGame() {
    return state.bo === 7 && state.currentGame === 7;
  }
  function targetWins() {
    return Math.ceil((state.bo + 1) / 2);
  }

  /* 判断某个英雄在当前步骤是否可用（全局BP核心规则） */
  function isHeroBlocked(ref, side, type) {
    const d = state.draft;
    if (!d) return true;
    const banned = includesHero(d.bans.blue, ref) || includesHero(d.bans.red, ref);
    const pickedBlue = includesHero(d.picks.blue, ref);
    const pickedRed = includesHero(d.picks.red, ref);

    if (type === "ban") {
      if (banned || pickedBlue || pickedRed) return true; // 本局已用不可再禁
      if (!d.isPeak) {
        // 对手上一局已用的英雄不可再禁（禁了无意义，对手已无法使用）；
        // 己方上一局已用的英雄可以禁（用来不给对面用）
        const opp = side === "blue" ? "red" : "blue";
        if (includesHero(usedBy(opp), ref)) return true;
      }
      return false;
    }

    if (type === "pick") {
      if (banned) return true; // 被禁英雄不可选
      if (d.isPeak) {
        // 巅峰对决：仅本队不可重复选同一英雄，跨队可重复、全解禁
        return includesHero(d.picks[side], ref);
      }
      if (pickedBlue || pickedRed) return true; // 本局唯一英雄
      if (includesHero(usedBy(side), ref)) return true; // 全局BP：本队已用
      return false;
    }
    return true;
  }

  /* -------------------- 流程控制 -------------------- */
  function startDraft() {
    pendingPick = null;
    confirmAnim = null;
    state.draft = {
      bans: { blue: [], red: [] },
      picks: { blue: [], red: [] },
      actions: [],
      isPeak: isPeakGame(),
      winRateHistory: [], // 胜率走势：[{step, blueWin}]
    };
    state.currentPrediction = null;
    predictionInFlight = false;
    render();
  }

  function currentStep() {
    const d = state.draft;
    if (!d) return null;
    const order = d.isPeak ? PEAK_ORDER : DRAFT_ORDER;
    if (d.actions.length >= order.length) return null;
    return order[d.actions.length];
  }

  /* 当前这一手的"同方连选组" —— BP 规则里同一方会连选（红方第 0、1 手，
   * 蓝方第 1、2 手等），这几格属于同一次强调：先一起闪烁，轮到谁谁放大，
   * 全部定完才一起复位。板子据此分段做动效（director.js 的 pickRoles）。
   *
   * 返回该组在本方 pick 列里的槽位下标区间 [start, end]（含）；非 pick 阶段返回 null。
   * 槽位下标 = 该方在这手之前已经选出的英雄数，与 d.picks[side] 一一对应。 */
  function currentPickGroup() {
    const d = state.draft;
    if (!d) return null;
    const order = d.isPeak ? PEAK_ORDER : DRAFT_ORDER;
    const a = d.actions.length;
    if (a >= order.length) return null;
    const cur = order[a];
    if (cur.type !== "pick") return null;
    // 向前后扩到同一方连续 pick 的边界（ban 阶段会打断连续，天然隔开）
    let s = a, e = a;
    while (s > 0 && order[s - 1].side === cur.side && order[s - 1].type === "pick") s--;
    while (e + 1 < order.length && order[e + 1].side === cur.side && order[e + 1].type === "pick") e++;
    let start = 0;
    for (let k = 0; k < s; k++) if (order[k].type === "pick" && order[k].side === cur.side) start++;
    return { side: cur.side, start, end: start + (e - s) };
  }

  // 是否轮到"我"操作（单机恒为 true；联机只看己方回合；导播模式一个人操作双方）
  function isMyTurn() {
    if (uiMode === "director") return true;
    if (!state.online) return true;
    const step = currentStep();
    if (!step) return false;
    return step.side === state.online.side;
  }

  // 点击英雄：进入待机（待确认），不立即提交
  function selectHero(heroName) {
    const d = state.draft;
    const step = currentStep();
    if (!d || !step || !isMyTurn()) return;
    if (isHeroBlocked(heroName, step.side, step.type)) return;
    pendingPick = { hero: heroName };
    // 英雄语音只在「选用」阶段播：ban 是禁用，不该替对手开麦。
    // （点击英雄池即出声，与参考站一致；导播台可整体关掉）
    if (uiMode === "director" && window.Director?.isActive() && window.BPAudio && step.type === "pick") BPAudio.playVoice(displayHero(heroName));
    sendPreview(heroName);
    renderPreview();
  }

  // 真正提交一手选/禁（本地与远程通用）。不负责发送网络消息。
  function commitStep(heroName, step) {
    const d = state.draft;
    if (isHeroBlocked(heroName, step.side, step.type)) return false;

    d.actions.push({ side: step.side, type: step.type, hero: heroName });
    if (step.type === "ban") d.bans[step.side].push(heroName);
    else d.picks[step.side].push(heroName);

    // 记录刚确定的那一格，用于触发 pick 缩放定格 / ban 斜线划掉动效
    confirmAnim = {
      side: step.side,
      type: step.type,
      index: step.type === "ban" ? d.bans[step.side].length - 1 : d.picks[step.side].length - 1,
    };

    /* 记录胜率走势（用于走势图）。
     * 除 step/blueWin 外补记 side/type/hero/lo/hi：走势图要能标出"第几手、谁、
     * 禁还是选、这一手把胜率推动了多少"，并画 ±置信带。旧记录缺这些字段时
     * 走势图会退化成只用 step/blueWin 的简版（不报错）。 */
    d.winRateHistory = d.winRateHistory || [];
    const pred = BPData.predictWinRate(d.picks.blue, d.picks.red, heroStats);
    const conf = pred && pred.confidence ? pred.confidence : null;
    const sr = conf && Array.isArray(conf.semiRange) && conf.semiRange.length >= 2 ? conf.semiRange : null;
    d.winRateHistory.push({
      step: d.actions.length,
      blueWin: pred.blueWinProb,
      side: step.side,
      type: step.type,
      hero: displayHero(heroName),
      lo: sr ? +sr[0] : null,
      hi: sr ? +sr[1] : null,
      sample: conf && typeof conf.sample === "number" ? conf.sample : null,
    });

    // 仅巅峰对决（第7局）弹出定格画面；普通小局不弹
    if (d.isPeak && uiMode !== "director") showFreeze(heroName, step.side, step.type);
    render();

    // 本局BP完成 → 进入结算（导播模式是模拟器：停在板上，不弹结算、不进系列赛）
    if (currentStep() === null) {
      if (uiMode === "director") {
        // Keep the final lock-in on screen until the director records a result.
      } else if (state.online && state.online.side !== state.online.hostSide) {
        state.waiting = "result"; // 客方等待房主录入胜负
        renderButtons();
      } else {
        setTimeout(openResultModal, 3100);
      }
    }
    return true;
  }

  // 确认：真正提交这一手并触发动效；联机时同步给对手
  function confirmPick() {
    const d = state.draft;
    const step = currentStep();
    if (!d || !step || !pendingPick || !isMyTurn()) return;
    const heroName = pendingPick.hero;
    pendingPick = null;
    if (!commitStep(heroName, step)) { render(); return; }
    if (state.online) sendAction({ type: step.type, hero: heroName, game: state.currentGame });
  }

  // 取消待机
  function cancelPick() {
    if (!pendingPick) return;
    pendingPick = null;
    sendPreview(null);
    renderPreview();
  }

  /* -------------------- 联机同步 -------------------- */
  let previewInFlight = null;
  let latestPreview = undefined;
  function flushPreview() {
    if (previewInFlight || latestPreview === undefined) return;
    const payload = latestPreview;
    latestPreview = undefined;
    previewInFlight = postJSON('/api/room/preview', payload)
      .catch(e => console.warn('预选同步失败', e))
      .finally(() => { previewInFlight = null; flushPreview(); });
  }
  function sendPreview(hero) {
    if (!state.online) return;
    latestPreview = {code:state.online.code,side:state.online.side,hero,game:state.currentGame,step:state.draft.actions.length};
    flushPreview();
  }
  function sendAction(action) {
    if (!state.online) return;
    // The server clears previews when it accepts an action. Drop superseded previews,
    // but let the active request finish so it cannot arrive after the action.
    latestPreview = undefined;
    Promise.resolve(previewInFlight).then(() => postJSON("/api/room/action", {
      code: state.online.code,
      side: state.online.side,
      action,
    })).then((res) => {
      // 用服务器返回的 seq 推进本地游标，避免轮询 sync 把"自己刚发的动作"再应用一遍
      if (res && res.ok && res.seq) lastSeq = Math.max(lastSeq, res.seq);
    }).catch((e) => console.warn("发送动作失败", e));
  }

  function applyRemoteAction(action) {
    if (!action) return;
    pendingPick = null; // 远端动作会改变棋盘，清除本地待机态避免误提交
    if (action.type === "ban" || action.type === "pick") {
      const step = currentStep();
      if (!state.draft || !step) return;
      if (step.type !== action.type) return; // 顺序保护
      commitStep(action.hero, step);
    } else if (action.type === "undo") {
      commitUndo();
    } else if (action.type === "result") {
      applyResult(action.winner, action.game); // 仅房主（blue）持久化，见 applyResult
    } else if (action.type === "sideChoice") {
      applySideChoiceResult(action.chosenSide);
    } else if (action.type === "seriesSaved") {
      applySeriesSaved(action.series);
    }
  }

  // 联机：客方收到房主广播的已保存大场后本地写入并重算统计。
  // 幂等：同一 id 已存在则跳过（断线重连重放 sync 动作不会重复添加）。
  function applySeriesSaved(series) {
    if (!series || !series.id) return;
    if (BPData.loadSeries().some((s) => s.id === series.id)) return;
    BPData.addSeries(series); // addSeries 保留 series.id
    heroStats = BPData.computeHeroStats();
    render();
  }

  /* -------------------- 联机：创建 / 加入 / SSE 同步 -------------------- */
  function setMode(mode) {
    uiMode = mode;
    if (mode !== "director") window.BPAudio?.setActive(false);
    $("online-panel").classList.toggle("hidden", mode !== "online");
    const dirHint = $("director-hint");
    if (dirHint) dirHint.classList.toggle("hidden", mode !== "director");
    // 联机靠房间按钮开局，用不上"开始 BP"；导播模式要用它进板子
    $("start-btn").classList.toggle("hidden", mode === "online");
    $("start-btn").textContent = mode === "director" ? "进入导播台" : "开始 BP";
  }

  /* -------------------- 导播模式：一个人模拟整局 --------------------
   * 它是和"单机 / 联机"并列的第三种模式，不是对局界面上的一个视图，
   * 也不是"导播观战"（那条只读接房间的通道已取消）。开局即进转播板子，
   * 不进对局界面、不占蓝/红席位、不写系列赛记录。
   *
   * 复用的部分：BP 顺序与合法性判定（currentStep / isHeroBlocked）、胜率算法
   * （BPData.predictWinRate）、英雄池与头像、音频 —— 都取自本系统同一份数据；
   * 唯一的区别是操作权：导播模式下 isMyTurn() 恒为 true，一个人给双方点选。 */
  function startDirectorMode() {
    state.blueTeam = $("blue-name").value.trim() || "蓝方";
    state.redTeam = $("red-name").value.trim() || "红方";
    const activeBo = document.querySelector("#bo-btns button.active");
    state.bo = activeBo ? parseInt(activeBo.dataset.bo, 10) : 7;
    state.score = { blue: 0, red: 0 };
    state.currentGame = 1;
    state.history = [];
    state.seriesOver = false;
    state.waiting = null;
    $("setup-screen").style.display = "none";
    $("main-screen").classList.remove("active"); // 导播模式不经过对局界面
    $("online-status").classList.add("hidden");
    startDraft();
    if (window.Director) Director.open();
    if (window.BPAudio) BPAudio.setActive(true);
    if (window.BPAudio) BPAudio.setMusicEnabled($("dir-music-on")?.checked ?? false);
  }

  async function createRoom() {
    state.blueTeam = $("blue-name").value.trim() || "蓝方";
    state.redTeam = $("red-name").value.trim() || "红方";
    const activeBo = document.querySelector("#bo-btns button.active");
    const bo = activeBo ? parseInt(activeBo.dataset.bo, 10) : 7;
    const sideBtn = document.querySelector("#create-side-btns button.active");
    const hostSide = sideBtn ? sideBtn.dataset.side : "blue"; // 房主自选红蓝方
    const btn = $("btn-create-room");
    btn.disabled = true;
    btn.textContent = "创建中…";
    try {
      const res = await postJSON("/api/room/create", { blueTeam: state.blueTeam, redTeam: state.redTeam, bo, hostSide });
      if (!res.ok) throw new Error(res.message || "创建失败");
      state.bo = bo;
      state.online = { code: res.code, side: res.side, hostSide: res.hostSide, connected: false };
      const box = $("create-result");
      box.classList.remove("hidden");
      const myName = esc(res.side === "blue" ? res.blueTeam : res.redTeam);
      box.innerHTML = `✅ 房间已创建，房间号：<b style="font-size:22px;letter-spacing:4px;color:var(--gold);">${res.code}</b><br>
        <span style="color:var(--muted);">你方为 <b style="color:${res.side === "blue" ? "var(--blue)" : "var(--red)"};">${res.side === "blue" ? "蓝方" : "红方"}</b>（${myName}）<br>把房间号发给对方，对方加入并自定队名后自动开局</span>`;
      connectRoom();
    } catch (e) {
      const box = $("create-result");
      box.classList.remove("hidden");
      box.innerHTML = `<span class="online-error">❌ ${e.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "创建房间";
    }
  }

  async function joinRoom() {
    const code = ($("join-code").value || "").trim().toUpperCase();
    if (!code) {
      $("join-error").textContent = "请输入 4 位房间号";
      $("join-error").classList.remove("hidden");
      return;
    }
    const teamName = ($("join-team-name").value || "").trim(); // 客方可自定己方队伍名
    const btn = $("btn-join-room");
    btn.disabled = true;
    try {
      const res = await postJSON("/api/room/join", { code, teamName: teamName || undefined });
      if (!res.ok) throw new Error(res.message || "加入失败");
      state.blueTeam = res.blueTeam;
      state.redTeam = res.redTeam;
      state.bo = res.bo;
      state.online = { code: res.code, side: res.side, hostSide: res.hostSide, connected: false };
      $("join-error").classList.add("hidden");
      connectRoom();
    } catch (e) {
      $("join-error").textContent = "❌ " + e.message;
      $("join-error").classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  }

  function connectRoom() {
    if (!state.online) return;
    const connection = state.online;
    const { code, side } = connection;
    if (roomStream) roomStream.close();
    let stopped = false;
    let timer = null;
    const controller = new AbortController();
    let events = null;
    const poll = async () => {
      if (stopped || state.online !== connection) return;
      try {
        const res = await fetch(apiUrl("/api/room/poll?code=" + encodeURIComponent(code) + "&side=" + side),
          {signal:controller.signal,cache:'no-store'});
        const data = await res.json();
        if (stopped || state.online !== connection) return;
        if (data.ok === false) { connection.connected = false; return; }
        if (!connection.connected) {
          connection.connected = true;
          if (connection.side !== connection.hostSide) startOnlineGame();
        }
        handleRoomMessage({ type: "sync", ...data });
      } catch (e) {
        if (!stopped && state.online === connection) connection.connected = false;
      } finally {
        if (!stopped && state.online === connection) timer = setTimeout(poll, 550);
      }
    };
    // The live stream delivers joins and confirmed actions immediately. Polling remains
    // for previews, missed stream events, and proxies that buffer streaming responses.
    if (typeof EventSource === 'function') {
      events = new EventSource(apiUrl('/api/room/stream?code='+encodeURIComponent(code)+'&side='+side));
      events.onmessage = event => {
        if (stopped || state.online !== connection) return;
        try { handleRoomMessage(JSON.parse(event.data)); }
        catch (e) { console.warn('联机消息解析失败', e); }
      };
    }
    poll();
    roomStream = {close() { stopped=true;clearTimeout(timer);controller.abort();events?.close(); }};
  }

  function handleRoomMessage(msg) {
    if (!msg) return;
    if (msg.type === "sync") {
      state.bo = msg.bo;
      if (state.online && !state.online.hostSide) state.online.hostSide = msg.hostSide;
      if (!state.draft) startDraft();
      // 先应用动作（选边等动作会本地换边/换队名），再用服务器队名（已随选边动作更新）为准覆盖，
      // 避免 sync 用静态队名把客户端刚交换的队名覆盖回去，导致"选边后又被改回"
      (msg.actions || []).forEach((entry) => {
        if (entry.seq <= lastSeq) return;
        lastSeq = entry.seq;
        if (entry.side !== state.online?.side) applyRemoteAction(entry.action);
      });
      const preview = msg.preview;
      if ('preview' in msg && state.online && !isMyTurn() && currentStep()) {
        const hero = preview && preview.side === currentStep().side && preview.game === state.currentGame && preview.step === state.draft.actions.length ? preview.hero : null;
        if ((pendingPick?.hero || null) !== hero) {
          pendingPick = hero ? {hero} : null;
          renderPreview();
        }
      }
      state.blueTeam = msg.blueTeam;
      state.redTeam = msg.redTeam;
      // 房主：对手已加入则开局（房主无论选蓝/红都适用）
      if (state.online) {
        const opp = state.online.hostSide === "blue" ? "red" : "blue";
        const oppJoined = opp === "blue" ? msg.blueJoined : msg.redJoined;
        if (state.online.side === state.online.hostSide && oppJoined) startOnlineGame();
      }
    } else if (msg.type === "action") {
      if (msg.seq <= lastSeq) return;
      lastSeq = msg.seq;
      if (msg.side !== state.online?.side) applyRemoteAction(msg.action);
    } else if (msg.type === "joined") {
      if (msg.blueTeam) state.blueTeam = msg.blueTeam;
      if (msg.redTeam) state.redTeam = msg.redTeam;
      if (msg.bo) state.bo = msg.bo;
      startOnlineGame(); // 房主：对手已加入，开局
    }
  }

  function startOnlineGame() {
    if (onlineStarted) return;
    onlineStarted = true;
    lastSeq = 0;
    $("setup-screen").style.display = "none";
    $("main-screen").classList.add("active");
    $("online-status").classList.remove("hidden");
    state.score = { blue: 0, red: 0 };
    state.currentGame = 1;
    state.history = [];
    state.seriesOver = false;
    state.waiting = null;
    startDraft();
  }

  // 撤销最后一手（本地与远程通用）。不负责发送网络消息。
  function commitUndo() {
    const d = state.draft;
    if (!d || d.actions.length === 0) return false;
    const last = d.actions.pop();
    if (d.winRateHistory && d.winRateHistory.length) d.winRateHistory.pop();
    if (last.type === "ban") {
      const arr = d.bans[last.side];
      arr.splice(arr.lastIndexOf(last.hero), 1);
    } else {
      const arr = d.picks[last.side];
      arr.splice(arr.lastIndexOf(last.hero), 1);
    }
    render();
    return true;
  }

  function undo() {
    if (state.seriesOver || state.waiting === "sideChoice") return;
    if (pendingPick) { pendingPick = null; render(); return; }
    if (state.online) {
      const d = state.draft;
      const step = currentStep();
      const last = d && d.actions.length ? d.actions[d.actions.length - 1] : null;
      // 联机撤销的安全窗口：必须是"自己上一步"且"仍轮到自己"。
      // 这样对方不可能并发操作，两端从同一状态弹出同一手，必然一致。
      if (!d || !last || !step || step.side !== state.online.side || last.side !== state.online.side) return;
      if (commitUndo()) sendAction({ type: "undo" });
      return;
    }
    commitUndo();
  }

  /* -------------------- 渲染 -------------------- */
  function render() {
    // 先快照本手刚确定的那一格：renderTeamPanels 末尾会把 confirmAnim 清空，
    // 而导播板要在同一次渲染里播放它的定格动效，所以必须提前取。
    const justConfirmed = confirmAnim;
    /* 导播模式没有对局界面：整块 main-screen 都不渲染（它本来就是 hidden 的），
     * 只把这一帧交给板子。少走一遍操作台的 DOM 重建，也让"独立"落到实处。 */
    if (uiMode === "director") {
      if (window.Director && Director.isActive()) Director.render(justConfirmed);
      confirmAnim = null; // 板子已经消费掉这一帧的定格动效，别让它每帧重播
      syncAudioPanel();
      return;
    }
    renderTopBar();
    renderTeamPanels();
    renderHeroGrid();
    renderDraftStatus();
    renderAnalysis();
    maybeGeneratePrediction(); // BP 完成后自动生成 赛前点评
    renderButtons();
    // 每次重渲染后再绑一次：视口内的头像立刻发请求，其余等滚动到才请求
    bindHeroImgs(document);
    startConfirmationMotion();
    // 导播板是第二视图，镜像同一份 state（单机 / 联机 / 导播观察者共用）
    if (window.Director && Director.isActive()) Director.render(justConfirmed);
    syncAudioPanel();
  }

  /* 把音频面板拉回与 BPAudio 一致，并处理"到第 7 局自动播巅峰对决"。
   * setPeak 幂等（只有进出巅峰局那一刻才动作），所以可以每帧调用；
   * 放在 render() 里是为了让联机远端推进的局数也走同一条路径。 */
  function syncAudioPanel() {
    if (!window.BPAudio) return;
    BPAudio.setActive(uiMode === "director" && !!window.Director?.isActive());
    // 第 7 局 = 巅峰对决（BO7 打满）。音乐开关关着时 setPeak 不会出声。
    BPAudio.setPeak(isPeakGame());
    // 下拉列表显示"实际在放的那首"：巅峰局显示巅峰曲，局后回到用户选择
    const sel = $("dir-music");
    if (sel) {
      const want = BPAudio.currentMusic();
      if (want && sel.value !== want) sel.value = want;
    }
    // resetToSetup 会把音乐关掉，勾选框不能还停在"已开"上撒谎
    const on = $("dir-music-on");
    if (on && on.checked !== BPAudio.isMusicEnabled()) on.checked = BPAudio.isMusicEnabled();
  }

  // A preview changes one slot, one pool highlight and the confirm controls.
  // Rebuilding every hero card and analysis panel for each hover/click caused
  // visible stalls, especially while a remote player selected repeatedly.
  function renderPreview() {
    // 导播模式：没有对局界面可刷，把这一帧直接交给板子
    if (uiMode === "director") {
      if (window.Director && Director.isActive()) Director.render(null);
      return;
    }
    const step = currentStep();
    if (step) renderSlots(step.side);
    document.querySelectorAll('#hero-grid .hero-card.selected').forEach(card=>card.classList.remove('selected'));
    if (pendingPick) {
      const card = Array.from(document.querySelectorAll('#hero-grid .hero-card'))
        .find(node=>node.dataset.hero===String(pendingPick.hero));
      card?.classList.add('selected');
    }
    renderDraftStatus();
    bindHeroImgs(document);
    // 预选只走这条轻量路径（不经过 render()），导播板必须一并跟着刷新，
    // 否则板上看不到待确认的英雄与释放的空槽。
    if (window.Director && Director.isActive()) Director.render(null);
  }

  // Avatar URLs are lazy-loaded. Start the lock-in only after pixels are ready;
  // otherwise a CSS animation can finish while the square still shows a placeholder.
  function startConfirmationMotion() {
    document.querySelectorAll('#main-screen .just-confirmed:not([data-motion-armed])').forEach(slot => {
      slot.dataset.motionArmed = '1';
      const avatar = slot.querySelector('.slot-img');
      let started = false;
      const begin = () => {
        if (started || !slot.isConnected) return;
        started = true;
        const ring = document.createElement('span');
        ring.className = 'confirm-radial';
        ring.setAttribute('aria-hidden', 'true');
        slot.appendChild(ring);
        const scan = document.createElement('span');
        scan.className = 'confirm-scan';
        scan.setAttribute('aria-hidden', 'true');
        const edge = document.createElement('span');
        edge.className = 'confirm-edge';
        edge.setAttribute('aria-hidden', 'true');
        let reveal = null;
        if (slot.classList.contains('pick-slot')) {
          if (avatar?.naturalWidth) {
            reveal = avatar.cloneNode();
            reveal.classList.add('confirm-portrait');
            ['data-src', 'onload', 'onerror'].forEach(attr => reveal.removeAttribute(attr));
            reveal.alt = '';
            reveal.setAttribute('aria-hidden', 'true');
            slot.appendChild(reveal);
          }
          slot.appendChild(scan);
        }
        slot.appendChild(edge);
        slot.classList.add('is-animating');
        // Run the lock light with Web Animations so it also works when the OS
        // requests reduced motion and does not depend on a stylesheet keyframe.
        scan.style.animation = 'none';
        edge.style.animation = 'none';
        ring.style.animation = 'none';
        const scanMotion = slot.classList.contains('pick-slot') ? scan.animate([
          {transform:'translateY(0)',opacity:0},
          {transform:'translateY(-110%)',opacity:1,offset:.22},
          {transform:'translateY(-440%)',opacity:0},
        ],{duration:720,delay:70,easing:'cubic-bezier(.2,.65,.3,1)'}) : null;
        const edgeMotion = edge.animate([
          {opacity:0,clipPath:'inset(100% 0 0)'},
          {opacity:1,clipPath:'inset(0)',offset:.38},
          {opacity:0,clipPath:'inset(0)'}
        ],{duration:1180,easing:'ease-in-out'});
        ring.animate([
          {transform:'scale(.3)',opacity:0},
          {transform:'scale(1)',opacity:.75,offset:.38},
          {transform:'scale(1.45)',opacity:0}
        ],{duration:1180,easing:'cubic-bezier(.37,0,.23,1)'});
        if (avatar?.naturalWidth && slot.classList.contains('pick-slot')) avatar.animate([
          {transform:'scale(1)',filter:'brightness(1)'},
          {transform:'scale(1.18)',filter:'brightness(1.3)',offset:.52},
          {transform:'scale(1)',filter:'brightness(1)'}
        ],{duration:1800,easing:'cubic-bezier(.37,0,.23,1)'});
        const finish = () => {
          slot.classList.remove('is-animating', 'just-confirmed');
          ring.remove();
          scan.remove();
          edge.remove();
          reveal?.remove();
        };
        edgeMotion.finished.then(finish).catch(finish);
        setTimeout(finish, 2100);
      };
      if (!avatar || avatar.complete) begin();
      else {
        avatar.addEventListener('load', begin, {once:true});
        avatar.addEventListener('error', begin, {once:true});
        // Some hero CDN requests can remain pending without load/error; never
        // let a stalled portrait suppress the lock-in light effect.
        setTimeout(begin, 240);
      }
    });
  }

  // Preserve unchanged nodes: renders must not restart pulses or interrupt lock-in.
  function reconcileSlot(container, slot, index) {
    const signature = slot.className.replace(/ just-confirmed/g, '') + '|' + slot.innerHTML;
    const previous = container.children[index];
    if (previous?.dataset.signature === signature) return;
    slot.dataset.signature = signature;
    const avatar = slot.querySelector('.slot-img');
    const oldAvatar = previous?.querySelector('.slot-img');
    if (slot.classList.contains('just-confirmed') && previous?.classList.contains('preview') &&
        avatar && oldAvatar && avatar.dataset.src === oldAvatar.dataset.src) {
      const oldImageStyle = getComputedStyle(oldAvatar);
      slot.style.setProperty('--confirm-opacity', oldImageStyle.opacity);
      slot.style.setProperty('--confirm-scale', new DOMMatrix(oldImageStyle.transform).a);
      slot.style.setProperty('--confirm-filter-start', oldImageStyle.filter);
      slot.style.setProperty('--confirm-shadow-start', getComputedStyle(previous).boxShadow);
      avatar.replaceWith(oldAvatar);
      ['hero-image-ready','hero-image-failed'].forEach(c => slot.classList.toggle(c, previous.classList.contains(c)));
    }
    if (previous) container.replaceChild(slot, previous);
    else container.appendChild(slot);
  }

  function renderTopBar() {
    $("game-tag").textContent = "第 " + state.currentGame + " 局";
    // 官方转播版式：顶部队名与队标跟随换边/改名实时同步
    $("tb-blue-name").textContent = state.blueTeam;
    $("tb-red-name").textContent = state.redTeam;
    setTeamLogo("tb-blue-logo", state.blueTeam);
    setTeamLogo("tb-red-logo", state.redTeam);
    $("score-blue").textContent = state.score.blue;
    $("score-red").textContent = state.score.red;
    const peakTag = $("peak-tag");
    if (isPeakGame()) peakTag.classList.remove("hidden");
    else peakTag.classList.add("hidden");

    // 联机状态
    const os = $("online-status");
    if (state.online) {
      os.classList.remove("hidden");
      const isHost = state.online.side === state.online.hostSide;
      os.textContent = "联机 · " + (state.online.side === "blue" ? "蓝方" : "红方") + (isHost ? "(房主)" : "");
      if (!state.online.connected) os.textContent += " · 连接中";
    } else {
      os.classList.add("hidden");
    }
  }

  function renderTeamPanels() {
    $("blue-name-display").textContent = state.blueTeam;
    $("red-name-display").textContent = state.redTeam;
    setTeamLogo("blue-panel-logo", state.blueTeam);
    setTeamLogo("red-panel-logo", state.redTeam);

    renderSlots("blue");
    renderSlots("red");
    confirmAnim = null; // 动效只播放一次
    renderUsed("blue");
    renderUsed("red");
    renderTurn();

    // 巅峰对决无禁用环节，隐藏 Ban 标签
    const peak = state.draft && state.draft.isPeak;
    $("blue-ban-label").style.display = peak ? "none" : "block";
    $("red-ban-label").style.display = peak ? "none" : "block";
  }

  function renderSlots(side) {
    const d = state.draft;
    const step = currentStep();
    const banContainer = $(side + "-bans");
    const pickContainer = $(side + "-picks");
    const banCount = d ? d.bans[side].length : 0;
    const pickCount = d ? d.picks[side].length : 0;
    const maxBan = d && d.isPeak ? 0 : 5;
    const maxPick = 5;
    const isMyBanTurn = !!step && step.side === side && step.type === "ban";
    const isMyPickTurn = !!step && step.side === side && step.type === "pick";

    /* 分路角标（.slot-meta.slot-role）已从选/禁槽位移除 —— 见下方槽位渲染处的说明。
       分路信息仍然完整保留在槽位的 title 悬停提示里（slotTitle 会拼上 role · pos）。 */

    const exposureOf = () => [];
    const warnHtml = () => "";
    const slotTitle = (name, h) => displayHero(name) + (h ? " · " + h.role + " · " + h.pos : "");

    while (banContainer.children.length > maxBan) banContainer.lastElementChild.remove();
    for (let i = 0; i < maxBan; i++) {
      const slot = document.createElement("div");
      slot.className = "ban-slot";
      if (i < banCount) {
        const name = d.bans[side][i];
        const h = heroByName(name);
        const role = h ? h.role : "辅助";
        const expo = exposureOf(name);
        slot.classList.add("filled");
        if (confirmAnim && confirmAnim.side === side && confirmAnim.type === "ban" && confirmAnim.index === i) slot.classList.add("just-confirmed");
        if (expo.length) slot.classList.add("exposed", "slot-exposed");
        slot.title = slotTitle(name, h, expo);
        // 头像置灰 + 单条斜线划掉（25年年总灰白风格）+ 被克制警戒角标（.slot-warn）
        // 分路角标（.slot-meta.slot-role）已从槽位上撤掉：槽位本身只有 60px 见方，
        // 顶着「对抗/发育」会盖住英雄脸，而分路信息在 title 里仍然完整可查。
        slot.innerHTML = heroImgTag(heroAvatarUrl(name), "slot-img", esc(displayHero(name))) + `
          ${laneFallback(h)}
          <span class="ban-strike"></span>
          <span class="ban-name">${warnHtml(expo)}${esc(displayHero(name))}</span>`;
      } else {
        // 待机槽位：轮到本队禁用时，下一个空槽闪烁提示；有待确认英雄时显示预览
        if (isMyBanTurn && i === banCount && pendingPick) {
          slot.classList.add("pending", "preview");
          slot.innerHTML = slotImgHtml(pendingPick.hero) +
            `<span class="ban-name" style="opacity:.75;">${displayHero(pendingPick.hero)}</span>`;
        } else {
          slot.textContent = "—";
          if (isMyBanTurn && i === banCount) slot.classList.add("pending");
        }
      }
      reconcileSlot(banContainer, slot, i);
    }

    while (pickContainer.children.length > maxPick) pickContainer.lastElementChild.remove();
    for (let i = 0; i < maxPick; i++) {
      const slot = document.createElement("div");
      slot.className = "pick-slot";
      if (i < pickCount) {
        const name = d.picks[side][i];
        const h = heroByName(name);
        const role = h ? h.role : "辅助";
        const expo = exposureOf(name);
        slot.classList.add("filled");
        if (expo.length) slot.classList.add("exposed", "slot-exposed");
        slot.style.setProperty("--role-color", ROLE_COLOR[role] || "#8b94b3");
        slot.title = slotTitle(name, h, expo);
        // 已选位：头像 + 名字条 + 被克制警戒（.slot-warn）；分路角标同 ban 槽已撤（见上）
        slot.innerHTML = heroImgTag(heroAvatarUrl(name), "slot-img", esc(displayHero(name))) + `
          ${laneFallback(h)}
          <span class="pick-name">${warnHtml(expo)}${esc(displayHero(name))}</span>`;
        // Only the newly confirmed hero portrait moves; the slot frame stays fixed.
        if (confirmAnim && confirmAnim.side === side && confirmAnim.type === "pick" && confirmAnim.index === i) {
          slot.classList.add("just-confirmed");
        }
      } else {
        // 待机槽位：轮到本队选用时，下一个空槽闪烁提示；有待确认英雄时显示预览
        if (isMyPickTurn && i === pickCount && pendingPick) {
          slot.classList.add("pending", "preview");
          slot.innerHTML = slotImgHtml(pendingPick.hero) +
            `<span class="pick-name" style="opacity:.75;">${displayHero(pendingPick.hero)}</span>`;
        } else {
          slot.textContent = "?";
          if (isMyPickTurn && i === pickCount) slot.classList.add("pending");
        }
      }
      reconcileSlot(pickContainer, slot, i);
    }
  }

  function renderUsed(side) {
    const container = $(side + "-used");
    const used = usedBy(side);
    container.innerHTML = "";
    if (used.length === 0) {
      container.innerHTML = `<span class="used-empty">本队尚未使用英雄</span>`;
      return;
    }
    // 全局 BP 的核心信息：已用英雄按头像网格排布，比一行小字更接近转播画面
    used.forEach((ref) => {
      const name = displayHero(ref);
      const el = document.createElement("span");
      el.className = "used-hero";
      el.title = name + "（本队后续不可再选）";
      el.innerHTML =
        heroImgTag(heroAvatarUrl(ref), null, name, 'loading="lazy"') +
        `<span class="used-name">${name}</span>`;
      container.appendChild(el);
    });
  }

  function renderTurn() {
    const step = currentStep();
    const blueTurn = $("blue-turn");
    const redTurn = $("red-turn");
    blueTurn.textContent = "轮到你了";
    redTurn.textContent = "轮到你了";
    blueTurn.classList.add("hidden");
    redTurn.classList.add("hidden");
    if (!step) return;
    if (state.online) {
      // 联机：己方回合显示"轮到你了"，对方回合显示"对方操作中"
      const mine = step.side === state.online.side;
      const myEl = state.online.side === "blue" ? blueTurn : redTurn;
      const oppEl = state.online.side === "blue" ? redTurn : blueTurn;
      if (mine) myEl.classList.remove("hidden");
      else { oppEl.textContent = "对方操作中"; oppEl.classList.remove("hidden"); }
      return;
    }
    if (step.side === "blue") blueTurn.classList.remove("hidden");
    else redTurn.classList.remove("hidden");
  }

  function renderDraftStatus() {
    const el = $("draft-status");
    const step = currentStep();
    el.classList.remove("blue-turn", "red-turn");

    // 手数进度：全局 BP 共 20 手（巅峰对决 10 手），让板面知道「下到第几手了」
    const dd = state.draft;
    const totalHands = dd ? (dd.isPeak ? PEAK_ORDER.length : DRAFT_ORDER.length) : 0;
    const handChip = (done) => totalHands
      ? `<span class="ds-hand" title="全局 BP 正赛共 ${totalHands} 手">${done ? "共 " + totalHands + " 手已下完" : "第 " + (dd.actions.length + 1) + " / " + totalHands + " 手"}</span>`
      : "";

    if (state.online && state.waiting === "result") {
      el.innerHTML = `<span class="phase">⏳ 等待房主录入本局胜负…</span>`;
      return;
    }
    if (state.online && state.waiting === "sideChoice") {
      el.innerHTML = `<span class="phase">⏳ 等待对方选边…</span>`;
      return;
    }
    if (!step) {
      el.innerHTML = `<span class="phase">本局BP完成</span>${handChip(true)}`;
      return;
    }
    const sideName = esc(step.side === "blue" ? state.blueTeam : state.redTeam);
    const sideColor = step.side === "blue" ? "var(--blue)" : "var(--red)";
    const typeLabel = step.type === "ban" ? "禁用" : "选用";
    const phaseLabel = state.draft.isPeak ? "巅峰对决 · 盲选" : (step.type === "ban" ? "禁用阶段" : "选用阶段");
    el.classList.add(step.side + "-turn");
    let html = `<span class="phase-dot"></span><span class="phase">${phaseLabel}</span>
      <span class="side-name" style="color:${sideColor};">${sideName}</span>
      <span>进行 ${typeLabel}</span>${handChip(false)}`;
    if (state.online && !isMyTurn()) {
      html += `<span style="color:var(--muted);font-size:12px;">（对方回合）</span>`;
    }
    if (pendingPick && isMyTurn()) {
      const h = heroByName(pendingPick.hero);
      html += `<div class="pending-confirm">
        <span class="pc-hero"><b style="color:${ROLE_COLOR[h ? h.role : "辅助"] || "#fff"};">${displayHero(pendingPick.hero)}</b>${h ? ` · ${h.role} · ${h.pos}` : ""}</span>
        <button class="pc-btn pc-ok" id="confirm-pick-btn" type="button">✓ 确认</button>
        <button class="pc-btn pc-cancel" id="cancel-pick-btn" type="button">✕ 取消</button>
      </div>`;
    }
    el.innerHTML = html;
    if (pendingPick && isMyTurn()) {
      $("confirm-pick-btn").addEventListener("click", confirmPick);
      $("cancel-pick-btn").addEventListener("click", cancelPick);
    }
  }

  function renderHeroGrid() {
    const grid = $("hero-grid");
    const previousCards = new Map(Array.from(grid.children).filter(c => c.dataset.hero).map(c => [c.dataset.hero, c]));
    const visibleKeys = new Set();
    grid.classList.toggle("turn-locked", !!state.online && !isMyTurn());
    const step = currentStep();
    const list = (BPData.heroItems ? BPData.heroItems() : window.HEROES || []).filter((h) => {
      if (state.filterPos !== "全部" && h.pos !== state.filterPos) return false;
      if (state.searchText && !h.name.includes(state.searchText)) return false;
      return true;
    });

    list.forEach((h, index) => {
      const card = document.createElement("div");
      card.className = "hero-card";
      card.style.setProperty("--role-color", ROLE_COLOR[h.role] || "#8b94b3");

      const st = heroStats[h.key] || {};
      const liveTier = st.tier || h.tier; // 实时赛场梯度优先，未加载数据时沿用静态
      const tierBadge = TIER_LABEL[liveTier] || "B";

      // 判断状态
      let status = "available";
      if (step) {
        if (isHeroBlocked(h.key, step.side, step.type)) status = "locked";
      }
      // 附加视觉状态：被禁 / 被选
      const d = state.draft;
      if (d) {
        if (includesHero(d.bans.blue, h.key) || includesHero(d.bans.red, h.key)) {
          status = "banned";
        } else if (d.isPeak) {
          // 巅峰对决：英雄全解禁，仅本队已选的不可再选，对方已选仍可选
          const ownPicks = d.picks[step ? step.side : "blue"] || [];
          if (includesHero(ownPicks, h.key)) status = "picked";
        } else if (includesHero(d.picks.blue, h.key) || includesHero(d.picks.red, h.key)) {
          status = "picked";
        }
      }

      if (status !== "available") card.classList.add(status);
      // 待机中：高亮当前待确认的英雄
      if (pendingPick && pendingPick.hero === h.key) card.classList.add("selected");

      const wrNum = Number(st.winRate);
      const wrText = (isFinite(wrNum) ? wrNum * 100 : 50).toFixed(1) + "%";
      const tierColor = TIER_COLOR[liveTier] || "#8b94b3";
      // 卡片信息层次：头像 → 英雄名 → 角色·分路 → 梯度徽章 + 胜率
      // （长文本用 .hero-wr-val 省略号收口，避免把卡片撑宽导致右侧被裁）
      card.title = h.name + " · " + h.role + " · " + h.pos +
        " · 梯度 " + tierBadge + (st.tierLive ? "（实时赛场数据）" : "") + (h.referenceOnly && !(st.sample > 0) ? " · 暂无比赛样本，参考值 " : " · 胜率 ") + wrText;
      card.innerHTML = `
        <div class="hero-avatar">
          ${heroImgTag(heroAvatarUrl(h.name), null, esc(h.name), 'loading="lazy"')}
          ${laneFallback(h, "hero-avatar-fallback")}
        </div>
        <div class="hero-name">${esc(h.name)}</div>
        <div class="hero-role">${esc(h.role)} · ${esc(h.pos)}</div>
        <div class="hero-wr">
          ${st.tierLive ? '<span class="hero-tier-live" title="实时赛场梯度（当前赛季职业数据）">●</span>' : ""}<span class="hero-tier" style="--tier-color:${tierColor}" title="梯度 ${tierBadge}${st.tierLive ? " · 实时赛场数据" : ""}">${tierBadge}</span><span class="hero-wr-val" title="胜率 ${wrText}">${h.referenceOnly && !(st.sample > 0) ? '参考' : '胜率'} ${wrText}</span>
        </div>`;

      const key = String(h.key);
      visibleKeys.add(key);
      const content = card.innerHTML;
      const previous = previousCards.get(key);
      const node = previous || card;
      if (previous) {
        previous.className = card.className;
        previous.style.cssText = card.style.cssText;
        previous.title = card.title;
        if (previous.dataset.content !== content) {
          const oldAvatar = previous.querySelector('.hero-avatar');
          const newAvatar = card.querySelector('.hero-avatar');
          if (oldAvatar?.querySelector('img')?.dataset.src === newAvatar?.querySelector('img')?.dataset.src) {
            newAvatar.replaceWith(oldAvatar);
          }
          previous.replaceChildren(...card.childNodes);
        }
      }
      node.dataset.hero = key;
      node.dataset.content = content;
      node.onclick = status === "available" && isMyTurn() ? () => selectHero(h.key) : null;
      if (grid.children[index] !== node) grid.insertBefore(node, grid.children[index] || null);
    });
    Array.from(grid.children).forEach(card => { if (!visibleKeys.has(card.dataset.hero)) card.remove(); });

    if (list.length === 0) {
      grid.innerHTML = `<div style="color:var(--muted);text-align:center;padding:30px;">没有匹配的英雄</div>`;
    }
    /* 英雄图是延迟加载的，必须在这里重新绑定：
     * 搜索/分路筛选直接调用本函数（不经过 render()），重建出来的卡片若没人
     * 把它们交给 IntersectionObserver，就会全部停在 data-src 状态 ——
     * 界面表现为"一筛选头像全没了"。 */
    bindHeroImgs(grid);
  }

  function formatBpScore(v, other) {
    // 防御：模型层给出 null / undefined / NaN（空阵容、旧版本数据）时退化成占位符
    const n = Number(v);
    if (!isFinite(n)) return "--";
    const o = Number(other);
    // 难以抉择（两方分差 < 2）时保留两位小数，否则保留一位
    return Math.abs(n - (isFinite(o) ? o : n)) < 2 ? n.toFixed(2) : n.toFixed(1);
  }

  function predictionInterpretation(g, historical = false) {
    const blue = g.picks ? g.picks.blue : g.blueLineup || [];
    const red = g.picks ? g.picks.red : g.redLineup || [];
    const pred = BPData.predictWinRate(blue, red, heroStats);
    const prob = pred.blueWinProb;
    const hist = g.winRateHistory || [];
    const saved = hist.length ? hist[hist.length - 1].blueWin : null;
    const fav = prob >= .5 ? g.blueTeam : g.redTeam;
    const gap = Math.abs(prob - .5) * 200;
    const conf = pred.confidence || {};
    const range = Array.isArray(conf.semiRange) ? conf.semiRange : null;
    const shortages = [[g.blueTeam, blue],[g.redTeam, red]].map(([team, lineup]) => {
      const c = BPData.compositionAnalysis(lineup);
      return c.weaknesses.length ? esc(team) + '：关注' + esc(c.weaknesses.map(x=>x.label).join('、')) : esc(team) + '：阵容能力较完整';
    });
    return `<section class="insight-card"><div class="eyebrow">WIN PROBABILITY · ${historical ? '当前数据重算' : '阵容预测'}</div>
      <div class="prob-duel"><strong>${esc(g.blueTeam)} ${(prob*100).toFixed(1)}%</strong><span>VS</span><strong>${esc(g.redTeam)} ${((1-prob)*100).toFixed(1)}%</strong></div>
      <div class="prob-meter"><i style="width:${prob*100}%"></i></div>
      <p>${gap < 2 ? '双方接近均势，微小分差不足以说明明显优势。' : '模型偏向 ' + esc(fav) + '，双方预测相差 ' + gap.toFixed(1) + ' 个百分点。'}</p>
      <p>${shortages.join('；')}。</p>
      <p class="muted">${range ? '蓝方模型不确定范围 ' + (range[0]*100).toFixed(1) + '%–' + (range[1]*100).toFixed(1) + '%。' : ''}这是 BP 阵容估计，实际胜负还取决于操作与临场决策。</p>
      ${historical ? '<p class="muted">' + (Number.isFinite(saved) ? '历史 BP 结束时蓝方预测：' + (saved*100).toFixed(1) + '%；上方为当前数据重算。' : '旧记录未保存当时预测，上方为当前数据重算。') + '</p>' : ''}</section>`;
  }

  function tacticsHtml(text) {
    return '<section class="tactics-board"><div class="eyebrow">COACH’S BOARD · 教练战术板</div>' + String(text || '').split(/\r?\n/).filter(Boolean).map((line,i) => {
      const colon = line.indexOf('：');
      return '<article class="tactic-row"><span class="tactic-index">0' + (i+1) + '</span><div><h4>' + esc(colon > 0 ? line.slice(0,colon) : '研判') + '</h4><p>' + esc(colon > 0 ? line.slice(colon+1) : line) + '</p></div></article>';
    }).join('') + '</section>';
  }

  function normalizeReviewGame(g) {
    if (!g) return g;
    return Object.assign({}, g, {
      picks: {blue:g.picks?.blue || g.blueLineup || [], red:g.picks?.red || g.redLineup || []},
      bans: {blue:g.bans?.blue || [], red:g.bans?.red || []}
    });
  }

  function reviewInsights(g) {
    const blue = g.picks ? g.picks.blue : g.blueLineup || [];
    const red = g.picks ? g.picks.red : g.redLineup || [];
    const pred = BPData.predictWinRate(blue, red, heroStats);
    const phases = BPData.predictMatchPhases(blue, red, heroStats);
    const text = BPData.generatePrediction({blueTeam:g.blueTeam, redTeam:g.redTeam, blueLineup:blue, redLineup:red, bans:g.bans, blueWinProb:pred.blueWinProb, phases});
    return predictionInterpretation(g, true) + tacticsHtml(text);
  }

  function renderAnalysis() {
    const d = state.draft;
    const blue = d ? d.picks.blue : [], red = d ? d.picks.red : [];
    const pred = BPData.predictWinRate(blue, red, heroStats);
    const bs = Number(bpValue(BPData.bpScore(blue, red, heroStats))) || 0;
    const rs = Number(bpValue(BPData.bpScore(red, blue, heroStats))) || 0;
    $('blue-a-title').textContent = state.blueTeam + ' · BP 评分';
    $('red-a-title').textContent = state.redTeam + ' · BP 评分';
    $('blue-winrate').textContent = blue.length ? formatBpScore(bs,rs) : '—';
    $('red-winrate').textContent = red.length ? formatBpScore(rs,bs) : '—';
    const total = Math.max(0,bs) + Math.max(0,rs);
    const share = total ? Math.max(0,bs)/total*100 : 50;
    $('p-blue').style.width = share + '%';
    $('p-red').style.width = (100-share) + '%';
    $('score-meter').setAttribute('aria-valuenow', share.toFixed(1));
    $('score-meter').setAttribute('aria-valuetext', '蓝方 BP 评分 ' + bs.toFixed(1) + '，红方 ' + rs.toFixed(1));
    $('score-probability').textContent = blue.length || red.length ? '预测胜率  ' + (pred.blueWinProb*100).toFixed(1) + '% / ' + ((1-pred.blueWinProb)*100).toFixed(1) + '%' : '等待阵容成形';
    const complete = blue.length === 5 && red.length === 5;
    $('analysis-notes').textContent = complete ? 'BP 已完成。可查看胜率解读与教练战术板，或录入本局结果。' : '逐手构建阵容 · 下方模块随时可打开，赛事点评将在 BP 完成后生成。';
    $('insights-content').innerHTML = predictionInterpretation({blueTeam:state.blueTeam,redTeam:state.redTeam,picks:{blue,red}});
    $('coach-placeholder').classList.toggle('hidden', complete);
  }

  /* -------------------- 赛前点评（BP 完成后自动生成） -------------------- */
  async function maybeGeneratePrediction() {
    const d = state.draft;
    const box = $("ai-prediction");
    const body = $("ai-prediction-body");
    if (!box || !body) return;

    /* 教练战术板分块排版：把生成的整段文本按行拆成「曲线 / 前期 / 中期 / 后期 /
     * 结论」独立小块，每块一个小标题 + 强调色，不再是一坨纯文本。
     * 全程用 createElement + textContent（不拼 HTML）→ 模型文本天然免疫 XSS。
     * 返回成功落块的行数；0 表示没有可分的行，调用方回退到 textContent。 */
    const renderLines = (el, text) => {
      const raw = String(text == null ? "" : text).split(/\r?\n/);
      const rows = [];
      raw.forEach((line) => {
        const t = line.trim();
        if (!t) return;
        const head = t.split("：")[0];
        const hasHead = head.length > 0 && head.length <= 12 && t.length > head.length;
        const bodyText = hasHead ? t.slice(head.length + 1).trim() : t;
        const kindOf = (s) => (/胜率曲线|曲线/.test(s) ? "tp-curve"
          : /^前期/.test(s) ? "tp-early"
            : /^中期/.test(s) ? "tp-mid"
              : /^后期|^大后期/.test(s) ? "tp-late"
                : /结论/.test(s) ? "tp-concl" : "tp-plain");
        const tagOf = (s) => {
          if (/胜率曲线/.test(s)) return "胜率曲线";
          if (/^前期/.test(s)) return "前期";
          if (/^中期/.test(s)) return "中期";
          if (/^后期|^大后期/.test(s)) return "后期";
          if (/结论/.test(s)) return "结论";
          return "研判";
        };
        const timeM = hasHead ? head.match(/（([^）]*)）/) : null;
        const row = document.createElement("div");
        row.className = "tp-line " + kindOf(head);
        const tagEl = document.createElement("span");
        tagEl.className = "tp-tag";
        tagEl.textContent = (hasHead ? tagOf(head) : "研判") + (timeM ? " " + timeM[1] : "");
        const textEl = document.createElement("span");
        textEl.className = "tp-text";
        textEl.textContent = hasHead ? (bodyText || t) : t;
        row.appendChild(tagEl);
        row.appendChild(textEl);
        rows.push(row);
      });
      if (!rows.length) return 0;
      el.innerHTML = "";
      rows.forEach((r) => el.appendChild(r));
      return rows.length;
    };

    const isComplete =
      !!d && currentStep() === null && d.picks.blue.length === 5 && d.picks.red.length === 5;

    // BP 未完成（含撤销/换人后）→ 隐藏并清空，等下一次完成再生成
    if (!isComplete) {
      if (!box.classList.contains("hidden")) box.classList.add("hidden");
      const sumEl = $("ai-pred-summary");
      if (sumEl) { sumEl.textContent = ""; sumEl.title = ""; }
      state.currentPrediction = null;
      $('event-commentary-text').textContent = '阵容构建中，等待双方完成选人。';
      predictionInFlight = false;
      return;
    }

    // 已有结果或正在请求 → 不重复生成
    if (state.currentPrediction || predictionInFlight) return;

    predictionInFlight = true;
    box.classList.remove("hidden");
    body.classList.remove("ai-error");
    body.textContent = "正在生成教练战术板…";

    try {
      const pred = BPData.predictWinRate(d.picks.blue, d.picks.red, heroStats);

      // 教练战术板（本地生成，不依赖任何网络/API）：只研判局内走势。
      // 同一阵容 → 同一篇点评（确定性种子），撤销/换人后阵容变化自然重新生成。
      const text = BPData.generatePrediction({
        blueTeam: state.blueTeam,
        redTeam: state.redTeam,
        blueLineup: d.picks.blue,
        redLineup: d.picks.red,
        bans: { blue: d.bans.blue, red: d.bans.red },
        blueWinProb: pred.blueWinProb,
        phases: BPData.predictMatchPhases(d.picks.blue, d.picks.red, heroStats),
      });

      // 生成是同步的，阵容不会在过程中变化；仍校验一次当前 draft 防撤销竞态
      const dNow = state.draft;
      if (!dNow || dNow.picks.blue.length !== 5 || dNow.picks.red.length !== 5) return;
      if (text) {
        $('event-commentary-text').textContent = String(text).split(/\r?\n/).find(line => /战术结论/.test(line)) || text;
        state.currentPrediction = text; // 状态里仍存纯文本（复盘/大场查看器复用）
        body.innerHTML = tacticsHtml(text); // 单段旧文本 → 原样显示
        /* 收起态摘要：把「结论」那一行搬到标题条上。
         * 短屏会自动收起战术板（见 bindEvents 里的自适应逻辑），
         * 如果收起后标题条上什么都没有，用户就真的看不到任何研判结论了。 */
        const sumEl = $("ai-pred-summary");
        if (sumEl) {
          // 结论行的标签是「战术结论：」（见 data.js），不能用 /^结论/ 锚定匹配 —— 会一条都挑不到，
          // 摘要就永远是空的。这里按「行内含结论」挑，再剥掉行首那个短标签。
          const line = String(text).split(/\r?\n/)
            .map((s) => s.trim())
            .find((s) => /结论/.test(s)) || "";
          sumEl.textContent = line.replace(/^[^：:]{0,12}[：:]\s*/, "") || line;
          sumEl.title = line || "";
        }
      } else {
        body.textContent = "战术板生成失败";
        body.classList.add("ai-error");
      }
    } catch (e) {
      body.textContent = "战术板生成失败：" + (e && e.message ? e.message : String(e));
      body.classList.add("ai-error");
    } finally {
      predictionInFlight = false;
    }
  }

  function renderButtons() {
    const d = state.draft;
    const done = d && currentStep() === null;
    // 联机：仅房主能录入胜负（房主可选蓝/红）；客方禁用"本局结束"
    const canEnd = done && (!state.online || state.online.side === state.online.hostSide);
    $("btn-endgame").disabled = !canEnd;
    $("btn-endgame").style.opacity = canEnd ? "1" : "0.4";
    // 联机：可取消待机，或撤销"自己上一步"（仅当仍轮到自己，保证两端一致）
    let canUndo;
    if (state.online) {
      const step = currentStep();
      const last = d && d.actions.length ? d.actions[d.actions.length - 1] : null;
      canUndo = !!pendingPick ||
        (!!step && !!last && step.side === state.online.side && last.side === state.online.side);
    } else {
      canUndo = !!pendingPick || (d && d.actions.length > 0);
    }
    $("btn-undo").disabled = !canUndo;
    $("btn-undo").style.opacity = canUndo ? "1" : "0.4";
  }

  /* -------------------- 弹出定格画面（仅巅峰对决） -------------------- */
  function showFreeze(ref, side, type) {
    const h = heroByName(ref);
    const role = h ? h.role : "辅助";
    const pos = h ? h.pos : "";
    const teamName = side === "blue" ? state.blueTeam : state.redTeam;

    // 巅峰对决：金色主题
    $("freeze-type").textContent = "巅峰对决 · 选用";
    $("freeze-type").className = "freeze-type type-peak";
    $("freeze-name").textContent = displayHero(ref);
    $("freeze-role").textContent = role + " · " + pos;
    $("freeze-team").textContent = teamName + " · 盲选";
    $("freeze-team").style.color = "var(--gold)";

    // KPL 金色描边 + 光晕
    const poster = $("freeze-poster");
    poster.classList.add("peak-gold");
    poster.style.setProperty("--frame-color", "#f5c542");
    poster.style.setProperty("--frame-glow", "rgba(245,197,66,.65)");

    const fallback = $("freeze-fallback");
    fallback.innerHTML = laneFallback(h, 'freeze-lane');
    fallback.style.display = '';

    // 关键改动：每次选人都【新建一个 <img>】并预加载新英雄海报。
    // 旧的 <img> 立即移除 → 上一张（如杨戬）的海报瞬间消失，不再有
    // "从杨戬渐变到曹操"的过渡；新海报加载完成后独立入场（freezeHeroIn），
    // 与官方巅峰对决"选谁就出谁的定格"一致。
    const oldImg = $("freeze-img");
    if (oldImg) oldImg.remove();

    const img = new Image();
    img.className = "freeze-img";
    img.id = "freeze-img";
    img.alt = displayHero(ref);
    img.style.opacity = "0"; // 加载完成前透明，回退 emoji 垫底
    img.onload = function () {
      fallback.style.display = "none";
      img.style.opacity = "1";
      img.style.animation = "none";
      void img.offsetWidth;
      img.style.animation = "freezeHeroIn .65s cubic-bezier(.2,1,.3,1) both";
    };
    img.onerror = function () { /* 海报加载失败：保持回退 emoji */ };
    // 拿不到海报 URL 就不要赋 src：`img.src = ""` 会让浏览器把当前页面地址
    // 当成图片再请求一次（server.js 上就是又拉一遍 index.html）。
    const posterUrl = heroPosterUrl(ref);
    if (posterUrl) img.src = posterUrl;
    else img.style.display = "none";
    poster.insertBefore(img, fallback);

    // 金色亮闪（海报边框整体闪一下）
    poster.style.animation = "none";
    void poster.offsetWidth;
    poster.style.animation = "freezeFlash .7s ease-out";

    // 金色粒子光效
    spawnParticles();

    // 卡片整体重新入场（缩放冲出）
    const card = $("freeze-card");
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";

    const overlay = $("freeze-overlay");
    overlay.classList.add("show");

    if (freezeTimer) clearTimeout(freezeTimer);
    freezeTimer = setTimeout(closeFreeze, 2200);
  }

  function spawnParticles() {
    const container = $("freeze-particles");
    if (!container) return;
    container.innerHTML = "";
    const N = 42;
    for (let i = 0; i < N; i++) {
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

  function closeFreeze() {
    if (freezeTimer) clearTimeout(freezeTimer);
    $("freeze-overlay").classList.remove("show");
  }

  /* -------------------- 赛后结算 -------------------- */
  function openResultModal() {
    const d = state.draft;
    if (!d || currentStep() !== null || state.seriesOver || state.waiting === "sideChoice") return;
    closeFreeze();
    $("result-blue-name").textContent = state.blueTeam;
    $("result-red-name").textContent = state.redTeam;
    $("result-blue-lineup").textContent = heroListText(d.picks.blue) || "未选";
    $("result-red-lineup").textContent = heroListText(d.picks.red) || "未选";
    $("result-blue").classList.remove("selected");
    $("result-red").classList.remove("selected");
    $("result-modal").classList.add("show");
  }

  // 应用一局胜负（本地与远程通用）。小局只入内存 history（供本场复盘），
  // 持久化统一在系列赛结束 endSeries 时按「一个大场一条记录」保存。
  function applyResult(winner, game) {
    if (!["blue", "red"].includes(winner) || game !== state.currentGame || currentStep() !== null || state.seriesOver || state.waiting === "sideChoice") return;
    if (state.history.some((g) => g.game === game)) return; // 幂等：同一局只结算一次
    const d = state.draft;
    if (!d) return;

    state.history.push({
      game,
      blueTeam: state.blueTeam,
      redTeam: state.redTeam,
      blueLineup: d.picks.blue.slice(),
      redLineup: d.picks.red.slice(),
      winner,
      bans: { blue: d.bans.blue.slice(), red: d.bans.red.slice() },
      picks: { blue: d.picks.blue.slice(), red: d.picks.red.slice() },
      actions: d.actions.map((a) => ({ side: a.side, type: a.type, hero: a.hero })),
      isPeak: d.isPeak,
      // 对局复盘用：BP阶段胜率快照 + 局内四阶段预测 + 赛前点评
      winRateHistory: (d.winRateHistory || []).slice(),
      phases: BPData.predictMatchPhases(d.picks.blue, d.picks.red, heroStats),
      prediction: state.currentPrediction || null,
    });

    state.score[winner]++;
    state.waiting = null;
    $("result-modal").classList.remove("show");

    if (state.score[winner] >= targetWins()) {
      endSeries(winner);
      return;
    }

    // 每局结束后，上一局败方自选下一局边路
    state.currentGame++;
    state.waiting = "sideChoice";
    if (uiMode === "director") render();
    const last = state.history[state.history.length - 1];
    const loserSide = last.winner === "blue" ? "red" : "blue";
    if (state.online && loserSide !== state.online.side) {
      state.waiting = "sideChoice"; // 我方非败方 → 等待对方选边
      render();
    } else {
      showSideChoiceModal();
    }
  }

  function confirmResult() {
    if (state.online && state.online.side !== state.online.hostSide) return; // 仅房主录入胜负（房主可选蓝/红）
    const selected = document.querySelector("#result-modal .result-team.selected");
    if (!selected) { alert("请选择获胜方"); return; }
    const winner = selected.dataset.winner;
    const game = state.currentGame;
    if (state.history.some((g) => g.game === game)) {
      $("result-modal").classList.remove("show");
      return;
    }
    applyResult(winner, game);
    if (state.online) sendAction({ type: "result", winner, game });
  }

  function showSideChoiceModal() {
    const last = state.history[state.history.length - 1];
    const loserSide = last.winner === "blue" ? "red" : "blue";
    const loserName = loserSide === "blue" ? state.blueTeam : state.redTeam;
    $("side-choice-loser").textContent = loserName;
    $("side-choice-modal").classList.add("show");
  }

  // 应用选边结果（本地与远程通用）
  function applySideChoiceResult(chosenSide) {
    const last = state.history[state.history.length - 1];
    const loserSide = last.winner === "blue" ? "red" : "blue";
    if (chosenSide !== loserSide) {
      // 败方换边 → 交换队伍名与比分（全局已用英雄按队伍名追踪，自动跟随）
      const t = state.blueTeam; state.blueTeam = state.redTeam; state.redTeam = t;
      const s = state.score.blue; state.score.blue = state.score.red; state.score.red = s;
    }
    state.waiting = null;
    $("side-choice-modal").classList.remove("show");
    startDraft();
  }

  function applySideChoice(chosenSide) {
    applySideChoiceResult(chosenSide);
    // 联机：把换边后的队名同步给服务器，保证双方轮询 sync 都返回正确队名
    if (state.online) sendAction({ type: "sideChoice", chosenSide, blueTeam: state.blueTeam, redTeam: state.redTeam });
  }

  function endSeries(winner) {
    state.seriesOver = true;
    if (uiMode !== "director") state.draft = null;

    const persist = !state.online || state.online.side === state.online.hostSide; // 仅房主持久化
    if (persist) {
      // 大场数据保存为一次记录（整个 BO 系列赛）
      const saved = BPData.addSeries({
        blueTeam: state.blueTeam,
        redTeam: state.redTeam,
        bo: state.bo,
        finalScore: { blue: state.score.blue, red: state.score.red },
        winner: winner,
        games: state.history.map((g) => ({
          game: g.game,
          blueTeam: g.blueTeam,
          redTeam: g.redTeam,
          blueLineup: g.blueLineup,
          redLineup: g.redLineup,
          winner: g.winner,
          bans: g.bans,
          picks: g.picks,
          isPeak: g.isPeak,
          winRateHistory: g.winRateHistory,
          phases: g.phases,
          prediction: g.prediction,
        })),
      });
      // 联机：房主把已保存的大场广播给客方，客方本地写入，保证双方统计一致
      if (state.online && state.online.side === state.online.hostSide) {
        sendAction({ type: "seriesSaved", series: saved });
      }
    }

    // 大场保存后刷新英雄胜率/出场/禁用统计（下个大场的数据源）
    heroStats = BPData.computeHeroStats();

    render();
    const name = winner === "blue" ? state.blueTeam : state.redTeam;
    setTimeout(() => {
      alert("🏆 系列赛结束！" + name + " 以 " + state.score.blue + ":" + state.score.red + " 获胜！" +
        (persist ? "大场记录已保存。" : "（联机对战，由房主保存记录）"));
    }, 200);
  }

  /* -------------------- 数据分析弹窗 -------------------- */
  function openStatsModal() {
    $("stats-modal").classList.add("show");
    renderStatsTab("heroes");
  }

  function renderStatsTab(tab) {
    const body = $("stats-body");
    document.querySelectorAll("#stats-modal .stats-tabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });

    if (tab === "heroes") {
      const items = BPData.heroItems ? BPData.heroItems() : (window.HEROES || []);
      const sorted = items.slice().sort((a, b) => {
        const wa = heroStats[a.key || a.name] ? heroStats[a.key || a.name].winRate : 0;
        const wb = heroStats[b.key || b.name] ? heroStats[b.key || b.name].winRate : 0;
        return wb - wa;
      });
      let html = `<table class="stats-table">
        <thead><tr><th>英雄</th><th>职业</th><th>分路</th><th>强度</th><th>胜率</th><th>出场率</th><th>禁用率</th><th>样本</th></tr></thead><tbody>`;
      sorted.forEach((h) => {
        const key = h.key || h.name;
        const st = heroStats[key] || {};
        const wr = (st.winRate || 0) * 100;
        const wrClass = wr >= 52 ? "wr-high" : (wr <= 48 ? "wr-low" : "");
        const liveTier = st.tier || h.tier;
        const sample = st.sample || 0;
        const sampleTxt = sample % 1 !== 0 ? Number(sample).toFixed(1) : sample;
        html += `<tr>
          <td><b>${h.name}</b></td>
          <td style="color:${ROLE_COLOR[h.role]}">${h.role}</td>
          <td>${h.pos || "总体"}</td>
          <td style="color:${TIER_COLOR[liveTier]}">${st.tierLive ? "●" : ""}${TIER_LABEL[liveTier]}</td>
          <td class="${wrClass}">${wr.toFixed(1)}%</td>
          <td>${((st.pickRate || 0) * 100).toFixed(1)}%</td>
          <td>${((st.banRate || 0) * 100).toFixed(1)}%</td>
          <td>${sampleTxt}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
      const extMeta = BPData.getExternalMeta();
      const src2 = (extMeta && extMeta.sources) || {};
      const pct2 = (w) => Math.round((w || 0) * 100);
      let note = "胜率 = 贝叶斯可信度加权：内置先验(20场等效) + 录入大场记录";
      if (src2.pro && src2.casual) note += " + 职业赛场(按真实场次) + 路人局(等效样本打折扣)";
      else if (src2.pro) note += " + 职业赛场(按真实场次)";
      else if (src2.casual) note += " + 路人局(等效样本打折扣)";
      note += "。KPL 从未出场的英雄不会计入「职业胜率 0%」，只回落到路人/先验。";
      note += " 数据源：" + (extMeta ? (extMeta.season || "当前职业赛事") + "（已连接实时数据）" : "内置参考数据");
      if (extMeta && extMeta.isLatest === false && src2.pro && !src2.casual) note += "；该赛季仅使用职业赛场数据（路人局只与最新赛季加权）";
      note += "。同名英雄按 name@分路 展示，多分路拥有独立胜率与登场倾向。";
      html += `<div style="margin-top:12px;color:var(--muted);font-size:12px;">${note}</div>`;
      body.innerHTML = html;
    } else {
      const series = BPData.loadSeries();
      let html = `<div style="display:flex;gap:10px;margin-bottom:12px;">
        <button id="export-btn" style="padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:#0d1226;color:var(--text);">⬇ 导出数据(JSON)</button>
        <button id="import-btn" style="padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:#0d1226;color:var(--text);">⬆ 导入数据(JSON)</button>
        <button id="clear-btn" style="padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:#0d1226;color:var(--red);">🗑 清空记录</button>
        <input type="file" id="import-file" accept=".json" style="display:none;" />
      </div>`;
      if (series.length === 0) {
        html += `<div style="color:var(--muted);padding:20px;text-align:center;">暂无大场记录。完成一整个系列赛（BO3/5/7）后会自动保存一条大场记录。</div>`;
      } else {
        // 大场记录（整个 BO 系列赛为一条，可点击查看完整 BP 盘）
        html += `<div>
          <div style="color:var(--gold);font-weight:700;margin-bottom:8px;">🏆 大场记录（${series.length} 场）· 点击查看完整 BP</div>`;
        series.slice().reverse().forEach((s, i) => {
          const origIdx = series.length - 1 - i;
          const sc = s.finalScore || {};
          const blueScore = sc.blue != null ? sc.blue : "–";
          const redScore = sc.red != null ? sc.red : "–";
          const nGames = (s.games || []).length;
          const w = s.winner === "blue" ? s.blueTeam : s.redTeam;
          html += `<div class="match-log-item series-item">
            <span class="series-meta"><span style="color:var(--muted);">${s.date} · BO${s.bo}</span> ·
              <b>${esc(s.blueTeam)}</b> ${blueScore} : ${redScore} <b>${esc(s.redTeam)}</b> →
              <span class="winner">${esc(w)} 胜</span>（共 ${nGames} 局）</span>
            <span class="rec-actions">
              <button class="series-view-btn" data-idx="${origIdx}" type="button">👁 查看 BP</button>
              <button class="rec-del-btn" data-idx="${origIdx}" type="button">🗑 删除</button>
            </span>
          </div>`;
        });
        html += `</div>`;
      }
      body.innerHTML = html;

      const exportBtn = $("export-btn");
      const importBtn = $("import-btn");
      const importFile = $("import-file");
      const clearBtn = $("clear-btn");
      if (exportBtn) exportBtn.addEventListener("click", exportData);
      if (importBtn) importBtn.addEventListener("click", () => importFile.click());
      if (importFile) importFile.addEventListener("change", importData);
      if (clearBtn) clearBtn.addEventListener("click", () => {
        if (confirm("确定清空所有大场记录吗？")) {
          BPData.clearSeries();
          heroStats = BPData.computeHeroStats();
          renderStatsTab("matches");
        }
      });
      // 大场记录 → 点击查看完整 BP 盘
      document.querySelectorAll(".series-view-btn").forEach((btn) => {
        btn.addEventListener("click", () => openSeriesViewer(parseInt(btn.dataset.idx, 10)));
      });
      // 大场记录 → 删除
      document.querySelectorAll("#stats-modal .rec-del-btn").forEach((btn) => {
        btn.addEventListener("click", () => deleteSeriesRecord(parseInt(btn.dataset.idx, 10)));
      });
    }
  }

  function exportData() {
    const data = BPData.loadSeries();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kpl_bp_series.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("格式错误");
        // 过滤明显无效的条目（缺 games / 缺数字比分）
        const valid = data.filter((s) => s && Array.isArray(s.games) && s.finalScore &&
          typeof s.finalScore.blue === "number" && typeof s.finalScore.red === "number");
        if (!valid.length) throw new Error("没有有效的大场记录");
        BPData.saveSeries(valid);
        heroStats = BPData.computeHeroStats();
        renderStatsTab("matches");
        alert("导入成功，共 " + valid.length + " 条大场记录" +
          (data.length !== valid.length ? "（跳过 " + (data.length - valid.length) + " 条无效记录）" : ""));
      } catch (err) {
        alert("导入失败：" + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* -------------------- 胜率走势图 --------------------
   * 走势图不只是"把折线画出来"，它要回答三个问题：
   *   ① 现在谁领先、领先多少（当前值 + 起点对比）；
   *   ② 这一手值多少（每手 Δ，标出最关键的一手）；
   *   ③ 这个数字有多可信（±置信带：越到后面样本越足，带越窄）。
   * 因此图上区分 Ban/Pick、画出置信带与最陡点，并支持点选查看每一手的明细。 */
  function openTrendModal() {
    renderTrendChart();
    $("trend-modal").classList.add("show");
  }

  function renderTrendChart() {
    window.KPLTrend.render($('trend-chart'), state.draft, state.blueTeam, state.redTeam);
  }

  /* -------------------- 往期复盘 + 换英雄 -------------------- */
  function openReviewModal() {
    if (!state.history.length) { alert("暂无已结束的小局"); return; }
    reviewState.gameIndex = state.history.length - 1;
    loadReviewGame();
    $("review-modal").classList.add("show");
  }

  function selectReviewGame(i) {
    reviewState.gameIndex = i;
    loadReviewGame();
  }

  function loadReviewGame() {
    const g = state.history[reviewState.gameIndex];
    reviewState.draft = {
      blueTeam: g.blueTeam, redTeam: g.redTeam,
      bans: {
        blue: (g.bans && g.bans.blue ? g.bans.blue : []).slice(),
        red: (g.bans && g.bans.red ? g.bans.red : []).slice(),
      },
      picks: {
        blue: (g.picks ? g.picks.blue : g.blueLineup).slice(),
        red: (g.picks ? g.picks.red : g.redLineup).slice(),
      },
      isPeak: !!g.isPeak,
      winRateHistory: g.winRateHistory || [],
      phases: g.phases || null,
      prediction: g.prediction || null,
    };
    renderReview();
  }

  function renderReview() {
    const g = state.history[reviewState.gameIndex];
    const d = reviewState.draft;

    const tabs = $("review-tabs");
    tabs.innerHTML = "";
    state.history.forEach((h, i) => {
      const b = document.createElement("button");
      b.textContent = "第" + h.game + "局";
      if (h.winner === "blue") b.textContent += "(蓝胜)"; else b.textContent += "(红胜)";
      if (i === reviewState.gameIndex) b.classList.add("active");
      b.addEventListener("click", () => selectReviewGame(i));
      tabs.appendChild(b);
    });

    const body = $("review-bp");
    const winnerName = esc(g.winner === "blue" ? state.blueTeam : state.redTeam);
    let html = `<div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;align-items:flex-start;">`;
    html += reviewTeamPanel("blue", d);
    html += `<div style="text-align:center;align-self:center;color:var(--gold);font-weight:700;line-height:1.6;">第${g.game}局<br>胜方<br>${winnerName}</div>`;
    html += reviewTeamPanel("red", d);
    html += `</div>`;
    body.innerHTML = html;
    // 槽位里是 data-src 形式的头像，必须显式交给延迟加载器。
    // 复盘窗口是 display:none 时渲染的，IntersectionObserver 会认为"不在视口"，
    // 但 .show 加上之后视口判定恢复，回调就会补上 src —— 所以这里绑一次即可。
    bindHeroImgs(body);

    body.querySelectorAll(".rv-slot.filled").forEach((el) => {
      el.addEventListener("click", () => {
        openSwapModal(el.dataset.side, el.dataset.type, parseInt(el.dataset.index, 10));
      });
    });

    // "进入对局"全屏复盘按钮
    const enterRow = document.createElement("div");
    enterRow.className = "review-enter-row";
    const enterBtn = document.createElement("button");
    enterBtn.className = "enter-game-btn";
    enterBtn.textContent = "⚔ 进入对局（完整对局复盘）";
    enterBtn.addEventListener("click", () => openGameReplay(reviewState.gameIndex));
    enterRow.appendChild(enterBtn);
    body.appendChild(enterRow);

    renderReviewAnalysis(d);
    renderGameReplayTimeChart(effectiveGame(reviewState.gameIndex), $("review-trend"), null);
  }

  function reviewTeamPanel(side, d) {
    const teamName = esc(side === "blue" ? d.blueTeam : d.redTeam);
    const color = side === "blue" ? "var(--blue)" : "var(--red)";
    const maxBan = d.isPeak ? 0 : 5;
    /* 槽位改成「头像格」而不是纯文字块。
     * 老实现只写 displayHero(name) 文本，所以在复盘窗口里根本看不到英雄图标 ——
     * 而开局 BP 盘的槽位是有头像的，两边观感对不上。
     * 这里直接复用开局的 slotImgHtml（同一套 data-src 延迟加载 + 失败 emoji 回退），
     * 再叠一条名字条，与 .pick-slot / .ban-slot 的版式保持一致。
     * 注意：生成后必须调 bindHeroImgs，否则 <img> 永远停在 data-src 上（见调用处）。 */
    const slot = (name, kind, i, emptyGlyph) => {
      if (!name) return `<div class="rv-slot empty">${emptyGlyph}</div>`;
      const h = heroByName(name);
      const title = displayHero(name) + (h ? " · " + h.role + " · " + h.pos : "") + " · 点击换英雄";
      return `<div class="rv-slot filled ${kind}" data-side="${side}" data-type="${kind}" data-index="${i}" title="${esc(title)}">` +
        slotImgHtml(name) +
        (kind === "ban" ? `<span class="rv-ban-x">✕</span>` : "") +
        `<span class="rv-name">${esc(displayHero(name))}</span></div>`;
    };
    let html = `<div class="review-team"><div class="review-team-name" style="color:${color};">${teamName}</div>`;
    if (maxBan) {
      html += `<div class="rv-label">禁用</div><div class="rv-row">`;
      for (let i = 0; i < maxBan; i++) html += slot(d.bans[side][i], "ban", i, "—");
      html += `</div>`;
    }
    html += `<div class="rv-label">选用</div><div class="rv-row">`;
    for (let i = 0; i < 5; i++) html += slot(d.picks[side][i], "pick", i, "?");
    html += `</div></div>`;
    return html;
  }

  /* ---------------- 复盘分析：全部由「当前 draft」现算 ----------------
   * 这里刻意不读 g.prediction / g.phases 等存档字段，而是拿 reviewState.draft
   * 当场重算。原因：复盘窗口允许点槽位换英雄，一旦换人，存档里的「战术板」
   * 和阵亡短板就与屏幕上的阵容对不上了 —— 表现就是"换了英雄但解读没变"。
   * generatePrediction 是纯规则、确定性种子的本地函数（同一阵容必得同一篇），
   * 所以没换人时重算结果与存档逐字一致，不会出现两套说法。 */
  function renderReviewAnalysis(d) {
    $('review-analysis').innerHTML = (d.swapped ? '<p class="simulation-label">假设阵容推演 · 不改写历史比赛</p>' : '') + reviewInsights(d);
  }

  // 与状态分离：独立读取 history 中的一局，输出完整对局界面
  let gameReplay = { index: 0, mode: "time" };

  function openGameReplay(index) {
    if (!state.history.length) return;
    gameReplay.index = index;
    gameReplay.mode = "time";
    $("review-modal").classList.remove("show");
    renderGameReplay();
    $("game-replay-screen").classList.add("active");
  }

  function closeGameReplay() {
    $("game-replay-screen").classList.remove("active");
    // 切回上一局对应 tab
    const prevDraft = reviewState.draft;
    const prevIndex = reviewState.gameIndex;
    reviewState.gameIndex = gameReplay.index;
    if (prevDraft && prevDraft.swapped && prevIndex === gameReplay.index) {
      // 在这一局里换过英雄：别让 loadReviewGame 用存档把改动覆盖回去
      renderReview();
    } else {
      loadReviewGame();
    }
    $("review-modal").classList.add("show");
  }

  function gameReplayTab(i) {
    gameReplay.index = i;
    renderGameReplay();
  }

  function renderGameReplay() {
    // effectiveGame：复盘窗口里换过英雄时给出改过的阵容副本，否则就是存档原样
    const g = effectiveGame(gameReplay.index);
    if (!g) return;

    // 顶部 tab
    const tabs = $("gr-tabs");
    tabs.innerHTML = "";
    state.history.forEach((h, i) => {
      const b = document.createElement("button");
      b.textContent = "第" + h.game + "局" + (h.isPeak ? "⚡" : "");
      if (i === gameReplay.index) b.classList.add("active");
      b.addEventListener("click", () => gameReplayTab(i));
      tabs.appendChild(b);
    });

    $("gr-title").textContent = `对局复盘 · ${g.blueTeam} vs ${g.redTeam} · 第${g.game}局（${
      g.isPeak ? "巅峰对决" : (g.winner === "blue" ? "蓝方胜" : "红方胜")
    }）`;

    renderGameReplayBp(g);
    renderGameReplayChart(g);
  }

  function renderGameReplayBp(g) {
    const bp = $("gr-bp");
    const blue = sideBlockHtml("blue", g);
    const red = sideBlockHtml("red", g);
    const winner = esc(g.winner === "blue" ? g.blueTeam : g.redTeam);
    bp.innerHTML = blue + `<div style="align-self:center;text-align:center;color:var(--gold);font-weight:700;">胜方<br>${winner}</div>` + red;

    // 这两个复盘界面以前漏了这一步：slotContent() 生成的是 data-src 头像，
    // 不交给延迟加载器就永远停在 data-src 上 —— 于是「图标不显示」。
    bindHeroImgs(bp);

    // BP 评分
    const bs = BPData.bpScore(g.picks.blue, g.picks.red, heroStats);
    const rs = BPData.bpScore(g.picks.red, g.picks.blue, heroStats);
    $("gr-bp-analysis").innerHTML =
      `<div class="gr-ab">${esc(g.blueTeam)} <span style="color:var(--blue);">BP分 ${bs == null ? "--" : formatBpScore(bpValue(bs), bpValue(rs))}</span>` +
      `　VS　${esc(g.redTeam)} <span style="color:var(--red);">BP分 ${rs == null ? "--" : formatBpScore(bpValue(rs), bpValue(bs))}</span></div>` +
      (g.phases ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;">局内四阶段走势模拟已生成 ↓</div>` : "") +
      reviewInsights(g);
  }

  function sideBlockHtml(side, g) {
    const teamName = esc(side === "blue" ? g.blueTeam : g.redTeam);
    const color = side === "blue" ? "var(--blue)" : "var(--red)";
    const bans = g.bans ? g.bans[side] || [] : [];
    const picks = g.picks ? g.picks[side] : (side === "blue" ? g.blueLineup : g.redLineup);
    let html = `<div class="gr-side"><div class="gr-side-name" style="color:${color};">${teamName}</div>`;
    if (!g.isPeak) {
      html += `<div class="gr-label">禁用</div><div class="gr-slot-row">`;
      for (let i = 0; i < 5; i++) {
        const n = bans[i];
        html += `<div class="gr-slot ban">${n ? slotContent(n, true) : "—"}</div>`;
      }
      html += `</div>`;
    }
    html += `<div class="gr-label">选用</div><div class="gr-slot-row">`;
    for (let i = 0; i < 5; i++) {
      const n = picks[i];
      html += `<div class="gr-slot">${n ? slotContent(n, false) : "?"}</div>`;
    }
    html += `</div></div>`;
    return html;
  }

  function slotContent(ref, isBan) {
    const h = heroByName(ref);
    const title = h ? `${displayHero(ref)}（${h.pos}）` : displayHero(ref);
    return heroImgTag(heroAvatarUrl(ref), null, displayHero(ref), `title="${title}"`) +
      (isBan ? `<span class="gr-ban-x">✕</span>` : ``) +
      `<span class="gr-name">${displayHero(ref)}</span>`;
  }

  function renderGameReplayChart(g) {
    const container = $("gr-phase-chart");
    if (gameReplay.mode === "bp") {
      renderGameReplayBpChart(g, container);
      return;
    }
    renderGameReplayTimeChart(g, container);
  }

  function renderGameReplayBpChart(g, container, tipsEl) {
    // 复盘与历史记录共用对局页的 KPL 面积图，保证比例、基线、辉光和明细交互一致。
    if (window.KPLTrend && typeof window.KPLTrend.render === "function") {
      window.KPLTrend.render(container, g, g.blueTeam, g.redTeam);
    }
    const box = tipsEl || $("gr-phase-tips");
    if (box) box.innerHTML = `<div>BP 阶段预测 · 每手 Ban/Pick 后的模拟胜率</div>`;
  }

  function renderGameReplayTimeChart(g, container, tipsEl) {
    let phases = Array.isArray(g.phases) && g.phases.length === 4 ? g.phases : [];
    if (!phases.length) {
      const blue = g.picks?.blue || g.blueLineup;
      const red = g.picks?.red || g.redLineup;
      if (Array.isArray(blue) && Array.isArray(red) && blue.length && red.length) {
        try { phases = BPData.predictMatchPhases(blue, red, heroStats); }
        catch { phases = []; }
      }
    }
    phases = phases.filter(p => Number.isFinite(p?.blueWin));
    window.KPLTrend.render(container, g, g.blueTeam, g.redTeam, {
      mode: 'time', phases, historical: !g.swapped && Array.isArray(g.phases) && g.phases.length === 4,
      provenance: g.swapped ? '换英雄后的阶段推演' : undefined
    });
    if (container.id !== 'review-trend') renderPhaseTips(g, phases, tipsEl);
  }

  function renderPhaseTips(g, phases, tipsEl) {
    const box = tipsEl || $("gr-phase-tips");
    let html = "";
    if (g.winRateHistory && g.winRateHistory.length) {
      const start = g.winRateHistory[0].blueWin;
      const end = g.winRateHistory[g.winRateHistory.length - 1].blueWin;
      html += `<span class="gr-pred-badge" style="color:#3b82f6;">BP 开局 ${(start * 100).toFixed(1)}%</span>`;
      html += `<span class="gr-pred-badge" style="color:#8b94b3;">BP 结束 ${(end * 100).toFixed(1)}%</span>`;
    }
    phases.forEach((p, i) => {
      const fav = esc(p.blueWin >= 0.5 ? g.blueTeam : g.redTeam);
      const wow = Math.abs(p.blueWin - 0.5) * 200;
      const favColor = p.blueWin >= 0.5 ? "#3b82f6" : "#ef4444";
      html += `<span class="gr-pred-badge" style="color:${favColor};">
        ${p.label} 优：${fav}（相差 ${wow.toFixed(1)} 个百分点）</span>`;
    });
    html += `<div style="margin-top:6px;">${g.swapped ? '换英雄后的阶段推演' : g.phases ? '历史保存的阶段预测' : '按当前数据补算的阶段预测'} · 非实际比赛走势</div>`;
    box.innerHTML = html;
  }

  function openSwapModal(side, type, index) {
    swapTarget = { side, type, index };
    const key = type === "ban" ? "bans" : "picks";
    const old = reviewState.draft[key][side][index];
    const teamName = side === "blue" ? reviewState.draft.blueTeam : reviewState.draft.redTeam;
    const oh = heroByName(old);
    $("swap-title").textContent =
      `换英雄 · ${teamName} ${type === "ban" ? "禁用" : "选用"}#${index + 1}（原 ${displayHero(old)}${oh ? " · " + oh.pos : ""}）`;
    renderSwapGrid();
    $("swap-modal").classList.add("show");
  }

  function renderSwapGrid() {
    const grid = $("swap-grid");
    grid.innerHTML = "";
    (BPData.heroItems ? BPData.heroItems() : window.HEROES || []).forEach((h) => {
      const card = document.createElement("div");
      card.className = "hero-card";
      card.style.setProperty("--role-color", ROLE_COLOR[h.role] || "#8b94b3");
      card.innerHTML = `
        <div class="hero-avatar">
          ${heroImgTag(heroAvatarUrl(h.name), null, h.name, 'loading="lazy"')}
          ${laneFallback(h, "hero-avatar-fallback")}
        </div>
        <div class="hero-name">${h.name}</div>
        <div class="hero-role">${h.role} · ${h.pos}</div>`;
      card.addEventListener("click", () => applySwap(h.key || h.name));
      grid.appendChild(card);
    });
    // 同 renderHeroGrid：换英雄弹窗里的卡片也要交给延迟加载器
    bindHeroImgs(grid);
  }

  function applySwap(ref) {
    if (!swapTarget) return;
    const { side, type, index } = swapTarget;
    const key = type === "ban" ? "bans" : "picks";
    reviewState.draft[key][side][index] = ref;
    /* 打脏标记：reviewState.draft 是从历史记录快照出来的副本，标记之后
     * 「进入对局」全屏复盘就知道要拿这份改过的阵容渲染，而不是原始存档。 */
    reviewState.draft.swapped = true;
    $("swap-modal").classList.remove("show");
    swapTarget = null;
    renderReview();
  }

  /* 复盘窗口里换过英雄时，全屏对局复盘要用改过的阵容而不是存档原样。
   * 只覆盖阵容相关的字段（picks/bans/prediction/phases），
   * winRateHistory 是「逐手 BP 的胜率快照」，换人后本来就没有对应手数，保持原样。 */
  function effectiveGame(index) {
    const g = normalizeReviewGame(state.history[index]);
    if (!g) return g;
    const d = reviewState.draft;
    if (!d || !d.swapped || reviewState.gameIndex !== index) return g;
    const out = Object.assign({}, g, {
      swapped: true,
      picks: { blue: d.picks.blue.slice(), red: d.picks.red.slice() },
      bans: { blue: d.bans.blue.slice(), red: d.bans.red.slice() },
    });
    try {
      const pred = BPData.predictWinRate(d.picks.blue, d.picks.red, heroStats) || {};
      const pb = Number(pred.blueWinProb);
      if (BPData.generatePrediction) {
        out.prediction = BPData.generatePrediction({
          blueTeam: g.blueTeam, redTeam: g.redTeam,
          blueLineup: d.picks.blue, redLineup: d.picks.red,
          bans: out.bans,
          blueWinProb: isFinite(pb) ? pb : 0.5,
          phases: BPData.predictMatchPhases ? BPData.predictMatchPhases(d.picks.blue, d.picks.red, heroStats) : null,
        }) || g.prediction;
      }
      if (BPData.predictMatchPhases) out.phases = BPData.predictMatchPhases(d.picks.blue, d.picks.red, heroStats);
    } catch (e) { /* 模型不可用：保持存档字段 */ }
    return out;
  }

  /* -------------------- 大场记录删除 -------------------- */
  function deleteSeriesRecord(index) {
    const s = BPData.loadSeries()[index];
    if (!s) return;
    const sc = s.finalScore || {};
    const blueScore = sc.blue != null ? sc.blue : "–";
    const redScore = sc.red != null ? sc.red : "–";
    if (!confirm(`确定删除这条大场记录吗？\n${s.date} · ${s.blueTeam} ${blueScore}:${redScore} ${s.redTeam} · BO${s.bo}`)) return;
    BPData.removeSeries(index);
    heroStats = BPData.computeHeroStats(); // 大场删除后英雄胜率/禁用率随之重算
    renderStatsTab("matches");
  }

  /* -------------------- 大场复盘查看器（历史大场记录） -------------------- */
  let seriesViewer = { index: -1, gameIndex: 0, chartMode: "time" };

  function openSeriesViewer(seriesIndex) {
    const s = BPData.loadSeries()[seriesIndex];
    if (!s || !s.games || !s.games.length) return;
    seriesViewer.index = seriesIndex;
    seriesViewer.gameIndex = 0;
    seriesViewer.chartMode = "time";
    $("stats-modal").classList.remove("show");
    renderSeriesViewer();
    $("series-viewer-screen").classList.add("active");
  }

  function closeSeriesViewer() {
    $("series-viewer-screen").classList.remove("active");
    $("stats-modal").classList.add("show");
    renderStatsTab("matches");
  }

  function seriesViewerTab(i) {
    seriesViewer.gameIndex = i;
    renderSeriesViewer();
  }

  function renderSeriesViewer() {
    const s = BPData.loadSeries()[seriesViewer.index];
    if (!s) return;
    const g = normalizeReviewGame(s.games[seriesViewer.gameIndex]);
    if (!g) return;

    // 顶部各局 tab
    const tabs = $("sv-tabs");
    tabs.innerHTML = "";
    s.games.forEach((game, i) => {
      const b = document.createElement("button");
      b.textContent = "第" + game.game + "局" + (game.isPeak ? "⚡" : "");
      if (i === seriesViewer.gameIndex) b.classList.add("active");
      b.addEventListener("click", () => seriesViewerTab(i));
      tabs.appendChild(b);
    });

    $("sv-title").textContent =
      `大场复盘 · ${s.blueTeam} ${s.finalScore.blue}:${s.finalScore.red} ${s.redTeam} · BO${s.bo}`;

    // 完整 BP 板（与开局一致），外圈四角金色边框
    const svBp = $("sv-bp");
    svBp.innerHTML =
      `<span class="corner-bracket cb-tl"></span><span class="corner-bracket cb-tr"></span>` +
      `<span class="corner-bracket cb-bl"></span><span class="corner-bracket cb-br"></span>` +
      teamPanelHtml("blue", g) + teamPanelHtml("red", g);
    bindHeroImgs(svBp);   // 同 renderGameReplayBp：data-src 头像必须显式绑定

    // BP 评分
    const bs = BPData.bpScore(g.picks.blue, g.picks.red, heroStats);
    const rs = BPData.bpScore(g.picks.red, g.picks.blue, heroStats);
    const winnerName = esc(g.winner === "blue" ? g.blueTeam : g.redTeam);
    $("sv-bp-analysis").innerHTML =
      `<div class="gr-ab">${esc(g.blueTeam)} <span style="color:var(--blue);">BP分 ${bs == null ? "--" : formatBpScore(bpValue(bs), bpValue(rs))}</span>` +
      `　VS　${esc(g.redTeam)} <span style="color:var(--red);">BP分 ${rs == null ? "--" : formatBpScore(bpValue(rs), bpValue(bs))}</span></div>` +
      `<div style="font-size:12px;color:var(--muted);margin-top:4px;">本局胜方：<b style="color:var(--gold);">${winnerName}</b>${g.isPeak ? " · 巅峰对决" : ""}</div>` +
      seriesAccuracyHtml(s) +
      reviewInsights(g);

    // 胜率走势图
    renderSeriesChart(g);
  }

  /**
   * 大场「模型命中率」自检：把每一局的模型预测胜率与该局真实胜负摆在一起。
   * 为什么要显示这个：职业 BP 的可预测性本来就低（bench/ 用 396 局真实对局实测
   * AUC 只有 0.52~0.55 量级），所以"猜对几局"波动很大 —— 与其让玩家以为模型很准，
   * 不如把对错直接摊开，顺便给出平均置信度，说明"小比分偏差是正常的"。
   * 不写入任何状态，纯展示；字段缺失时安静退化成不显示。
   */
  function seriesAccuracyHtml(s) {
    const games = (s && Array.isArray(s.games)) ? s.games : [];
    if (!games.length) return "";
    const rows = [];
    games.forEach((raw) => {
      const g = normalizeReviewGame(raw);
      if (!g || !g.winner || !g.picks || !g.picks.blue || !g.picks.red) return;
      if (g.picks.blue.length !== 5 || g.picks.red.length !== 5) return;
      let p = null;
      const history = g.winRateHistory || [];
      const saved = history.length ? history[history.length - 1].blueWin : null;
      try {
        const pred = BPData.predictWinRate(g.picks.blue, g.picks.red, heroStats);
        p = Number.isFinite(saved) ? saved : pred && typeof pred.blueWinProb === "number" ? pred.blueWinProb : null;
      } catch (e) { p = null; }
      if (p == null || !isFinite(p)) return;
      const pickSide = p >= 0.5 ? "blue" : "red";
      rows.push({
        game: g.game,
        p: p,
        hit: pickSide === g.winner,
        conf: Math.max(p, 1 - p),
        team: pickSide === 'blue' ? g.blueTeam : g.redTeam,
        recalculated: !Number.isFinite(saved),
      });
    });
    if (!rows.length) return "";
    const hits = rows.filter((r) => r.hit).length;
    const avgConf = rows.reduce((a, r) => a + r.conf, 0) / rows.length;
    const cells = rows.map((r) =>
      `<span class="sv-acc-cell ${r.hit ? "hit" : "miss"}" title="模型看好 ${esc(r.team)}（${(r.conf * 100).toFixed(1)}%）">` +
      `第${r.game}局 ${(r.p * 100).toFixed(1)}% ${r.recalculated ? '重算 ' : ''}${r.hit ? "✓" : "✗"}</span>`).join("");
    const note = rows.length < 3
      ? "局数太少，命中率没有统计意义"
      : (hits / rows.length >= 0.6
        ? "本场模型方向判断与结果较一致"
        : "本场模型方向判断与结果偏差较大 —— 职业 BP 可预测性本就有限，单场对错波动属正常");
    return `<div class="sv-acc">` +
      `<div class="sv-acc-head">模型命中 ${hits}/${rows.length}　平均置信度 ${(avgConf * 100).toFixed(1)}%</div>` +
      `<div class="sv-acc-cells">${cells}</div>` +
      `<div class="sv-acc-note">每局百分比为该局蓝方胜率，优先使用历史快照；标注“重算”的旧记录不代表当时预测。${note}</div>` +
      `</div>`;
  }

  function renderSeriesChart(g) {
    const container = $("sv-phase-chart");
    const tipsEl = $("sv-phase-tips");
    if (seriesViewer.chartMode === "bp") {
      renderGameReplayBpChart(g, container, tipsEl);
      return;
    }
    renderGameReplayTimeChart(g, container, tipsEl);
  }

  // 完整 BP 板（复用开局 .team-panel / .ban-slot / .pick-slot 结构，含队伍横幅与四角装饰）
  function teamPanelHtml(side, g) {
    const teamName = esc(side === "blue" ? g.blueTeam : g.redTeam);
    const bans = g.bans ? (g.bans[side] || []) : [];
    const picks = g.picks ? g.picks[side] : (side === "blue" ? g.blueLineup : g.redLineup);
    const maxBan = g.isPeak ? 0 : 5;
    const sideLabel = side === "blue" ? "蓝方" : "红方";
    let html = `<div class="team-panel ${side}-panel">`;
    html += `<div class="team-header"><span class="side-badge">${sideLabel}</span><span class="team-name">${teamName}</span></div>`;
    if (maxBan) {
      html += `<div class="section-label">禁用 Ban</div><div class="bans-grid">`;
      for (let i = 0; i < maxBan; i++) {
        const name = bans[i];
        if (name) {
          html += `<div class="ban-slot filled" title="${displayHero(name)}">${slotImgHtml(name)}<span class="ban-strike"></span><span class="ban-name">${displayHero(name)}</span></div>`;
        } else {
          html += `<div class="ban-slot">—</div>`;
        }
      }
      html += `</div>`;
    }
    html += `<div class="section-label">选用 Pick</div><div class="picks-grid">`;
    for (let i = 0; i < 5; i++) {
      const name = picks[i];
      if (name) {
        const h = heroByName(name);
        html += `<div class="pick-slot filled" style="--role-color:${ROLE_COLOR[h ? h.role : "辅助"] || "#8b94b3"}" title="${h ? displayHero(name) + " · " + h.pos : displayHero(name)}">${slotImgHtml(name)}<span class="pick-name">${displayHero(name)}</span></div>`;
      } else {
        html += `<div class="pick-slot">?</div>`;
      }
    }
    html += `</div></div>`;
    return html;
  }

  /* -------------------- 实时数据源 -------------------- */
  const FALLBACK_SEASONS = [
    { id: "KPL2025S3", label: "天权kpl全局bp模拟系统（2025 年总数据）" },
    { id: "KPL2025S2", label: "KPL2025夏季赛" },
    { id: "KCC2025",   label: "2025王者荣耀挑战者杯" },
    { id: "KPL2026S1", label: "KPL2026春季赛" },
    { id: "KCC2026",   label: "2026王者荣耀挑战者杯" },
    { id: "KPL2026S2", label: "KPL2026夏季赛", latest: true },
  ];

  async function syncOfficialHeroes() {
    const button = $('sync-heroes-btn'), status = $('roster-status');
    button.disabled = true;
    status.textContent = '正在核对腾讯官方英雄库…';
    try {
      const url = location.protocol === 'file:' ? 'https://pvp.qq.com/web201605/js/herolist.json' : apiUrl('/api/hero-catalog');
      const response = await fetch(url, {signal:AbortSignal.timeout(25000)});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.heroes;
      const added = HeroRoster.merge(rows, window.HEROES, window.HERO_IMAGE);
      try { localStorage.setItem('kpl_official_roster_v1', JSON.stringify({heroes:rows,fetchedAt:new Date().toISOString()})); } catch (_) {}
      heroStats = BPData.computeHeroStats();
      status.textContent = '已核对官方 ' + rows.length + ' 位英雄/形态，新增 ' + added + ' 个分路条目 · ' + new Date().toLocaleString('zh-CN');
      if (state.draft) render();
    } catch (e) {
      status.textContent = '同步失败，继续使用随附英雄快照。可启动本地服务重试，或运行 tools/sync-roster.js。';
    } finally { button.disabled = false; }
  }

  function setDataSourceStatus(text, cls) {
    const el = $("ds-status");
    if (!el) return;
    el.textContent = text;
    el.title = text; // 单行省略后，完整信息仍可悬停查看
    el.className = "ds-status" + (cls ? " " + cls : "");
  }

  function populateSeasonSelect(seasons) {
    const sel = $("season-select");
    if (!sel) return;
    sel.innerHTML = "";
    seasons.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label;
      sel.appendChild(opt);
    });
    // 默认选中最新赛季（路人数据只与该赛季一起返回）；无 latest 标记时选最后一个（最晚开赛）
    const latest = seasons.find((s) => s.latest) || seasons[seasons.length - 1];
    if (latest) sel.value = latest.id;
  }

  /* 前后端分离：/api/* 请求拼到后端 API_BASE 上（config.js 配置）。
   * 同源托管时 API_BASE 为空字符串 → 保持相对路径，向前兼容。 */
  function apiUrl(path) {
    const base = (window.API_BASE || "").replace(/\/+$/, "");
    if (path.indexOf("/api/") === 0 && base) return base + path;
    return path;
  }

  async function fetchJSON(path) {
    const res = await fetch(apiUrl(path));
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function postJSON(path, data) {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
    });
    return res.json();
  }

  async function loadHeroStats() {
    const season = $("season-select").value || "";
    const seasonLabel = $("season-select").selectedOptions[0] ? $("season-select").selectedOptions[0].textContent : season;
    const btn = $("btn-load-data");
    btn.disabled = true;
    setDataSourceStatus("正在加载 " + (seasonLabel || "最新赛季") + " 实时数据…", "");
    try {
      const [statsRes, playersRes] = await Promise.all([
        fetchJSON("/api/hero-stats?season=" + season),
        fetchJSON("/api/players?season=" + season).catch(() => null), // 选手数据失败不阻断英雄数据
      ]);
      const res = statsRes;
      if (res.code !== 200) throw new Error(res.message || "加载失败");
      const d = res.data;
      // 职业选手（该赛季）→ 供 AI 预测做英雄↔选手绑定
      if (playersRes && playersRes.code === 200 && playersRes.data) {
        BPData.setExternalPlayers(playersRes.data.players || []);
      }
      const meta = {
        season: d.season,
        updatedAt: d.updatedAt,
        heroCount: d.heroCount,
        matchCount: d.matchCount,
        sources: d.sources,
        isLatest: d.isLatest,
      };
      BPData.setExternalHeroStats(d.heroes, meta);
      heroStats = BPData.computeHeroStats();
      const matched = d.heroes.filter((h) => heroByName(h.name)).length;
      const src = d.sources || {};
      const pct = (w) => Math.round((w || 0) * 100);
      let srcTxt = "";
      if (src.pro && src.casual) srcTxt = "职业(按场次可信度)(" + (src.pro.season || "当前赛事") + ") + 路人(等效样本打折扣)(" + (src.casual.date || "") + ")";
      else if (src.pro) srcTxt = "职业(按场次可信度)(" + (src.pro.season || "当前赛事") + ")";
      else if (src.casual) srcTxt = "路人(等效样本打折扣)";
      if (d.isLatest === false) srcTxt += " · 仅职业赛场数据（该赛季）";
      setDataSourceStatus(
        "✅ 已加载 " + meta.heroCount + " 个英雄" + (srcTxt ? " · " + srcTxt : "") +
          " · 匹配本库 " + matched + " 个 · 更新 " +
          (meta.updatedAt ? meta.updatedAt.slice(5, 16).replace("T", " ") : ""),
        "online"
      );
      render();
    } catch (e) {
      setDataSourceStatus("⚠️ 加载失败：" + e.message + "（请确认已运行 node server.js）", "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function detectServer() {
    try {
      const res = await fetchJSON("/api/health");
      if (res && res.ok) {
        try {
          const s = await fetchJSON("/api/seasons");
          if (s.code === 200 && s.data && s.data.length) populateSeasonSelect(s.data);
        } catch (e) { /* 赛季列表拉取失败则沿用默认 */ }
        setDataSourceStatus("✅ 实时数据服务已连接", "online");
        loadHeroStats();
        return;
      }
      throw new Error("no server");
    } catch (e) {
      populateSeasonSelect(FALLBACK_SEASONS);
      setDataSourceStatus("未连接数据服务 · 使用内置参考数据（运行 node server.js 可启用职业+路人 可信度融合胜率）", "offline");
    }
  }

  /* -------------------- 初始化 / 事件绑定 -------------------- */
  function resetToSetup() {
    if (roomStream) { roomStream.close(); roomStream = null; }
    state.online = null;
    state.waiting = null;
    onlineStarted = false;
    lastSeq = 0;
    // 导播视图与音乐随开局一起收掉。
    // 这里必须走 Director.close()：只摘 .active 类会让 Director.active 停在 true，
    // 之后每次 render() 都还在往一块看不见的板子上画。
    if (window.Director && Director.isActive()) Director.close({ silent: true });
    document.body.classList.remove("dir-open");
    if (window.BPAudio) { BPAudio.setActive(false); BPAudio.setMusicEnabled(false); }
    $("online-status").classList.add("hidden");
    state.score = { blue: 0, red: 0 };
    state.currentGame = 1;
    state.seriesOver = false;
    state.history = [];
    state.draft = null;
    closeFreeze();
    $("result-modal").classList.remove("show");
    $("side-choice-modal").classList.remove("show");
    $("stats-modal").classList.remove("show");
    $("main-screen").classList.remove("active");
    $("setup-screen").style.display = "flex";
  }

  function bindEvents() {
    // 设置界面
    document.querySelectorAll("#bo-btns button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#bo-btns button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    // 模式切换（单机 / 联机）
    document.querySelectorAll("#mode-btns button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#mode-btns button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        setMode(btn.dataset.mode);
      });
    });

    // 房主选择己方阵营（蓝 / 红）
    document.querySelectorAll("#create-side-btns button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#create-side-btns button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    $("tab-create").addEventListener("click", () => {
      $("tab-create").classList.add("active");
      $("tab-join").classList.remove("active");
      $("online-create").classList.remove("hidden");
      $("online-join").classList.add("hidden");
    });
    $("tab-join").addEventListener("click", () => {
      $("tab-join").classList.add("active");
      $("tab-create").classList.remove("active");
      $("online-create").classList.add("hidden");
      $("online-join").classList.remove("hidden");
    });
    $("btn-create-room").addEventListener("click", createRoom);
    $("btn-join-room").addEventListener("click", joinRoom);

    $("start-btn").addEventListener("click", () => {
      // 导播模式：不进对局界面，直接开局进转播板子
      if (uiMode === "director") { startDirectorMode(); return; }
      state.blueTeam = $("blue-name").value.trim() || "蓝方";
      state.redTeam = $("red-name").value.trim() || "红方";
      const activeBo = document.querySelector("#bo-btns button.active");
      state.bo = activeBo ? parseInt(activeBo.dataset.bo, 10) : 7;
      state.score = { blue: 0, red: 0 };
      state.currentGame = 1;
      state.history = [];
      state.seriesOver = false;
      $("setup-screen").style.display = "none";
      $("main-screen").classList.add("active");
      startDraft();
    });

    // 英雄筛选
    document.querySelectorAll("#filter-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#filter-tabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.filterPos = btn.dataset.pos;        renderHeroGrid();
      });
    });

    $("search-box").addEventListener("input", (e) => {
      state.searchText = e.target.value.trim();
      renderHeroGrid();
    });

    // 操作按钮
    $("btn-undo").addEventListener("click", undo);
    $("btn-endgame").addEventListener("click", openResultModal);
    $("btn-trend").addEventListener("click", openTrendModal);
    $("btn-review").addEventListener("click", openReviewModal);
    $("btn-stats").addEventListener("click", openStatsModal);
    $("btn-reset").addEventListener("click", () => {
      if (confirm("确定重新开局吗？当前进度将丢失。")) resetToSetup();
    });

    let moduleTrigger = null;
    const drawer = $('module-dialog');
    const closeModule = () => { drawer.close(); if (moduleTrigger) moduleTrigger.focus(); };
    const selectModule = (name) => {
      document.querySelectorAll('[data-module-panel]').forEach(el => { el.hidden = el.dataset.modulePanel !== name; });
      document.querySelectorAll('[data-module-tab]').forEach(el => {
        const active = el.dataset.moduleTab === name;
        el.classList.toggle('active',active); el.setAttribute('aria-selected',String(active));
      });
    };
    document.querySelectorAll('[data-module-open]').forEach(btn => btn.addEventListener('click', () => {
      moduleTrigger = btn; selectModule(btn.dataset.moduleOpen); drawer.showModal();
    }));
    document.querySelectorAll('[data-module-tab]').forEach(btn => btn.addEventListener('click', () => selectModule(btn.dataset.moduleTab)));
    $('module-close').addEventListener('click', closeModule);
    drawer.addEventListener('click', e => { if (e.target === drawer) closeModule(); });
    $('sync-heroes-btn').addEventListener('click', syncOfficialHeroes);

    // 数据源
    $("btn-load-data").addEventListener("click", loadHeroStats);
    // 切换赛季 → 单独计算该赛季赛场数据（不混入其他赛季；历史赛季不取路人局）
    const seasonSel = $("season-select");
    if (seasonSel) seasonSel.addEventListener("change", loadHeroStats);

    // 定格画面点击关闭
    $("freeze-overlay").addEventListener("click", closeFreeze);

    // 结算弹窗
    $("result-close").addEventListener("click", () => $("result-modal").classList.remove("show"));
    $("result-blue").addEventListener("click", function () {
      $("result-blue").classList.add("selected");
      $("result-red").classList.remove("selected");
    });
    $("result-red").addEventListener("click", function () {
      $("result-red").classList.add("selected");
      $("result-blue").classList.remove("selected");
    });
    $("result-confirm").addEventListener("click", confirmResult);

    // 巅峰对决选边
    $("side-choose-blue").addEventListener("click", () => applySideChoice("blue"));
    $("side-choose-red").addEventListener("click", () => applySideChoice("red"));

    // 数据弹窗
    $("stats-close").addEventListener("click", () => $("stats-modal").classList.remove("show"));
    $("trend-close").addEventListener("click", () => $("trend-modal").classList.remove("show"));
    $("review-close").addEventListener("click", () => $("review-modal").classList.remove("show"));

    // 全屏对局复盘
    $("gr-back").addEventListener("click", closeGameReplay);
    document.querySelectorAll("#gr-phase-switch button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#gr-phase-switch button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        gameReplay.mode = btn.dataset.mode;
        // mode 字段目前只做展示切换；时间轴走势固定为四阶段
        renderGameReplay();
      });
    });

    // 大场复盘查看器
    $("sv-back").addEventListener("click", closeSeriesViewer);
    document.querySelectorAll("#sv-phase-switch button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#sv-phase-switch button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        seriesViewer.chartMode = btn.dataset.mode;
        const s = BPData.loadSeries()[seriesViewer.index];
        if (s) renderSeriesViewer();
      });
    });
    $("swap-close").addEventListener("click", () => {
      $("swap-modal").classList.remove("show");
      swapTarget = null;
    });
    document.querySelectorAll("#stats-modal .stats-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => renderStatsTab(btn.dataset.tab));
    });

    // 首屏绑定一次：已经在视口内的头像（选/禁槽位、首屏可见卡片）立刻加载，
    // 其余交给 IntersectionObserver 在滚动时按需加载。各 render 函数重渲染后
    // 会各自再调一次 bindHeroImgs（作用域限定在自己刚生成的节点上）。
    bindHeroImgs(document);
  }

  /* -------------------- 导播模式 / 音频 初始化 --------------------
   * 把状态读取器与少量动作函数注入 Director —— 本模块因此不需要知道
   * 任何 BP 规则，单机与联机共用同一条渲染路径。 */
  function initDirector() {
    if (!window.Director) return;
    Director.init({
      state,
      heroItems: () => (BPData.heroItems ? BPData.heroItems() : window.HEROES || []),
      currentStep,
      currentPickGroup,
      isMyTurn,
      isPeakGame,
      isHeroBlocked,
      includesHero,
      heroByName,
      displayHero,
      heroAvatarUrl,
      heroPosterUrl,
      heroImgTag,
      laneFallback,
      esc,
      bindHeroImgs,
      getHeroStats: () => heroStats,
      getPendingPick: () => pendingPick,
      setTeamLogoEl: (el, name) => {
        const f = teamLogoFile(name);
        if (f) { el.src = "js/teams/" + f; el.style.display = ""; }
        else { el.removeAttribute("src"); el.style.display = "none"; }
      },
      selectHero, confirmPick, cancelPick, openResultModal,
      undo: () => undo(), // 板子上的"撤销上一手"（导播是一个人模拟，撤手是刚需）
      // 退出导播：回到设置界面（导播模式没有"收起来看对局"这一说）
      onExit: () => resetToSetup(),
    });

    // 每秒刷新板上计时（仅在板子可见时工作）
    setInterval(() => { if (Director.isActive()) Director.tick(); }, 1000);

    // ---- 音频控件 ----
    const musicSel = $("dir-music");
    const musicOn = $("dir-music-on");
    const voiceOn = $("dir-voice-on");
    const vol = $("dir-volume");
    if (!window.BPAudio) return;

    BPAudio.ready().then(() => {
      const list = BPAudio.musicList();
      if (musicSel) {
        musicSel.innerHTML = list.length
          ? list.map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join("")
          : `<option value="">（未找到音频资源，请先运行 tools/fetch-audio.mjs）</option>`;
        musicSel.value = BPAudio.currentMusic();
      }
      if (vol) vol.value = String(Math.round(BPAudio.volume() * 100));
      if (musicOn) musicOn.checked = BPAudio.isMusicEnabled();
      if (voiceOn) voiceOn.checked = BPAudio.isVoiceEnabled();
    });

    musicSel?.addEventListener("change", () => {
      BPAudio.selectMusic(musicSel.value);
      if (musicOn) musicOn.checked = BPAudio.isMusicEnabled();
    });
    musicOn?.addEventListener("change", () => BPAudio.setMusicEnabled(musicOn.checked));
    voiceOn?.addEventListener("change", () => BPAudio.setVoiceEnabled(voiceOn.checked));
    vol?.addEventListener("input", () => BPAudio.setVolume(Number(vol.value) / 100));
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.KPLTeams.mount();
    bindEvents();
    initDirector();
    populateSeasonSelect(FALLBACK_SEASONS);
    detectServer();
    $('roster-status').textContent = '随附官方快照：' + (window.OFFICIAL_ROSTER ? new Date(OFFICIAL_ROSTER.fetchedAt).toLocaleString('zh-CN') + ' · ' + OFFICIAL_ROSTER.heroes.length + ' 位英雄/形态' : '未载入');
  });
})();
