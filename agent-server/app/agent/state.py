"""LangGraph 状态定义与动作计划模型。"""
from __future__ import annotations

from typing import Literal, TypedDict

from pydantic import BaseModel, Field

from ..schemas.common import LLMConfig

ActionLiteral = Literal[
    "load_document", "split_sections", "rule_extract",
    "llm_extract", "repair_fields", "finalize",
]


class ActionPlan(BaseModel):
    thought: str = Field(description="对当前状态的判断")
    action: ActionLiteral
    reason: str


class ResumeParseState(TypedDict, total=False):
    # 输入
    file_name: str
    file_bytes: bytes
    config: LLMConfig
    use_ocr: bool
    max_iterations: int
    section_budget: int
    # 过程产物
    document: dict                    # NormalizedDocument.model_dump()
    section_map: dict[str, str]       # section_key -> 证据文本
    rule_result: dict                 # {data, warnings, confidence}
    llm_result: dict                  # {data, confidence}
    draft: dict
    confidence: dict[str, float]
    missing: list[str]                # 字段路径，如 basic.name
    warnings: list[str]
    observations: list[dict]
    iteration: int
    next_action: str
