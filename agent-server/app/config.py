"""全局配置：环境变量兜底（请求未携带 LLM 配置时使用）。"""
from __future__ import annotations

import os
from pydantic import BaseModel


class Settings(BaseModel):
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "deepseek-chat"
    max_iterations: int = 12
    enable_ocr: bool = True
    max_upload_mb: int = 20
    section_char_budget: int = 7000  # 单个板块证据超过该长度则分块抽取


def get_settings() -> Settings:
    return Settings(
        llm_base_url=os.getenv("LLM_BASE_URL", ""),
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_model=os.getenv("LLM_MODEL", "deepseek-chat"),
        max_iterations=int(os.getenv("MAX_ITERATIONS", "12")),
        enable_ocr=os.getenv("ENABLE_OCR", "true").lower() == "true",
        max_upload_mb=int(os.getenv("MAX_UPLOAD_MB", "20")),
        section_char_budget=int(os.getenv("SECTION_CHAR_BUDGET", "7000")),
    )
