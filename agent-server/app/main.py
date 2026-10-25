"""FastAPI 入口：简历解析 + 网页理解。"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import page, resume

app = FastAPI(
    title="央国企网申速填 - Agent 服务",
    description="简历解析 ReAct 智能体（LangGraph）+ 网页表单理解",
    version="1.0.0",
)

# 单用户自建服务：允许插件跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resume.router)
app.include_router(page.router)


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok", "service": "qf-agent", "version": "1.0.0"}


@app.get("/", tags=["meta"])
async def root():
    return {
        "service": "央国企网申速填 Agent",
        "docs": "/docs",
        "endpoints": ["/api/resume/parse", "/api/resume/parse/stream", "/api/page/understand", "/api/page/act"],
    }
