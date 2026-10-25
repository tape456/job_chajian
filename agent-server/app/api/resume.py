"""简历解析接口：POST /api/resume/parse（JSON）与 /parse/stream（SSE）。"""
from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse

from ..agent.graph import build_graph
from ..config import get_settings
from ..schemas.common import LLMConfig
from ..schemas.resume import ParseResult

router = APIRouter(prefix="/api/resume", tags=["resume"])


def _resolve_config(base_url: str | None, api_key: str | None,
                    model: str | None) -> LLMConfig:
    settings = get_settings()
    return LLMConfig(
        base_url=base_url or settings.llm_base_url or None,
        api_key=api_key or settings.llm_api_key or None,
        model=model or settings.llm_model or None,
    )


def _initial_state(file_bytes: bytes, filename: str, config: LLMConfig,
                   use_ocr: bool) -> dict:
    settings = get_settings()
    return {
        "file_name": filename,
        "file_bytes": file_bytes,
        "config": config,
        "use_ocr": use_ocr,
        "max_iterations": settings.max_iterations,
        "section_budget": settings.section_char_budget,
        "observations": [],
        "iteration": 0,
    }


def _result_from_state(state: dict) -> ParseResult:
    return ParseResult(
        data=state["draft"],
        warnings=state.get("warnings", []),
        confidence=state.get("confidence", {}),
        observations=state.get("observations", []),
        text_length=len((state.get("document") or {}).get("text", "")),
        file_name=state["file_name"],
    )


@router.post("/parse", response_model=ParseResult)
async def parse(
    file: UploadFile = File(...),
    base_url: str | None = Form(None),
    api_key: str | None = Form(None),
    model: str | None = Form(None),
    use_ocr: bool = Form(False),
):
    file_bytes = await file.read()
    config = _resolve_config(base_url, api_key, model)
    graph = build_graph()
    state = await graph.ainvoke(
        _initial_state(file_bytes, file.filename, config, use_ocr)
    )
    return _result_from_state(state)


@router.post("/parse/stream")
async def parse_stream(
    file: UploadFile = File(...),
    base_url: str | None = Form(None),
    api_key: str | None = Form(None),
    model: str | None = Form(None),
    use_ocr: bool = Form(False),
):
    file_bytes = await file.read()
    config = _resolve_config(base_url, api_key, model)
    graph = build_graph()
    initial = _initial_state(file_bytes, file.filename, config, use_ocr)

    async def event_gen():
        final_state: dict = dict(initial)
        async for chunk in graph.astream(initial, stream_mode="updates"):
            for node, update in chunk.items():
                final_state = _deep_update(final_state, update)
                payload = {"node": node}
                if update.get("observations"):
                    payload["event"] = update["observations"][-1]
                yield _sse("step", payload)
        yield _sse("result", _result_from_state(final_state).model_dump())

    return StreamingResponse(event_gen(), media_type="text/event-stream")


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _deep_update(base: dict, update: dict) -> dict:
    """graph 更新片段合并（observations 等数组整体覆盖，dict 递归）。"""
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = _deep_update(base[key], value)
        else:
            base[key] = value
    return base
