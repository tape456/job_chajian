"""行政区归一：从文本中提取省/市/区，补齐通名。"""
from __future__ import annotations

import re

_REGION_PART = re.compile(
    r"([\u4e00-\u9fa5]{2,8}?(?:省|自治区|特别行政区|自治州|地区|盟|市|区|县|旗))"
)
_MUNICIPALITIES = {"北京", "上海", "天津", "重庆"}


def split_region(text: str) -> list[str]:
    """'北京市海淀区学院路30号' -> ['北京市', '海淀区']。"""
    s = re.sub(r"^中国\s*[\/、]?", "", str(text)).strip()
    parts = _REGION_PART.findall(s)
    if parts:
        return parts
    return [p for p in re.split(r"[\/\s,，、]+", s) if p]


def normalize_region(text: str) -> str:
    """归一为「省/市/区」斜杠串；直辖市补「市」。"""
    raw = str(text or "").strip()
    if not raw:
        return ""
    if "/" in raw:
        parts = [p.strip() for p in raw.split("/") if p.strip()]
    else:
        parts = split_region(raw)
    out = []
    for p in parts:
        if p in _MUNICIPALITIES:
            p += "市"
        out.append(p)
    return "/".join(out)
