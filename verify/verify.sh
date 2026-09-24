#!/bin/sh
# 一次性验收：单元测试 -> 构建检查 -> HTTP 冒烟。
# 任一步失败立即以专用退出码退出；全部成功输出 0。
set -u
cd /app

echo "== [1/3] 单元测试（vitest） =="
if ! npm test; then
  echo "VERIFY FAILED: 单元测试未通过 (exit 10)"
  exit 10
fi

echo "== [2/3] 构建检查（tsc 类型检查 + vite 构建） =="
if ! npm run build; then
  echo "VERIFY FAILED: 构建检查未通过 (exit 20)"
  exit 20
fi

echo "== [3/3] HTTP 冒烟（${BASE_URL:-http://web:80}） =="
if ! node verify/smoke.mjs; then
  echo "VERIFY FAILED: HTTP 冒烟未通过 (exit 30)"
  exit 30
fi

echo "ALL VERIFY STEPS PASSED"
exit 0
