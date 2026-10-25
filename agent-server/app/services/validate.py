"""校验、派生与缺失检测：字段一致性、教育经历回填基本信息、年龄计算。"""
from __future__ import annotations

import calendar
import re
from datetime import date

from ..rules.idcard import parse_id
from ..rules.patterns import GLOBAL_EMAIL, GLOBAL_PHONE

# 修复阶段重点关注的基本字段
KEY_BASIC_FIELDS = [
    "name", "gender", "birthDate", "phone", "email",
    "politicalStatus", "nativePlace", "hukou", "currentAddress",
    "highestDegree", "englishLevel",
]


def _fmt(v) -> str:
    return str(v or "").replace(".", "-").replace("/", "-").strip()


def _month_end(v: str) -> str:
    """'2024-06' -> '2024-06-30'。"""
    m = re.match(r"(\d{4})-(\d{2})", _fmt(v))
    if not m:
        return ""
    y, mo = int(m.group(1)), int(m.group(2))
    if not 1 <= mo <= 12:
        return ""
    return f"{y}-{mo:02d}-{calendar.monthrange(y, mo)[1]:02d}"


def _age_from_birth(bd: str, today: date) -> str:
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", bd)
    if not m:
        return ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    age = today.year - y - ((today.month, today.day) < (mo, d))
    return str(age) if 0 < age < 100 else ""


def _education_rank(degree: str) -> int:
    if "博士" in degree:
        return 70
    if "硕士" in degree or "研究生" in degree:
        return 60
    if "本科" in degree:
        return 50
    if "大专" in degree or "专科" in degree:
        return 40
    if "中专" in degree or "中技" in degree:
        return 30
    if "高中" in degree:
        return 20
    return 0


def derive_fields(draft: dict, confidence: dict) -> list[str]:
    """派生字段写入，返回警告。"""
    warnings: list[str] = []
    basic = draft.setdefault("basic", {})
    education = draft.get("education") or []

    # 教育经历排序（学历层次优先，其次入学时间）
    education.sort(key=lambda e: (
        _education_rank(e.get("degree", "")),
        _fmt(e.get("start")),
    ), reverse=True)

    # 最高学历 -> 基本信息（只补空）
    if education:
        top = education[0]
        pairs = [
            ("gradSchool", top.get("school")),
            ("gradMajor", top.get("major")),
            ("highestDegree", top.get("degree")),
            ("highestDiploma", top.get("diploma")),
            ("gradDate", _month_end(top.get("end", ""))),
            ("studyMode", top.get("eduMode")),
        ]
        for key, val in pairs:
            val = str(val or "").strip()
            if val and not basic.get(key):
                basic[key] = val
                confidence[f"basic.{key}"] = 0.85

    # 生日 -> 年龄
    if basic.get("birthDate"):
        age = _age_from_birth(basic["birthDate"], date.today())
        if age:
            basic["age"] = age
            confidence["basic.age"] = 0.9

    # 身份证 -> 性别/生日一致性
    id_number = basic.get("idNumber", "")
    if id_number:
        info = parse_id(id_number)
        if info["gender"] and basic.get("gender") and basic["gender"] != info["gender"]:
            warnings.append("性别与身份证号不一致，请核对")
        if info["birthDate"] and basic.get("birthDate") and basic["birthDate"] != info["birthDate"]:
            warnings.append("出生日期与身份证号不一致，请核对")

    # 联系方式格式
    if basic.get("phone") and not GLOBAL_PHONE.fullmatch(basic["phone"]):
        warnings.append("手机号格式异常，请核对")
    if basic.get("email") and not GLOBAL_EMAIL.fullmatch(basic["email"]):
        warnings.append("邮箱格式异常，请核对")
    return warnings


def find_missing(draft: dict) -> list[str]:
    """返回缺失字段路径（修复循环用）。"""
    basic = draft.setdefault("basic", {})
    missing = [f"basic.{f}" for f in KEY_BASIC_FIELDS if not str(basic.get(f) or "").strip()]
    if not (draft.get("education") or []):
        missing.append("education")
    return missing
