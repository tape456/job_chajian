"""网页理解（字段映射）与浮层动作规划请求/响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field

from .common import LLMConfig


class PageOption(BaseModel):
    text: str = ""


class PageField(BaseModel):
    id: str
    kind: str | None = None
    signals: list[str] = Field(default_factory=list)
    options: list[PageOption] = Field(default_factory=list)


class PageEntry(BaseModel):
    path: str
    label: str
    value: str | None = None


class PageUnderstandRequest(BaseModel):
    fields: list[PageField]
    entries: list[PageEntry]
    config: LLMConfig | None = None


class MappingEntry(BaseModel):
    id: str
    path: str | None = None
    confidence: float = 0.8


class PageUnderstandResult(BaseModel):
    mappings: list[MappingEntry]
    unresolved: list[str] = Field(default_factory=list)


class PageActOption(BaseModel):
    index: int
    text: str = ""


class PageActCell(BaseModel):
    """浮层里的一个候选项。col/index 定位它，状态字段告诉模型能不能点、点了会不会展开。"""
    col: int
    index: int
    text: str = ""
    selected: bool = False
    disabled: bool = False
    expandable: bool = False


class PageActColumn(BaseModel):
    """级联浮层的一列；模型必须按「列 + 列内序号」定位，只给扁平列表它分不清当前级。"""
    level: int
    options: list[PageActCell] = Field(default_factory=list)


class PageActRequest(BaseModel):
    goal: str
    field_label: str = ""
    step: int = 1
    open_state: str = "closed"
    display: str = ""
    placeholder: str = ""
    columns: list[PageActColumn] = Field(default_factory=list)
    # options 是 columns 的扁平视图，留给旧客户端与退化路径
    options: list[PageActOption] = Field(default_factory=list)
    actions: list[PageActOption] = Field(default_factory=list)
    history: list[str] = Field(default_factory=list)
    config: LLMConfig | None = None


class PageActResult(BaseModel):
    action: str
    index: int | None = None
    col: int | None = None
    x: float | None = None
    y: float | None = None
    ms: int | None = None
    text: str = ""
    direction: str = "down"
