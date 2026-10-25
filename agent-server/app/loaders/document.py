"""统一文档块模型：所有加载器输出 NormalizedDocument，供规则抽取与 LLM 共用。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class Block(BaseModel):
    kind: str = Field(description="heading | kv | record | paragraph | list_item")
    text: str = ""
    label: str | None = None
    value: str | None = None
    page: int | None = None
    bbox: tuple[float, float, float, float] | None = None


class NormalizedDocument(BaseModel):
    file_name: str
    file_type: str
    blocks: list[Block]
    text: str = ""
    needs_ocr: bool = False
    metadata: dict = Field(default_factory=dict)


def render_for_llm(blocks: list[Block]) -> str:
    """块 -> 规范化文本；kv 输出「标签：值」，heading 输出「## 标题」。"""
    out: list[str] = []
    for b in blocks:
        if b.kind == "kv":
            out.append(f"{b.label}：{b.value}")
        elif b.kind == "heading":
            out.append(f"\n## {b.text}")
        elif b.kind == "record":
            out.append(b.text)
        else:
            out.append(b.text)
    return "\n".join(x for x in out if x is not None)
