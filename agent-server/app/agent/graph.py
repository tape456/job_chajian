"""
LangGraph 编排：ReAct 范式。

think（大模型决策下一步 Action）→ 动作节点（执行工具、写入观察）
→ think … → finalize → END。
"""
from __future__ import annotations

from langgraph.graph import END, StateGraph

from ..schemas.resume import SECTION_ORDER
from ..services.validate import find_missing
from . import tools
from .llm import build_llm, structured_extract
from .prompts import ROUTER_SYSTEM, router_prompt
from .state import ActionPlan, ResumeParseState

ACTIONS = [
    "load_document", "split_sections", "rule_extract",
    "llm_extract", "repair_fields",
]


def _state_summary(state: ResumeParseState) -> str:
    lines: list[str] = []
    lines.append(f"- 文档加载：{'是' if state.get('document') else '否'}")
    if state.get("section_map"):
        lines.append(f"- 板块切分：{len(state['section_map'])} 个板块")
    else:
        lines.append("- 板块切分：否")
    rr = state.get("rule_result")
    if rr:
        bf = sum(1 for v in rr["data"].get("basic", {}).values() if v)
        lines.append(f"- 规则抽取：基本信息 {bf} 项")
    if state.get("llm_result"):
        lines.append(f"- LLM 抽取：{len(state['llm_result']['data'])} 个板块")
    if state.get("draft"):
        lines.append(f"- 已合并修复，缺失：{find_missing(state['draft']) or '无'}")
    return "\n".join(lines)


def _fallback_action(state: ResumeParseState) -> str:
    """路由不可用时的确定性默认流程。"""
    if not state.get("document"):
        return "load_document"
    if not state.get("section_map"):
        return "split_sections"
    if not state.get("rule_result"):
        return "rule_extract"
    if not state.get("llm_result"):
        return "llm_extract"
    if not state.get("draft"):
        return "repair_fields"
    return "finalize"


async def think(state: ResumeParseState) -> dict:
    iteration = state.get("iteration", 0) + 1
    max_iter = state.get("max_iterations", 12)
    observations = state.get("observations", [])

    if iteration > max_iter:
        return {
            "iteration": iteration,
            "next_action": "finalize",
            "observations": observations + [
                {"action": "think", "observation": "达到最大迭代次数，强制定稿"}
            ],
        }

    try:
        llm = build_llm(state["config"])
        plan = await structured_extract(
            llm, ActionPlan, ROUTER_SYSTEM,
            router_prompt(_state_summary(state), observations),
        )
        action = plan.action
        note = f"思考：{plan.thought} → 行动：{action}（{plan.reason}）"
    except Exception as e:
        action = _fallback_action(state)
        note = f"思考节点失败（{e}），走默认流程：{action}"

    return {
        "iteration": iteration,
        "next_action": action,
        "observations": observations + [{"action": "think", "observation": note}],
    }


def route(state: ResumeParseState) -> str:
    return state.get("next_action", "finalize")


def build_graph():
    g = StateGraph(ResumeParseState)
    g.add_node("think", think)
    g.add_node("load_document", tools.load_document)
    g.add_node("split_sections", tools.split_sections)
    g.add_node("rule_extract", tools.rule_extract)
    g.add_node("llm_extract", tools.llm_extract)
    g.add_node("repair_fields", tools.repair_fields)
    g.add_node("finalize", tools.finalize)

    g.set_entry_point("think")
    g.add_conditional_edges(
        "think", route,
        {a: a for a in ACTIONS} | {"finalize": "finalize"},
    )
    for action in ACTIONS:
        g.add_edge(action, "think")
    g.add_edge("finalize", END)
    return g.compile()
