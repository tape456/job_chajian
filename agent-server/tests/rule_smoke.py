"""冒烟测试：模块导入、图构建、规则路径解析（不调用 LLM）。"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 1) 全量导入（包含 FastAPI 路由）
import app.main  # noqa: F401
from app.agent.graph import build_graph
from app.agent import tools
from app.schemas.common import LLMConfig
from app.loaders.docx_loader import load_docx


def test_imports_and_graph():
    graph = build_graph()
    assert graph is not None
    print("[PASS] 模块导入 & 图构建成功")


def test_docx_rule_path(docx_path: Path):
    # 模拟 state，跳过 LLM：load_document -> split_sections -> rule_extract
    state = {
        "file_name": docx_path.name,
        "file_bytes": docx_path.read_bytes(),
        "config": LLMConfig(base_url=None, api_key=None, model=None),
        "use_ocr": False,
        "section_budget": 7000,
        "observations": [],
        "iteration": 0,
    }
    for node in (tools.load_document, tools.split_sections, tools.rule_extract):
        update = asyncio.run(node(state))
        state.update(update)
        print(f"[STEP] {node.__name__} -> {state['observations'][-1]['observation']}")
    data = state["rule_result"]["data"]
    print("[RESULT] basic =", json.dumps(data["basic"], ensure_ascii=False))
    print("[RESULT] education =", json.dumps(data["education"], ensure_ascii=False))
    print("[RESULT] work =", json.dumps(data["work"], ensure_ascii=False))
    print("[RESULT] internship =", json.dumps(data["internship"], ensure_ascii=False))
    print("[RESULT] project =", json.dumps(data["project"], ensure_ascii=False))
    assert data["basic"]["name"], "姓名未抽到！"
    print("[PASS] DOCX 规则解析成功，姓名 =", data["basic"]["name"])


def test_full_graph_without_llm(docx_path: Path):
    """完整图：无 LLM 配置时 think 失败走 fallback，仍应能定稿输出。"""
    graph = build_graph()
    state = {
        "file_name": docx_path.name,
        "file_bytes": docx_path.read_bytes(),
        "config": LLMConfig(base_url="http://127.0.0.1:9", api_key="bad", model="none"),
        "use_ocr": False,
        "max_iterations": 12,
        "section_budget": 7000,
        "observations": [],
        "iteration": 0,
    }
    result = asyncio.run(graph.ainvoke(state))
    print("[FINAL] draft.basic.name =", result["draft"]["basic"]["name"])
    print("[FINAL] warnings =", result["warnings"])
    print("[PASS] 无 LLM 全图 fallback 定稿成功")


if __name__ == "__main__":
    test_imports_and_graph()
    docx = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "test" / "sample-resume.docx"
    if docx.exists():
        test_docx_rule_path(docx)
        test_full_graph_without_llm(docx)
    else:
        print(f"[SKIP] 未找到测试件 {docx}")
