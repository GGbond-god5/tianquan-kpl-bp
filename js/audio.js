/* ============================================================
 * 导播模式 · 音频层（BP 背景音乐 + 英雄语音）
 *
 * 资源来源：audio/manifest.json（由 tools/fetch-audio.mjs 从参考站
 * wucebp.top 一次性镜像落地）。BGM 原站是约 1 小时过期的签名链接，
 * 不能运行时热链，故全部本地化 —— 离线可用。
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
 *  - 资源预热：进入导播模式后后台把语音全量与当前曲目灌进 HTTP 缓存，
 *    把"点击后才开始下载"的等待挪到用户还在摆布局的时候（见 warmCache）。
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
   *  而且 <audio> 不会报错，只是永远不出声。所以必须钉死 audio/ 这个基准。 */
  const AUDIO_BASE = new URL("audio/", location.href);
  function audioUrl(file) {
    return new URL(file, AUDIO_BASE).href;
  }

  /* ---------- 预热：把"点击后才下载"改成"进导播就后台下好" ----------
   * 原来 preload="none" + 点击时才设 src，等于把整段下载时间摊到点击之后；
   * 加上音频是强缓存资源，先在空闲时段灌进浏览器 HTTP 缓存，点击时命中缓存即可出声。
   *
   * 语音总量只有约 11 MB（132 个文件，平均 80 KB），全量预热是划算的；
   * 音乐只热当前选中那一首 —— 单曲 3~18 MB，全热不划算。
   *
   * 只在首次进入导播模式时启动：在此之前 playVoice() 也会直接返回，
   * 预热了也没人会听，白白占带宽。
   */
  let warmStarted = false;
  function warmCache() {
    if (warmStarted) return;
    warmStarted = true;

    const track = effectiveTrack();
    if (track && track.file) void warmOne(track.file);

    const files = (manifest?.voice || []).map((v) => v.file).filter(Boolean);
    let i = 0;
    const CONC = 3;   // 别把连接占满，否则会拖慢正在播放的音频
    const worker = async () => {
      while (i < files.length) await warmOne(files[i++]);
    };
    for (let k = 0; k < CONC; k++) void worker();
  }

  /** 取一个音频进缓存；失败静默 —— 预热是尽力而为，不能影响正常播放。
   *  必须把 body 读掉：只拿到 Response 不读，浏览器可能在对象回收时中断下载，
   *  HTTP 缓存就填不上，预热等于白做。 */
  async function warmOne(file) {
    try {
      const r = await fetch(audioUrl(file), { cache: "force-cache" });
      if (r.ok) await r.arrayBuffer();
    } catch { /* 单个失败不影响其余 */ }
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
        const savedVolume = Number(readStore(VOLUME_STORE, volume));
        volume = Number.isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume)) : volume;
        currentKey = resolveKey(readStore(MUSIC_KEY_STORE, DEFAULT_MUSIC_KEY));
        applyVolume();
        syncMusic();
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
    const want = audioUrl(file);
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
    const url = audioUrl(file);
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
