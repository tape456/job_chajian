"""表格单元格配对逻辑（DOCX / PDF 共用）。"""
from __future__ import annotations

import re

from ..rules.patterns import KNOWN_LABELS, RECORD_HEADER_TOKENS


def strip_colon(text: str) -> str:
    return text.strip().rstrip("：:").strip()


def is_label(text: str) -> bool:
    """强标签：已知标签词；弱标签：≤8 字、无句子标点的词。"""
    t = strip_colon(text)
    if t in KNOWN_LABELS:
        return True
    if 1 <= len(t) <= 8 and re.fullmatch(r"[\u4e00-\u9fa5A-Za-z0-9/（）()\s]{1,8}", t):
        return True
    return False


def looks_record_header(cells: list[str]) -> bool:
    if len(cells) < 3:
        return False
    hits = sum(1 for c in cells if c.strip() in RECORD_HEADER_TOKENS)
    return hits >= 2


def pair_cells(cells: list[str]) -> list[tuple[str, str]]:
    """单元格序列 -> [(label, value)]。"""
    vals = [c.strip() for c in cells if c.strip()]
    pairs: list[tuple[str, str]] = []

    # 2 列：第一格是标签即可（第二格即使是“汉族”这类短词也接受）
    if len(vals) == 2:
        if is_label(vals[0]):
            return [(strip_colon(vals[0]), vals[1])]
        return []

    # 偶数列：严格相邻配对
    if len(vals) >= 4 and len(vals) % 2 == 0:
        ok = True
        for i in range(0, len(vals), 2):
            if is_label(vals[i]) and not is_label(vals[i + 1]):
                pairs.append((strip_colon(vals[i]), vals[i + 1]))
            else:
                ok = False
                break
        if ok:
            return pairs

    # 兜底：任意相邻“标签-值”对
    i = 0
    while i < len(vals) - 1:
        if is_label(vals[i]) and not is_label(vals[i + 1]):
            pairs.append((strip_colon(vals[i]), vals[i + 1]))
            i += 2
        else:
            i += 1
    return pairs
