"""
简历结构化模型：字段键与中文标签严格对齐插件 lib/resume-schema.js。
LLM 抽取使用 Pydantic 结构化输出（function calling / json_schema）。
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, create_model

# ---------------------------------------------------------------- 字段键 + 中文标签
# basic（基本信息）
BASIC = {
    "name": "姓名", "namePinyin": "姓名拼音", "nameEn": "英文姓名", "gender": "性别",
    "phone": "电话", "email": "邮箱", "birthDate": "出生日期", "age": "年龄",
    "nationality": "国籍", "ethnicity": "民族", "politicalStatus": "政治面貌",
    "maritalStatus": "婚姻状况", "idType": "证件类型", "idNumber": "身份证号",
    "currentAddress": "现居住地址", "currentCity": "现居城市",
    "nativePlace": "籍贯", "birthPlace": "生源地",
    "hukouType": "户口性质", "hukou": "户口所在地",
    "highestDegree": "最高学历", "highestDiploma": "学位",
    "gradSchool": "毕业院校", "gradMajor": "毕业专业", "studyMode": "学习形式",
    "gradDate": "毕业时间", "isFresher": "是否应届生", "workStatus": "工作状态",
    "workYears": "工作年限", "lastCompany": "上一家公司",
    "wechat": "微信号", "qq": "QQ号", "homepage": "个人主页/作品链接",
    "englishLevel": "英语等级", "gaokaoDate": "高考时间", "gaokaoScore": "高考分数",
    "gaokaoSubjects": "高考科目", "techTitle": "专业技术职级",
    "emergencyContactName": "紧急联系人姓名", "emergencyContactRelation": "紧急联系人关系",
    "emergencyContactPhone": "紧急联系人电话", "postalCode": "邮政编码",
    "health": "健康状况", "hasChronicDisease": "是否有长期病史",
    "hasCriminalRecord": "是否有犯罪记录", "hasMilitaryService": "是否服兵役",
    "isVeteran": "是否退伍军人", "bloodType": "血型",
    "partyJoinDate": "入党时间", "leagueJoinDate": "入团时间",
    "isRecommendPostgrad": "是否保研", "hasOverseaStudy": "是否有留学经历",
    "isPoorStudent": "是否贫困生", "isColorBlind": "是否色弱",
    "hasOverseaId": "是否具有境外身份", "archiveLocation": "档案所在地",
    "height": "身高(cm)", "weight": "体重(kg)",
    "advantages": "个人优势", "hobbies": "兴趣爱好", "careerPlan": "职业规划",
}

# intention（求职意向）
INTENTION = {
    "expectedJob": "目标岗位", "expectedIndustry": "期望行业", "currentIndustry": "当前行业",
    "expectedCity": "期望城市", "interviewCity": "面试城市",
    "expectedSalary": "期望薪资", "expectedAnnualSalary": "期望年薪", "currentSalary": "当前薪资",
    "jobType": "工作类型", "availableTime": "预计入职时间",
    "hasRelativeInCompany": "是否有亲人在当前求职公司",
    "jobSource": "招聘信息来源", "acceptAdjust": "是否接受调剂",
}

# education（教育背景，数组）
EDUCATION = {
    "school": "学校", "degree": "学历", "department": "院系", "major": "专业",
    "majorCategory": "专业类别", "schoolCity": "学校城市", "schoolType": "学校类型",
    "eduStatus": "学历状态", "duration": "学制（年）",
    "start": "入学时间", "end": "毕业时间", "degreeDate": "学历授予日期",
    "diploma": "学位", "degreeType": "学位类型", "degreeCategory": "学位类别",
    "eduMode": "教育方式", "enrollCategory": "招生类别", "isUnifiedEnroll": "是否统招",
    "gpa": "成绩绩点", "failedCount": "挂科数",
    "classRank": "班级排名", "majorRank": "专业排名",
    "diplomaNumber": "学历证书编号", "degreeNumber": "学位证书编号",
    "studentNumber": "学号", "supervisor": "导师", "labName": "实验室名称",
    "isKeyLab": "是否国家重点实验室", "isJointProgram": "是否联合培养",
    "counselorName": "辅导员姓名", "counselorPhone": "辅导员联系方式",
    "isOverseaSchool": "是否海外学校", "eduDescription": "教育描述",
    "majorDescription": "专业描述", "courses": "专业课程",
    "researchDirection": "研究方向", "thesis": "毕业论文",
    "isExchange": "是否交换生", "exchangeSchool": "交换学校",
}

# work / internship（工作、实习经历，字段集相同）
WORK = {
    "company": "公司", "companyScale": "公司规模", "isOversea": "是否海外经历",
    "department": "部门", "position": "职位",
    "start": "开始时间", "end": "结束时间",
    "city": "工作城市", "industry": "工作行业", "employmentType": "用工性质",
    "monthlySalary": "月薪", "annualSalary": "年薪",
    "referrerName": "证明人姓名", "referrerContact": "证明人联系方式",
    "referrerPosition": "证明人职位", "description": "工作描述", "leaveReason": "离职原因",
}
INTERNSHIP = dict(WORK)  # 键相同，抽取时标题提示语不同

# project（项目经历）
PROJECT = {
    "name": "项目名称", "teamSize": "团队规模", "isOversea": "是否海外经历",
    "role": "项目职务", "practiceMethod": "实践方式",
    "start": "开始时间", "end": "结束时间", "city": "项目地址", "link": "项目链接",
    "referrerName": "证明人姓名", "referrerContact": "证明人联系方式",
    "referrerPosition": "证明人职位",
    "description": "项目描述", "responsibility": "项目职责", "achievement": "项目成果",
}

# campus（校园经历）
CAMPUS = {
    "name": "组织名称", "level": "级别", "position": "职位",
    "start": "开始时间", "end": "结束时间",
    "description": "工作内容", "duty": "本人职责",
}

# practice（社会实践）
PRACTICE = {
    "name": "实践单位", "position": "实践岗位/身份",
    "start": "开始时间", "end": "结束时间", "description": "实践内容",
}

# certificate（证书）
CERTIFICATE = {
    "name": "资质证书名称", "type": "资质证书类型", "date": "证书获取时间",
    "number": "证书编号", "issuer": "证书颁发机构", "score": "证书成绩",
    "validUntil": "证书有效期", "description": "证书描述",
}

# awards（获奖经历）
AWARDS = {
    "name": "奖项名称", "issuer": "颁发机构", "date": "获奖时间", "endDate": "结束时间",
    "level": "奖项级别", "rewardType": "奖励类型", "rewardLevel": "奖励等级",
    "description": "获奖描述", "detailDescription": "获奖详细描述",
}

# patent（专利信息）
PATENT = {
    "name": "专利名称", "number": "专利号", "date": "申请日期", "status": "专利状态",
    "inventor": "发明人", "type": "专利类型", "description": "专利描述",
}

# paper（论文发表）
PAPER = {
    "title": "论文标题", "journal": "发表期刊", "authors": "作者",
    "volume": "期刊卷期", "impactFactor": "影响因子", "level": "刊物等级",
    "authorship": "作者顺序", "date": "发表时间", "doi": "DOI号",
    "link": "论文链接", "abstract": "论文摘要",
}

# language（外语能力）
LANGUAGE = {
    "name": "语言种类", "date": "获得时间", "certName": "证书名称",
    "score": "成绩", "level": "掌握程度",
    "listening": "听说能力", "reading": "读写能力",
}

# skill（技能特长，对象）
SKILL = {
    "computer": "技术技能", "languageSkill": "语言能力", "software": "软件技能",
    "certificates": "证书认证", "softSkill": "软技能", "other": "其他技能",
}

# selfEvaluation（自我评价，对象）
SELF_EVALUATION = {"content": "自我介绍（自我评价）"}

# family（家庭情况，数组）
FAMILY = {
    "name": "姓名", "relation": "关系", "gender": "性别",
    "education": "教育程度", "ethnicity": "民族", "idNumber": "身份证号",
    "birthDate": "出生日期", "age": "年龄", "phone": "电话",
    "company": "工作单位", "position": "职位",
    "politicalStatus": "政治面貌", "address": "联系地址",
}

# key: (中文板块名, kind=object|array, 字段标签表)
SECTION_SPECS: dict[str, tuple[str, str, dict[str, str]]] = {
    "basic": ("基本信息", "object", BASIC),
    "intention": ("求职意向", "object", INTENTION),
    "education": ("教育背景", "array", EDUCATION),
    "work": ("工作经历", "array", WORK),
    "internship": ("实习经历", "array", INTERNSHIP),
    "project": ("项目经历", "array", PROJECT),
    "campus": ("校园经历", "array", CAMPUS),
    "practice": ("社会实践", "array", PRACTICE),
    "certificate": ("证书", "array", CERTIFICATE),
    "awards": ("获奖经历", "array", AWARDS),
    "patent": ("专利信息", "array", PATENT),
    "paper": ("论文发表", "array", PAPER),
    "language": ("外语能力", "array", LANGUAGE),
    "skill": ("技能特长", "object", SKILL),
    "selfEvaluation": ("自我评价", "object", SELF_EVALUATION),
    "family": ("家庭情况", "array", FAMILY),
}
SECTION_ORDER = list(SECTION_SPECS.keys())

# ---------------------------------------------------------------- Pydantic 模型工厂
_BASE_KWARGS = {"__config__": ConfigDict(extra="ignore")}


def make_record_model(section_key: str):
    """单条记录的结构化模型（全部字段为 str，缺省空串）。"""
    fields = SECTION_SPECS[section_key][2]
    return create_model(
        f"{section_key}_record",
        **{
            key: (str, Field(default="", description=label))
            for key, label in fields.items()
        },
        **_BASE_KWARGS,
    )


def make_list_model(section_key: str):
    """数组板块的列表包装模型。"""
    record_model = make_record_model(section_key)
    title = SECTION_SPECS[section_key][0]
    return create_model(
        f"{section_key}_list",
        items=(list[record_model], Field(default_factory=list, description=f"{title}列表，每条经历一项")),
        **_BASE_KWARGS,
    )


# ---------------------------------------------------------------- 解析结果
class ParseResult(BaseModel):
    data: dict = Field(description="与插件 schema 完全对齐的简历数据")
    warnings: list[str] = Field(default_factory=list)
    confidence: dict[str, float] = Field(default_factory=dict, description="字段路径 -> 置信度")
    observations: list[dict] = Field(default_factory=list, description="思考-行动-观察轨迹")
    text_length: int = 0
    file_name: str = ""
