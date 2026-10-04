# 天权 KPL 全局 BP 模拟系统 · 公网站点

本仓库是 BP 模拟器的**公网静态站点包**，通过 **GitHub + Cloudflare Pages** 发布。
推送到 GitHub 后，Cloudflare Pages 会自动重新构建部署（约 1 分钟），无需手动上传任何文件。

---

## 一、站点能做什么

| 功能 | 纯静态（不依赖后端） | 需要后端 server.js |
|---|---|---|
| BP 模拟（单机）、导播模式、转播视图、巅峰对决 | ✅ | |
| 英雄库、分路池、阵容排序、内置参考数据 | ✅ | |
| BGM / 英雄语音、音效 | ✅ | |
| 对局历史、导入导出（浏览器本地存储） | ✅ | |
| **实时职业 + 路人可信度融合胜率** | | ✅ |
| **官方英雄库在线核对** | | ✅ |
| **联机对战房间（建房间 / 加入 / 导播同步）** | | ✅ |

后端没开或隧道断了，站点**不会白屏**：会自动退回内置参考数据，
上面「纯静态」那一列的功能全部照常可用，只是顶栏会提示「未连接数据服务」。

---

## 二、目录结构

```
kpl-web/
├── index.html          # 页面入口
├── js/                 # 前端脚本（config.js 是后端地址配置，改动前先读注释）
│   ├── config.js       # ★ 后端地址在这里
│   ├── teams/          # 战队 logo
│   └── lanes/          # 分路参考图
├── css/                # 样式
│   └── assets/         # 背景图
├── audio/              # BGM + 英雄语音 + manifest.json
│   ├── music/
│   └── voice/
├── sync.mjs            # 从本地开发目录同步最新前端资源
├── publish.cmd         # 一键同步 + 提交 + 推送
├── start-backend.cmd   # 启动本机后端（含跨域白名单设置）
└── .gitignore          # 防止密钥/备份/日志误入库
```

> 本包**只放前端**。后端 `server.js`、`ai.config.json`（含 DeepSeek 密钥）
> 等一律留在本地 `../kpl-bp-simulator/`，**绝不能进这个仓库**。
> `.gitignore` 已经把它们挡掉了，但推之前仍建议跑一次下面的自检。

---

## 三、日常更新内容（最常用）

改完本地 `../kpl-bp-simulator/` 里的前端代码后：

```
双击 publish.cmd
```

它按顺序做三件事：

1. `node sync.mjs` —— 把开发目录的 `index.html` / `js` / `css` / `audio` 同步过来，
   并自动把 `index.html` 里所有 `?v=xxx` 刷成新时间戳（防止用户看到旧缓存）。
2. `git add -A` + `git commit`
3. `git push` —— Cloudflare Pages 收到推送后自动部署

只想预览会改哪些文件、不实际写入：

```
node sync.mjs --dry
```

**`js/config.js` 不会被同步覆盖**：发布版里它写的是公网后端地址，
开发版是空字符串，两者用途不同，脚本已显式保护。

---

## 四、后端地址变了怎么办

后端由本机 `server.js`（默认 8080）提供，经 Tailscale Funnel / Cloudflare 隧道对外发布。
隧道地址变化时，改 [js/config.js](js/config.js) 顶部的这一行，然后重新 `publish.cmd`：

```js
const DEFAULT_API_BASE = "https://administrator.taild67b1f.ts.net";
```

**临时救急不用重新部署**：在网址后加 `?api=新地址` 即可，会记进浏览器 localStorage。

```
https://你的站点.pages.dev/?api=https://新隧道地址
```

---

## 五、跨域（CORS）说明

站点在 `*.pages.dev`，后端在隧道域名，两者不同源，浏览器默认会拦截 `/api/*` 请求。
后端已支持白名单，启动时用环境变量放行即可 —— `start-backend.cmd` 已经设好了：

```
set KPL_ALLOWED_ORIGINS=https://*.pages.dev,https://你的自定义域名
node server.js
```

不设这个变量时，后端行为与之前完全一致（只允许同源），不影响原有的隧道访问方式。

---

## 六、首次部署（只需做一次）

1. **建仓库并推送**（本目录已 `git init` 并完成首次提交）：
   ```
   gh auth login                     # 浏览器授权，不要用账号密码
   gh repo create kpl-bp --public --source=. --push
   ```
2. **连 Cloudflare Pages**：登录 <https://dash.cloudflare.com/> → Workers & Pages →
   Create → Pages → Connect to Git → 选刚建的仓库。
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：**`/`**（根目录）
3. 部署完成后拿到 `https://xxx.pages.dev`，据此更新 `start-backend.cmd`
   里的白名单和 `js/config.js` 里的地址（如果隧道地址有变）。

---

## 七、推送前自检

```
node -e "const fs=require('fs');const bad=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(/node_modules|\.git$/.test(p))continue;e.isDirectory()?w(p):/ai\.config\.json|\.env|\.log$|\.sqlite$|\.bak/.test(p)&&bad.push(p)}})('.');console.log(bad.length?'❌ 疑似敏感文件：\n'+bad.join('\n'):'✅ 未发现敏感文件')"
```

---

## 八、常见问题

**页面打开是白屏 / 样式全丢**
检查 Cloudflare Pages 的 build output directory 是不是设成了 `/`，以及仓库根目录
必须有 `index.html`。

**顶栏一直显示「未连接数据服务」**
后端没开，或隧道断了，或 `KPL_ALLOWED_ORIGINS` 没放行站点域名。
先确认 `http://localhost:8080/api/health` 通，再确认隧道地址能打开。

**实时数据 / 联机房间用不了，但其它都正常**
这是预期行为 —— 这两项依赖后端，静态站点无法独立提供。

**推上去后页面还是旧的**
`sync.mjs` 会自动刷新 `?v=` 版本号。若仍不更新，去 Cloudflare Pages
的 Deployments 页面确认这次提交有没有触发部署。
