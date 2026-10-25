"""网页理解接口：POST /api/page/understand。"""
from __future__ import annotations

from fastapi import APIRouter

from ..config import get_settings
from ..schemas.common import LLMConfig
from ..schemas.page import PageActRequest, PageActResult, PageUnderstandRequest, PageUnderstandResult
from ..services.page_service import act_page, understand_page

router = APIRouter(prefix="/api/page", tags=["page"])


@router.post("/understand", response_model=PageUnderstandResult)
async def understand(req: PageUnderstandRequest) -> PageUnderstandResult:
    s = get_settings()
    default_config = LLMConfig(
        base_url=s.llm_base_url or None,
        api_key=s.llm_api_key or None,
        model=s.llm_model or None,
    )
    return await understand_page(req, default_config)


@router.post("/act", response_model=PageActResult)
async def act(req: PageActRequest) -> PageActResult:
    s = get_settings()
    default_config = LLMConfig(
        base_url=s.llm_base_url or None,
        api_key=s.llm_api_key or None,
        model=s.llm_model or None,
    )
    return await act_page(req, default_config)
