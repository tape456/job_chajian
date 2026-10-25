// 字段语义词典：归一化后的字段信号 -> 简历数据路径优先级列表
// 路径格式与 ResumeSchema 扁平化条目一致：section.field / section.*.field / derived.field
(function (root) {
  'use strict';

  // alias 顺序即匹配优先级：精确命中 > 包含命中（长词优先）
  const RULES = [
    // ---- 基本信息 ----
    { id: 'name', paths: ['basic.name'], aliases: ['姓名', '名字', '真实姓名', '真实名字', 'name', 'fullname', 'realname', 'username', 'applicantname', '应聘者姓名', '申请人姓名'] },
    { id: 'gender', paths: ['basic.gender'], aliases: ['性别', 'sex', 'gender'] },
    { id: 'birthDate', paths: ['basic.birthDate'], aliases: ['出生日期', '出生年月', '生日', '出生时间', 'birthdate', 'birthday', 'dateofbirth', 'dob'] },
    { id: 'age', paths: ['derived.age'], aliases: ['年龄', 'age'] },
    { id: 'ethnicity', paths: ['basic.ethnicity'], aliases: ['民族', 'ethnicity', 'ethnic', 'nation'] },
    { id: 'nativePlace', paths: ['basic.nativePlace'], aliases: ['籍贯', '原籍', '籍贯所在地', 'nativeplace', 'ancestralhome'] },
    { id: 'birthPlace', paths: ['basic.birthPlace'], aliases: ['生源地', '生源所在地', '生源', 'birthplace', 'placeoforigin'] },
    { id: 'hukou', paths: ['basic.hukou', 'basic.nativePlace'], aliases: ['户口所在地', '户籍所在地', '户籍', '户口', 'hukou', 'householdregister', 'household'] },
    { id: 'politicalStatus', paths: ['basic.politicalStatus'], aliases: ['政治面貌', '党派', '政治身份', '政治成分', 'politicalstatus', 'politicalaffiliation', 'party'] },
    { id: 'maritalStatus', paths: ['basic.maritalStatus'], aliases: ['婚姻状况', '婚姻状态', '婚否', '婚姻', 'maritalstatus', 'marital', 'marriage'] },
    { id: 'height', paths: ['basic.height'], aliases: ['身高', 'height', 'stature'] },
    { id: 'weight', paths: ['basic.weight'], aliases: ['体重', 'weight'] },
    { id: 'idNumber', paths: ['basic.idNumber'], aliases: ['身份证号', '身份证号码', '证件号码', '身份证', 'idnumber', 'idcard', 'identitycard', 'identityno'] },
    { id: 'phone', paths: ['basic.phone'], aliases: ['手机号', '手机号码', '手机', '电话', '联系电话', '电话号码', '移动电话', '联系方式', 'phone', 'mobile', 'telephone', 'cellphone', 'tel', 'contactnumber', 'phonenumber'] },
    { id: 'email', paths: ['basic.email'], aliases: ['邮箱', '电子邮箱', '电子邮件', '邮件地址', 'email', 'mail', 'emailaddress', 'e-mail'] },
    { id: 'currentAddress', paths: ['basic.currentAddress'], aliases: ['现居地址', '现住地址', '居住地址', '通讯地址', '通信地址', '联系地址', '收件地址', '家庭住址', '现居城市', '所在城市', '当前城市', '现居住地城市', 'address', 'currentaddress', 'mailingaddress', 'homeaddress', 'city', 'location'] },
    { id: 'postalCode', paths: ['basic.postalCode'], aliases: ['邮政编码', '邮编', 'zipcode', 'postalcode', 'postcode'] },
    { id: 'photo', paths: [], aliases: ['照片', '免冠照', '头像', '一寸照', 'photo', 'avatar', 'picture'] },

    // ---- 求职意向 ----
    { id: 'expectedJob', paths: ['intention.expectedJob'], aliases: ['期望岗位', '应聘岗位', '申请职位', '应聘职位', '意向岗位', '意向职位', '申请职位名称', '岗位名称', '职位', 'expectedjob', 'position', 'jobtitle', 'desiredposition', 'appliedposition'] },
    { id: 'expectedCity', paths: ['intention.expectedCity'], aliases: ['期望城市', '期望工作地点', '意向城市', '工作地点', 'expectedcity', 'worklocation', 'preferredlocation'] },
    { id: 'expectedSalary', paths: ['intention.expectedSalary'], aliases: ['期望薪资', '期望月薪', '薪资要求', '薪酬期望', '期望薪酬', 'expectedsalary', 'salary', 'desiredsalary'] },
    { id: 'jobType', paths: ['intention.jobType'], aliases: ['工作类型', '求职类型', '工作性质', '应聘类型', 'jobtype'] },
    { id: 'availableTime', paths: ['intention.availableTime'], aliases: ['到岗时间', '入职时间', '可到岗时间', 'starttime', 'availabledate'] },

    // ---- 教育经历 ----
    { id: 'school', paths: ['education.0.school'], aliases: ['毕业院校', '学校', '院校', '学校名称', '毕业学校', '就读学校', '大学', 'school', 'university', 'college', 'graduatefrom', 'institution'] },
    { id: 'undergradSchool', paths: ['derived.undergradSchool', 'education.0.school'], aliases: ['本科学校', '本科院校', '本科毕业院校', '第一学历学校', 'undergraduateschool'] },
    { id: 'degree', paths: ['education.0.degree'], aliases: ['学历', '最高学历', '学历层次', '文化程度', 'education', 'degree', 'educationlevel', 'academicbackground'] },
    { id: 'diploma', paths: ['education.0.diploma'], aliases: ['学位', '最高学位', 'degrees'] },
    { id: 'degreeDiploma', paths: ['derived.degreeDiploma', 'education.0.degree'], aliases: ['最高学历学位', '学历学位', '学历及学位', 'degreeanddiploma'] },
    { id: 'major', paths: ['education.0.major'], aliases: ['专业', '所学专业', '专业名称', '主修专业', 'major', 'specialization', 'fieldofstudy', 'subject'] },
    { id: 'undergradMajor', paths: ['derived.undergradMajor', 'education.0.major'], aliases: ['本科专业', ' undergraduate major'] },
    { id: 'eduStart', paths: ['education.0.start'], aliases: ['入学时间', '入学年月', '教育开始时间', 'enrollmentdate', 'startdate'] },
    { id: 'eduEnd', paths: ['derived.graduationDate', 'education.0.end'], aliases: ['毕业时间', '毕业年月', '预计毕业时间', 'graduationdate', 'graduationtime', 'enddate'] },
    { id: 'eduPeriod', paths: ['education.0.period'], aliases: ['起止时间', '入学时间-毕业时间', '教育经历时间段', '就读时间', '在校时间', 'period'] },
    { id: 'gpa', paths: ['education.0.gpa'], aliases: ['成绩绩点', 'gpa', '绩点', '平均绩点', '成绩排名', '学业成绩', '平均分'] },
    { id: 'courses', paths: ['education.0.courses'], aliases: ['专业课程', '主修课程', '主要课程', '核心课程', '所学专业主修课程', 'maincourses', 'majorcourses', 'courses'] },
    { id: 'isExchange', paths: ['education.0.isExchange'], aliases: ['是否交换生', '交换生经历', 'exchange'] },
    { id: 'exchangeSchool', paths: ['education.0.exchangeSchool'], aliases: ['交换学校', '交换院校', 'exchangeschool'] },
    { id: 'educationAll', paths: ['education.*.period', 'education.*.school'], aliases: ['教育经历', '教育背景', '学习经历', '受教育经历', 'educationexperience', 'educationhistory'] },
    { id: 'studentType', paths: [], aliases: ['学生类型', '毕业去向', 'studenttype'] },

    // ---- 工作经历（实习经历见下方 internship 块） ----
    { id: 'workCompany', paths: ['work.*.company', 'internship.*.company'], aliases: ['工作单位', '公司名称', '曾任职公司', 'company', 'employer', 'organization', 'companyname'] },
    { id: 'workPosition', paths: ['work.*.position', 'internship.*.position'], aliases: ['担任职务', '工作岗位', '职位', 'workposition', 'jobposition'] },
    { id: 'workDescription', paths: ['work.*.description', 'internship.*.description'], aliases: ['工作描述', '工作内容', '工作职责', 'workdescription', 'jobdescription', 'responsibility', 'responsibilities'] },
    { id: 'workPeriod', paths: ['work.*.period', 'internship.*.period'], aliases: ['工作时间段', 'workperiod'] },
    { id: 'workAll', paths: ['work.*.description'], aliases: ['工作经历', '工作经验', '职业经历', 'workexperience', 'employmenthistory'] },
    { id: 'workYears', paths: ['basic.workYears'], aliases: ['工作年限', '工作经验年限', 'yearsofexperience', 'workingyears'] },

    // ---- 实习经历 ----
    { id: 'internCompany', paths: ['internship.*.company', 'work.*.company'], aliases: ['实习单位', '实习公司', '实习公司名称', 'interncompany'] },
    { id: 'internPosition', paths: ['internship.*.position', 'work.*.position'], aliases: ['实习岗位', '实习职位', 'internposition'] },
    { id: 'internDescription', paths: ['internship.*.description', 'work.*.description'], aliases: ['实习内容', '实习描述', '实习工作内容', 'interncontent'] },
    { id: 'internPeriod', paths: ['internship.*.period'], aliases: ['实习起止时间', '实习时间', '实习时间段', '实习开始时间-实习结束时间', 'internperiod'] },
    { id: 'internStart', paths: ['internship.*.start'], aliases: ['实习开始时间', 'internstart'] },
    { id: 'internEnd', paths: ['internship.*.end'], aliases: ['实习结束时间', 'internend'] },
    { id: 'internAll', paths: ['internship.*.description'], aliases: ['实习经历', '实习经验', 'internship', 'internshipexperience'] },
    { id: 'internCity', paths: ['internship.*.city'], aliases: ['实习地址', '实习所在城市', '实习所在地区', 'internlocation'] },
    { id: 'internIndustry', paths: ['internship.*.industry'], aliases: ['实习行业', '实习所在行业', 'internindustry'] },
    { id: 'internDepartment', paths: ['internship.*.department'], aliases: ['实习部门', 'interndepartment'] },
    { id: 'internReferrer', paths: ['internship.*.referrerName'], aliases: ['实习证明人', 'internreferrer'] },
    { id: 'internLeaveReason', paths: ['internship.*.leaveReason'], aliases: ['实习离职原因', '结束实习原因'] },

    // ---- 项目经历 ----
    { id: 'projectName', paths: ['project.*.name'], aliases: ['项目名称', 'projectname'] },
    { id: 'projectRole', paths: ['project.*.role'], aliases: ['项目职务', '项目角色', '担任角色', '项目中担任角色', '项目中的角色或职务', 'projectrole'] },
    { id: 'projectTeamSize', paths: ['project.*.teamSize'], aliases: ['团队规模', '项目团队规模', '项目参与团队人数规模', 'teamsize', 'projectteamsize'] },
    { id: 'projectIsOversea', paths: ['project.*.isOversea'], aliases: ['项目海外经历', '项目是否海外', 'projectisoversea'] },
    { id: 'projectPracticeMethod', paths: ['project.*.practiceMethod'], aliases: ['实践方式', '项目实践方式', 'practicemethod', 'projectpracticemethod'] },
    { id: 'projectCity', paths: ['project.*.city'], aliases: ['项目地址', '项目所在地区', '项目地点', 'projectcity', 'projectaddress'] },
    { id: 'projectLink', paths: ['project.*.link'], aliases: ['项目链接', '项目在线链接', '项目网址', 'projectlink', 'projecturl'] },
    { id: 'projectPeriod', paths: ['project.*.period'], aliases: ['项目起止时间', '项目开始时间-项目结束时间', '项目时间段', 'projectperiod'] },
    { id: 'projectStart', paths: ['project.*.start'], aliases: ['项目开始时间', 'projectstart'] },
    { id: 'projectEnd', paths: ['project.*.end'], aliases: ['项目结束时间', 'projectend'] },
    { id: 'projectReferrerName', paths: ['project.*.referrerName'], aliases: ['项目证明人姓名', '项目证明人', 'projectreferrer'] },
    { id: 'projectReferrerContact', paths: ['project.*.referrerContact'], aliases: ['项目证明人联系方式', 'projectreferrercontact'] },
    { id: 'projectReferrerPosition', paths: ['project.*.referrerPosition'], aliases: ['项目证明人职位', 'projectreferrerposition'] },
    { id: 'projectDescription', paths: ['project.*.description'], aliases: ['项目描述', '项目内容', '项目详细描述', 'projectdescription'] },
    { id: 'projectAll', paths: ['project.*.description'], aliases: ['项目经历', '科研项目', '研究经历', '项目经验', 'projectexperience', 'research', 'researchexperience'] },

    // ---- 校园经历 ----
    { id: 'campusAll', paths: ['campus.*.description'], aliases: ['校园经历', '校内经历', '校园活动', '社团经历', '学生工作经历', '社团活动', '课外活动', 'campusexperience', 'studentactivities', 'extracurricular', 'clubexperience'] },
    { id: 'studentUnion', paths: ['campus.*.name'], aliases: ['学生会职务', '学生干部经历', '担任职务', 'studentunion'] },

    // ---- 证书/语言/技能 ----
    { id: 'certificates', paths: ['certificate.*.name'], aliases: ['证书', '资格证书', '获奖证书', '证书名称', '职业资格证', 'certificate', 'certificates', 'certification', 'license', 'qualification', 'qualifications'] },
    { id: 'awards', paths: ['awards.*.name', 'certificate.*.name'], aliases: ['获奖情况', '所获奖项', '奖励情况', '获奖经历', '获奖经历（奖学金）', '荣誉奖项', '奖惩情况', 'award', 'awards', 'honors', 'prize', 'scholarship', '奖学金', '荣誉'] },
    { id: 'awardName', paths: ['awards.*.name'], aliases: ['获奖名称', '奖项名称', '奖励名称', 'awardname', 'honorname'] },
    { id: 'awardLevel', paths: ['awards.*.level'], aliases: ['获奖等级', '奖项等级', '奖励级别', '获奖级别', '奖项级别', 'awardlevel'] },
    { id: 'awardDate', paths: ['awards.*.date'], aliases: ['获奖时间', '获奖日期', '奖励时间', 'awarddate'] },
    { id: 'awardEndDate', paths: ['awards.*.endDate'], aliases: ['获奖结束时间', '奖励结束时间', 'awardenddate'] },
    { id: 'awardPeriod', paths: ['awards.*.period'], aliases: ['获奖起止时间', '获奖时间-结束时间', 'awardperiod'] },
    { id: 'awardIssuer', paths: ['awards.*.issuer'], aliases: ['颁奖单位', '授予单位', '颁发单位', '颁发机构', 'awardissuer'] },
    // ---- 专利 ----
    { id: 'patents', paths: ['patent.*.name'], aliases: ['专利', '专利信息', '专利名称', '发明专利', 'patent', 'patents'] },
    { id: 'patentNumber', paths: ['patent.*.number'], aliases: ['专利号', '专利申请号', '授权公告号', 'patentnumber'] },
    { id: 'patentType', paths: ['patent.*.type'], aliases: ['专利类型', '专利种类', 'patenttype'] },
    { id: 'patentStatus', paths: ['patent.*.status'], aliases: ['专利状态', '专利进展', '专利情况', 'patentstatus'] },
    // ---- 论文 ----
    { id: 'papers', paths: ['paper.*.title'], aliases: ['论文', '论文发表', '发表论文', '论文题目', '论文名称', 'paper', 'papers', 'publication', 'publications'] },
    { id: 'paperJournal', paths: ['paper.*.journal'], aliases: ['期刊名称', '发表期刊', '刊物名称', '期刊会议', 'journal'] },
    { id: 'paperLevel', paths: ['paper.*.level'], aliases: ['收录等级', '论文级别', '检索类型', '论文等级', 'paperlevel'] },
    { id: 'paperAuthorship', paths: ['paper.*.authorship'], aliases: ['作者位次', '作者排名', '第几作者', 'authorship'] },
    { id: 'punishment', paths: [], aliases: ['处分情况', '违纪情况', '奖惩', 'punishment', 'disciplinary'] },
    // 「语言能力」留给 skill.languageSkill（技能特长板块）；外语列表用「外语能力/语言种类」
    { id: 'languages', paths: ['language.*.name'], aliases: ['外语能力', '语种', '语言种类', '语言', 'language', 'languages', 'foreignlanguage'] },
    { id: 'englishLevel', paths: ['basic.englishLevel', 'derived.englishLevel', 'language.*.level'], aliases: ['英语水平', '英语等级', '外语水平', '英语能力等级', 'englishlevel', 'cet4', 'cet6', '英语四级', '英语六级', 'englishproficiency'] },
    { id: 'englishScore', paths: ['derived.englishLevel'], aliases: ['英语成绩', '四六级成绩', 'englishscore', 'toefl', 'ielts', '托福', '雅思'] },
    { id: 'computerSkill', paths: ['skill.computer'], aliases: ['计算机水平', '计算机技能', '电脑技能', 'computerskill', 'computerskills', 'itlevel'] },
    { id: 'skills', paths: ['skill.other', 'skill.computer'], aliases: ['技能特长', '特长', '专业技能', '技能', '个人技能', 'skill', 'skills', 'speciality', 'expertise'] },

    // ---- 自我评价 ----
    // 「自我介绍」与「自我评价」是两个独立字段：表单问哪个填哪个，避免一段文字硬塞两种题型
    { id: 'selfIntro', paths: ['selfEvaluation.selfIntro', 'selfEvaluation.content'], aliases: ['自我介绍', '个人简介', '自我介绍（自我评价）', 'selfintroduction', 'introduction', 'personalstatement'] },
    { id: 'selfEvaluation', paths: ['selfEvaluation.content', 'selfEvaluation.selfIntro'], aliases: ['自我评价', '自我描述', '个人总结', '个人评价', '自述', '关于我', 'selfevaluation', 'aboutme', 'summary', 'personalsummary', 'selfassessment', 'personalprofile'] },

    // ---- 家庭成员 ----
    { id: 'family', paths: ['family.*.name'], aliases: ['家庭成员', '家庭情况', '主要家庭成员', '家庭主要成员', '直系亲属', '亲属', 'family', 'familymember', 'familymembers', 'relatives'] },
    { id: 'familyName', paths: ['family.*.name'], aliases: ['家庭成员姓名', '成员姓名', 'familyname'] },
    { id: 'familyRelation', paths: ['family.*.relation'], aliases: ['家庭成员称谓', '称谓', '与本人关系', '关系', 'relation', 'relationship'] },
    { id: 'familyAge', paths: ['family.*.age'], aliases: ['家庭成员年龄', '成员年龄', 'familyage'] },
    { id: 'familyPolitical', paths: ['family.*.politicalStatus'], aliases: ['家庭成员政治面貌', '成员政治面貌', 'familypoliticalstatus'] },
    { id: 'familyCompany', paths: ['family.*.company'], aliases: ['工作单位及职务', '成员工作单位', '所在单位', 'familycompany'] },

    // ---- 其他常见 ----
    { id: 'remark', paths: [], aliases: ['备注', '其他', '补充说明', '其他说明', 'remark', 'remarks', 'note', 'notes', 'other', 'additional', 'additionalinfo'] },
    { id: 'emergencyContact', paths: ['basic.emergencyContactName', 'family.*.name'], aliases: ['紧急联系人', '紧急联系人姓名', '紧急联系方式', 'emergencycontact'] },
    { id: 'emergencyRelation', paths: ['basic.emergencyContactRelation'], aliases: ['紧急联系人关系', '紧急联系人与本人关系', '与紧急联系人关系', 'emergencyrelation'] },
    { id: 'emergencyPhone', paths: ['basic.emergencyContactPhone'], aliases: ['紧急联系人电话', '紧急联系电话', '应急联系电话', '紧急联系电话号码', 'emergencyphone'] },
    { id: 'personalHomepage', paths: ['basic.homepage'], aliases: ['个人主页', '个人网站', 'github', '博客', 'homepage', 'website', 'blog', 'linkedin', 'personalsite'] },
    { id: 'wechat', paths: ['basic.wechat'], aliases: ['微信', '微信号', 'wechat', 'weixin'] },
    { id: 'qq', paths: ['basic.qq'], aliases: ['qq', 'qq号', 'qq号码'] },
    { id: 'hobbies', paths: ['basic.hobbies'], aliases: ['兴趣爱好', '爱好', '特长爱好', '个人爱好', 'hobby', 'hobbies', 'interests'] },

    // ==================== 四期：对齐竞品字段模型的补充规则 ====================
    // ---- 基本信息补充 ----
    { id: 'namePinyin', paths: ['basic.namePinyin'], aliases: ['姓名拼音', '中文姓名拼音', '拼音', 'pinyin', 'namipinyin', 'namepinyin'] },
    { id: 'nameEn', paths: ['basic.nameEn'], aliases: ['英文姓名', '姓名英文', '英文名', 'englishname', 'nameinenglish'] },
    { id: 'nationality', paths: ['basic.nationality'], aliases: ['国籍', '国别', 'nationality', 'nationalityname'] },
    { id: 'idType', paths: ['basic.idType'], aliases: ['证件类型', '证件类别', '证件名称', 'idtype', 'documenttype', 'cardtype'] },
    { id: 'hukouType', paths: ['basic.hukouType'], aliases: ['户口性质', '户籍性质', 'hukoutype', 'householdtype'] },
    { id: 'studyMode', paths: ['basic.studyMode', 'education.0.eduMode'], aliases: ['学习形式', '就读方式', '培养方式', 'studytype', 'studyform'] },
    { id: 'isFresher', paths: ['basic.isFresher'], aliases: ['是否应届生', '应届生身份', '是否应届毕业生', 'freshgraduate', 'isthisfreshgraduate'] },
    { id: 'workStatus', paths: ['basic.workStatus'], aliases: ['工作状态', '求职状态', '当前状态', '就业状态', 'workstatus', 'jobstatus'] },
    { id: 'lastCompany', paths: ['basic.lastCompany'], aliases: ['上一家公司', '最近工作单位', '现工作单位', 'lastcompany', 'previouscompany'] },
    { id: 'gaokaoDate', paths: ['basic.gaokaoDate'], aliases: ['高考时间', '高考年份', '参加高考时间', 'gaokaadate'] },
    { id: 'gaokaoScore', paths: ['basic.gaokaoScore'], aliases: ['高考分数', '高考成绩', 'gaokaoscore', 'collegeentrancescore'] },
    { id: 'gaokaoSubjects', paths: ['basic.gaokaoSubjects'], aliases: ['高考科目', '高考选科', '选科组合', 'gaokaosubjects'] },
    { id: 'techTitle', paths: ['basic.techTitle'], aliases: ['专业技术职称', '专业技术职级', '专业技术资格', '职称', '职务名称', 'professionaltitle', 'title'] },
    { id: 'health', paths: ['basic.health'], aliases: ['健康状况', '身体情况', 'health', 'healthstatus'] },
    { id: 'hasChronicDisease', paths: ['basic.hasChronicDisease'], aliases: ['是否有长期病史', '长期病史', '慢性病史', 'chronicdisease'] },
    { id: 'hasCriminalRecord', paths: ['basic.hasCriminalRecord'], aliases: ['是否有犯罪记录', '犯罪记录', '违法犯罪情况', 'criminalrecord'] },
    { id: 'hasMilitaryService', paths: ['basic.hasMilitaryService'], aliases: ['是否服兵役', '是否曾服兵役', '参军情况', 'militaryservice'] },
    { id: 'isVeteran', paths: ['basic.isVeteran'], aliases: ['是否退伍军人', '退伍军人', '退役情况', 'veteran'] },
    { id: 'bloodType', paths: ['basic.bloodType'], aliases: ['血型', 'bloodtype', 'blood'] },
    { id: 'leagueJoinDate', paths: ['basic.leagueJoinDate'], aliases: ['入党时间', '入党日期', '入团时间', '入团/入党时间', '加入共青团时间', 'partyjoineddate', 'leaguejoineddate'] },
    { id: 'isRecommendPostgrad', paths: ['basic.isRecommendPostgrad'], aliases: ['是否保研', '保研情况', '推荐免试', 'isthisrecommend'] },
    { id: 'hasOverseaStudy', paths: ['basic.hasOverseaStudy'], aliases: ['是否有留学经历', '留学经历', '海外留学经历', 'overseastudy'] },
    { id: 'isPoorStudent', paths: ['basic.isPoorStudent'], aliases: ['是否贫困生', '贫困生', '家庭经济困难', 'poorstudent'] },
    { id: 'isColorBlind', paths: ['basic.isColorBlind'], aliases: ['是否色弱', '色弱', '色盲', 'colorblind'] },
    { id: 'hasOverseaId', paths: ['basic.hasOverseaId'], aliases: ['是否具有境外身份', '境外身份', '国外永久居留权', 'overseasid'] },
    { id: 'archiveLocation', paths: ['basic.archiveLocation'], aliases: ['档案所在地', '档案存放地', '人事档案所在地', 'archivelocation'] },
    { id: 'advantages', paths: ['basic.advantages'], aliases: ['个人优势', '优势特长', 'advantages'] },
    { id: 'careerPlan', paths: ['basic.careerPlan'], aliases: ['职业规划', '职业目标', '未来规划', 'careerplan'] },
    { id: 'gradSchoolBasic', paths: ['basic.gradSchool', 'education.0.school'], aliases: ['最高学历毕业院校', '现毕业院校'] },
    { id: 'gradMajorBasic', paths: ['basic.gradMajor', 'education.0.major'], aliases: ['最高学历毕业专业', '现毕业专业'] },

    // ---- 求职意向补充 ----
    { id: 'expectedIndustry', paths: ['intention.expectedIndustry'], aliases: ['期望行业', '意向行业', '期望从事行业', 'desiredindustry'] },
    { id: 'currentIndustry', paths: ['intention.currentIndustry'], aliases: ['当前行业', '所在行业', '现从事行业', 'currentindustry'] },
    { id: 'interviewCity', paths: ['intention.interviewCity'], aliases: ['面试城市', '面试地点', 'interviewcity'] },
    { id: 'expectedAnnualSalary', paths: ['intention.expectedAnnualSalary', 'intention.expectedSalary'], aliases: ['期望年薪', '年薪要求', 'desiredannualsalary'] },
    { id: 'currentSalary', paths: ['intention.currentSalary'], aliases: ['当前薪资', '目前月薪', '现有年薪', 'currentsalary'] },
    { id: 'hasRelativeInCompany', paths: ['intention.hasRelativeInCompany'], aliases: ['是否有亲人在当前求职公司', '亲属在本公司', '是否有亲属在公司', 'relativerefer'] },
    { id: 'jobSource', paths: ['intention.jobSource'], aliases: ['招聘信息来源', '获知渠道', '信息来源', 'jobsource', 'sourceofinfo'] },
    { id: 'acceptAdjust', paths: ['intention.acceptAdjust'], aliases: ['是否接受调剂', '服从调剂', '接受调剂', 'acceptadjust'] },

    // ---- 教育经历补充 ----
    { id: 'department', paths: ['education.0.department'], aliases: ['院系', '所在院系', '学院名称', '院系名称', 'department', 'faculty'] },
    { id: 'majorCategory', paths: ['education.0.majorCategory'], aliases: ['专业类别', '专业门类', 'majorcategory'] },
    { id: 'schoolCity', paths: ['education.0.schoolCity'], aliases: ['学校城市', '学校所在城市', '院校所在地', '学校地区', 'schoolcity'] },
    { id: 'schoolType', paths: ['education.0.schoolType'], aliases: ['学校类型', '院校类型', 'schooltype'] },
    { id: 'eduStatus', paths: ['education.0.eduStatus'], aliases: ['学历状态', '在读状态', '教育经历状态', 'educationstatus'] },
    { id: 'duration', paths: ['education.0.duration'], aliases: ['学制（年）', '学制', '学制年限', '在校年数', 'schoollength', 'programduration'] },
    { id: 'degreeDate', paths: ['education.0.degreeDate'], aliases: ['学历授予日期', '学位证书时间', '学位授予时间', 'degreedate'] },
    { id: 'degreeType', paths: ['education.0.degreeType'], aliases: ['学位类型', '学术或专业学位', 'degreetype'] },
    { id: 'degreeCategory', paths: ['education.0.degreeCategory'], aliases: ['学位类别', '学位门类', 'degreeCategory'] },
    { id: 'eduMode', paths: ['education.0.eduMode', 'basic.studyMode'], aliases: ['教育方式', '学习类型', 'educationmode'] },
    { id: 'enrollCategory', paths: ['education.0.enrollCategory'], aliases: ['招生类别', '招生类型', 'enrollcategory'] },
    { id: 'isUnifiedEnroll', paths: ['education.0.isUnifiedEnroll'], aliases: ['是否统招', '统招情况', 'unifiedenrollment'] },
    { id: 'failedCount', paths: ['education.0.failedCount'], aliases: ['挂科数', '挂科科目数量', '挂科科目数', 'failedcourses'] },
    { id: 'classRank', paths: ['education.0.classRank'], aliases: ['班级排名', '班级名次', 'classrank'] },
    { id: 'majorRank', paths: ['education.0.majorRank'], aliases: ['专业排名', '专业名次', 'majorrank'] },
    { id: 'majorStudentCount', paths: ['education.0.majorStudentCount'], aliases: ['专业人数', '本专业人数', '专业总人数', 'majorsize', 'majorstudentcount'] },
    { id: 'diplomaNumber', paths: ['education.0.diplomaNumber'], aliases: ['学历证书编号', '毕业证书编号', '学历证编号', 'diplomanumber'] },
    { id: 'degreeNumber', paths: ['education.0.degreeNumber'], aliases: ['学位证书编号', '学位证编号', 'degreenumber'] },
    { id: 'studentNumber', paths: ['education.0.studentNumber'], aliases: ['学号', '在校学号', 'studentnumber', 'studentid'] },
    { id: 'supervisor', paths: ['education.0.supervisor'], aliases: ['导师姓名', '指导教师', '导师', 'supervisor', 'advisor'] },
    { id: 'supervisorContact', paths: ['education.0.supervisorContact'], aliases: ['导师联系方式', '导师电话', '导师邮箱', '导师联系方法', 'supervisorcontact'] },
    { id: 'labName', paths: ['education.0.labName'], aliases: ['实验室名称', '所在实验室', 'labname'] },
    { id: 'isKeyLab', paths: ['education.0.isKeyLab'], aliases: ['是否国家重点实验室', '国家重点实验室', 'keylab'] },
    { id: 'isJointProgram', paths: ['education.0.isJointProgram'], aliases: ['是否联合培养', '联合培养', 'jointprogram'] },
    { id: 'counselorName', paths: ['education.0.counselorName'], aliases: ['辅导员姓名', '辅导员', 'counselor'] },
    { id: 'counselorPhone', paths: ['education.0.counselorPhone'], aliases: ['辅导员联系方式', '辅导员电话', 'counselorphone'] },
    { id: 'isOverseaSchool', paths: ['education.0.isOverseaSchool'], aliases: ['是否海外学校', '海外院校', 'overseaschool'] },
    { id: 'eduDescription', paths: ['education.0.eduDescription'], aliases: ['教育描述', '教育经历描述', 'educationdescription'] },
    { id: 'majorDescription', paths: ['education.0.majorDescription'], aliases: ['专业描述', '专业方向描述', 'majordescription'] },
    { id: 'researchDirection', paths: ['education.0.researchDirection'], aliases: ['研究方向', 'researchdirection'] },
    { id: 'thesis', paths: ['education.0.thesis', 'paper.*.title'], aliases: ['毕业论文', '学位论文', 'thesis', 'dissertation'] },

    // ---- 工作/实习经历补充 ----
    { id: 'companyScale', paths: ['work.*.companyScale', 'internship.*.companyScale'], aliases: ['公司规模', '员工人数规模', 'companyScale', 'companySize'] },
    { id: 'workIsOversea', paths: ['work.*.isOversea', 'internship.*.isOversea'], aliases: ['是否海外经历', '海外经历', 'isoversea'] },
    { id: 'workDepartment', paths: ['work.*.department', 'internship.*.department'], aliases: ['所属部门', '部门名称', '工作部门', 'departmentname'] },
    { id: 'workCity', paths: ['work.*.city', 'internship.*.city'], aliases: ['工作城市', '工作地点城市', 'workcity'] },
    { id: 'workIndustry', paths: ['work.*.industry', 'internship.*.industry'], aliases: ['工作行业', '所属行业', '行业类别', 'industry'] },
    { id: 'employmentType', paths: ['work.*.employmentType', 'internship.*.employmentType'], aliases: ['用工性质', '雇佣形式', 'employmenttype'] },
    { id: 'monthlySalary', paths: ['work.*.monthlySalary', 'internship.*.monthlySalary'], aliases: ['月薪', '月薪收入', 'monthlysalary'] },
    { id: 'annualSalary', paths: ['work.*.annualSalary', 'internship.*.annualSalary'], aliases: ['年薪', '年薪薪资', '年薪收入', 'annualsalary', '职位年薪'] },
    { id: 'referrerName', paths: ['work.*.referrerName', 'internship.*.referrerName', 'project.*.referrerName'], aliases: ['证明人姓名', '推荐人姓名', '证明人', 'referrer', 'referee'] },
    { id: 'referrerContact', paths: ['work.*.referrerContact', 'internship.*.referrerContact', 'project.*.referrerContact'], aliases: ['证明人联系方式', '推荐人联系方式', 'referrercontact'] },
    { id: 'referrerPosition', paths: ['work.*.referrerPosition', 'internship.*.referrerPosition', 'project.*.referrerPosition'], aliases: ['证明人职位', '推荐人职位', 'referrerposition'] },
    { id: 'leaveReason', paths: ['work.*.leaveReason', 'internship.*.leaveReason'], aliases: ['离职原因', '离开原因', 'reasonforleaving'] },

    // ---- 项目/校园/社会实践补充 ----
    { id: 'projectResponsibility', paths: ['project.*.responsibility'], aliases: ['项目职责', '项目职责与贡献', 'projectresponsibility'] },
    { id: 'projectAchievement', paths: ['project.*.achievement'], aliases: ['项目成果', '项目业绩', '项目交付结果与量化成果', 'projectachievement'] },
    { id: 'campusLevel', paths: ['campus.*.level'], aliases: ['组织级别', '校园组织级别', 'campuslevel'] },
    { id: 'campusPosition', paths: ['campus.*.position'], aliases: ['校园职务', '组织职位', 'campusposition'] },
    { id: 'campusDuty', paths: ['campus.*.duty'], aliases: ['本人职责', '个人职责与成果', 'campusduty'] },
    { id: 'campusName', paths: ['campus.*.name'], aliases: ['组织名称', '任职组织', 'campusname', 'organizationname'] },
    { id: 'campusPeriod', paths: ['campus.*.period'], aliases: ['任职起止时间', '任职开始时间-任职结束时间', 'campusperiod'] },
    { id: 'campusDescription', paths: ['campus.*.description'], aliases: ['主要工作内容', '校园工作内容', 'campusdescription', 'campuswork'] },
    { id: 'practiceAll', paths: ['practice.*.description'], aliases: ['社会实践', '社会实践内容', '实践活动', '社会活动', 'socialpractice', 'socialactivities'] },
    { id: 'practiceUnit', paths: ['practice.*.name'], aliases: ['实践单位', '社会实践单位', 'practiceunit'] },
    { id: 'practicePosition', paths: ['practice.*.position'], aliases: ['实践岗位/身份', '实践岗位', '实践身份', 'practiceposition'] },
    { id: 'practiceStart', paths: ['practice.*.start'], aliases: ['实践开始时间', 'practicestart'] },
    { id: 'practiceEnd', paths: ['practice.*.end'], aliases: ['实践结束时间', 'practiceend'] },
    { id: 'practicePeriod', paths: ['practice.*.period'], aliases: ['实践开始时间-实践结束时间', '实践起止时间', '实践时间', '社会实践时间', 'practiceperiod'] },

    // ---- 证书 / 获奖 / 专利 / 论文 / 外语 / 技能 / 家庭 补充 ----
    { id: 'certType', paths: ['certificate.*.type'], aliases: ['资质证书类型', '证书类型', 'certificateType'] },
    { id: 'certNumber', paths: ['certificate.*.number'], aliases: ['证书编号', '资格证编号', 'certificatenumber', 'certno'] },
    { id: 'certIssuer', paths: ['certificate.*.issuer'], aliases: ['证书颁发机构', '发证机关', 'certificateissuer'] },
    { id: 'certScore', paths: ['certificate.*.score'], aliases: ['证书成绩', '职业资格成绩', 'certificatescore'] },
    { id: 'certValidUntil', paths: ['certificate.*.validUntil'], aliases: ['证书有效期', '有效期至', 'certificatevalidity'] },
    { id: 'certDescription', paths: ['certificate.*.description'], aliases: ['证书描述', 'certificatedescription'] },
    { id: 'rewardType', paths: ['awards.*.rewardType'], aliases: ['奖励类型', '个人团体', 'rewardtype'] },
    { id: 'rewardLevel', paths: ['awards.*.rewardLevel'], aliases: ['奖励等级'] },
    { id: 'awardDescription', paths: ['awards.*.description'], aliases: ['获奖描述', '奖励描述', '获奖详细描述', '奖励详细描述', 'awarddescription', 'awarddetaildescription'] },
    { id: 'patentInventor', paths: ['patent.*.inventor'], aliases: ['发明人', '设计人', 'inventor'] },
    { id: 'patentDate', paths: ['patent.*.date'], aliases: ['专利申请日期', '申请时间', 'patentdate'] },
    { id: 'patentDescription', paths: ['patent.*.description'], aliases: ['专利描述', '专利技术说明', 'patentdescription'] },
    { id: 'paperAuthors', paths: ['paper.*.authors'], aliases: ['论文作者', '作者', 'authors'] },
    { id: 'paperVolume', paths: ['paper.*.volume'], aliases: ['期刊卷期', '卷号', '期次', 'volume'] },
    { id: 'impactFactor', paths: ['paper.*.impactFactor'], aliases: ['影响因子', 'impactfactor'] },
    { id: 'paperDate', paths: ['paper.*.date'], aliases: ['发表时间', '论文发表时间', 'publicationdate'] },
    { id: 'doi', paths: ['paper.*.doi'], aliases: ['doi号', 'doi', '数字对象标识符'] },
    { id: 'paperLink', paths: ['paper.*.link'], aliases: ['论文链接', '文献链接', 'paperlink'] },
    { id: 'paperAbstract', paths: ['paper.*.abstract'], aliases: ['论文摘要', '摘要', 'abstract'] },
    { id: 'langCertName', paths: ['language.*.certName'], aliases: ['语言证书名称', '外语证书名称', '外语证书', 'languagecertificate'] },
    { id: 'langDate', paths: ['language.*.date'], aliases: ['获得时间', '考试或获得日期', 'languageDate'] },
    { id: 'langScore', paths: ['language.*.score'], aliases: ['考试成绩或级别', '语言成绩', '外语成绩', 'langscore'] },
    { id: 'proficiency', paths: ['language.*.level'], aliases: ['掌握程度', '总体掌握程度', 'proficiency'] },
    { id: 'listening', paths: ['language.*.listening'], aliases: ['听说能力', '听力与口语', 'listening'] },
    { id: 'reading', paths: ['language.*.reading'], aliases: ['读写能力', '阅读与写作', 'readingwriting'] },
    { id: 'techSkill', paths: ['skill.computer'], aliases: ['技术技能', '专业技术技能', 'technicalskills'] },
    { id: 'languageSkill', paths: ['skill.languageSkill'], aliases: ['语言能力', '掌握的语言', 'languageskill', 'languageskills'] },
    { id: 'softwareSkill', paths: ['skill.software'], aliases: ['软件技能', '软件使用技能', 'softwareskills'] },
    { id: 'certSkill', paths: ['skill.certificates'], aliases: ['证书认证', '持有证书', 'certificationskill'] },
    { id: 'softSkill', paths: ['skill.softSkill'], aliases: ['软技能', '软技能和沟通能力', '沟通协调能力', 'softskills'] },
    { id: 'familyGender', paths: ['family.*.gender'], aliases: ['家庭成员性别', '成员性别', 'familygender'] },
    { id: 'familyEducation', paths: ['family.*.education'], aliases: ['家庭成员教育程度', '成员学历', 'familyeducation'] },
    { id: 'familyEthnicity', paths: ['family.*.ethnicity'], aliases: ['家庭成员民族', '成员民族', 'familyethnicity'] },
    { id: 'familyBirthDate', paths: ['family.*.birthDate'], aliases: ['家庭成员出生日期', '成员出生日期', 'familybirthdate'] },
    { id: 'familyIdNumber', paths: ['family.*.idNumber'], aliases: ['家庭成员身份证号', '成员身份证号', 'familyid'] },
    { id: 'familyPhone', paths: ['family.*.phone'], aliases: ['家庭成员联系电话', '成员电话', 'familyphone'] },
    { id: 'familyPosition', paths: ['family.*.position'], aliases: ['家庭成员职务', '成员职务', 'familypost'] },
    { id: 'familyAddress', paths: ['family.*.address'], aliases: ['家庭成员地址', '家庭居住地', 'familyaddress'] }
  ];

  // select/radio 选项值归一化同义词：字段值 -> 可接受的选项文本变体
  const VALUE_SYNONYMS = {
    '男': ['男', 'male', 'm'],
    '女': ['女', 'female', 'f'],
    '中共党员': ['中共党员', '党员', '共产党员', 'party member'],
    '中共预备党员': ['中共预备党员', '预备党员'],
    '共青团员': ['共青团员', '团员', '团员', 'league member'],
    '群众': ['群众', '普通群众', '无党派群众', 'masses'],
    '本科': ['本科', '大学本科', '学士', 'bachelor', 'undergraduate'],
    '硕士': ['硕士', '硕士研究生', 'master', '研究生'],
    '博士': ['博士', '博士研究生', 'phd', 'doctor', 'doctorate'],
    '大专': ['大专', '专科', '大学专科', 'associate', 'college'],
    '未婚': ['未婚', '单身', 'single', 'unmarried'],
    '已婚': ['已婚', 'married'],
    '全职': ['全职', 'fulltime', 'full-time'],
    '兼职': ['兼职', 'parttime', 'part-time'],
    '实习': ['实习', 'internship', 'intern'],
    '硕士研究生': ['硕士', '硕士研究生', 'master', '研究生'],
    '博士研究生': ['博士', '博士研究生', 'phd', 'doctor'],
    '全日制': ['全日制', '普通全日制', '统招全日制', 'fulltime', 'full-time'],
    '非全日制': ['非全日制', '在职', 'parttime', 'part-time'],
    '统招': ['统招', '统一招生', '普通统招', 'national'],
    '城镇': ['城镇', '城市', '非农', 'urban'],
    '农村': ['农村', '农业', 'non-urban', 'rural'],
    '在读': ['在读', '在校', '未毕业', 'studying'],
    '毕业': ['毕业', '已毕业', 'graduated'],
    '健康': ['健康', '良好', 'good', 'healthy'],
    '精通': ['精通', '熟练', 'proficient', 'excellent'],
    '良好': ['良好', 'good'],
    '一般': ['一般', '中等', 'average', 'fair'],
    '是': ['是', 'yes', 'y', '有', 'true'],
    '否': ['否', 'no', 'n', '无', 'false']
  };

  // 关键词打分（表单识别用）
  const DETECT_KEYWORDS = [
    '姓名', '手机号', '电话', '邮箱', '学历', '毕业院校', '专业', '政治面貌', '籍贯', '生源地',
    '身份证', '简历', '应聘', '申请职位', '网申', '求职', '工作经历', '实习经历', '项目经历',
    '自我评价', '家庭成员', '期望岗位', '入职', '校园招聘', '社会招聘', '报名', '申请职位',
    '获奖', '专利', '论文', '紧急联系人',
    'resume', 'apply', 'application', 'job', 'career', 'position', 'recruit'
  ];

  // 已知 ATS/招聘系统域名特征
  const ATS_DOMAINS = [
    'zhaopin.com', '51job.com', 'liepin.com', 'lagou.com', 'jobui.com',
    'mokahr.com', 'mokachinago.com', 'beisen.com', 'beisen', 'italent',
    'dayee.com', 'dayee', 'zhiye.com', 'hotjob.cn', 'hotjob',
    'campus.chinahr.com', 'chinahr.com', 'kanzhun.com', 'bosszhipin.com', 'zhipin.com',
    'liepin.cn', '51jobcdn', 'yonyou.com', 'inspur', 'neusoft',
    'iguopin.com', 'job91.com', 'newjob.com', '91job', 'cnhr.com'
  ];

  // 归一化字段信号文本
  function normalize(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[*＊]/g, '')
      .replace(/[：:]/g, '')
      .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '') // 去括号提示
      .replace(/[.,，。;；、_\-—/\\'"!?？]/g, '')
      .trim();
  }

  // 匹配：返回 {ruleId, paths, confidence} 或 null
  function matchSignal(signalText) {
    const norm = normalize(signalText);
    if (!norm || norm.length > 40) return null;
    let best = null;
    for (const rule of RULES) {
      for (const alias of rule.aliases) {
        const a = normalize(alias);
        if (!a) continue;
        if (a === norm) return { ruleId: rule.id, paths: rule.paths, confidence: 1.0 };
        // 包含匹配：别名包含信号 或 信号包含别名，长者优先
        // 注意：信号短于 3 字时禁用"信号被别名包含"方向，避免"是/否/男"等选项文本误配（如"是"命中"是否交换生"）
        if (norm.length >= 3 && a.length >= 2 && norm.includes(a)) {
          const score = Math.min(a.length, norm.length) / Math.max(a.length, norm.length);
          if (!best || score > best.confidence) {
            best = { ruleId: rule.id, paths: rule.paths, confidence: Math.max(0.5, score) };
          }
        }
        if (a.length >= 4 && norm.length >= 3 && a.includes(norm)) {
          const score = Math.min(a.length, norm.length) / Math.max(a.length, norm.length);
          if (!best || score > best.confidence) {
            best = { ruleId: rule.id, paths: rule.paths, confidence: Math.max(0.5, score) };
          }
        }
      }
    }
    return best;
  }

  // 数组型板块：路径里的中段既可能写成具体索引（education.0.school，latest 策略）
  // 也可能写成通配（work.*.company，joinAll 聚合 / 选区填写的单条记录展开）。
  // 两种写法指的是同一个字段，必须互为等价，否则规则命中了却取不到值，
  // 字段会被误标成「简历缺该项」（选区填写教育经历必然全红的根因）。
  const ARRAY_SECTIONS = new Set(['education', 'work', 'internship', 'project', 'campus', 'practice',
    'certificate', 'awards', 'patent', 'paper', 'language', 'family']);

  function isIndexSeg(s) { return s === '*' || /^\d+$/.test(s); }

  // 只处理 section.index.field 三段形态；object 段与 derived.* 要求逐字相等
  function pathEq(a, b) {
    if (a === b) return true;
    const x = String(a || '').split('.');
    const y = String(b || '').split('.');
    if (x.length !== 3 || y.length !== 3) return false;
    if (x[0] !== y[0] || !ARRAY_SECTIONS.has(x[0])) return false;
    if (x[2] !== y[2]) return false;
    if (x[1] === y[1]) return true;
    // 两个不同具体索引是两条不同记录，不等价；只有涉及 '*' 时才互相等价
    return isIndexSeg(x[1]) && isIndexSeg(y[1]) && (x[1] === '*' || y[1] === '*');
  }

  // 等价匹配到多条时按「索引就近」挑选，杜绝聚合值冒充单条记录
  function pickByIndex(reqPath, cands) {
    if (cands.length < 2) return cands[0];
    const want = String(reqPath).split('.')[1];
    if (/^\d+$/.test(want)) {
      return cands.find(e => String(e.index) === want) || cands.find(e => e.index === 0) || cands[0];
    }
    return cands.find(e => e.index === -1) || cands[0];   // '*'：优先聚合条目
  }

  // 按路径优先级从扁平条目中取值
  function resolveValue(paths, entries) {
    if (!paths || !paths.length || !entries || !entries.length) return null;
    const filled = e => e && String(e.value == null ? '' : e.value).trim();
    // 第一遍：纯精确相等。一键填写的 entries 每段只有一种方言，走这里结果与修复前完全一致
    for (const p of paths) {
      const hit = entries.find(e => e.path === p && filled(e));
      if (hit) return hit;
    }
    // 第二遍：索引等价兜底（规则写 .0 而数据是 .*，或反之）
    for (const p of paths) {
      const cands = entries.filter(e => filled(e) && pathEq(e.path, p));
      if (cands.length) return pickByIndex(p, cands);
    }
    return null;
  }

  // 选项文本与简历值匹配（用于 select/radio/checkbox）
  function matchOptionValue(optionText, resumeValue) {
    const o = normalize(optionText);
    const v = normalize(resumeValue);
    if (!o || !v) return false;
    if (o === v) return true;
    // 简历值的同义词表
    const syns = VALUE_SYNONYMS[resumeValue] || VALUE_SYNONYMS[String(resumeValue).trim()];
    if (syns && syns.some(s => normalize(s) === o)) return true;
    // 双向包含（如 "大学本科" vs "本科"，"其他-请注明" 场景）
    if (o.includes(v) || v.includes(o)) return true;
    // 选项含"其他"且简历值不在选项集合中时，由调用方处理
    return false;
  }

  root.FieldRules = {
    RULES, VALUE_SYNONYMS, DETECT_KEYWORDS, ATS_DOMAINS, ARRAY_SECTIONS,
    normalize, matchSignal, resolveValue, matchOptionValue, pathEq
  };
})(typeof window !== 'undefined' ? window : self);
