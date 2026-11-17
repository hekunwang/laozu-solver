#!/bin/zsh
set -e
script_dir="${0:A:h}"
cd "$script_dir"
node_bin=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -x "$candidate" ]]; then node_bin="$candidate"; break; fi
done
if [[ -z "$node_bin" ]]; then node_bin=$(command -v node || true); fi
if [[ -z "$node_bin" ]]; then
  print '没有找到 Node.js。先打开离线网页；天赋截图文字识别需要本机 Node 服务。'
  /usr/bin/open "$script_dir/index.html"
  exit 1
fi
print '正在启动本地计算器。保持此窗口打开即可使用天赋截图文字识别；关闭窗口会停止服务。'
exec "$node_bin" "$script_dir/launch-local.cjs"
