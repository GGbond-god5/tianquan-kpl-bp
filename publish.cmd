@echo off
chcp 65001 >nul
rem ============================================================
rem  一键更新并发布
rem  同步本地最新前端 → 提交 → 推送到 GitHub
rem  Cloudflare Pages 检测到推送后会自动重新部署（约 1 分钟）
rem ============================================================
cd /d "%~dp0"

echo.
echo [1/3] 从 ../kpl-bp-simulator 同步最新前端资源...
node "%~dp0sync.mjs"
if errorlevel 1 (
  echo.
  echo 同步失败，已中止。
  pause
  exit /b 1
)

echo.
echo [2/3] 提交改动...
git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo 没有需要提交的改动，跳过提交。
  goto :push
)
set /p MSG=请输入本次更新说明（直接回车用默认）:
if "%MSG%"=="" set MSG=更新站点内容 %date% %time%
git commit -m "%MSG%"

:push
echo.
echo [3/3] 推送到 GitHub...
git push
if errorlevel 1 (
  echo.
  echo 推送失败。常见原因：
  echo   - 未登录：运行  gh auth login
  echo   - 远程未配置：git remote -v 查看，git remote add origin ^<仓库地址^>
  pause
  exit /b 1
)

echo.
echo ✅ 已推送。Cloudflare Pages 通常 1 分钟内自动部署完成。
echo    查看部署状态：https://dash.cloudflare.com/  ^>  Workers ^& Pages
echo.
pause
