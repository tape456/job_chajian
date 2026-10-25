"""
规则抽取器：在 NormalizedDocument 上做确定性提取（移植自插件 lib/resume-parser.js）。
LLM 不参与本层；输出高置信度的规则结果与缺失警告。
"""
from __future__ import annotations

import re
from collections import defaultdict

from .idcard import parse_id
from .patterns import (
    GLOBAL_EMAIL, GLOBAL_ID, GLOBAL_PHONE, KV_RULES, NAME_IN_TITLE_RE,
    TIME_RANGE, match_section_title,
)
from ..loaders.document import NormalizedDocument
from ..schemas.resume import SECTION_SPECS


def empty_data() -> dict:
    data: dict = {}
    for key, (_, kind, fields) in SECTION_SPECS.items():
        data[key] = {f: "" for f in fields} if kind == "object" else []
    return data


def _norm_month(y: str | None, m: str | None) -> str:
    if not y:
        return ""
    return f"{y}-{int(m or 1):02d}"


def _match_kv_line(line: str, data: dict, confidence: dict) -> bool:
    for rx, path in KV_RULES:
        sec, field = path.split(".")
        if data[sec].get(field):
            continue
        m = rx.match(line)
        if m and m.group(1):
            data[sec][field] = m.group(1).strip()
            confidence[path] = 0.92
            return True
    return False


_PROJECT_KV = {
    "项目职务": "role", "担任角色": "role", "项目角色": "role",
    "团队规模": "teamSize", "项目团队规模": "teamSize",
    "实践方式": "practiceMethod", "项目实践方式": "practiceMethod",
    "项目链接": "link", "项目在线链接": "link", "项目网址": "link",
    "项目地址": "city", "项目所在地区": "city",
    "是否海外经历": "isOversea", "项目海外经历": "isOversea",
    "证明人姓名": "referrerName", "项目证明人姓名": "referrerName", "项目证明人": "referrerName",
    "证明人联系方式": "referrerContact", "项目证明人联系方式": "referrerContact",
    "证明人职位": "referrerPosition", "项目证明人职位": "referrerPosition",
    "项目职责": "responsibility", "项目职责与贡献": "responsibility",
    "项目成果": "achievement", "项目交付结果与量化成果": "achievement",
    "项目描述": "description", "项目详细描述": "description",
}
_CAMPUS_KV = {
    "组织名称": "name", "任职组织": "name",
    "级别": "level", "组织级别": "level",
    "职位": "position", "担任职务": "position",
    "工作内容": "description", "主要工作内容": "description",
    "本人职责": "duty", "个人职责与成果": "duty",
}


def _parse_experience(section_key: str, lines: list[str], data: dict) -> None:
    cur: dict | None = None
    pos_key = "role" if section_key == "project" else "position"
    name_key = "name" if section_key in ("project", "campus", "practice") else "company"
    field_keys = list(SECTION_SPECS[section_key][2])

    for line in lines:
        tm = TIME_RANGE.search(line)
        looks_title = bool(re.search(r"公司|集团|厂|银行|事务所|研究院|中心|项目|课题|会|部|大学|协会", line)) and len(line) <= 60
        if tm or (looks_title and not cur):
            if cur and cur.get("description"):
                cur = None
            if not cur:
                cur = {f: "" for f in field_keys}
                data[section_key].append(cur)
            if tm:
                cur["start"] = _norm_month(tm.group(1), tm.group(2))
                cur["end"] = _norm_month(tm.group(3), tm.group(4))
            title = TIME_RANGE.sub("", line)
            title = re.sub(r"[-–—~至\s]*$", "", title).strip()
            if section_key in ("work", "internship"):
                cm = re.match(
                    r"^(.*?(?:有限公司|股份公司|公司|集团|厂|银行|事务所|研究院|研究所|中心|院)(?=\s|$))\s+(.{2,20})$",
                    title,
                )
                if cm:
                    title = cm.group(1)
                    if not cur.get("position"):
                        cur["position"] = cm.group(2)
            elif section_key in ("practice", "campus"):
                cm = re.match(r"^(\S{2,40})\s+(.{2,12})$", title)
                if cm and re.search(r"队长|负责人|成员|志愿者|实习生|干事|部长|主席|实践|实习|服务", cm.group(2)):
                    title = cm.group(1)
                    if not cur.get("position"):
                        cur["position"] = cm.group(2)
            if title and not cur.get(name_key):
                cur[name_key] = title
        elif cur:
            kvm = re.match(r"^(.{2,12})[:：]\s*(.+)$", line)
            keyed = False
            if kvm:
                k = re.sub(r"\s", "", kvm.group(1))
                v = kvm.group(2).strip()
                mapping = _PROJECT_KV if section_key == "project" else (_CAMPUS_KV if section_key == "campus" else None)
                if mapping and mapping.get(k) and v and not cur.get(mapping[k]):
                    cur[mapping[k]] = v
                    keyed = True
            if not keyed:
                if not cur.get("description"):
                    cur["description"] = line
                else:
                    cur["description"] += "\n" + line
            if not cur.get(pos_key) and re.search(r"职位|岗位|职务|担任|角色", line) and len(line) <= 30:
                cur[pos_key] = re.sub(r"^(?:担任|职位|岗位|项目职务)[:：]?", "", line)


