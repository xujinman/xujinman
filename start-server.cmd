@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "D:\node.exe" (
  "D:\node.exe" server\server.js
) else (
  node server\server.js
)
echo.
echo 服务已停止，按任意键关闭窗口。
pause >nul
