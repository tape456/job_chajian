"""
规则模式库：键值正则、板块标题、时间范围（移植自插件 lib/resume-parser.js，并扩充）。
"""
from __future__ import annotations

import re

# ------------------------------------------------------------ 键值正则：(regex, path)
KV_REGEXES: list[tuple[str, str]] = [
    (r"^(?:姓\s*名)[:：\s]*(\S{1,6})", "basic.name"),
    (r"^(?:姓名拼音|拼音)[:：\s]*(.{2,30}?)(?=[\s]{2,}|$)", "basic.namePinyin"),
    (r"^(?:英文姓名|英文名)[:：\s]*(.{2,30}?)(?=[\s]{2,}|$)", "basic.nameEn"),
    (r"^(?:性\s*别)[:：\s]*(\S{1,4})", "basic.gender"),
    (r"^(?:出生年月?|出生日期)[:：\s]*([\d年月./\-]{6,12})", "basic.birthDate"),
    (r"^(?:年\s*龄)[:：\s]*(\d{2,3})", "basic.age"),
    (r"^(?:国\s*籍)[:：\s]*(\S{1,10})", "basic.nationality"),
    (r"^(?:民\s*族)[:：\s]*(\S{1,6})", "basic.ethnicity"),
    (r"^(?:籍\s*贯)[:：\s]*(\S{1,12})", "basic.nativePlace"),
    (r"^(?:生源(?:地)?|毕业生源地)[:：\s]*(\S{1,12})", "basic.birthPlace"),
    (r"^(?:政治面貌|党派)[:：\s]*(\S{1,10})", "basic.politicalStatus"),
    (r"^(?:婚姻状况|婚否)[:：\s]*(\S{1,6})", "basic.maritalStatus"),
    (r"^(?:证件类型)[:：\s]*(\S{1,8})", "basic.idType"),
    (r"^(?:身\s*高)[:：\s]*(\d{2,3})", "basic.height"),
    (r"^(?:体\s*重)[:：\s]*(\d{2,3})", "basic.weight"),
    (r"^(?:血\s*型)[:：\s]*(\S{1,4})", "basic.bloodType"),
    (r"^(?:电子邮箱|邮\s*箱|E-?mail)[:：\s]*([\w.+-]+@[\w-]+\.[\w.]+)", "basic.email"),
    (r"^(?:手机号码?|联系电话|电\s*话)[:：\s]*(1[3-9]\d{9})", "basic.phone"),
    (r"^(?:微信号|微\s*信)[:：\s]*(\S{1,30})", "basic.wechat"),
    (r"^(?:QQ\s*号?|Q\s*Q)[:：\s]*(\d{5,12})", "basic.qq"),
    (r"^(?:邮政编码|邮\s*编)[:：\s]*(\d{6})", "basic.postalCode"),
    (r"^(?:现居|居住地址|现住|通讯地址|联系地址)[:：\s]*(.{2,40})", "basic.currentAddress"),
    (r"^(?:户口所在地|户\s*籍)[:：\s]*(.{2,20})", "basic.hukou"),
    (r"^(?:户口性质)[:：\s]*(\S{1,8})", "basic.hukouType"),
    (r"^(?:档案所在地|档案存放地)[:：\s]*(.{2,30})", "basic.archiveLocation"),
    (r"^(?:最高学历)[:：\s]*(\S{1,10})", "basic.highestDegree"),
    (r"^(?:最高学位|学\s*位)[:：\s]*(\S{1,10})", "basic.highestDiploma"),
    (r"^(?:学习形式|培养方式)[:：\s]*(\S{1,10})", "basic.studyMode"),
    (r"^(?:是否应届生|应届生身份)[:：\s]*(\S{1,4})", "basic.isFresher"),
    (r"^(?:工作状态|求职状态)[:：\s]*(\S{1,12})", "basic.workStatus"),
    (r"^(?:工作年限)[:：\s]*(\d{1,2})", "basic.workYears"),
    (r"^(?:健康状况)[:：\s]*(\S{1,8})", "basic.health"),
    (r"^(?:入团时间|入党(?:时间|日期)|入团/入党时间)[:：\s]*([\d年月./\-]{6,12})", "basic.leagueJoinDate"),
    (r"^(?:英语(?:等级|水平))[:：\s]*(\S{1,16})", "basic.englishLevel"),
    (r"^(?:兴趣爱好|爱\s*好)[:：\s]*(.{2,40})", "basic.hobbies"),
    (r"^(?:个人优势|优\s*势)[:：\s]*(.{2,80})", "basic.advantages"),
    (r"^(?:职业规划)[:：\s]*(.{2,80})", "basic.careerPlan"),
    (r"^(?:个人主页|主页|作品链接)[:：\s]*(\S{4,100})", "basic.homepage"),
    (r"^(?:期望(?:薪资|月薪)|薪资要求)[:：\s]*(.{2,20})", "intention.expectedSalary"),
    (r"^(?:期望年薪)[:：\s]*(.{2,20})", "intention.expectedAnnualSalary"),
    (r"^(?:到岗时间|预计入职时间|入职时间)[:：\s]*(.{2,20})", "intention.availableTime"),
    (r"^(?:期望岗位|目标岗位|求职意向|意向岗位)[:：\s]*(.{2,30})", "intention.expectedJob"),
    (r"^(?:期望行业|意向行业)[:：\s]*(.{2,20})", "intention.expectedIndustry"),
    (r"^(?:期望城市|期望工作地点|工作地点)[:：\s]*(.{2,30})", "intention.expectedCity"),
    (r"^(?:是否接受调剂|服从调剂)[:：\s]*(\S{1,4})", "intention.acceptAdjust"),
]

