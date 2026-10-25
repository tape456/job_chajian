"""
动作节点工具：每个函数对应 ReAct 中的一个 Action，
返回 state 更新片段，并向 observations 追加观察记录。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from ..loaders.document import NormalizedDocument
from ..loaders.docx_loader import load_docx
from ..loaders.pdf_loader import load_pdf
from ..loaders.text_loader import load_text
from ..rules.extractor import rule_extract as run_rule_extract
from ..rules.patterns import match_section_title
from ..schemas.resume import (
    SECTION_ORDER, SECTION_SPECS, make_list_model, make_record_model,
)
from ..services.merge import merge_results
from ..services.validate import derive_fields, find_missing
from .llm import build_llm, structured_extract
from .prompts import EXTRACT_SYSTEM, repair_prompt, section_prompt


class RepairValue(BaseModel):
    value: str = Field(description="找到的值，没有则为空字符串")


def _observe(observations: list[dict], action: str, observation: str) -> list[dict]:
    return observations + [{"action": action, "observation": observation}]


def _doc(state) -> NormalizedDocument:
    return NormalizedDocument.model_validate(state["document"])


def _chunk_text(text: str, budget: int) -> list[str]:
    chunks: list[str] = []
    cur = ""
    for line in text.split("\n"):
        if cur and len(cur) + len(line) > budget:
            chunks.append(cur)
            cur = ""
        cur += line + "\n"
    if cur.strip():
        chunks.append(cur)
    return chunks


# ------------------------------------------------------------ Action: 加载文档
async def load_document(state):
    name = state["file_name"]
    lower = name.lower()
    try:
        if lower.endswith(".docx"):
            doc = load_docx(state["file_bytes"], name)
        elif lower.endswith(".pdf"):
            doc = load_pdf(state["file_bytes"], name, use_ocr=state.get("use_ocr", True))
        else:
            doc = load_text(state["file_bytes"].decode("utf-8", errors="ignore"), name)
    except Exception as e:  # 加载失败直接进入定稿，由其返回警告
        return {
            "next_action": "finalize",
            "observations": _observe(state.get("observations", []), "load_document", f"加载失败：{e}"),
        }
    note = f"已加载 {len(doc.blocks)} 个块、文本 {len(doc.text)} 字"
    if doc.needs_ocr:
        note += "；疑似扫描件，OCR 不可用（可安装 requirements-ocr.txt）"
    return {
        "document": doc.model_dump(),
        "observations": _observe(state.get("observations", []), "load_document", note),
    }


# ------------------------------------------------------------ Action: 切分板块
async def split_sections(state):
    doc = _doc(state)
    buckets: dict[str, list[str]] = {key: [] for key in SECTION_ORDER}
    cur = "basic"
    for b in doc.blocks:
        if b.kind == "heading":
            sec = match_section_title(b.text)
            if sec:
                cur = sec
                buckets[cur].append("## " + b.text)
                continue
        if b.kind == "kv":
            buckets[cur].append(f"{b.label}：{b.value}")
        else:
            buckets[cur].append(b.text)
    section_map = {k: "\n".join(v).strip() for k, v in buckets.items() if v}
    present = "、".join(SECTION_SPECS[k][0] for k in section_map)
    return {
        "section_map": section_map,
        "observations": _observe(state.get("observations", []), "split_sections", f"识别到板块：{present}"),
    }


# ------------------------------------------------------------ Action: 规则抽取
async def rule_extract(state):
    result = run_rule_extract(_doc(state))
    filled_basic = sum(1 for v in result["data"].get("basic", {}).values() if v)
    counts = sum(
        len(result["data"].get(k, []))
        for k in SECTION_ORDER
        if SECTION_SPECS[k][1] == "array"
    )
    return {
        "rule_result": result,
        "confidence": dict(result["confidence"]),
        "warnings": list(result["warnings"]),
        "observations": _observe(
            state.get("observations", []),
            "rule_extract",
            f"规则抽取：基本信息 {filled_basic} 项、经历 {counts} 条；警告 {len(result['warnings'])} 条",
        ),
    }


# ------------------------------------------------------------ Action: LLM 结构化抽取
async def llm_extract(state):
    section_map = state.get("section_map", {})
    budget = state.get("section_budget", 7000)
    data: dict = {}
    confidence: dict = {}
    failed_sections: list[str] = []
    try:
        llm = build_llm(state["config"])
    except Exception as e:
        # 连模型都构建不了：整体回退，交给规则结果
        return {
            "llm_result": {"data": {}, "confidence": {}},
            "warnings": list(state.get("warnings", [])) + ["LLM 抽取失败：" + str(e)],
            "observations": _observe(
                state.get("observations", []), "llm_extract",
                f"LLM 抽取失败：{e}；继续走规则结果"),
        }

    for sec in SECTION_ORDER:
        evidence = section_map.get(sec)
        if not evidence:
            continue
        title, kind, labels = SECTION_SPECS[sec]
        model_cls = make_list_model(sec) if kind == "array" else make_record_model(sec)
        field_labels = list(labels.values())

        merged_obj: dict | None = None
        items_all: list[dict] = []
        try:
            for chunk in _chunk_text(evidence, budget):
                prompt = section_prompt(title, chunk, field_labels)
                result = await structured_extract(llm, model_cls, EXTRACT_SYSTEM, prompt)
                if kind == "array":
                    items_all.extend(item.model_dump() for item in result.items)
                else:
                    obj = result.model_dump()
                    if merged_obj is None:
                        merged_obj = obj
                    else:
                        for k, v in obj.items():
                            if not merged_obj.get(k) and v:
                                merged_obj[k] = v
        except Exception as e:
            # 单板块失败不拖累其它板块
            failed_sections.append(sec)
            continue
        data[sec] = items_all if kind == "array" else (merged_obj or {})
        for field in labels:
            confidence[f"{sec}.{field}"] = 0.75

    n_items = sum(len(v) for k, v in data.items() if SECTION_SPECS[k][1] == "array")
    note = f"大模型抽取：{len(data)} 个板块、经历 {n_items} 条"
    if failed_sections:
        note += f"；{len(failed_sections)} 个板块失败跳过"
    return {
        "llm_result": {"data": data, "confidence": confidence},
        "observations": _observe(
            state.get("observations", []), "llm_extract", note,
        ),
    }


# ------------------------------------------------------------ Action: 定向修复
async def repair_fields(state):
    # 合并不依赖 LLM，先做；即使 LLM 全挂也能产出 draft 定稿
    draft, confidence = merge_results(
        state["rule_result"],
        state.get("llm_result", {"data": {}, "confidence": {}}),
    )
    missing = find_missing(draft)
    section_map = state.get("section_map", {})
    fixed: list[str] = []
    llm = None
    try:
        llm = build_llm(state["config"])
    except Exception as e:
        llm = None

    if llm is not None:
        for path in missing:
            try:
                if path in SECTION_ORDER:  # 缺失整个数组板块
                    sec = path
                    evidence = section_map.get(sec, "")
                    if not evidence:
                        continue
                    title, _, labels = SECTION_SPECS[sec]
                    result = await structured_extract(
                        llm, make_list_model(sec), EXTRACT_SYSTEM,
                        section_prompt(title, evidence, list(labels.values())),
                    )
                    draft[sec] = [item.model_dump() for item in result.items]
                    if draft[sec]:
                        fixed.append(sec)
                    continue

                sec, field = path.split(".")
                title, _, labels = SECTION_SPECS[sec]
                field_label = labels.get(field, field)
                evidence = section_map.get(sec, state.get("document", {}).get("text", ""))
                result = await structured_extract(
                    llm, RepairValue, EXTRACT_SYSTEM,
                    repair_prompt(title, field_label, evidence),
                    retries=1,
                )
                value = result.value.strip()
                if value:
                    draft[sec][field] = value
                    confidence[path] = 0.6
                    fixed.append(path)
            except Exception as e:
                # 单项修复失败跳过，不影响其余
                continue

    note = f"定向修复：缺失 {len(missing)} 项，补回 {len(fixed)} 项"
    if llm is None and missing:
        note += "（LLM 不可用，仅按规则结果）"
    return {
        "draft": draft,
        "confidence": confidence,
        "missing": [m for m in missing if m not in fixed],
        "observations": _observe(
            state.get("observations", []),
            "repair_fields",
            note + (f"（{', '.join(fixed)}）" if fixed else ""),
        ),
    }


# ------------------------------------------------------------ Action: 定稿
async def finalize(state):
    rule_result = state.get("rule_result")
    warnings = list(state.get("warnings", []))

    if state.get("draft") is not None:
        draft = state["draft"]
        confidence = state.get("confidence", {})
    else:
        if not rule_result:
            # 极端情况：文档都没加载出来
            from ..rules.extractor import empty_data

            draft = empty_data()
            confidence = {}
            warnings.append("文档解析失败，未能提取任何内容，请更换文件格式")
        else:
            draft, confidence = merge_results(
                rule_result,
                state.get("llm_result", {"data": {}, "confidence": {}}),
            )

    # 完整性补齐：保证所有板块/字段存在
    from ..rules.extractor import empty_data

    base = empty_data()
    for sec in SECTION_ORDER:
        if SECTION_SPECS[sec][1] == "object":
            base[sec].update({k: v for k, v in draft.get(sec, {}).items() if v})
        else:
            base[sec] = draft.get(sec, [])
    warnings.extend(derive_fields(base, confidence))
    warnings.extend(rule_result.get("warnings", [])) if rule_result else None

    # 去重保序
    warnings = list(dict.fromkeys(warnings))
    return {
        "draft": base,
        "confidence": confidence,
        "warnings": warnings,
        "observations": _observe(
            state.get("observations", []),
            "finalize",
            f"定稿完成：警告 {len(warnings)} 条",
        ),
    }
