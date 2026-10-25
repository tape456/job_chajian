"""网页理解服务：表单字段 -> 简历条目路径映射。"""
from __future__ import annotations

import json

from pydantic import create_model

from ..schemas.common import LLMConfig
from ..schemas.page import (
    MappingEntry, PageActRequest, PageActResult,
    PageUnderstandRequest, PageUnderstandResult,
)
from ..agent.llm import build_llm, chat_json, structured_extract
from ..agent.prompts import PAGE_ACT_SYSTEM, PAGE_SYSTEM, page_act_prompt, page_prompt


async def understand_page(req: PageUnderstandRequest, default_config: LLMConfig) -> PageUnderstandResult:
    config = req.config or default_config
    if not config.model:
        raise ValueError("缺少模型配置（请在插件设置中填写模型名）")
    llm = build_llm(config)

    # 动态结构化模型：mappings 列表
    mapping_model = create_model(
        "page_mappings",
        mappings=(list[MappingEntry], ...),
    )
    fields_json = json.dumps(
        [f.model_dump() for f in req.fields], ensure_ascii=False,
    )
    entries_json = json.dumps(
        [e.model_dump() for e in req.entries], ensure_ascii=False,
    )
    result = await structured_extract(
        llm, mapping_model, PAGE_SYSTEM,
        page_prompt(fields_json, entries_json),
    )

    valid_paths = {e.path for e in req.entries}
    by_id = {m.id: m for m in result.mappings}
    mappings: list[MappingEntry] = []
    unresolved: list[str] = []
    for field in req.fields:
        m = by_id.get(field.id)
        if m and m.path in valid_paths and m.confidence >= 0.5:
            mappings.append(MappingEntry(id=field.id, path=m.path, confidence=m.confidence))
        else:
            unresolved.append(field.id)
    return PageUnderstandResult(mappings=mappings, unresolved=unresolved)


_ACTS = {
    "click_option", "hover_option", "click_action", "commit", "click_at",
    "scroll_column", "type", "wait", "retry_open", "done", "fail",
    "scroll",  # 旧名，等价于 scroll_column
}


def _int(raw, key):
    try:
        v = raw.get(key) if isinstance(raw, dict) else None
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _num(raw, key):
    try:
        v = raw.get(key) if isinstance(raw, dict) else None
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


async def act_page(req: PageActRequest, default_config: LLMConfig) -> PageActResult:
    config = req.config or default_config
    if not config.model:
        raise ValueError("缺少模型配置（请在插件设置中填写模型名）")
    llm = build_llm(config)
    obs = req.model_dump(exclude={"config"})
    raw = await chat_json(llm, PAGE_ACT_SYSTEM, page_act_prompt(json.dumps(obs, ensure_ascii=False)))
    action = raw.get("action") if isinstance(raw, dict) else None
    if action not in _ACTS:
        action = "fail"
    text = raw.get("text") if isinstance(raw, dict) and isinstance(raw.get("text"), str) else ""
    ms = _int(raw, "ms")
    return PageActResult(
        action=action,
        index=_int(raw, "index"),
        col=_int(raw, "col"),
        x=_num(raw, "x"),
        y=_num(raw, "y"),
        ms=max(50, min(1500, ms)) if ms is not None else None,
        text=text[:80],
        direction="up" if isinstance(raw, dict) and raw.get("direction") == "up" else "down",
    )
