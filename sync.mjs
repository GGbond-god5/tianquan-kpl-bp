#!/usr/bin/env node
/* ============================================================
 * 同步脚本：把本地开发目录的最新前端资源，同步进本发布包（kpl-web）。
 * ============================================================
 * 用法（在本目录下）：
 *     node sync.mjs            正常同步
 *     node sync.mjs --dry      只预览会改哪些文件，不实际写入
 *
 * 会做什么：
 *   1. 从 ../kpl-bp-simulator 复制 index.html / js / css / audio 下的资源
 *   2. 保护 js/config.js —— 发布版里它写的是公网后端地址，
 *      不能用开发版的空字符串覆盖（见下面的 PROTECTED）
 *   3. 自动给 index.html 里所有 ?v=xxx 换成新的时间戳，强制浏览器/Cloudflare
 *      重新拉取，避免"推了新代码但用户看到旧缓存"
 *
 * 不会碰：README、.gitignore、本脚本自身、以及任何后端文件。
 * ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "kpl-bp-simulator");
const DST = HERE;
const DRY = process.argv.includes("--dry");

/* 发布版持有独立内容、不允许被开发版覆盖的文件（相对 DST 的路径） */
const PROTECTED = new Set(["js/config.js"]);

/* 需要同步的目录（递归）与单文件 */
const DIRS = ["js", "css", "audio"];
const FILES = ["index.html"];

/* 这些子目录/文件属于开发侧，不发布 */
const EXCLUDE_RE = /(^|[\\/])(_backup|node_modules|test|bench|crawler)([\\/]|$)|\.(mjs|cmd|vbs|py|sqlite|log|pid)$|\.bak$|\.bak-/i;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (EXCLUDE_RE.test(full)) continue;
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let copied = 0, skipped = 0, removed = 0;

if (!fs.existsSync(SRC)) {
  console.error("✗ 找不到开发目录：" + SRC);
  console.error("  请确认本包与 kpl-bp-simulator 在同一层目录下。");
  process.exit(1);
}

/* ---- 1. 复制文件 ---- */
const srcFiles = [];
for (const f of FILES) {
  const p = path.join(SRC, f);
  if (fs.existsSync(p)) srcFiles.push(p);
  else console.warn("  ! 源文件不存在，跳过：" + f);
}
for (const d of DIRS) {
  const p = path.join(SRC, d);
  if (fs.existsSync(p)) srcFiles.push(...walk(p));
}

for (const s of srcFiles) {
  const rel = path.relative(SRC, s);
  if (PROTECTED.has(rel.replace(/\\/g, "/"))) { skipped++; continue; }
  const t = path.join(DST, rel);
  const same = fs.existsSync(t) && fs.readFileSync(s).equals(fs.readFileSync(t));
  if (same) { skipped++; continue; }
  if (!DRY) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.copyFileSync(s, t);
  }
  console.log((DRY ? "  将更新  " : "  ✓ 更新   ") + rel.replace(/\\/g, "/"));
  copied++;
}

/* ---- 2. 清理：源里已删除、包里还在的文件 ---- */
const srcRel = new Set(srcFiles.map((s) => path.relative(SRC, s).replace(/\\/g, "/")));
for (const d of DIRS) {
  const p = path.join(DST, d);
  if (!fs.existsSync(p)) continue;
  for (const f of walk(p)) {
    const rel = path.relative(DST, f).replace(/\\/g, "/");
    if (PROTECTED.has(rel) || srcRel.has(rel)) continue;
    if (!DRY) fs.unlinkSync(f);
    console.log((DRY ? "  将删除  " : "  ✗ 删除   ") + rel);
    removed++;
  }
}

/* ---- 3. 缓存版本号 ---- */
const idxPath = path.join(DST, "index.html");
if (fs.existsSync(idxPath)) {
  const html = fs.readFileSync(idxPath, "utf8");
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const tag =
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "-" + pad(d.getHours()) + pad(d.getMinutes());
  const bumped = html.replace(/\?v=[A-Za-z0-9._-]+/g, "?v=" + tag);
  const n = (html.match(/\?v=[A-Za-z0-9._-]+/g) || []).length;
  if (bumped !== html) {
    if (!DRY) fs.writeFileSync(idxPath, bumped);
    console.log("  ⟳ 缓存版本号 → ?v=" + tag + "（" + n + " 处）");
  }
} else if (!DRY) {
  console.warn("  ! index.html 缺失，跳过版本号更新");
}

console.log("\n汇总：" + (DRY ? "[预览] " : "") + "更新 " + copied + " · 未变 " + skipped + " · 删除 " + removed);
console.log(DRY ? "（--dry 预览模式，未写入任何文件）" : "下一步：运行 publish.cmd 推送，或手动 git add -A && git commit && git push");
