"""调试：dump 样例 DOCX 的板块文本。"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.agent.tools import load_document, split_sections
from app.schemas.common import LLMConfig

docx = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "test" / "sample-resume.docx"
state = {
    "file_name": docx.name, "file_bytes": docx.read_bytes(),
    "config": LLMConfig(base_url=None, api_key=None, model=None),
    "use_ocr": False, "section_budget": 7000, "observations": [],
}
import asyncio
for node in (load_document, split_sections):
    state.update(asyncio.run(node(state)))
for key, text in state["section_map"].items():
    print("=" * 20, key, "=" * 20)
    print(text)
