"""跨模块共享的请求模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LLMConfig(BaseModel):
    """插件设置页中的 AI 配置，随请求传入；服务本身不持久化。"""

    base_url: str | None = Field(None, description="OpenAI 兼容地址，如 http://1.2.3.4:3000 或 https://api.deepseek.com/v1")
    api_key: str | None = None
    model: str | None = Field(None, description="模型名，如 qwen3-8-27b / deepseek-chat")
    temperature: float = 0.0
    max_tokens: int | None = None
    timeout: int = Field(60, description="单次 LLM 请求超时秒数")
