/* ============================================================
 * 导播模式 · 音频层（BP 背景音乐 + 英雄语音）
 *
 * 资源来源：audio/manifest.json（由 tools/fetch-audio.mjs 从参考站
 * wucebp.top 一次性镜像落地）。BGM 原站是约 1 小时过期的签名链接，
 * 不能运行时热链，故全部本地化 —— 离线可用。
 * 清单里可选地给一个 "baseUrl"，把音频字节指向国内对象存储/CDN
 * （站点在大陆走 Cloudflare 落台北节点，首字节 2~12 秒，是国内体验的唯一硬伤）。
 * 不配就沿用同站 audio/，行为与从前完全一致。
 *
 * 对外接口（window.BPAudio）：
 *   ready()                 -> Promise，资源清单载入完成
 *   musicList()             -> [{key,label,file}]，供下拉列表
 *   currentMusic()          -> 当前"实际在放"的曲目 key（巅峰局会返回巅峰曲）
 *   selectedMusic()         -> 用户自己选的曲目 key（巅峰局结束后回到它）
 *   selectMusic(key)        -> 切换曲目（"off" 表示不播放）
 *   setMusicEnabled(bool)   -> BP 音乐总开关
 *   setVoiceEnabled(bool)   -> 英雄语音开关
 *   setVolume(v)            -> 0..1，同时作用于音乐与语音
 *   setPeak(bool)           -> 进入/退出第 7 局（巅峰对决）——幂等，只有翻转才动作
 *   playVoice(name)         -> 按英雄名播放语音（无则静默）
 *   attachVoice(name)       -> 只驱动语音播放器（供英雄池点击）
 *
 * 设计要点：
 *  - 浏览器自动播放策略：首次用户交互前不主动出声。所有播放都发生在
 *    点击之后（开始 BP / 点英雄），因此不需要额外的解锁弹窗；但仍
 *    捕获 play() 的 rejection，避免控制台报错。
 *  - 音乐与语音各用一个 <audio>，互不打断；语音播放时对音乐做短暂
 *    闪避（ducking），这是转播台的做法。
 *  - 第 7 局（巅峰对决）自动接管：清单里标了 peak 的曲目顶替用户选择，
 *    前提是音乐总开关是开的。用户在巅峰局手动换曲则本局内尊重手动选择，
 *    下一局重新接管。
 *  - 资源预热：进入导播模式后后台把语音全量与当前曲目取进内存、转成
 *    blob URL，把"点击后才开始下载"的等待挪到用户还在摆布局的时候，
 *    点击时零网络（见 warmCache）。
 * ============================================================ */
