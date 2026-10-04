@echo off
chcp 65001 >nul
rem ============================================================
rem  启动后端 server.js，并放行公网站点的跨域调用
rem
rem  站点走 Cloudflare Pages 后，页面域名与后端域名不同，
rem  浏览器会按 CORS 拦截 /api/* 请求。这里把站点域名加进白名单。
rem
rem  ↓↓↓ 部署完 Cloudflare Pages 后，把下面这行换成你的实际域名 ↓↓↓
rem     多个域名用英文逗号隔开；也可写 https://*.pages.dev 匹配全部子域
rem ============================================================

set "KPL_ALLOWED_ORIGINS=https://*.pages.dev"

cd /d "%~dp0..\kpl-bp-simulator"
echo.
echo  跨域白名单：%KPL_ALLOWED_ORIGINS%
echo  后端目录：%CD%
echo  浏览器打开 http://localhost:8080
echo  保持本窗口运行。按 Ctrl+C 停止服务。
echo.
node server.js
pause