def _parse_education(lines: list[str], data: dict) -> None:
    """教育经历：单行「时间段 学校 专业 学历」+ 课程/GPA 行。"""
    field_keys = list(SECTION_SPECS["education"][2])
    cur: dict | None = None
    for line in lines:
        tm = TIME_RANGE.search(line)
        is_school = bool(re.search(r"大学|学院|学校|研究院", line))
        if tm or (is_school and not cur):
            cur = {f: "" for f in field_keys}
            data["education"].append(cur)
            if tm:
                cur["start"] = _norm_month(tm.group(1), tm.group(2))
                cur["end"] = _norm_month(tm.group(3), tm.group(4))
            sm = re.search(r"([\u4e00-\u9fa5A-Za-z]+(?:大学|学院|学校|研究院))", line)
            if sm:
                cur["school"] = sm.group(1)
            dm = re.search(r"(博士|硕士|本科|大专|专科|学士)", line)
            if dm:
                deg = dm.group(1)
                cur["degree"] = "本科" if deg == "学士" else deg
                cur["diploma"] = "学士" if deg == "本科" else deg
            # 专业：去掉时间/学校/学历后剩下的词
            rest = line
            if tm:
                rest = TIME_RANGE.sub("", rest)
            if sm:
                rest = rest.replace(sm.group(1), " ")
            if dm:
                rest = rest.replace(dm.group(1), " ")
            rest = rest.strip()
            if rest and not re.search(r"大学|学院|学校|研究院", rest):
                cur["major"] = rest
        elif cur:
            if re.search(r"主修|课程", line):
                cur["courses"] = re.sub(r"^(?:主修|主要)?课程[:：]?", "", line)
            elif re.search(r"GPA|绩点|排名", line, re.I):
                cur["gpa"] = line


def _simple_row(line: str) -> tuple[str, str]:
    tm = TIME_RANGE.search(line)
    if not tm:
        tm2 = re.search(r"(\d{4})[./年](\d{1,2})", line)
        date_str = _norm_month(tm2.group(1), tm2.group(2)) if tm2 else ""
    else:
        date_str = _norm_month(tm.group(1), tm.group(2))
    clean = TIME_RANGE.sub("", line)
    clean = re.sub(r"^\d{4}[./年]\d{1,2}\s*", "", clean)
    clean = re.sub(r"^[-–—~至\s]+", "", clean).strip()
    return clean, date_str


def _name_candidates(doc: NormalizedDocument) -> list[str]:
    candidates: list[str] = []
    author = doc.metadata.get("author", "")
    if re.fullmatch(r"[\u4e00-\u9fa5]{2,4}", author):
        candidates.append(author)
    for source in (doc.metadata.get("title", ""), doc.file_name.rsplit(".", 1)[0]):
        m = NAME_IN_TITLE_RE.match(source)
        if m:
            candidates.append(m.group(1))
    # 第一个标题前的短中文段落（简历常见：姓名在最顶部）
    for b in doc.blocks:
        if b.kind == "heading":
            break
        if b.kind == "paragraph" and re.fullmatch(r"[\u4e00-\u9fa5]{2,4}", b.text):
            candidates.append(b.text)
            break
    return candidates


