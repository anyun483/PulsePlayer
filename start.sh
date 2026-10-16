#!/usr/bin/env bash
# PulsePlayer 启动器
#
# 某些环境（如 CI、IDE 内嵌终端、部分国产开发环境）会全局设置
# ELECTRON_RUN_AS_NODE=1。该变量会让 Electron 以纯 Node 模式启动，
# 导致 require('electron') 返回字符串路径而非 API 对象，
# 表现为启动即崩溃并报 "Cannot read properties of undefined (reading 'requestSingleInstanceLock')"。
#
# 这里用 env -u 把它从子进程环境中彻底移除。
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

ELECTRON="$DIR/node_modules/electron/dist/electron.exe"
if [ ! -x "$ELECTRON" ]; then
  ELECTRON="$DIR/node_modules/electron/dist/electron"
fi

if [ ! -e "$ELECTRON" ]; then
  echo "错误：未找到 Electron 运行时。"
  echo "请先执行安装，国内网络建议使用镜像："
  echo "  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install"
  exit 1
fi

# 允许附加原生启动参数，例如：./start.sh --disable-gpu
exec env -u ELECTRON_RUN_AS_NODE "$ELECTRON" . "$@"