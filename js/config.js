/* ============================================================
 * KPL 全局BP模拟器 —— 公网发布版（Cloudflare Pages）前后端分离配置
 * ============================================================
 * 本站为纯静态站点，托管在 Cloudflare Pages。
 * 需要后端（server.js）才能启用的功能：
 *   - 实时职业/路人 可信度融合胜率（/api/hero-stats、/api/players、/api/seasons）
 *   - 联机对战房间（/api/room/*）
 * 后端仍由本机 server.js 提供（默认 8080 端口），并通过原有的
 * Tailscale Funnel / Cloudflare 隧道对外发布。这里填的就是那个公网地址。
 *
 * 后端地址的三种确定方式，优先级从高到低：
 *   1. 网址后加 ?api=https://xxx  —— 临时切换并记住到 localStorage
 *   2. localStorage 里已保存的值
 *   3. DEFAULT_API_BASE（下面这个常量）—— 隧道地址变了就改它，然后重新推送
 *
 * 隧道没开 / 后端没跑时，站点不会崩：会自动退回到内置参考数据，
 * BP 模拟、导播模式、转播、音频、英雄库等全部离线可用。
 * ============================================================ */

/* ↓↓↓ 隧道地址变了，只改这一行 ↓↓↓ */
const DEFAULT_API_BASE = "https://administrator.taild67b1f.ts.net";

window.API_BASE = (function () {
  const trim = (s) => String(s || "").replace(/\/+$/, "");
  try {
    const q = new URLSearchParams(location.search).get("api");
    if (q) {
      const v = trim(q);
      localStorage.setItem("kpl_api_base", v);
      return v;
    }
    const saved = localStorage.getItem("kpl_api_base");
    if (saved) return trim(saved);
  } catch (e) { /* 隐私模式等场景下忽略 */ }
  return trim(DEFAULT_API_BASE);
})();
