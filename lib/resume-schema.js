// 简历数据模型：元数据驱动，编辑器与匹配引擎共用
(function (root) {
  'use strict';

  const F = (key, label, type, opts) => Object.assign({ key, label, type: type || 'text' }, opts || {});

  // type: text | textarea | date | month | select | number | region
  // opts: options[] 可选项 · freeText 允许自填 · hint 输入框下方说明 · suffix 输入框右侧后缀 · readonly 由其它字段自动算出
  const BOOL = ['是', '否'];
  // 行业选项：求职意向与工作/实习经历共用（对齐竞品下拉，并含截图中的专业服务、互联网/IT）
  const INDUSTRY_OPTIONS = [
    '基金/证券/期货/投资', '银行', '保险', '学术/科研', '互联网/电商', '互联网/IT', '计算机软件',
    '通信/电子', '电力/能源', '石油/石化', '机械/制造', '汽车', '建筑/房地产',
    '医药/生物', '教育/培训', '政府/事业单位', '咨询', '专业服务', '传媒/广告', '物流/供应链', '其他'
  ];
  // 工作经历与实习经历字段集相同、标签不同：网申表单常常两张表并存，
  // 拆成两个板块才不会把同一份实习内容重复填进「工作经历」和「实习经历」。
  // 标签逐条对齐竞品：工作经历用「工作城市/工作行业/工作描述」，
  // 实习经历用「实习公司/实习职位/实习地址/所属行业/职位年薪/实习描述」。
  const EXPERIENCE_FIELDS = (mode) => {
    const intern = mode === 'internship';
    const L = intern
      ? { company: '实习公司', position: '实习职位', city: '实习地址', industry: '所属行业', description: '实习描述', annual: '职位年薪', cityHint: '实习所在地区', indHint: '实习所在行业', descHint: '实习工作内容', salHint: '实习职位年薪', leaveHint: '实习离职原因', overseaHint: '该实习经历是否发生在海外', startHint: '实习开始时间', endHint: '实习结束时间', refContactHint: '证明人联系方式', refPosHint: '证明人职位' }
      : { company: '公司', position: '职位', city: '工作城市', industry: '工作行业', description: '工作描述', annual: '年薪薪资', cityHint: '工作所在城市', indHint: '所属行业', descHint: '工作内容描述', salHint: '年薪收入', leaveHint: '离职原因', overseaHint: '该工作经历是否发生在海外', startHint: '工作开始时间', endHint: '工作结束时间', refContactHint: '推荐人联系方式', refPosHint: '推荐人职位' };
    return [
      F('company', L.company, 'text', { hint: intern ? '实习公司名称' : '公司名称' }),
      F('companyScale', '公司规模', 'select', {
        options: ['20人以下', '21-99人', '100-499人', '500-999人', '1000-9999人', '10000人以上'],
        freeText: true, hint: '公司员工人数规模'
      }),
      F('isOversea', '是否海外经历', 'select', { options: BOOL, hint: L.overseaHint }),
      F('department', '部门', 'text', { hint: '所属部门' }),
      F('position', L.position, 'text', { hint: intern ? '实习职位名称' : '职位名称' }),
      F('start', '开始时间', 'date', { hint: L.startHint }),
      F('end', '结束时间', 'date', { hint: L.endHint }),
      F('city', L.city, 'region', { hint: L.cityHint }),
      F('industry', L.industry, 'select', { options: INDUSTRY_OPTIONS, freeText: true, hint: L.indHint }),
      F('employmentType', '用工性质', 'select', {
        options: intern
          ? ['实习', '兼职', '外包', '正式', '派遣', '合同制']
          : ['正式', '派遣', '外包', '合同制', '实习', '兼职'],
        freeText: true, hint: intern ? '如实习、兼职、外包等' : '如正式、派遣、外包、合同制等'
      }),
      F('monthlySalary', '月薪', 'text', { hint: '月薪收入' }),
      F('annualSalary', L.annual, 'text', { hint: L.salHint }),
      F('referrerName', '证明人姓名', 'text', { hint: intern ? '实习证明人' : '推荐人或证明人姓名' }),
      F('referrerContact', '证明人联系方式', 'text', { hint: L.refContactHint }),
      F('referrerPosition', '证明人职位', 'text', { hint: L.refPosHint }),
      F('description', L.description, 'textarea', { hint: L.descHint }),
      F('leaveReason', '离职原因', 'textarea', { hint: L.leaveHint })
    ];
  };

  const SCHEMA = {
    sections: [
      {
        key: 'basic', title: '基本信息', kind: 'object',
        fields: [
          F('name', '姓名', 'text', { hint: '真实姓名' }),
          F('namePinyin', '姓名拼音', 'text', { hint: '姓名拼音，便于英文表单填写' }),
          F('nameEn', '英文姓名', 'text', { hint: '完整英文姓名' }),
          F('gender', '性别', 'select', { options: ['男', '女'] }),
          F('phone', '电话', 'text', { hint: '手机号码' }),
          F('email', '邮箱', 'text', { hint: '联系邮箱' }),
          F('birthDate', '出生日期', 'date'),
          F('age', '年龄', 'number', { hint: '根据出生日期自动计算' }),
          F('nationality', '国籍', 'text', { hint: '国籍' }),
          F('ethnicity', '民族', 'text', { hint: '民族信息' }),
          F('politicalStatus', '政治面貌', 'select', {
            options: ['中共党员', '中共预备党员', '共青团员', '群众', '民主党派', '无党派人士'],
            freeText: true
          }),
          F('maritalStatus', '婚姻状况', 'select', { options: ['未婚', '已婚', '保密'], freeText: true }),
          F('idType', '证件类型', 'select', {
            options: ['身份证', '护照', '军官证', '港澳台居民居住证', '其他'], freeText: true, hint: '证件类型'
          }),
          F('idNumber', '身份证号', 'text', { hint: '身份证号码' }),
          F('currentAddress', '现居住地址', 'region', { hint: '居住所在地' }),
          F('currentCity', '现居城市', 'text', { hint: '现居住地所在城市' }),
          F('nativePlace', '籍贯', 'region', { hint: '籍贯（省市）' }),
          F('birthPlace', '生源地', 'region', { hint: '毕业生生源地' }),
          F('hukouType', '户口性质', 'select', { options: ['城镇', '农村'], freeText: true, hint: '户口性质，如城镇或农村' }),
          F('hukou', '户口所在地', 'region', { hint: '户口所在地' }),
          F('highestDegree', '最高学历', 'select', {
            options: ['初中及以下', '中专/中技', '高中', '大专', '本科', '硕士研究生', '博士研究生'],
            freeText: true, hint: '最高学历'
          }),
          F('highestDiploma', '学位', 'select', {
            options: ['无', '学士', '硕士', '博士'], freeText: true, hint: '最高学历对应的学位'
          }),
          F('gradSchool', '毕业院校', 'text', { hint: '取教育经历中最高学历的学校自动计算，可手动修改' }),
          F('gradMajor', '毕业专业', 'text', { hint: '取教育经历中最高学历的专业自动计算，可手动修改' }),
          F('studyMode', '学习形式', 'select', {
            options: ['全日制', '非全日制', '函授', '自考', '网络教育'], freeText: true, hint: '最高学历对应的学习形式'
          }),
          F('gradDate', '毕业时间', 'date', { hint: '毕业时间' }),
          F('isFresher', '是否应届生', 'select', { options: BOOL, hint: '是否为应届毕业生' }),
          F('workStatus', '工作状态', 'select', {
            options: ['在校', '应届', '离职-随时到岗', '在职-暂不考虑', '在职-考虑机会'], freeText: true, hint: '当前求职状态'
          }),
          F('workYears', '工作年限', 'text', { hint: '总工作年限（在读或应届写0）' }),
          F('lastCompany', '上一家公司', 'text', { hint: '最近工作单位' }),
          F('wechat', '微信号', 'text', { hint: '即时通讯微信号' }),
          F('qq', 'QQ号', 'text', { hint: 'QQ号码' }),
          F('homepage', '个人主页/作品链接', 'text', { hint: '个人主页、作品集或代码仓库链接' }),
          F('englishLevel', '英语等级', 'select', {
            options: ['CET-4', 'CET-6', 'TEM-4', 'TEM-8', 'IELTS', 'TOEFL', '其他'], freeText: true,
            hint: '选择已取得的最高英语等级'
          }),
          F('gaokaoDate', '高考时间', 'date', { hint: '高考参加时间' }),
          F('gaokaoScore', '高考分数', 'text', { hint: '高考成绩' }),
          F('gaokaoSubjects', '高考科目', 'text', { hint: '高考选科组合' }),
          F('techTitle', '专业技术职级', 'select', {
            options: ['无', '初级', '中级', '高级', '其他'], freeText: true, hint: '专业技术资格等级'
          }),
          F('emergencyContactName', '紧急联系人姓名', 'text', { hint: '紧急联系人姓名' }),
          F('emergencyContactRelation', '紧急联系人关系', 'select', {
            options: ['父亲', '母亲', '配偶', '兄弟', '姐妹', '朋友', '其他'], freeText: true, hint: '与紧急联系人的关系'
          }),
          F('emergencyContactPhone', '紧急联系人电话', 'text', { hint: '紧急联系人电话' }),
          F('postalCode', '邮政编码', 'text', { hint: '现居住地邮编' }),
          F('health', '健康状况', 'select', { options: ['健康', '良好', '一般', '其他'], freeText: true, hint: '整体健康状态' }),
          F('hasChronicDisease', '是否有长期病史', 'select', { options: BOOL, hint: '是否存在长期病史' }),
          F('hasCriminalRecord', '是否有犯罪记录', 'select', { options: BOOL, hint: '是否存在犯罪记录' }),
          F('hasMilitaryService', '是否服兵役', 'select', { options: BOOL, hint: '是否曾服兵役' }),
          F('isVeteran', '是否退伍军人', 'select', { options: BOOL, hint: '是否为退伍军人' }),
          F('bloodType', '血型', 'select', { options: ['A', 'B', 'AB', 'O', '其他'], freeText: true, hint: '血型信息' }),
          F('partyJoinDate', '入党时间', 'date', { hint: '加入党组织的时间' }),
          F('leagueJoinDate', '入团/入党时间', 'date', { hint: '加入共青团或党组织的时间' }),
          F('isRecommendPostgrad', '是否保研', 'select', { options: BOOL, hint: '是否推荐免试攻读研究生' }),
          F('hasOverseaStudy', '是否有留学经历', 'select', { options: BOOL, hint: '是否有海外留学经历' }),
          F('isPoorStudent', '是否贫困生', 'select', { options: BOOL, hint: '是否属于家庭经济困难学生' }),
          F('isColorBlind', '是否色弱', 'select', { options: BOOL, hint: '是否存在色觉异常' }),
          F('hasOverseaId', '是否具有境外身份', 'select', {
            options: BOOL,
            hint: '是否具有外国国籍、境外永久居留权（绿卡）等境外身份；与国籍、留学或海外经历分别填写，按招聘方定义确认，无法判断时留空'
          }),
          F('archiveLocation', '档案所在地', 'region', { hint: '人事档案所在地区' }),
          F('height', '身高(cm)', 'number', { hint: '身高(cm)' }),
          F('weight', '体重(kg)', 'number', { hint: '体重(kg)' }),
          F('advantages', '个人优势', 'textarea', { hint: '个人优势和特长' }),
          F('hobbies', '兴趣爱好', 'textarea', { hint: '个人兴趣爱好' }),
          F('careerPlan', '职业规划', 'textarea', { hint: '如应聘成功，对未来职业生涯的规划' })
        ]
      },
      {
        key: 'intention', title: '求职意向', kind: 'object',
        fields: [
          F('expectedJob', '目标岗位', 'text', { hint: '目标岗位' }),
          F('expectedIndustry', '期望行业', 'select', {
            options: INDUSTRY_OPTIONS, freeText: true, hint: '期望从事的行业'
          }),
          F('currentIndustry', '当前行业', 'select', {
            options: INDUSTRY_OPTIONS, freeText: true, hint: '当前从事的行业'
          }),
          F('expectedCity', '期望城市', 'tags', { max: 5, anyLabel: '任意城市', hint: '期望工作城市，最多 5 个' }),
          F('interviewCity', '面试城市', 'region', { hint: '可参与面试的城市' }),
          F('expectedSalary', '期望薪资', 'text', { hint: '期望税前月薪（元）' }),
          F('expectedAnnualSalary', '期望年薪', 'text', { hint: '期望年薪，仅填写数字' }),
          F('currentSalary', '当前薪资', 'text', { hint: '当前税前月薪（元）' }),
          F('jobType', '工作类型', 'select', { options: ['全职', '兼职', '实习'], freeText: true }),
          F('availableTime', '预计入职时间', 'date', { hint: '预计到岗时间' }),
          F('hasRelativeInCompany', '是否有亲人在当前求职公司', 'select', { options: BOOL, hint: '是否有亲属在当前应聘的公司任职' }),
          F('jobSource', '招聘信息来源', 'select', {
            options: ['官网', '校招', '招聘平台', '内推', '宣讲会', '其他'], freeText: true, hint: '获取本次招聘信息的渠道'
          }),
          F('acceptAdjust', '是否接受调剂', 'select', { options: BOOL, hint: '是否接受岗位或城市调剂' })
        ]
      },
      {
        key: 'education', title: '教育背景', kind: 'array',
        fields: [
          F('school', '学校', 'text', { hint: '学校名称' }),
          F('degree', '学历', 'select', {
            options: ['博士研究生', '硕士研究生', '本科', '大专', '中专/中技', '高中'],
            freeText: true, hint: '先选择学历层次，再选择对应的专业类别'
          }),
          F('department', '院系', 'text', { hint: '院系名称' }),
          F('major', '专业', 'text', { hint: '专业名称' }),
          F('majorCategory', '专业类别', 'text', { hint: '选择学历对应的教育部专业目录项' }),
          F('schoolCity', '学校城市', 'region', { hint: '学校所在城市' }),
          F('schoolType', '学校类型', 'select', {
            options: ['普通本科', '职业院校', '成人本科', '海外院校', '其他'], freeText: true, hint: '学校类型'
          }),
          F('eduStatus', '学历状态', 'select', {
            options: ['在读', '毕业', '休学', '退学'], freeText: true, hint: '当前教育经历的完成状态'
          }),
          F('duration', '学制（年）', 'text', { hint: '在校年数，如 2、2.5、4' }),
          F('start', '入学时间', 'date', { hint: '入学时间' }),
          F('end', '毕业时间', 'date', { hint: '毕业时间' }),
          F('degreeDate', '学历授予日期', 'date', { hint: '学历证书正式授予或取得日期' }),
          F('diploma', '学位', 'select', { options: ['无', '学士', '硕士', '博士'], freeText: true, hint: '具体学位，如学士、硕士、博士' }),
          F('degreeType', '学位类型', 'select', { options: ['学术学位', '专业学位'], freeText: true, hint: '学术学位或专业学位' }),
          F('degreeCategory', '学位类别', 'text', { hint: '学位门类与层级，如经济学硕士、工学博士' }),
          F('eduMode', '教育方式', 'select', { options: ['全日制', '非全日制', '函授', '自考'], freeText: true, hint: '全日制/非全日制/函授等' }),
          F('enrollCategory', '招生类别', 'select', {
            options: ['统招', '单招', '专升本', '定向', '委培'], freeText: true, hint: '如统招、单招、专升本、定向等'
          }),
          F('isUnifiedEnroll', '是否统招', 'select', { options: BOOL, hint: '是否属于统一招生' }),
          F('gpa', '成绩绩点', 'text', { hint: '成绩绩点，1位小数' }),
          F('failedCount', '挂科数', 'text', { hint: '挂科科目数量' }),
          F('classRank', '班级排名', 'text', { hint: '填写排名百分比，如前 5% 填写 5', suffix: '%' }),
          F('majorRank', '专业排名', 'text', { hint: '填写排名百分比，如前 5% 填写 5', suffix: '%' }),
          F('diplomaNumber', '学历证书编号', 'text', { hint: '学历证书编号' }),
          F('degreeNumber', '学位证书编号', 'text', { hint: '学位证书编号' }),
          F('studentNumber', '学号', 'text', { hint: '在校学号' }),
          F('supervisor', '导师姓名', 'text', { hint: '导师姓名' }),
          F('labName', '实验室名称', 'text', { hint: '所在实验室名称' }),
          F('isKeyLab', '是否国家重点实验室', 'select', { options: BOOL, hint: '是否为国家重点实验室' }),
          F('isJointProgram', '是否联合培养', 'select', { options: BOOL, hint: '是否属于联合培养项目' }),
          F('counselorName', '辅导员姓名', 'text', { hint: '辅导员姓名' }),
          F('counselorPhone', '辅导员联系方式', 'text', { hint: '辅导员联系方式' }),
          F('isOverseaSchool', '是否海外学校', 'select', { options: BOOL, hint: '是否海外学校' }),
          F('eduDescription', '教育描述', 'textarea', { hint: '教育经历描述' }),
          F('majorDescription', '专业描述', 'textarea', { hint: '专业方向描述' }),
          F('courses', '专业课程', 'textarea', { hint: '核心课程' }),
          F('researchDirection', '研究方向', 'textarea', { hint: '研究方向' }),
          F('thesis', '毕业论文', 'textarea', { hint: '毕业论文' }),
          F('isExchange', '是否交换生', 'select', { options: BOOL }),
          F('exchangeSchool', '交换学校')
        ]
      },
      {
        key: 'work', title: '工作经历', kind: 'array',
        fields: EXPERIENCE_FIELDS('work')
      },
      {
        key: 'internship', title: '实习经历', kind: 'array',
        fields: EXPERIENCE_FIELDS('internship')
      },
      {
        key: 'project', title: '项目经历', kind: 'array',
        fields: [
          F('name', '项目名称', 'text', { hint: '项目名称' }),
          F('teamSize', '团队规模', 'select', {
            options: ['1人', '2-5人', '6-10人', '11-20人', '21-50人', '50人以上'],
            freeText: true, hint: '项目参与团队人数规模'
          }),
          F('isOversea', '是否海外经历', 'select', { options: BOOL, hint: '该项目经历是否发生在海外' }),
          F('role', '项目职务', 'text', { hint: '项目中的角色或职务' }),
          F('practiceMethod', '实践方式', 'select', {
            options: ['个人项目', '团队项目', '课程设计', '毕业设计', '科研项目', '竞赛项目', '企业合作'],
            freeText: true, hint: '项目实践方式'
          }),
          F('start', '开始时间', 'month', { hint: '项目开始时间' }),
          F('end', '结束时间', 'month', { hint: '项目结束时间' }),
          F('city', '项目地址', 'region', { hint: '项目所在地区' }),
          F('link', '项目链接', 'text', { hint: '项目在线链接' }),
          F('referrerName', '证明人姓名', 'text', { hint: '项目证明人姓名' }),
          F('referrerContact', '证明人联系方式', 'text', { hint: '项目证明人联系方式' }),
          F('referrerPosition', '证明人职位', 'text', { hint: '项目证明人职位' }),
          F('description', '项目描述', 'textarea', { hint: '项目详细描述' }),
          F('responsibility', '项目职责', 'textarea', { hint: '项目职责与贡献' }),
          F('achievement', '项目成果', 'textarea', { hint: '项目交付结果与量化成果' })
        ]
      },
      {
        key: 'campus', title: '校园经历', kind: 'array',
        fields: [
          F('name', '组织名称', 'text', { hint: '任职组织' }),
          F('level', '级别', 'select', {
            options: ['校级', '院系级', '班级', '社团'], freeText: true, hint: '校园组织所属级别'
          }),
          F('position', '职位', 'text', { hint: '担任职务' }),
          F('start', '开始时间', 'month', { hint: '任职开始时间' }),
          F('end', '结束时间', 'month', { hint: '任职结束时间' }),
          F('description', '工作内容', 'textarea', { hint: '主要工作内容' }),
          F('duty', '本人职责', 'textarea', { hint: '个人职责与成果' })
        ]
      },
      {
        key: 'practice', title: '社会实践', kind: 'array',
        fields: [
          F('name', '实践单位', 'text', { hint: '社会实践单位' }),
          F('position', '实践岗位/身份', 'text', { hint: '实践期间担任的岗位或身份' }),
          F('start', '开始时间', 'month', { hint: '实践开始时间' }),
          F('end', '结束时间', 'month', { hint: '实践结束时间' }),
          F('description', '实践内容', 'textarea', { hint: '社会实践内容' })
        ]
      },
      {
        key: 'certificate', title: '证书', kind: 'array',
        fields: [
          F('name', '资质证书名称', 'text', { hint: '资质证书名称' }),
          F('type', '资质证书类型', 'select', {
            options: ['职业资格证书', '职业技能等级证书', '专业资格认证', '其他资质证书'],
            freeText: true, hint: '例如执业资格、职业资格'
          }),
          F('date', '证书获取时间', 'date'),
          F('number', '证书编号', 'text', { hint: '证书编号' }),
          F('issuer', '证书颁发机构', 'text', { hint: '证书颁发机构' }),
          F('score', '证书成绩', 'text', { hint: '证书成绩' }),
          F('validUntil', '证书有效期', 'date', { hint: '证书有效期' }),
          F('description', '证书描述', 'textarea', { hint: '证书描述' })
        ]
      },
      {
        key: 'awards', title: '获奖经历（奖学金）', kind: 'array',
        fields: [
          F('name', '奖项名称', 'text', { hint: '获得的奖项名称。填写奖学金时，请直接填写奖学金的名字。' }),
          F('issuer', '颁发机构', 'text', { hint: '颁发奖项的机构' }),
          F('date', '获奖时间', 'date', { hint: '获奖时间' }),
          F('endDate', '结束时间', 'date', { hint: '获奖结束时间' }),
          F('level', '奖项级别', 'select', {
            options: ['国际级', '国家级', '省级', '市级', '校级'], freeText: true, hint: '奖项级别'
          }),
          F('rewardType', '奖励类型', 'select', { options: ['个人', '团体'], freeText: true, hint: '奖励类型(个人、团体)' }),
          F('rewardLevel', '奖励等级', 'select', {
            options: ['特等奖', '一等奖', '二等奖', '三等奖', '优秀奖', '其他'], freeText: true,
            hint: '奖励等级(一二三等特等优秀奖其他)'
          }),
          F('description', '获奖描述', 'textarea', { hint: '获奖描述' }),
          F('detailDescription', '获奖详细描述', 'textarea', { hint: '获奖详细描述' })
        ]
      },
      {
        key: 'patent', title: '专利信息', kind: 'array',
        fields: [
          F('name', '专利名称', 'text', { hint: '专利标题' }),
          F('number', '专利号', 'text', { hint: '专利申请号或授权号' }),
          F('date', '申请日期', 'date', { hint: '专利申请日期' }),
          F('status', '专利状态', 'select', {
            options: ['已受理', '实质审查', '已授权', '已驳回', '失效'], freeText: true, hint: '专利当前状态'
          }),
          F('inventor', '发明人', 'text', { hint: '专利发明人' }),
          F('type', '专利类型', 'select', {
            options: ['发明专利', '实用新型', '外观设计'], freeText: true, hint: '专利类型'
          }),
          F('description', '专利描述', 'textarea', { hint: '专利详细描述' })
        ]
      },
      {
        key: 'paper', title: '论文发表', kind: 'array',
        fields: [
          F('title', '论文标题', 'text', { hint: '论文标题' }),
          F('journal', '发表期刊', 'text', { hint: '发表期刊或会议' }),
          F('authors', '作者', 'text', { hint: '论文作者' }),
          F('volume', '期刊卷期', 'text', { hint: '期刊年度、卷号或期次' }),
          F('impactFactor', '影响因子', 'text', { hint: '论文发表期刊的影响因子' }),
          F('level', '刊物等级', 'select', {
            options: ['SCI', 'EI', 'CSSCI', '北大核心', '其他'], freeText: true, hint: '论文或期刊的刊物等级'
          }),
          F('authorship', '作者顺序', 'select', {
            options: ['第一作者', '共同第一作者', '通讯作者', '第二作者', '其他'], freeText: true,
            hint: '论文中的作者排序或作者身份'
          }),
          F('date', '发表时间', 'date', { hint: '论文发表时间' }),
          F('doi', 'DOI号', 'text', { hint: '数字对象识别码' }),
          F('link', '论文链接', 'text', { hint: '论文原文、期刊或 DOI 页面链接' }),
          F('abstract', '论文摘要', 'textarea', { hint: '论文摘要或描述' })
        ]
      },
      {
        key: 'language', title: '外语能力', kind: 'array',
        fields: [
          F('name', '语言种类', 'select', {
            options: ['英语', '日语', '俄语', '法语', '德语', '西班牙语', '韩语', '普通话'], freeText: true,
            hint: '语言种类'
          }),
          F('date', '获得时间', 'date', { hint: '考试或获得日期' }),
          F('certName', '证书名称', 'text', { hint: '证书名称' }),
          F('score', '成绩', 'text', { hint: '考试成绩或级别' }),
          F('level', '掌握程度', 'select', {
            options: ['精通', '熟练', '良好', '一般'], freeText: true, hint: '总体掌握程度'
          }),
          F('listening', '听说能力', 'select', { options: ['精通', '熟练', '良好', '一般'], freeText: true, hint: '听说能力' }),
          F('reading', '读写能力', 'select', { options: ['精通', '熟练', '良好', '一般'], freeText: true, hint: '读写能力' })
        ]
      },
      {
        key: 'skill', title: '技能特长', kind: 'object',
        fields: [
          F('computer', '技术技能', 'textarea', { hint: '专业技术技能' }),
          F('languageSkill', '语言能力', 'textarea', { hint: '掌握的语言' }),
          F('software', '软件技能', 'textarea', { hint: '软件使用技能' }),
          F('certificates', '证书认证', 'textarea', { hint: '根据证书列表自动生成，可在证书板块维护' }),
          F('softSkill', '软技能', 'textarea', { hint: '软技能和沟通能力' }),
          F('other', '其他技能', 'textarea')
        ]
      },
      {
        key: 'selfEvaluation', title: '自我评价', kind: 'object',
        fields: [
          F('content', '自我介绍（自我评价）', 'textarea', { hint: '个人自我介绍' })
        ]
      },
      {
        key: 'family', title: '家庭情况', kind: 'array',
        fields: [
          F('name', '姓名', 'text', { hint: '家庭成员姓名' }),
          F('relation', '关系', 'select', {
            options: ['父亲', '母亲', '兄', '弟', '姐', '妹', '配偶', '其他'], freeText: true, hint: '与本人关系'
          }),
          F('gender', '性别', 'select', { options: ['男', '女'], hint: '家庭成员性别' }),
          F('education', '教育程度', 'select', {
            options: ['小学', '初中', '高中/中专', '大专', '本科', '硕士研究生', '博士研究生', '其他'],
            freeText: true, hint: '家庭成员最高教育程度'
          }),
          F('ethnicity', '民族', 'text', { hint: '家庭成员民族' }),
          F('idNumber', '身份证号', 'text', { hint: '家庭成员身份证号码' }),
          F('birthDate', '出生日期', 'date'),
          F('age', '年龄', 'number', { hint: '根据出生日期自动计算' }),
          F('phone', '联系电话', 'text', { hint: '联系电话' }),
          F('company', '工作单位', 'text', { hint: '所在单位' }),
          F('position', '职位', 'text', { hint: '职务' }),
          F('politicalStatus', '政治面貌', 'select', {
            options: ['中共党员', '中共预备党员', '共青团员', '群众', '民主党派', '其他'], freeText: true
          }),
          F('address', '联系地址', 'region', { hint: '居住/联系地区' })
        ]
      }
    ]
  };

  function emptyData() {
    const data = {};
    for (const s of SCHEMA.sections) {
      if (s.kind === 'object') {
        data[s.key] = {};
        for (const f of s.fields) data[s.key][f.key] = '';
      } else {
        data[s.key] = [];
      }
    }
    return data;
  }

  function newResume(name) {
    return {
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || '我的简历',
      updatedAt: Date.now(),
      data: emptyData()
    };
  }

  // 旧简历仅存 YYYY-MM 时，升为该月首日，供 date 控件显示
  function coerceMonthToDateStart(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{4})\D?(\d{1,2})(?:\D+(\d{1,2}))?$/);
    if (!m) return s;
    const y = m[1], mo = String(Number(m[2])).padStart(2, '0');
    const day = m[3] != null ? String(Number(m[3])).padStart(2, '0') : '01';
    return y + '-' + mo + '-' + day;
  }

  // 归一化合并：保证导入的旧数据/残缺数据字段完整
  function normalizeData(data) {
    const base = emptyData();
    if (!data || typeof data !== 'object') return base;
    for (const s of SCHEMA.sections) {
      const src = data[s.key];
      if (s.kind === 'object') {
        if (src && typeof src === 'object') {
          for (const f of s.fields) {
            if (src[f.key] !== undefined && src[f.key] !== null) base[s.key][f.key] = String(src[f.key]);
          }
        }
      } else if (Array.isArray(src)) {
        base[s.key] = src.map(item => {
          const row = {};
          for (const f of s.fields) {
            let val = item && item[f.key] != null ? String(item[f.key]) : '';
            // 起止日从 month 升为 date：兼容旧 YYYY-MM（教育 / 工作 / 实习）
            if ((s.key === 'education' || s.key === 'work' || s.key === 'internship') &&
                (f.key === 'start' || f.key === 'end') && f.type === 'date') {
              val = coerceMonthToDateStart(val);
            }
            row[f.key] = val;
          }
          return row;
        });
      }
    }
    return base;
  }

  // ---------- 教育经历 → 基本信息 / 生日 → 年龄（编辑器与自测共用） ----------

  const DEGREE_RANK = {
    '博士研究生': 70, '博士': 70,
    '硕士研究生': 60, '硕士': 60, '研究生': 55,
    '本科': 50, '大学本科': 50,
    '大专': 40, '专科': 40,
    '中专/中技': 30, '中专': 30, '中技': 30,
    '高中': 20,
    '初中及以下': 10, '初中': 10
  };

  function degreeRank(d) {
    const s = String(d || '').trim();
    if (DEGREE_RANK[s] != null) return DEGREE_RANK[s];
    if (/博士/.test(s)) return 70;
    if (/硕士|研究生/.test(s)) return 60;
    if (/本科/.test(s)) return 50;
    if (/大专|专科/.test(s)) return 40;
    if (/中专|中技/.test(s)) return 30;
    if (/高中/.test(s)) return 20;
    return 0;
  }

  function monthToDate(m) {
    const n = String(m || '').match(/(\d{4})\D?(\d{1,2})/);
    if (!n) return '';
    const y = Number(n[1]), mo = Number(n[2]);
    if (!y || !mo || mo < 1 || mo > 12) return '';
    const last = new Date(y, mo, 0).getDate();
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(last).padStart(2, '0');
  }

  function pickHighestEducation(education) {
    const arr = (education || []).filter(Boolean);
    if (!arr.length) return null;
    return arr.slice().sort((a, b) => {
      const rd = degreeRank(b.degree) - degreeRank(a.degree);
      if (rd) return rd;
      return ((b.start || '').replace(/[./]/g, '-')).localeCompare((a.start || '').replace(/[./]/g, '-'));
    })[0];
  }

  /** 仅当 basic 对应字段为空时，用最高学历教育经历回填。返回被写入的 key 列表。 */
  function syncEducationToBasic(data) {
    if (!data || !data.basic) return [];
    const top = pickHighestEducation(data.education);
    if (!top) return [];
    const pairs = [
      ['gradSchool', top.school],
      ['gradMajor', top.major],
      ['highestDegree', top.degree],
      ['highestDiploma', top.diploma],
      ['gradDate', monthToDate(top.end)],
      ['studyMode', top.eduMode]
    ];
    const changed = [];
    for (const [k, raw] of pairs) {
      const v = String(raw || '').trim();
      if (!v) continue;
      if (String(data.basic[k] || '').trim()) continue;
      data.basic[k] = v;
      changed.push(k);
    }
    return changed;
  }

  function ageFromBirthDate(birthDate) {
    if (!birthDate) return '';
    const b = new Date(birthDate);
    if (isNaN(b.getTime())) return '';
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    if (age > 0 && age < 100) return String(age);
    return '';
  }

  /** 有合法生日则覆盖 basic.age；返回是否发生了变更。 */
  function syncAgeFromBirthDate(data) {
    if (!data || !data.basic) return false;
    const age = ageFromBirthDate(data.basic.birthDate);
    if (!age) return false;
    if (String(data.basic.age || '') === age) return false;
    data.basic.age = age;
    return true;
  }

  /** 由证书列表名称拼出技能「证书认证」文案（顿号分隔）。 */
  function buildCertificatesSkill(data) {
    const names = (data && data.certificate || [])
      .map(c => String(c && c.name || '').trim())
      .filter(Boolean);
    return names.join('、');
  }

  /**
   * 证书名称 → skill.certificates 自动同步（对齐竞品）。
   * 仅当字段为空，或仍等于上一轮自动写入值时覆盖；手改后不冲掉。
   * state 为可选 { lastAuto }，用于跨次调用记住上次自动值。
   * 返回是否发生了变更。
   */
  function syncCertificatesSkill(data, state) {
    if (!data) return false;
    if (!data.skill) data.skill = {};
    const auto = buildCertificatesSkill(data);
    const cur = String(data.skill.certificates || '').trim();
    const lastAuto = state && state.lastAuto != null ? String(state.lastAuto) : null;
    // 首次且已有与自动值不同的内容 → 视为手改，不覆盖
    if (lastAuto == null && cur && cur !== auto) return false;
    // 后续仅当为空或仍等于上次自动值才可写
    if (cur && lastAuto != null && cur !== lastAuto) return false;
    if (cur === auto) {
      if (state) state.lastAuto = auto;
      return false;
    }
    data.skill.certificates = auto;
    if (state) state.lastAuto = auto;
    return true;
  }

  // ---------- 扁平化：供匹配引擎使用 ----------

  const fmtMonth = v => (v || '').replace(/[./]/g, '-');

  const period = (item) => {
    // 教育/工作等用 start/end；获奖经历用 date/endDate
    const s = fmtMonth(item.start || item.date), e = fmtMonth(item.end || item.endDate);
    if (s && e) return s + ' 至 ' + e;
    return s || e || '';
  };

  // 数组段取哪一条：latest=最近一条(按start排序), first, joinAll
  const ARRAY_POLICY = {
    education: 'latest',   // 央国企表单通常问最高/最近学历
    work: 'joinAll',
    internship: 'joinAll',
    project: 'joinAll',
    campus: 'joinAll',
    practice: 'joinAll',
    certificate: 'joinAll',
    awards: 'joinAll',
    patent: 'joinAll',
    paper: 'joinAll',
    language: 'joinAll',
    family: 'joinAll'
  };

  // 返回 [{path, label, value, sectionKind, sectionKey, fieldKey, index}]
  function buildFlatEntries(data) {
    const entries = [];
    for (const s of SCHEMA.sections) {
      if (s.kind === 'object') {
        for (const f of s.fields) {
          const v = (data[s.key] && data[s.key][f.key]) || '';
          if (String(v).trim()) entries.push({
            path: s.key + '.' + f.key, label: f.label, value: String(v).trim(),
            sectionKey: s.key, fieldKey: f.key
          });
        }
      } else {
        const arr = data[s.key] || [];
        const policy = ARRAY_POLICY[s.key] || 'first';
        if (policy === 'latest') {
          const sorted = arr.slice().sort((a, b) => (fmtMonth(b.start) || '').localeCompare(fmtMonth(a.start) || ''));
          const item = sorted[0];
          if (item) {
            for (const f of s.fields) {
              let v = item[f.key] || '';
              if (f.key === 'period') continue;
              if (String(v).trim()) entries.push({
                path: s.key + '.0.' + f.key, label: f.label, value: String(v).trim(),
                sectionKey: s.key, fieldKey: f.key, index: 0
              });
            }
            const p = period(item);
            if (p) entries.push({ path: s.key + '.0.period', label: '时间段', value: p, sectionKey: s.key, fieldKey: 'period', index: 0 });
          }
        } else if (policy === 'joinAll') {
          // 整体拼接值（如"证书1；证书2"）与逐条值都提供
          for (const f of s.fields) {
            if (f.type === 'textarea') continue;
            const vals = arr.map(it => it[f.key]).filter(v => v && String(v).trim());
            if (vals.length) entries.push({
              path: s.key + '.*.' + f.key, label: f.label + '(全部)', value: vals.join('；'),
              sectionKey: s.key, fieldKey: f.key, index: -1
            });
          }
          // 长文本字段（工作描述、离职原因等）逐字段整体拼接，标题取公司/项目/组织名
          const textFields = s.fields.filter(f => f.type === 'textarea');
          for (const tf of textFields) {
            const blocks = arr.map(it => {
              const title = it.company || it.name || it.position || it.role || '';
              const body = it[tf.key] || '';
              return body ? (title ? title + '：' : '') + body : '';
            }).filter(Boolean);
            if (blocks.length) entries.push({
              path: s.key + '.*.' + tf.key, label: tf.label + '(全部)',
              value: blocks.join('\n'), sectionKey: s.key, fieldKey: tf.key, index: -1
            });
          }
          // 时间段整体
          const periods = arr.map(period).filter(Boolean);
          if (periods.length) entries.push({
            path: s.key + '.*.period', label: '时间段(全部)', value: periods.join('；'),
            sectionKey: s.key, fieldKey: 'period', index: -1
          });
        }
      }
    }
    return entries;
  }

  // 派生复合值：最高学历、毕业时间等常见问题
  function derivedEntries(data) {
    const out = [];
    const edu = (data.education || []).slice()
      .sort((a, b) => (fmtMonth(b.start) || '').localeCompare(fmtMonth(a.start) || ''));
    if (edu.length) {
      const top = edu[0];
      if (top.degree && top.diploma && top.degree !== top.diploma) {
        out.push({ path: 'derived.degreeDiploma', label: '最高学历学位', value: top.degree + '（' + top.diploma + '）', sectionKey: 'derived', fieldKey: 'degreeDiploma' });
      }
      if (top.end) out.push({ path: 'derived.graduationDate', label: '毕业时间', value: fmtMonth(top.end), sectionKey: 'derived', fieldKey: 'graduationDate' });
      if (top.school && top.major) out.push({ path: 'derived.schoolMajor', label: '毕业院校及专业', value: top.school + ' ' + top.major, sectionKey: 'derived', fieldKey: 'schoolMajor' });
      const uni = edu.find(e => e.degree === '本科' || e.degree === '大学本科');
      if (uni && uni !== top && uni.school) {
        out.push({ path: 'derived.undergradSchool', label: '本科学校', value: uni.school, sectionKey: 'derived', fieldKey: 'undergradSchool' });
        if (uni.major) out.push({ path: 'derived.undergradMajor', label: '本科专业', value: uni.major, sectionKey: 'derived', fieldKey: 'undergradMajor' });
      }
    }
    // 年龄
    const derivedAge = data.basic ? ageFromBirthDate(data.basic.birthDate) : '';
    if (derivedAge) out.push({ path: 'derived.age', label: '年龄', value: derivedAge, sectionKey: 'derived', fieldKey: 'age' });
    // 英语等级简写（证书名称优先，其次掌握程度）
    const langs = data.language || [];
    for (const l of langs) {
      if (l.name === '英语') {
        const lv = l.certName || l.level || '';
        if (lv) out.push({ path: 'derived.englishLevel', label: '英语等级', value: lv + (l.score ? '（' + l.score + '分）' : ''), sectionKey: 'derived', fieldKey: 'englishLevel' });
      }
    }
    // 基本信息里手填的最高学历/毕业时间优先于派生值
    if (data.basic) {
      for (const [k, label] of [['highestDegree', '最高学历'], ['highestDiploma', '最高学位'], ['gradDate', '毕业时间'],
        ['gradSchool', '毕业院校'], ['gradMajor', '毕业专业'], ['age', '年龄']]) {
        const v = data.basic[k];
        if (v && String(v).trim()) out.push({ path: 'derived.basic_' + k, label: label + '(基本信息)', value: String(v).trim(), sectionKey: 'basic', fieldKey: k });
      }
    }
    return out;
  }

  function allEntries(data) {
    return buildFlatEntries(normalizeData(data)).concat(derivedEntries(normalizeData(data)));
  }

  root.ResumeSchema = {
    SCHEMA, emptyData, newResume, normalizeData, buildFlatEntries, derivedEntries, allEntries,
    pickHighestEducation, syncEducationToBasic, ageFromBirthDate, syncAgeFromBirthDate,
    buildCertificatesSkill, syncCertificatesSkill, monthToDate, degreeRank
  };
})(typeof window !== 'undefined' ? window : self);
