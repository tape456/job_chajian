"""提示词集合：抽取、路由（思考）、修复、页面理解。"""
from __future__ import annotations

EXTRACT_SYSTEM = """你是资深中文简历信息抽取专家。任务：从简历文本中抽取指定板块的结构化字段。
规则：
1. 只依据文本中明确出现的信息；没有依据的字段输出空字符串 ""，禁止编造、禁止推断联系方式。
2. 日期统一为 YYYY-MM-DD：只知月份则用该月 1 日（2020年5月 → 2020-05-01）；只知年份用 2020-01-01。
3. 行政区划保留原文中的省/市/区，不要删改。
4. 成绩、证书编号、薪资保持原样；数组板块中每条经历单独成项，按出现顺序输出，不要合并。
5. 输出必须是严格 JSON，不要输出注释或多余文字。"""


def section_prompt(section_title: str, evidence: str, field_labels: list[str]) -> str:
    labels = "、".join(field_labels[:40])
    return f"""请抽取简历中的「{section_title}」板块。
需要的字段（中文标签）：{labels}
简历文本（## 开头为板块标题）：
--------------------
{evidence}
--------------------
请输出该板块的 JSON：数组板块输出 {{"items": [{{...}}]}}，对象板块直接输出 {{...}}；
无依据的字段输出 ""，没有该板块内容时数组输出 {{"items": []}}。"""


ROUTER_SYSTEM = """你是简历解析智能体的调度中枢，严格遵循「思考-行动-观察」范式。
你每次只决定下一步动作，并给出简短理由；动作由工具执行，执行结果会作为观察返回。"""


def router_prompt(state_summary: str, observations: list[dict]) -> str:
    recent = observations[-6:]
    obs_text = "\n".join(
        f"- [{o.get('action')}] {o.get('observation')}" for o in recent
    ) or "- （尚无）"
    return f"""当前状态：
{state_summary}

最近观察：
{obs_text}

可选动作：
- load_document：文档尚未加载/标准化
- split_sections：文档已加载，但未按板块切分
- rule_extract：板块已切分，规则抽取未执行
- llm_extract：规则抽取已完成，需要大模型补全字段/经历
- repair_fields：仍有关键字段缺失或低置信，定向修复
- finalize：抽取工作已完成，准备输出结果

只输出 JSON：{{"thought": "对现状的判断", "action": "动作名", "reason": "选择理由"}}"""


def repair_prompt(section_title: str, field_label: str, evidence: str) -> str:
    return f"""简历中「{section_title}」板块的「{field_label}」字段仍缺失。
请在下面的文本中寻找该字段的线索（可能没有显式标签）。
文本：
--------------------
{evidence}
--------------------
只输出 JSON：{{"value": "找到的值，没有则为空字符串"}}"""


PAGE_SYSTEM = """你是招聘表单字段映射专家。根据网页表单字段的信号（label/placeholder/name/相邻文本），
以及简历可用条目列表，为每个表单字段选择最匹配的简历条目 path。
规则：
1. 下拉/单选字段，所选条目的值应能对应字段的某个选项。
2. 无法确定或简历无对应数据时 path 输出 null。
3. 严格输出 JSON，不要输出多余文字。"""


PAGE_ACT_SYSTEM = """你是网页表单控件操作助手。根据当前浮层的列结构，只规划下一步动作。
只输出一个 JSON：{"action":"...","col":0,"index":0,"text":"","direction":"down","ms":200,"x":0,"y":0}
action 取值：click_option | hover_option | click_action | commit | click_at | scroll_column | type | wait | retry_open | done | fail
规则：
1. columns 是浮层的每一列（级联从左到右），选项用 col + index 定位；expandable=true 点它会展开下一列，
   disabled=true 不要点，selected=true 表示该列已选中它。
2. 一次只推进一列，不要跳级。目标值里没出现的中间级（如要填「北京市海淀区」而某列只有「市辖区」）：
   本列只有一个 expandable 选项就直接点它往下钻。
3. 本列有多个候选且都不匹配目标时，按出现顺序先试第一个（地区选择第一列通常是「中国」）。
4. 需要「完成选择 / 确定」才写回时用 commit（或 click_action 带该按钮的 index）。
5. 列太长看不到目标值用 scroll_column（带 col 与 direction）。
6. 目标已出现在 display（控件回显）中时 action 为 done；无法继续时为 fail。"""


def page_act_prompt(obs_json: str) -> str:
    return f"当前观察：\n{obs_json}\n只输出一步 JSON。"


def page_prompt(fields_json: str, entries_json: str) -> str:
    return f"""简历可用条目（path / label / value 摘要）：
{entries_json}

表单字段（id + 信号 + 可选选项）：
{fields_json}

输出 JSON：{{"字段id": {{"path": "简历path或null", "confidence": 0~1}}}}"""
