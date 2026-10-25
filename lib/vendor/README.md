# lib/vendor

本目录用于存放第三方库。为减小仓库体积，pdf.js 的构建产物**未纳入版本库**，首次拉取代码后请执行一次下载脚本。

## pdf.js（本地 PDF 解析，必须）

- 版本：**pdfjs-dist 3.11.174**（与插件中 `resume-parser.js` 调用的 UMD 接口 `pdfjsLib` 对应）
- 需要的两个文件：`pdf.min.js`、`pdf.worker.min.js`

Windows PowerShell：`powershell -ExecutionPolicy Bypass -File scripts/fetch-pdfjs.ps1`
macOS / Linux：`bash scripts/fetch-pdfjs.sh`

或手动下载：
- https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js
- https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js

> 该库为 Mozilla pdf.js（Apache-2.0），仅在浏览器本地解析 PDF，不经过任何网络。
