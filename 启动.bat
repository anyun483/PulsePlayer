@echo off
REM PulsePlayer Windows 启动器
REM 清理 ELECTRON_RUN_AS_NODE，该变量会让 Electron 退化为纯 Node 模式而无法启动

setlocal
cd /d "%~dp0"

if defined ELECTRON_RUN_AS_NODE set ELECTRON_RUN_AS_NODE=

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
  echo 错误：未找到 Electron 运行时。
  echo 请先执行安装，国内网络建议使用镜像：
  echo   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  echo   npm install
  pause
  exit /b 1
)

"%ELECTRON%" %*

if errorlevel 1 pause
endlocal