def rule_extract(doc: NormalizedDocument) -> dict:
    data = empty_data()
    confidence: dict[str, float] = {}
    warnings: list[str] = []

    # 1) 全文联系方式兜底
    pm = GLOBAL_PHONE.search(doc.text)
    em = GLOBAL_EMAIL.search(doc.text)
    idm = GLOBAL_ID.search(doc.text)
    if pm:
        data["basic"]["phone"] = pm.group(0)
        confidence["basic.phone"] = 0.99
    if em:
        data["basic"]["email"] = em.group(0)
        confidence["basic.email"] = 0.99
    if idm:
        id_number = idm.group(1).upper()
        data["basic"]["idNumber"] = id_number
        confidence["basic.idNumber"] = 0.99

    # 2) 遍历块
    section = "basic"
    section_lines: dict[str, list[str]] = defaultdict(list)
    for b in doc.blocks:
        if b.kind == "heading":
            sec = match_section_title(b.text)
            if sec:
                section = sec
                continue
        if b.kind == "kv":
            if _match_kv_line(f"{b.label}：{b.value}", data, confidence):
                continue
        if b.kind == "record":
            section_lines[section].append(b.text)
            continue
        segments = re.split(r"[\t ]{2,}|\t+", b.text) if re.search(r"[\t ]{2,}|\t", b.text) else [b.text]
        hit = False
        for seg in segments:
            if _match_kv_line(seg.strip(), data, confidence):
                hit = True
        if hit and section == "basic":
            continue
        section_lines[section].append(b.text)

    # 3) 教育经历 + 经历类（工作/实习/项目/校园/社会实践）
    _parse_education(section_lines.get("education", []), data)
    for sec in ("work", "internship", "project", "campus", "practice"):
        _parse_experience(sec, section_lines.get(sec, []), data)

    # 4) 获奖 / 专利 / 论文 / 外语 / 家庭
    for line in section_lines.get("awards", []):
        clean, dt = _simple_row(line)
        if not clean:
            continue
        lv_m = re.search(r"(国家级|省级|市级|校级|院级|特等奖|一等奖|二等奖|三等奖|优秀奖|奖学金|三好学生|优秀干部)", clean)
        data["awards"].append({
            "name": re.sub(r"[（(].{0,8}[)）]", "", clean),
            "issuer": "", "date": dt, "endDate": "",
            "level": lv_m.group(1) if lv_m else "",
            "rewardType": "", "rewardLevel": "", "description": "",
        })
    for line in section_lines.get("patent", []):
        clean, dt = _simple_row(line)
        if not clean:
            continue
        no_m = re.search(r"(?:CN|ZL)?\d{8,12}(?:\.\d)?X?", clean)
        data["patent"].append({
            "name": re.sub(r"(?:CN|ZL)?\d{8,12}(?:\.\d)?X?", "", clean).strip(),
            "number": no_m.group(0) if no_m else "",
            "date": dt, "status": "", "inventor": "", "type": "", "description": "",
        })
    for line in section_lines.get("paper", []):
        clean, dt = _simple_row(line)
        if clean:
            data["paper"].append({
                "title": clean, "journal": "", "authors": "", "volume": "",
                "impactFactor": "", "level": "", "authorship": "", "date": dt,
                "doi": "", "link": "", "abstract": "",
            })
    for line in section_lines.get("language", []):
        clean, dt = _simple_row(line)
        if not clean:
            continue
        cert_m = re.search(r"(CET-?\s?[46]|TEM-?\s?[48]|四级|六级|专四|专八|IELTS|TOEFL|N1|N2)", clean, re.I)
        score_m = re.search(r"(\d{2,3})\s*分?", clean)
        data["language"].append({
            "name": clean[:6], "date": dt,
            "certName": cert_m.group(0) if cert_m else "",
            "score": score_m.group(1) if score_m else "",
            "level": "", "listening": "", "reading": "",
        })
    for line in section_lines.get("family", []):
        clean, _ = _simple_row(line)
        if not clean:
            continue
        tokens = clean.split()
        row = {
            "name": "", "relation": "", "gender": "", "education": "", "ethnicity": "",
            "idNumber": "", "birthDate": "", "age": "", "phone": "",
            "company": "", "position": "", "politicalStatus": "", "address": "",
        }
        rel_m = re.match(r"^(父亲|母亲|兄|弟|姐|妹|配偶|妻子|丈夫|儿子|女儿|父|母)", tokens[0] if tokens else "")
        if rel_m:
            row["relation"] = rel_m.group(1)
            tokens = tokens[1:]
        if tokens:
            row["name"] = tokens.pop(0)
        if tokens and re.search(r"厂|公司|局|学校|医院|集团|事务所|银行|队|所|行|部|中心", tokens[0]):
            row["company"] = tokens.pop(0)
        if tokens:
            row["position"] = tokens.pop(0)
        data["family"].append(row)

    # 5) 证书
    for line in section_lines.get("certificate", []):
        clean, dt = _simple_row(line)
        if not clean:
            continue
        data["certificate"].append({
            "name": clean, "type": "", "date": dt,
            "number": "", "issuer": "", "score": "", "validUntil": "", "description": "",
        })

    # 6) 技能 / 自评
    if section_lines.get("skill"):
        data["skill"]["computer"] = "\n".join(section_lines["skill"])
    if section_lines.get("selfEvaluation"):
        data["selfEvaluation"]["content"] = "\n".join(section_lines["selfEvaluation"])

    # 7) 身份证推断（性别/生日/年龄，只补空）
    if idm:
        info = parse_id(idm.group(1))
        b = data["basic"]
        if not b["gender"] and info["gender"]:
            b["gender"] = info["gender"]
            confidence["basic.gender"] = 0.9
        if not b["birthDate"] and info["birthDate"]:
            b["birthDate"] = info["birthDate"]
            confidence["basic.birthDate"] = 0.9
        if not b["age"] and info["age"]:
            b["age"] = info["age"]

    # 8) 姓名兜底
    if not data["basic"]["name"]:
        for candidate in _name_candidates(doc):
            if candidate:
                data["basic"]["name"] = candidate
                confidence["basic.name"] = 0.7
                break

    # 9) 警告
    if not data["basic"]["name"]:
        warnings.append("未识别到姓名")
    if not data["basic"]["phone"] and not data["basic"]["email"]:
        warnings.append("未识别到联系方式")
    if not data["education"]:
        warnings.append("未识别到教育经历")
    filled = sum(1 for v in data["basic"].values() if v)
    filled += len(data["education"]) + len(data["work"]) + len(data["internship"]) + len(data["project"])
    if filled < 3:
        warnings.append("解析内容过少，建议检查文件格式或手动填写")

    return {"data": data, "warnings": warnings, "confidence": confidence}
