# 央国企网申速填 · Agent 服务

简历解析 **ReAct 智能体**（FastAPI + LangGraph），与浏览器插件配套：

- `POST /api/resume/parse`：上传 PDF / DOCX / TXT，返回结构化简历（对齐插件 schema）
- `POST /api/resume/parse/stream`：同上，SSE 推送「思考-行动-观察」全过程
- `POST /api/page/understand`：网页表单字段 → 简历条目路径映射

> 服务本身**不存储任何简历与密钥**：插件每次请求携带其设置页的 AI 配置（base_url / api_key / model），服务仅做转发与编排。

## 1. 本地运行

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows；Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

打开 http://localhost:8000/docs 可在线调试。

扫描件 / 图片简历再装 OCR 依赖：`pip install -r requirements-ocr.txt`

## 2. 调用示例

```bash
curl -X POST http://localhost:8000/api/resume/parse \
  -F "file=@我的简历.docx" \
  -F "base_url=http://your-gateway:3000" \
  -F "api_key=sk-xxxx" \
  -F "model=qwen3-8-27b" \
  -F "use_ocr=true"
```

响应：

```json
{
  "data": { "basic": { "name": "张三", "gender": "男", "...": "" }, "education": [] },
  "warnings": ["未识别到教育经历"],
  "confidence": { "basic.name": 0.99, "basic.gender": 0.9 },
  "observations": [
    { "action": "think", "observation": "思考：… → 行动：load_document" },
    { "action": "load_document", "observation": "已加载 32 个块、文本 1820 字" }
  ],
  "text_length": 1820,
  "file_name": "我的简历.docx"
}
```

## 3. 解析链路（ReAct）

```
think（LLM 决策）
  ├─ load_document   DOCX 表格感知 / PDF 文本+表格 / 扫描件 OCR
  ├─ split_sections  按板块标题归组（基本信息/教育/工作/实习/项目…）
  ├─ rule_extract    正则 + 身份证推断（性别/生日/年龄）→ 高置信基线
  ├─ llm_extract     逐板块结构化输出（function calling，失败转 JSON 兜底）
  ├─ repair_fields   合并后对缺失字段定向补证
  └─ finalize        合并、一致性校验、教育经历回填、输出
```

动作节点执行后回到 `think`，直到智能体选择 `finalize`（默认上限 12 轮）。

## 4. Docker 部署

```bash
docker build -t qf-agent .
docker run -d --name qf-agent -p 8000:8000 \
  -e LLM_BASE_URL=http://your-gateway:3000 \
  -e LLM_MODEL=qwen3-8-27b \
  qf-agent
```

服务器用 systemd 直接托管 uvicorn：

```ini
# /etc/systemd/system/qf-agent.service
[Unit]
Description=qf-agent
After=network.target

[Service]
WorkingDirectory=/opt/qf-agent
ExecStart=/opt/qf-agent/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now qf-agent
```

如需 80 端口或域名，再在 Nginx 反代 `127.0.0.1:8000`，并在插件「解析服务地址」填写 `http://你的服务器:8000`。

## 5. 目录结构

```
app/
├── config.py              # 环境变量兜底配置
├── main.py                # FastAPI
├── schemas/               # LLMConfig / 简历结构化模型 / 页面模型
├── loaders/               # docx / pdf / text / ocr + 统一块模型、表格配对
├── rules/                 # 正则模式、身份证、行政区、规则抽取
├── agent/                 # state / llm / prompts / tools / graph
└── services/              # 合并、校验、页面理解
```
