"""
合并规则结果与 LLM 结果：
- 确定性规则值优先（联系方式/身份证等）；LLM 只补空。
- 数组板块：按 (起止时间+标题) 对齐记录，字段级互补；对不齐则并集。
"""
from __future__ import annotations

from ..schemas.resume import SECTION_SPECS, SECTION_ORDER


def _merge_object(sec: str, rule_obj: dict, llm_obj: dict,
                  confidence: dict, llm_conf: dict) -> None:
    for field in SECTION_SPECS[sec][2]:
        rv = (rule_obj.get(field) or "").strip()
        if rv:
            continue
        lv = (llm_obj.get(field) or "").strip()
        if lv:
            rule_obj[field] = lv
            path = f"{sec}.{field}"
            confidence[path] = llm_conf.get(path, 0.75)


def _record_signature(item: dict) -> tuple[str, str, str]:
    return (
        (item.get("start") or item.get("date") or ""),
        (item.get("end") or item.get("endDate") or ""),
        (item.get("company") or item.get("name") or item.get("school") or item.get("title") or ""),
    )


def _merge_record_fields(sec: str, target: dict, source: dict,
                         confidence: dict, llm_conf: dict, prefix: str = "") -> None:
    for field in SECTION_SPECS[sec][2]:
        if (target.get(field) or "").strip():
            continue
        lv = (source.get(field) or "").strip()
        if lv:
            target[field] = lv
            path = f"{sec}.{prefix}{field}" if not prefix else f"{sec}.{prefix}.{field}"
            confidence[path] = llm_conf.get(path, 0.75)


def _merge_array(sec: str, rule_rows: list[dict], llm_rows: list[dict],
                 confidence: dict, llm_conf: dict) -> list[dict]:
    if not rule_rows:
        return llm_rows
    if not llm_rows:
        return rule_rows

    # 数量相同：按下标对齐
    if len(rule_rows) == len(llm_rows):
        for i, (r, l) in enumerate(zip(rule_rows, llm_rows)):
            _merge_record_fields(sec, r, l, confidence, llm_conf, prefix=str(i))
        return rule_rows

    # 数量不同：按签名匹配互补，剩余 LLM 记录追加
    used = set()
    for i, r in enumerate(rule_rows):
        rs = _record_signature(r)
        for j, l in enumerate(llm_rows):
            if j in used:
                continue
            ls = _record_signature(l)
            # 标题/时间有重叠即视为同一记录
            if (rs[2] and ls[2] and (rs[2] in ls[2] or ls[2] in rs[2])) or \
               (rs[0] and rs[0] == ls[0]):
                _merge_record_fields(sec, r, l, confidence, llm_conf, prefix=str(i))
                used.add(j)
                break
    for j, l in enumerate(llm_rows):
        if j not in used:
            rule_rows.append(l)
    return rule_rows


def merge_results(rule_result: dict, llm_result: dict) -> tuple[dict, dict]:
    rule_data = rule_result["data"]
    llm_data = llm_result.get("data", {})
    confidence: dict = dict(rule_result.get("confidence", {}))
    llm_conf = llm_result.get("confidence", {})

    for sec in SECTION_ORDER:
        kind = SECTION_SPECS[sec][1]
        if kind == "object":
            _merge_object(
                sec,
                rule_data.setdefault(sec, {}),
                llm_data.get(sec, {}),
                confidence, llm_conf,
            )
        else:
            rule_data[sec] = _merge_array(
                sec,
                rule_data.get(sec, []),
                llm_data.get(sec, []),
                confidence, llm_conf,
            )
    return rule_data, confidence
