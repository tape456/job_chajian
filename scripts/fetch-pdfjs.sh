#!/usr/bin/env bash
# 下载 pdf.js（pdfjs-dist）固定版本到 lib/vendor，供插件本地解析 PDF。
# 用法：bash scripts/fetch-pdfjs.sh
set -euo pipefail

VERSION="3.11.174"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${SCRIPT_DIR}/../lib/vendor"
FILES=(pdf.min.js pdf.worker.min.js)

BASES=(
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build"
  "https://unpkg.com/pdfjs-dist@${VERSION}/build"
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VERSION}"
)

mkdir -p "$DEST"

for f in "${FILES[@]}"; do
  target="${DEST}/${f}"
  if [ -s "$target" ]; then
    echo "已存在，跳过: $f"
    continue
  fi
  ok=0
  for b in "${BASES[@]}"; do
    url="${b}/${f}"
    echo "下载 $url ..."
    if curl -fsSL --retry 2 --connect-timeout 20 -o "$target" "$url"; then
      ok=1; break
    fi
    rm -f "$target"
  done
  if [ "$ok" -ne 1 ]; then
    echo "下载 $f 失败，请按 lib/vendor/README.md 手动下载。" >&2
    exit 1
  fi
done

echo "pdf.js ${VERSION} 已就绪于 $DEST"