(function () {
  "use strict";

  const MUSIC_KEY_STORE = "kpl.bp.music";   // localStorage：记住上次选的曲目
  const VOLUME_STORE = "kpl.bp.volume";
  const DEFAULT_MUSIC_KEY = "01_regular";   // 默认曲目；不在清单里时回退到清单第一首

  let manifest = null;
  let loadPromise = null;

  const bgm = new Audio();
  bgm.loop = true;
  bgm.preload = "auto";

  const voice = new Audio();
  voice.preload = "auto";

  let musicEnabled = false;   // 总开关：默认不开启，由导播面板显式打开
  let voiceEnabled = true;    // 英雄语音默认开启
  let volume = 0.6;
  let currentKey = null;
  let duckTimer = null;
  let active = false;

  // A session gate independent of saved controls: no audio outside the director.
  function setActive(on) {
    const next = !!on;
    if (active === next) return;
    active = next;
    if (!active) {
      bgm.pause(); voice.pause();
      try { voice.currentTime = 0; } catch {}
      if (duckTimer) clearTimeout(duckTimer);
      duckTimer = null;
      applyVolume();
    } else { syncMusic(); warmCache(); }
  }

  // 巅峰对决（第 7 局）：清单里 peak:true 的那首顶替用户选择。
  // peakOverridden 记「用户在巅峰局里自己换了曲」，本局内不再自动接管。
  let peakMode = false;
  let peakOverridden = false;

  function readStore(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch { return fallback; }
  }
  function writeStore(key, v) {
    try { localStorage.setItem(key, v); } catch { /* 隐私模式忽略 */ }
  }

  /** 安全播放：吞掉自动播放策略导致的 rejection，不让控制台刷红。 */
  function safePlay(el) {
    if (!active) return;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  /** 清单里的 file 是相对 audio/ 的（如 "music/01_regular.mp3"），
   *  不是相对页面根 —— 按页面根解析会变成 /music/... 被静态白名单 403，
   *  而且 <audio> 不会报错，只是永远不出声。所以必须钉死 audio/ 这个基准。
   *
   *  可切换：manifest.json 里给了 baseUrl 就用它（绝对地址或相对地址都行）。
   *  这是给"音频挪到国内对象存储"留的口子 —— 站点在大陆走 Cloudflare 会落到
   *  台北节点，首字节要 2~12 秒，这是免费版改不掉的硬天花板；把音频字节挪到
   *  国内 CDN 才能真正做到"点击即有"。清单本身留在本站（小、且要 no-cache），
   *  只让重的音频字节走 CDN。
   *
   *  ⚠️ 用 CDN 时对象存储必须允许跨域（响应带 Access-Control-Allow-Origin）。
   *     预热走的是 fetch()，跨域没有 CORS 头会被浏览器直接拦掉。
   *     拦掉的后果是温和的：预热失败、自动退回下面的直连播放，不会报错刷屏，
   *     只是"点击即有"没了。 */
  let audioBase = new URL("audio/", location.href);
  function audioUrl(file) {
    return new URL(file, audioBase).href;
  }

  /* ---------- 预热：把"点击后才下载"改成"进导播就后台下好" ----------
   * 原来 preload="none" + 点击时才设 src，等于把整段下载时间摊到点击之后。
   *
   * 为什么不是"灌进 HTTP 缓存"就完事：`fetch()` 填的是 HTTP 磁盘缓存，
   * 而 `<audio>` 走浏览器另一套**媒体缓存**，两者不保证共享 —— 预热跑完了，
   * 点击时媒体元素仍可能重新发一次请求，那 2~12 秒的首字节又等一遍。
   * 所以这里不再只写缓存，而是把字节收进内存、转成 blob URL 交给播放器：
   * blob 是本地地址，点击时零网络、零等待。
   *
   * 内存代价：语音全量约 10 MB（132 个，平均 80 KB），常驻划算；
   * 音乐单曲 3~18 MB，只留当前那一份，换曲时释放旧的。
   *
   * 并发取 8 而不是 3：这一层是**延迟受限**而非带宽受限 —— 每个请求首字节
   * 要 2~12 秒，小并发等于把这 132 次首字节排成一条长队。
   *
   * 只在首次进入导播模式时启动：在此之前 playVoice() 也会直接返回，
   * 预热了也没人会听，白白占带宽。
   */
  const voiceBlobs = new Map();   // 语音 file -> blob URL（全量常驻）
  let musicBlob = null;           // { file, url } —— 只保留当前曲目那一份

  let warmStarted = false;
  function warmCache() {
    // 清单没到就先不启动，也**不要**把 warmStarted 钉死 —— 否则用户在清单
    // 加载完之前就点了"进入导播台"（首字节 2~12 秒，这很常见），这里空转一次
    // 就再也不会预热了，等于把预热整个丢掉。load() 完成后会带着 active 再调一次。
    if (warmStarted || !manifest || !active) return;
    warmStarted = true;

    const track = effectiveTrack();
    if (track && track.file) void warmMusic(track.file);

    const files = (manifest?.voice || []).map((v) => v.file).filter(Boolean);
    let i = 0;
    const CONC = 8;
    const worker = async () => {
      while (i < files.length) await warmVoice(files[i++]);
    };
    for (let k = 0; k < CONC; k++) void worker();
  }

  /** 播放时实际用的地址：预热好的走本地 blob，还没热到就退回网络。 */
  function mediaUrl(file) {
    if (file.startsWith("music/")) {
      return musicBlob && musicBlob.file === file ? musicBlob.url : audioUrl(file);
    }
    return voiceBlobs.get(file) || audioUrl(file);
  }

  async function fetchBytes(file) {
    const r = await fetch(audioUrl(file), { cache: "force-cache" });
    if (!r.ok) return null;
    return r.arrayBuffer();
  }

  async function warmVoice(file) {
    if (voiceBlobs.has(file)) return;
    try {
      const buf = await fetchBytes(file);
      if (!buf) return;
      voiceBlobs.set(file, URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
    } catch { /* 单个失败不影响其余 */ }
  }

  async function warmMusic(file) {
    if (musicBlob && musicBlob.file === file) return;
    try {
      const buf = await fetchBytes(file);
      if (!buf) return;
      if (musicBlob && musicBlob.file === file) return;   // 并发里别人已备好
      if (musicBlob) URL.revokeObjectURL(musicBlob.url);
      musicBlob = { file, url: URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })) };
    } catch { /* 预热是尽力而为，不能影响正常播放 */ }
    // 只在音乐停着时换 src —— 换 src 会打断正在播的曲子，而 blob 的价值
    // 是"下次点播放不用等"，不是"打断当前播放"。
    if (!bgm.paused) return;
    if (wantFile() !== file) return;
    syncMusic();
  }

  function applyVolume() {
    bgm.volume = volume * (duckTimer ? 0.35 : 1);
    voice.volume = Math.min(1, volume * 1.15); // 语音略微抬高，压过音乐
  }

  /** 语音播放期间压低音乐，播完/超时后恢复。 */
  function duck(ms) {
    if (duckTimer) clearTimeout(duckTimer);
    duckTimer = setTimeout(() => { duckTimer = null; applyVolume(); }, ms);
    applyVolume();
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch("audio/manifest.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        manifest = m || { music: [], voice: [] };
        // 清单里给了 baseUrl 就把音频基准切过去（国内对象存储/CDN）。
        // 必须在下面任何 audioUrl() 被用到之前定好 —— syncMusic() 紧随其后。
        if (manifest.baseUrl) {
          try { audioBase = new URL(manifest.baseUrl, location.href); }
          catch { /* 写错了就沿用本站 audio/，不要因为一个配置错误整个不出声 */ }
        }
        const savedVolume = Number(readStore(VOLUME_STORE, volume));
        volume = Number.isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume)) : volume;
        currentKey = resolveKey(readStore(MUSIC_KEY_STORE, DEFAULT_MUSIC_KEY));
        applyVolume();
        syncMusic();
        // 补一次预热：用户在清单到达之前就进了导播台的话，setActive 那次是空转的。
        // 没进导播台时 warmCache 自己会直接返回，不会白占带宽。
        warmCache();
        return manifest;
      })
      .catch(() => { manifest = { music: [], voice: [] }; return manifest; });
    return loadPromise;
  }

  function musicList() {
    return (manifest?.music || []).filter((m) => m.file)
      .map((m) => ({ key: String(m.key), label: m.label || String(m.key), file: m.file }));
  }

  function trackByKey(key) {
    return musicList().find((t) => t.key === String(key)) || null;
  }

  /** 把可能已失效的 key 收敛到清单里真实存在的一首。
   *  localStorage 里可能留着上一版清单的 key（换曲目后就成了死值），
   *  不收敛的话音乐开关打开也永远不出声。 */
  function resolveKey(key) {
    if (trackByKey(key)) return String(key);
    const first = musicList()[0];
    return first ? first.key : String(key);
  }

  /** 清单里标了 peak 的曲目就是巅峰对决曲。 */
  function peakTrack() {
    return (manifest?.music || []).find((m) => m.peak && m.file) || null;
  }

  /** 巅峰曲此刻是否在接管。 */
  function peakActive() { return peakMode && !peakOverridden && !!peakTrack(); }

  /** 实际在放的那首（巅峰局是巅峰曲，否则是用户选的）。 */
  function effectiveTrack() {
    if (peakActive()) return peakTrack();
    return trackByKey(currentKey);
  }

  /** 当前应该播放的曲目文件（受总开关影响）。 */
  function wantFile() {
    if (!active || !musicEnabled) return null;
    const t = effectiveTrack();
    return t ? t.file : null;
  }

  function syncMusic() {
    const file = wantFile();
    if (!file) { bgm.pause(); return; }
    const want = mediaUrl(file);
    if (bgm.src !== want) {
      bgm.src = want;   // 用绝对地址，避免相对路径被解析到页面根
      bgm.currentTime = 0;
    }
    if (bgm.paused) safePlay(bgm);
  }

  function selectMusic(key) {
    if (key === "off") { setMusicEnabled(false); return; }
    currentKey = String(key);
    writeStore(MUSIC_KEY_STORE, currentKey);
    // 巅峰局里用户自己挑了别的曲子 → 本局内不再自动接管（手动优先）
    const pt = peakTrack();
    if (peakMode && !peakOverridden && pt && currentKey !== String(pt.key)) peakOverridden = true;
    musicEnabled = true;
    syncMusic();
    warmIfActive();
  }

  /** 换了曲目就把新曲也提前取进内存（原本只热了进导播时那一首）。 */
  function warmIfActive() {
    if (!active) return;
    const t = effectiveTrack();
    if (t && t.file) void warmMusic(t.file);
  }

  function setMusicEnabled(on) {
    musicEnabled = !!on;
    syncMusic();
  }

  /** 进入/退出第 7 局（巅峰对决）。幂等：只有状态真正翻转才动作，
   *  所以可以从 render() 里每帧无脑调用。 */
  function setPeak(on) {
    const next = !!on;
    if (next === peakMode) return;
    peakMode = next;
    peakOverridden = false;   // 每次进出巅峰局都重新接管
    syncMusic();
    warmIfActive();           // 巅峰曲也提前取好，别等第七局开场才下
  }

  function setVoiceEnabled(on) {
    voiceEnabled = !!on;
    if (!voiceEnabled) voice.pause();
  }

  function setVolume(v) {
    volume = Math.min(1, Math.max(0, Number(v) || 0));
    writeStore(VOLUME_STORE, String(volume));
    applyVolume();
  }

  function voiceFileFor(name) {
    const list = manifest?.voice || [];
    const hit = list.find((v) => v.name === name && v.file);
    return hit ? hit.file : null;
  }

  /** 播放英雄语音；找不到该英雄的语音就安静跳过（不报错）。 */
  function playVoice(name) {
    if (!active || !voiceEnabled || !name) return;
    const file = voiceFileFor(name);
    if (!file) return;
    const url = mediaUrl(file);
    if (voice.src !== url) voice.src = url;
    try { voice.currentTime = 0; } catch { /* 尚未 metadata，忽略 */ }
    safePlay(voice);
    duck(2600);
  }

  // 语音自然播完就恢复音乐音量
  voice.addEventListener("ended", () => { if (duckTimer) { clearTimeout(duckTimer); duckTimer = null; } applyVolume(); });

  window.BPAudio = {
    setActive,
    ready: load,
    musicList,
    // 下拉列表显示"实际在放的那首"，所以巅峰局会显示巅峰曲，局后回到用户选择
    currentMusic: () => (effectiveTrack() || { key: currentKey }).key,
    selectedMusic: () => currentKey,
    selectMusic,
    setMusicEnabled,
    setVoiceEnabled,
    setVolume,
    setPeak,
    isMusicEnabled: () => musicEnabled,
    isVoiceEnabled: () => voiceEnabled,
    isPeak: () => peakMode,
    volume: () => volume,
    playVoice,
    trackByKey,
    /** 只读调试快照（验收脚本用）：把内部判定摊平出来，
     *  省得测试去猜"现在到底该放哪首"。 */
    _state: () => ({
      active,
      key: currentKey,                        // 用户选择的 key
      effective: effectiveTrack()?.key || null, // 实际该放的那首
      peak: peakMode,
      overridden: peakOverridden,
      enabled: musicEnabled,
      want: wantFile(),                       // 该放的文件的相对路径（关着就是 null）
      base: audioBase.href,                   // 音频基准（配了 baseUrl 时是 CDN 地址）
      src: bgm.src,
      paused: bgm.paused,
      // paused=false 只说明 play() 被调过；readyState 才证明字节真的到了。
      // （清单路径解析错时 <audio> 静默不出声，只看 paused 会漏掉。）
      readyState: bgm.readyState,
      duration: Number.isFinite(bgm.duration) ? bgm.duration : null,
      error: bgm.error ? bgm.error.code : null,
      voice: { src: voice.src, readyState: voice.readyState, paused: voice.paused, error: voice.error ? voice.error.code : null },
    }),
  };
  window.addEventListener("pagehide", () => setActive(false));
})();
