"""
LLM 客户端与健壮结构化抽取：
1) 优先 with_structured_output（json_schema / function calling）
2) 不支持或失败时，注入 JSON Schema 走纯文本 JSON 兜底
"""
from __future__ import annotations

import json
import re
from typing import Type

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, ValidationError

from ..schemas.common import LLMConfig


def normalize_base_url(base_url: str | None) -> str:
    """OpenAI 兼容地址归一：只有主机端口时补 /v1。"""
    if not base_url:
        return ""
    b = base_url.rstrip("/")
    if re.search(r"/chat/completions$", b):
        b = b[: -len("/chat/completions")]
    if re.fullmatch(r"https?://[^/]+", b):  # http://host:port
        b += "/v1"
    return b


def build_llm(config: LLMConfig) -> ChatOpenAI:
    return ChatOpenAI(
        base_url=normalize_base_url(config.base_url),
        api_key=config.api_key or "not-needed",
        model=config.model or "deepseek-chat",
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        timeout=config.timeout,
        max_retries=1,
    )


def extract_json(text: str) -> dict:
    """从模型输出中提取最外层 JSON 对象。"""
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError("模型输出中未找到 JSON")
    raw = m.group(0)
    return json.loads(raw)


async def chat_json(llm: ChatOpenAI, system: str, user: str) -> dict:
    resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
    return extract_json(resp.content)


async def structured_extract(
    llm: ChatOpenAI,
    model_cls: Type[BaseModel],
    system: str,
    user: str,
    retries: int = 2,
) -> BaseModel:
    """结构化抽取主入口：先结构化接口，失败转 JSON 兜底并可带修复重试。"""
    # 1) with_structured_output
    try:
        structured_llm = llm.with_structured_output(model_cls)
        result = await structured_llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
        if isinstance(result, model_cls):
            return result
    except Exception:
        pass  # 网关/模型不支持结构化输出，走兜底

    # 2) JSON 兜底（含解析失败修复重试）
    schema = json.dumps(model_cls.model_json_schema(), ensure_ascii=False)
    last_error = ""
    for attempt in range(retries + 1):
        fix = f"\n上一次输出解析失败：{last_error}，请严格按 schema 输出。" if last_error else ""
        full_user = user + f"\n\n请严格按以下 JSON Schema 输出（只输出 JSON）：{schema}{fix}"
        try:
            resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=full_user)])
            parsed = extract_json(resp.content)
            return model_cls.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError, ValueError) as e:
            last_error = str(e)[:200]
    raise ValueError(f"结构化抽取失败（{model_cls.__name__}）：{last_error}")
