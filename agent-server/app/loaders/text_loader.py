"""TXT / MD 加载器：按行识别板块标题。"""
from __future__ import annotations

from .document import Block, NormalizedDocument
from ..rules.patterns import match_section_title


def load_text(content: str, file_name: str, file_type: str = "txt") -> NormalizedDocument:
    blocks: list[Block] = []
    for raw in content.splitlines():
        line = raw.strip()
        if not line:
            continue
        sec = match_section_title(line)
        blocks.append(Block(kind="heading", text=line) if sec else Block(kind="paragraph", text=line))
    doc = NormalizedDocument(
        file_name=file_name, file_type=file_type, blocks=blocks,
        text="\n".join(b.text for b in blocks),
    )
    return doc