# 编译为“行首”版本
KV_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(pattern), path) for pattern, path in KV_REGEXES
]

# ------------------------------------------------------------ 板块标题
SECTION_TITLES: dict[str, list[str]] = {
    "basic": ["个人信息", "基本信息", "基本资料", "联系方式", "联系信息"],
    "intention": ["求职意向", "应聘意向", "意向"],
    "education": ["教育背景", "教育经历", "学历背景", "学习经历"],
    "work": ["工作经历", "工作经验", "职业经历", "就业经历"],
    "internship": ["实习经历", "实习经验", "实践经历", "社会实践经历"],
    "project": ["项目经历", "项目经验", "科研经历", "研究经历"],
    "campus": ["校园经历", "校园活动", "社团经历", "学生工作", "课外活动"],
    "practice": ["社会实践", "实践活动", "社会活动"],
    "certificate": ["资格证书", "证书", "职业证书", "资质证书"],
    "awards": ["荣誉奖项", "获奖情况", "奖励情况", "获奖经历", "荣誉"],
    "patent": ["专利信息", "专利"],
    "paper": ["论文发表", "论文", "研究成果", "发表文章"],
    "language": ["外语能力", "语言能力", "语言"],
    "family": ["家庭成员", "家庭情况", "家庭主要成员", "直系亲属"],
    "skill": ["技能特长", "专业技能", "个人技能", "技能", "特长"],
    "selfEvaluation": ["自我评价", "个人评价", "自我描述", "个人总结", "自我介绍"],
}
_SECTION_TITLE_RE = {
    key: re.compile(r"^(?:" + "|".join(re.escape(t) for t in titles) + r")$")
    for key, titles in SECTION_TITLES.items()
}


def match_section_title(line: str) -> str | None:
    """整行是板块标题 -> 返回 section key。"""
    if not line or len(line) > 14:
        return None
    for key, rx in _SECTION_TITLE_RE.items():
        if rx.match(line):
            return key
    return None


# ------------------------------------------------------------ 标签词汇（DOCX 表格配对用）
def _build_known_labels() -> set[str]:
    labels: set[str] = set()
    for pattern, _ in KV_REGEXES:
        m = re.match(r"\^\(\?:([^)]+)\)", pattern)
        if not m:
            continue
        for tok in m.group(1).split("|"):
            tok = tok.replace(r"\s*", "").replace(r"\?", "").strip()
            if re.fullmatch(r"[\u4e00-\u9fa5A-Za-z]{1,10}", tok):
                labels.add(tok)
    for titles in SECTION_TITLES.values():
        labels.update(titles)
    return labels


KNOWN_LABELS: set[str] = _build_known_labels()

# 表格“记录型”表头（家庭成员 / 教育经历列表等）
RECORD_HEADER_TOKENS = {
    "姓名", "关系", "称谓", "与本人关系", "工作单位", "单位", "职务", "职位",
    "部门", "联系电话", "电话", "学历", "政治面貌", "年龄", "工作单位及职务",
    "学校", "专业", "入学时间", "毕业时间",
}

# ------------------------------------------------------------ 时间 / 机构
TIME_RANGE = re.compile(
    r"(\d{4})[./年\-](\d{1,2})?\s*[-–—~至]+\s*(\d{4})[./年\-]?(\d{1,2})?"
)
SINGLE_MONTH = re.compile(r"(\d{4})[./年](\d{1,2})")
GLOBAL_PHONE = re.compile(r"1[3-9]\d{9}")
GLOBAL_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
GLOBAL_ID = re.compile(r"(?<!\d)(\d{17}[\dXx])(?!\d)")

ORG_SUFFIX = (
    "有限公司", "股份公司", "公司", "集团", "厂", "银行", "事务所", "研究院",
    "研究所", "中心", "院",
)
SCHOOL_RE = re.compile(r"[\u4e00-\u9fa5A-Za-z]+(?:大学|学院|学校|研究院)")

# 简历标题里的姓名线索：「张三-个人简历」「张三_求职简历」
NAME_IN_TITLE_RE = re.compile(
    r"^([\u4e00-\u9fa5]{2,4})(?:[-_·\s]*)?(?:个人简历|求职简历|简历|CV|cv|resume)"
)
