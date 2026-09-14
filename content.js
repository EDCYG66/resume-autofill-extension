(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.ResumeContent = api;
    if (root.chrome && chrome.runtime && chrome.runtime.onMessage && typeof document !== 'undefined') {
      chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        try {
          if (message && message.type === 'ping') sendResponse({ version: CONTENT_VERSION });
          else if (message && message.type === 'scan') sendResponse({ candidates: api.scan(message.profile || {}, message.context || {}) });
          else if (message && message.type === 'fill') api.fill(message.fields || []).then(function (results) { sendResponse({ results: results }); return; }, function () { sendResponse({ results: [], error: '填充失败' }); });
          else if (message && message.type === 'remember') sendResponse({ remembered: api.rememberFields(message.fields || [], message.siteKey || '') });
          else if (message && message.type === 'highlight') sendResponse({ highlighted: api.highlight(message.field) });
          else if (message && message.type === 'clearHighlight') sendResponse({ cleared: api.clearHighlight() });
          else sendResponse({});
        } catch (error) {
          sendResponse({ error: '页面处理失败' });
        }
        return true;
      });
    }
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CONTENT_VERSION = readExtensionVersion();
  var CONTROL_SELECTOR = 'input:not([type="hidden"]), textarea, select, [contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i], [role="combobox"], [aria-haspopup="listbox"], .ant-select, .ant-select-selection, .el-select, .el-select__input, .ivu-select-selection, .select2-selection, .n-select, .n-base-selection, .arco-select, .t-select, .t-select-input, .semi-select, .next-select, .v-select';
  var MAX_FRAMES = 12;
  // Open shadow roots are walked on every scan, so the traversal is capped: a page with thousands
  // of custom elements must not turn one click into a full-tree crawl.
  var MAX_SHADOW_ROOTS = 32;
  var MAX_EMPTY_SHADOW_ROOTS = 64;
  // Per root rather than a running total: the cost that matters is one querySelectorAll('*') per
  // root, and the number of roots is already capped above.
  var MAX_SCANNED_ELEMENTS = 20000;

  function readExtensionVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        var manifest = chrome.runtime.getManifest();
        if (manifest && manifest.version) return String(manifest.version);
      }
    } catch (_) {}
    return 'unknown';
  }

  var ALIASES = {
    // 基本信息
    name: ['姓名', '名字', '真实姓名', '本人姓名', '申请人姓名', '您的姓名', '中文姓名', '用户姓名', 'name', 'full name'],
    gender: ['性别', '您的性别', 'gender', 'sex'],
    birth_date: ['出生日期', '出生年月', '出生年月日', '出生日', '生日', '出生时间', 'birth date', 'birthday', 'date of birth', 'dob'],
    age: ['年龄', '您的年龄', 'age'],
    work_start_date: ['参加工作时间', '开始工作时间', '首次参加工作时间', '参加工作日期'],
    work_years: ['工作经验', '工作年限', '工作经历年限', '从业年限', '经验年限'],
    ethnicity: ['民族', '民族成分', 'ethnicity'],
    native_place: ['籍贯', '籍贯地', '祖籍', 'native place'],
    political_status: ['政治面貌', '政治面貌情况', '党派', 'political status'],
    marital_status: ['婚姻状况', '婚姻状态', '婚否', 'marital status'],
    household_registration: ['户口所在地', '户口地址', '户籍所在地', '户籍地址', '户口', '户籍', 'household registration'],
    place_of_origin: ['生源地', '生源所在地', '生源地区', '生源'],
    current_residence: ['现居住地', '现居住地址', '现居地', '现住址', '居住地', '常住地', '现居'],
    mailing_address: ['通信地址', '通讯地址', '联系地址', '邮寄地址', '收件地址', '详细地址'],
    phone: ['联系电话', '手机号', '手机号码', '电话号码', '联系手机', '本人手机', '常用电话', '手机', '移动电话', '电话', 'mobile', 'phone', 'tel', 'telephone', 'cell phone'],
    phone_code: ['手机类别', '手机区号', '电话区号', '国际区号', '国家代码', '国家区号', '区号', '国家/地区代码', '国家/地区'],
    email: ['邮箱', '电子邮箱', '电子邮件', '邮箱地址', '电子信箱', '常用邮箱', '邮件', 'email', 'e-mail', 'mail'],
    wechat: ['微信', '微信号', '微信账号', 'wechat', 'weixin'],
    qq: ['QQ', 'QQ号', 'QQ号码', 'qq'],
    id_type: ['证件类型', '证件类别', '证件种类', '身份证件类型'],
    id_number: ['身份证号', '身份证号码', '证件号码', '证件号', '公民身份号码', '身份证件号', '证件编号', 'idcard', 'idnumber'],
    has_children: ['有无子女', '是否有子女', '子女情况', '子女状况'],
    emergency_contact: ['紧急联系人', '紧急联系人姓名', '紧急联络人'],
    emergency_phone: ['紧急联系电话', '紧急联系人电话', '紧急联系方式', '紧急联络电话'],
    height: ['身高', '净身高', '身高cm', '身高(cm)', '身高（cm）', 'height'],
    weight: ['体重', '净体重', '体重kg', '体重(kg)', '体重（kg）', 'weight'],
    // 求职意向
    target_role: ['期望职位', '目标职位', '应聘职位', '意向职位', '期望岗位', '意向岗位', '应聘岗位', '目标岗位', '求职岗位', '期望职业', '求职意向', '应聘意向', '岗位', '职位'],
    industry: ['期望行业', '意向行业', '目标行业', '所属行业', '公司行业', '行业'],
    city: ['期望城市', '意向城市', '工作城市', '期望工作城市', '意向工作城市', '期望工作地点', '意向工作地点', '期望工作地', '期望地区', '意向地区'],
    salary: ['期望薪资', '期望薪资要求', '期望月薪', '期望年薪', '期望工资', '薪资要求', '薪酬要求', '月薪要求', '薪资', '薪水'],
    employment_type: ['工作性质', '就业性质', '职位类型', '职位性质', '求职类型', '工作类型'],
    available_date: ['可到岗时间', '到岗时间', '到岗日期', '最快到岗', '可入职时间'],
    interview_site: ['面试站点', '面试地点', '面试城市', '面试地址', '应聘站点'],
    // 教育经历. The composite wordings below (最高学历院校, 最高学历统招 …) are listed in full as
    // well as in their stripped form: matching removes one leading qualifier at run time, and the
    // full forms keep this table honest for whatever compares it literally.
    school: ['学校', '学校名称', '毕业院校', '毕业院校名称', '毕业学校', '就读学校', '就读院校', '就读高校', '高校名称', '院校名称', '院校', '母校', '最高学历院校'],
    college: ['学院', '学院名称', '所在学院', '所在院系', '院系', '系别'],
    start_date: ['开始时间', '开始年月', '开始日期', '起始时间', '起始年月', '起始日期', '入学时间', '入学年月', '入职时间', 'start date'],
    end_date: ['结束时间', '结束年月', '结束日期', '截止时间', '截止日期', '毕业时间', '毕业年月', '离校时间', '离职时间', 'end date', '最高学历毕业时间'],
    duration_years: ['学制', '学制年限', '修业年限'],
    level: ['学历', '学历层次', '最高学历', '现有学历', '目前学历', '培养层次'],
    admission_type: ['招生类型', '培养类型', '招生方式', '录取类型', '录取批次', '统招', '非统招', '统招统分', '最高学历统招'],
    study_mode: ['学习形式', '学习方式', '就读形式', '培养方式', '全日制', '非全日制', '最高学历全日制'],
    graduate_type: ['应届往届', '应届/往届', '毕业生类型', '生源类型', '是否应届'],
    degree_certificate: ['学位证', '学位证书', '是否取得学位'],
    degree_name: ['学位名称', '所获学位', '授予学位', '学位'],
    major: ['专业', '专业名称', '所学专业', '就读专业', '主修专业', '本科专业'],
    second_major: ['第二专业', '第二学位专业', '辅修专业', '双学位专业'],
    major_category: ['专业分类', '专业类别', '专业大类', '最高学历专业分类'],
    major_rank: ['专业排名', '成绩排名', '年级排名', '班级排名', '排名'],
    gpa: ['绩点', '平均绩点', '成绩绩点', '平均学分绩点', '学分绩点', '平均成绩', '均分', '平均分', 'gpa'],
    english_level: ['英语等级', '英语级别', '英语水平', '外语等级', '外语水平'],
    english_score: ['英语等级成绩', '英语成绩', '英语分数', '四六级成绩', '外语成绩'],
    research_direction: ['研究方向', '研究领域'],
    advisor: ['导师', '导师姓名', '指导教师', '指导老师'],
    thesis_title: ['毕业论文题目', '毕业论文', '论文题目', '学位论文题目', '毕业设计题目'],
    student_id: ['学号', '学生学号', '学籍号'],
    major_rank_percent: ['专业排名百分比', '专业排名（百分比）', '年级排名百分比', '排名百分比'],
    gpa_max: ['满分平均学分绩点', '平均学分绩点满分', '绩点满分', '满分绩点', 'GPA满分'],
    weighted_score: ['加权平均分', '加权成绩', '加权分'],
    score_max: ['满分', '成绩满分', '总分满分'],
    has_failed_course: ['是否有挂科历史', '挂科历史', '是否有挂科经历', '挂科经历', '是否有挂科', '有无挂科', '挂科'],
    // 工作 / 实习
    employer: ['公司', '公司名称', '企业名称', '单位', '单位名称', '工作单位', '任职单位', '雇主'],
    role: ['职位', '职位名称', '职务', '职务名称', '岗位', '担任职务'],
    organization: ['组织', '组织名称', '项目单位'],
    employer_type: ['单位性质', '公司性质', '企业性质', '单位类型', '单位分类'],
    location: ['工作地点', '上班地点', '工作地区'],
    description: ['描述', '说明', '简介'],
    duties: ['工作内容', '工作职责', '岗位职责', '主要职责', '实习内容'],
    // 自定义 / 其他
    self_evaluation: ['自我评价', '个人评价', '个人陈述', '自我介绍', '个人介绍', '自我描述', '個人簡介', '个人简介', '自我鉴定', '自我认知'],
    political: ['政治面貌'],
    // 附加信息
    hobbies: ['兴趣爱好', '个人爱好', '业余爱好', '爱好'],
    specialty: ['特长', '个人特长', '专业特长', '技能特长', '专长'],
    punishment: ['受处分情况', '处分情况', '是否受过处分', '有无处分'],
    academic_works: ['学术专著', '学术成果', '论文著作', '专著'],
    patents: ['专利成果', '发明专利', '专利情况', '专利'],
    law_violation: ['是否有触犯国家法律法规', '是否有触犯国家法律/法规', '违法犯罪记录', '是否有违法违纪', '违法违纪', '是否违法犯罪'],
    applied_subsidiary: ['是否应聘过本公司', '是否投递过本公司', '是否有应聘过', '是否有投递过', '是否应聘过', '是否投递过'],
    relatives_in_company: ['是否有亲属在本公司', '是否有亲友在本公司', '亲戚朋友', '亲属在本公司', '是否有亲友'],
    medical_history: ['手术史', '重大疾病史', '重大疾病', '既往病史', '疾病史'],
    referral_code: ['校园大使推荐码', '内推推荐码', '推荐码', '内推码'],
    accept_adjustment: ['是否接受岗位调剂', '接受岗位调剂', '是否服从调剂', '服从调剂', '是否接受调剂', '接受调剂', '是否同意调剂'],
    siblings_count: ['兄弟姐妹数量', '兄弟姐妹数', '兄弟姐妹人数', '同胞数量'],
    score: ['成绩', '分数', '考试成绩']
  };
  var DISPLAY_LABELS = {
    name: '姓名', gender: '性别', birth_date: '出生日期', ethnicity: '民族', native_place: '籍贯', political_status: '政治面貌', household_registration: '户口所在地', place_of_origin: '生源地', current_residence: '现居住地', mailing_address: '通信地址', phone: '联系电话', email: '邮箱', target_role: '期望职位', industry: '期望行业', city: '期望城市', salary: '期望薪资', employment_type: '工作性质', available_date: '可到岗时间', school: '学校', college: '学院', start_date: '开始时间', end_date: '结束时间', duration_years: '学制', level: '学历', admission_type: '招生类型', study_mode: '学习形式', degree_certificate: '学位证', degree_name: '学位名称', major: '专业', major_category: '专业分类', major_rank: '专业排名', gpa: '绩点/均分', research_direction: '研究方向', advisor: '导师', employer: '单位', role: '职位', organization: '组织', self_evaluation: '自我评价', courses: '课程', duties: '工作内容', description: '描述', introduction: '项目介绍', outcomes: '项目成果', related_paper: '相关论文', category: '分类', skills: '相关技能', evidence: '应用说明', question: '题目', answer: '回答', custom_fields: '自定义字段', phone_code: '手机区号 / 类别', id_type: '证件类型', id_number: '身份证号', has_children: '有无子女', qq: 'QQ', emergency_contact: '紧急联系人', emergency_phone: '紧急联系电话', interview_site: '面试站点', second_major: '第二专业', graduate_type: '应届往届', english_level: '英语等级', english_score: '英语等级成绩', thesis_title: '毕业论文题目', hobbies: '兴趣爱好', specialty: '特长', punishment: '受处分情况', academic_works: '学术专著', patents: '专利成果', law_violation: '违法违纪情况', applied_subsidiary: '是否应聘过本公司', relatives_in_company: '是否有亲友在本公司', medical_history: '手术史或重大疾病史', referral_code: '推荐码', student_id: '学号', major_rank_percent: '专业排名百分比', gpa_max: '满分平均学分绩点', weighted_score: '加权平均分', score_max: '满分', has_failed_course: '是否有挂科经历', accept_adjustment: '是否接受岗位调剂', siblings_count: '兄弟姐妹数量', score: '成绩', relation: '关系'
  };
  // Per-section aliases for leaves whose plain name means something different in each
  // section. A "name" under 荣誉 is an award, not a person. Defining an entry here also
  // scopes that leaf: it stops inheriting the generic aliases of its leaf key.
  var CONTEXT_LABELS = {
    'skills.name': ['技能名称', '证书名称', '英语证书名称', '技能证书', '语言名称'],
    'skills.category': ['技能分类', '语言类别', '证书种类', '语言类型'],
    'skills.score': ['成绩', '证书成绩', '考试成绩'],
    'skills.level': ['熟练程度', '掌握程度'],
    'skills.evidence': ['应用说明', '技能说明'],
    'honors.name': ['荣誉名称', '奖项名称', '获奖名称', '奖励名称', '荣誉奖项'],
    'honors.date': ['获奖时间', '获得时间', '获奖日期'],
    'honors.issuer': ['颁发单位', '授予单位', '颁发机构'],
    'honors.description': ['荣誉说明', '奖项说明'],
    'projects.name': ['项目名称', '课题名称', '项目题目'],
    'projects.role': ['担任角色', '项目角色', '承担角色'],
    'projects.organization': ['项目单位', '项目来源', '委托单位'],
    'projects.participant_count': ['参加人数', '项目人数'],
    'projects.research_direction': ['项目方向'],
    'projects.introduction': ['项目介绍', '项目简介', '项目描述'],
    'projects.duties': ['项目职责', '项目工作', '承担工作', '项目中职责'],
    'projects.outcomes': ['项目成果', '项目成果与收获'],
    'projects.related_paper': ['相关论文', '发表论文'],
    'activities.name': ['活动名称'],
    'activities.role': ['担任角色', '活动角色'],
    'activities.organization': ['主办单位', '组织单位', '活动组织'],
    'activities.description': ['活动描述', '活动内容'],
    'campus_roles.organization': ['学生组织', '所在组织', '组织名称'],
    'campus_roles.role': ['担任职务', '学生职务', '职务名称'],
    'campus_roles.duties': ['工作内容', '职责描述'],
    'campus_roles.gains': ['任职收获', '工作收获'],
    'family.relation': ['关系', '称谓', '与本人关系', '亲属关系'],
    'family.name': ['姓名', '父亲姓名', '母亲姓名', '父母姓名', '亲属姓名'],
    'family.employer': ['工作单位', '单位名称', '所在单位', '父亲工作单位', '母亲工作单位'],
    'family.role': ['职务', '职位', '父亲职务', '母亲职务'],
    'family.phone': ['联系电话', '手机号码', '父亲电话', '母亲电话', '亲属电话'],
    'employment.description': ['工作内容', '工作职责', '岗位职责', '实习内容', '工作描述'],
    'application_answers.question': ['题目'],
    'application_answers.answer': ['回答']
  };
  var SENSITIVE_RE = /(密码|password|passwd|验证码|captcha|verification.?code|短信码|身份证|证件号码|银行卡|bank.?card|cvv|安全码|security.?code|social.?security)/i;

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/[：:]/g, '').replace(/[\/]/g, '-').replace(/[\u00a0\t\r\n ]+/g, '').replace(/[（）()【】\[\]，,。；;、？?！!*·・]/g, '').toLowerCase();
  }
  function textOf(element) { return element && (element.innerText || element.textContent || element.text || '') || ''; }
  function cleanFieldLabel(value) {
    var text = String(value == null ? '' : value).replace(/[＊*]/g, '').replace(/\s+/g, ' ').trim();
    var prompt = text.search(/(?:请填写|请输入|请选择|请上传|请搜索)/);
    if (prompt > 0) text = text.slice(0, prompt).trim();
    text = text.replace(/(?:^|\s)(?:必填|选填|非必填|required|optional)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
    if (/^(?:\d+_)+\d+$/.test(text) || /^resume[-_]?item[-_\d]*$/i.test(text)) return '';
    return text;
  }
  function isGenericPrompt(value) {
    var text = normalizeText(value);
    return /^(请填写|请输入|请选择|请上传|请搜索|选择|输入)/.test(text) || /^(自定义字段|字段|内容|信息)$/.test(text);
  }
  // Kept in sync with PLACEHOLDER_VALUES in profile-parser.js. The content script is injected
  // on its own and cannot require that module, so the list is duplicated on purpose: a
  // half-filled template must fill nothing rather than type 请填写 into the phone field.
  var PLACEHOLDER_RE = /^(请填写|请输入|请选择|请上传|请搜索|待补充|待填写|待完善)$/;
  function isPlaceholderValue(value) {
    return typeof value === 'string' && PLACEHOLDER_RE.test(value.trim());
  }
  function isUsableFieldLabel(value) {
    var text = cleanFieldLabel(value);
    if (!text || isGenericPrompt(text)) return false;
    if (/^(必填|选填|非必填|required|optional)$/i.test(normalizeText(text))) return false;
    return text.length <= 80;
  }
  function shouldIncludeCandidate(candidate) {
    if (!candidate) return false;
    var label = cleanFieldLabel(candidate.label || '');
    if (!isUsableFieldLabel(label) || normalizeText(label) === normalizeText('未标注字段')) return false;
    return true;
  }
  function customControlValue(control) {
    if (!control) return '';
    if (control.querySelector) {
      var selectors = ['.ant-select-selection-selected-value', '.el-select__tags-text', '.el-input__inner', '[aria-selected="true"]'];
      for (var i = 0; i < selectors.length; i++) {
        var selected = control.querySelector(selectors[i]);
        var selectedText = textOf(selected).trim();
        if (selected && selectedText && !isGenericPrompt(selectedText)) return selectedText;
      }
    }
    return String(control.value || textOf(control) || '').trim();
  }
  function readControlValue(control) {
    if (!control) return '';
    var visible = customControlValue(control);
    if (visible && !isGenericPrompt(visible)) return visible;
    return String(control.value || visible || '').trim();
  }
  // Select components name their root after the library, and each library lays its own popup
  // out differently. Listing the roots here is what gets a site-specific dropdown scanned;
  // the class has to be its own token, so "selected-item" never counts as a select.
  var CUSTOM_SELECT_CLASS_RE = /(^|[\s_-])(el-select|ant-select|ivu-select|select2-selection|n-select|n-base-selection|arco-select|t-select|semi-select|next-select|v-select|phoenix-select)([\s_-]|$)/;
  function isCustomSelectControl(element) {
    if (!element) return false;
    var role = normalizeText(element.role || (element.getAttribute && element.getAttribute('role')));
    var popup = normalizeText(element.ariaHaspopup || element['aria-haspopup'] || (element.getAttribute && element.getAttribute('aria-haspopup')));
    var className = String(element.className || '').toLowerCase();
    return role === 'combobox' || role === 'listbox' || popup === 'listbox' || CUSTOM_SELECT_CLASS_RE.test(className);
  }
  function isScannableControl(element) {
    if (!element || element.disabled || element.hidden) return false;
    var type = normalizeText(element.type);
    if (['hidden', 'submit', 'reset', 'button', 'image', 'file'].indexOf(type) >= 0) return false;
    if (element.getAttribute && element.getAttribute('aria-hidden') === 'true') return false;
    // A custom-styled radio or checkbox is a transparent input layered over a drawn circle.
    // Opacity must not hide it from the scan, or a whole 性别 group never shows up.
    if (!isRendered(element) && !(isChoiceControl(element) && isRendered(element, { ignoreOpacity: true }))) return false;
    var view = viewOf(element);
    if (view && view.getComputedStyle) {
      var style = view.getComputedStyle(element);
      if (style.pointerEvents === 'none' && !isCustomSelectControl(element)) return false;
    }
    return true;
  }
  function combineContextLabel(label, contextLabels) {
    return (contextLabels || []).filter(Boolean).concat(label || []).join(' ').trim();
  }
  function findContainerLabel(descriptor) {
    if (!descriptor) return '';
    var context = Array.isArray(descriptor.contextTexts) ? descriptor.contextTexts : [];
    var fields = Array.isArray(descriptor.containerTexts) ? descriptor.containerTexts : [];
    var field = fields.map(cleanFieldLabel).find(isUsableFieldLabel) || '';
    var section = context.map(cleanFieldLabel).find(function (value) { return isUsableFieldLabel(value) && (field || !isNavigationOnlyLabel(value)); }) || '';
    return cleanFieldLabel([section, field].filter(Boolean).join(' '));
  }
  function isNavigationOnlyLabel(value) {
    var text = cleanFieldLabel(value);
    return ['应聘渠道', '个人基本信息', '求职意向', '教育经历', '英语能力', '其他外语能力', '计算机技能', '专业技能', '实习经历', '获奖或社团职务', '专利', '自我评价'].indexOf(text) >= 0;
  }
  function preferredContainerSelectors() { return ['.resume-operation-wrap .form-cell', '.resume-operation-wrap .form-cell-right', '.ant-form-item', '.el-form-item', '.form-item--phoenix', '.form-item']; }
  function nearestResumeContainer(element) {
    if (!element) return null;
    var selectors = preferredContainerSelectors();
    for (var i = 0; i < selectors.length; i++) {
      if (element.closest) {
        try {
          var found = element.closest(selectors[i]);
          if (found) return found;
        } catch (_) {}
      }
    }
    return null;
  }
  function containerFieldLabel(container, element) {
    if (!container || !container.querySelector) return '';
    var item = element && element.closest ? element.closest('.ant-form-item, .el-form-item') : null;
    var root = item || container;
    var labelSelectors = ['.ant-form-item-label', '.el-form-item__label', '.form-item__text', 'label', '.form-label', '[class*="label"]'];
    for (var i = 0; i < labelSelectors.length; i++) {
      var label = root.querySelector(labelSelectors[i]);
      var value = cleanFieldLabel(textOf(label));
      if (isUsableFieldLabel(value)) return value;
    }
    return '';
  }
  function containerSectionLabel(container) {
    var node = container;
    var depth = 0;
    while (node && depth < 5) {
      if (node.querySelector) {
        var title = node.querySelector('.tit-wrap .tit, .resume-section > h1, .resume-section > h2, .resume-section > h3, .resume-section > h4');
        var value = cleanFieldLabel(textOf(title));
        if (isUsableFieldLabel(value) && !isNavigationOnlyLabel(value)) return value;
      }
      node = node.parentElement;
      depth += 1;
    }
    return '';
  }
  // Stable identity for a DOM container, used to tell radio groups apart when the page
  // renders no name attribute to group them by.
  var scopeCounter = 0;
  var scopeIds = typeof WeakMap === 'function' ? new WeakMap() : null;
  function scopeKey(element) {
    if (!scopeIds || !element) return '';
    if (!scopeIds.has(element)) { scopeCounter += 1; scopeIds.set(element, 'scope-' + scopeCounter); }
    return scopeIds.get(element);
  }
  function dedupeControlDescriptors(controls) {
    var seen = Object.create(null);
    return (controls || []).filter(function (control) {
      var type = normalizeText(control && control.type);
      if (type !== 'radio' && type !== 'checkbox') return true;
      var name = String(control.name || '');
      // A React radio group often renders no name attribute and keeps exclusivity in its own
      // state; options may still carry their own ids, so the shared question container, not the
      // id, is what identifies the group. Checkboxes stay id-keyed: a lone 是/否 box is one
      // field, not a group.
      if (!name && type === 'radio' && control.closest) {
        name = scopeKey(control.closest('fieldset, .ant-form-item, .el-form-item, .ivu-form-item, .form-item, .form-cell, .field-card, [class*="form-item"], [class*="field-card"]'));
      }
      if (!name) name = String(control.id || '');
      if (!name) return true;
      var key = type + ':' + name;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }
  function dedupeFieldDescriptors(descriptors) {
    var seen = Object.create(null);
    return (descriptors || []).filter(function (descriptor) {
      var key = normalizeText((descriptor.label || '') + '|' + (descriptor.name || '') + '|' + (descriptor.type || ''));
      if (!key || !seen[key]) { seen[key] = true; return true; }
      return false;
    });
  }
  function viewOf(element) {
    var ownerDocument = element && element.ownerDocument;
    if (ownerDocument && ownerDocument.defaultView) return ownerDocument.defaultView;
    return typeof window !== 'undefined' ? window : null;
  }
  // The root an element lives in: a shadow root for a control inside a web component, the inner
  // document for one inside a frame, the page document otherwise. A <label for> sitting beside a
  // shadow control is invisible to document.querySelector, so lookups have to start from here.
  function documentOf(element) {
    if (element && element.getRootNode) {
      try {
        var root = element.getRootNode();
        if (root && root.querySelectorAll) return root;
      } catch (_) {}
    }
    var ownerDocument = element && element.ownerDocument;
    if (ownerDocument && ownerDocument.querySelectorAll) return ownerDocument;
    return typeof document !== 'undefined' && document.querySelectorAll ? document : null;
  }
  // A control can live in a shadow root while its dropdown or calendar is portalled to the page
  // document, so anything hunting a floating panel has to look in all three: the control's own
  // root, its document (where a panel inside an iframe lives) and the top document.
  function searchRoots(element) {
    var roots = [];
    [documentOf(element), element && element.ownerDocument, typeof document !== 'undefined' ? document : null].forEach(function (root) {
      if (root && root.querySelectorAll && roots.indexOf(root) < 0) roots.push(root);
    });
    return roots;
  }
  function isFrameVisible(frame) {
    var view = viewOf(frame);
    if (!view || !view.getComputedStyle) return true;
    try {
      var style = view.getComputedStyle(frame);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (_) { return true; }
  }
  // A web component keeps its form fields inside an open shadow root, where document.querySelector
  // cannot see them. The walk below is bounded because it runs on every scan, fill and highlight,
  // and it stays inside open roots: a closed one is unreachable from page script by design, so a
  // form built entirely out of them cannot be filled.
  function shadowHosts(root) {
    var hosts = [];
    if (!root || !root.querySelectorAll) return hosts;
    var elements = null;
    try { elements = root.querySelectorAll('*'); } catch (_) { return hosts; }
    var limit = Math.min(elements.length, MAX_SCANNED_ELEMENTS);
    for (var index = 0; index < limit; index++) {
      if (elements[index].shadowRoot) hosts.push(elements[index]);
    }
    return hosts;
  }
  function scanRoots() {
    var roots = [];
    if (typeof document === 'undefined' || !document.querySelectorAll) return roots;
    roots.push(document);
    var frameCount = 0;
    var controlRoots = 0;
    // A host with no control of its own is still entered, because the form may sit one level
    // deeper, but it draws on a separate allowance: a page with dozens of icon components would
    // otherwise spend the whole budget before the form is reached and the scan would come back
    // empty without saying why.
    var emptyRoots = 0;
    for (var index = 0; index < roots.length; index++) {
      var root = roots[index];
      var frames = root.querySelectorAll('iframe, frame');
      for (var frameIndex = 0; frameIndex < frames.length && frameCount < MAX_FRAMES; frameIndex++) {
        var frame = frames[frameIndex];
        if (!isFrameVisible(frame)) continue;
        var inner = null;
        try { inner = frame.contentDocument; } catch (_) { inner = null; }
        if (inner && inner.querySelectorAll && inner.body && roots.indexOf(inner) < 0) { roots.push(inner); frameCount += 1; }
      }
      var hosts = shadowHosts(root);
      for (var hostIndex = 0; hostIndex < hosts.length; hostIndex++) {
        var shadow = hosts[hostIndex].shadowRoot;
        if (!shadow || !shadow.querySelectorAll || roots.indexOf(shadow) >= 0) continue;
        var carriesControl = false;
        try { carriesControl = Boolean(shadow.querySelector(CONTROL_SELECTOR)); } catch (_) {}
        if (carriesControl) {
          if (controlRoots >= MAX_SHADOW_ROOTS) continue;
          controlRoots += 1;
        } else {
          if (emptyRoots >= MAX_EMPTY_SHADOW_ROOTS) continue;
          emptyRoots += 1;
        }
        roots.push(shadow);
      }
    }
    return roots;
  }
  function queryControls(root) {
    if (!root || !root.querySelectorAll) return [];
    var controls = Array.prototype.slice.call(root.querySelectorAll(CONTROL_SELECTOR));
    // A div-based radio group carries no input at all (the library draws the circles itself), so
    // the group has to be scanned as the control. Groups that do have native inputs stay out:
    // those inputs are already in the list above and the native path fills them.
    Array.prototype.slice.call(root.querySelectorAll(CUSTOM_CHOICE_GROUP_SELECTOR)).forEach(function (group) {
      if (isCustomChoiceGroup(group)) controls.push(group);
    });
    return controls;
  }
  function controlSelector() { return CONTROL_SELECTOR; }
  function allControls() {
    var controls = [];
    scanRoots().forEach(function (root) { controls = controls.concat(queryControls(root)); });
    return controls;
  }
  // True when the control is actually rendered. An ancestor with display:none hides it, but
  // getComputedStyle on the descendant still reports its own display value, so the plain style
  // reads are not enough on their own. Options.ignoreOpacity is for radios and checkboxes,
  // whose real control is routinely an opacity:0 input with a drawn shape beside it.
  function isRendered(element, options) {
    if (!element) return false;
    var ignoreOpacity = Boolean(options && options.ignoreOpacity);
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkOpacity: !ignoreOpacity, checkVisibilityCSS: true, contentVisibilityAuto: true });
    }
    if (element.offsetParent === null) {
      var view = viewOf(element);
      var style = view && view.getComputedStyle ? view.getComputedStyle(element) : null;
      // offsetParent is also null for fixed positioning, where the element is on screen.
      if (!style || style.position !== 'fixed') return false;
      if (!ignoreOpacity && style.opacity === '0') return false;
    }
    return true;
  }
  function isChoiceControl(element) {
    var type = normalizeText(element && element.type);
    return type === 'radio' || type === 'checkbox';
  }
  function isVisible(element) {
    if (!element || element.disabled || element.hidden) return false;
    if (isRendered(element)) return true;
    return isChoiceControl(element) ? isRendered(element, { ignoreOpacity: true }) : false;
  }
  function cssEscape(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, function (char) { return '\\' + char; }); }
  function ancestorContextLabels(element) {
    if (!element) return [];
    var labels = [];
    var node = element.parentElement;
    var depth = 0;
    while (node && depth < 6) {
      var heading = node.querySelector && node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > .title, :scope > [class*="title"]');
      if (heading && !isGenericPrompt(textOf(heading))) labels.push(textOf(heading).trim());
      depth += 1;
      node = node.parentElement;
    }
    return labels;
  }
  function deriveLabel(element) {
    if (!element) return '';
    var container = nearestResumeContainer(element);
    if (container) {
      var containerLabel = findContainerLabel({
        containerTexts: [containerFieldLabel(container, element)],
        contextTexts: [containerSectionLabel(container)]
      });
      if (isUsableFieldLabel(containerLabel)) return containerLabel;
    }
    var id = element.id;
    if (id) {
      // The <label for> can sit in the same shadow root, or beside the host in the light DOM when
      // the control itself is inside one, so both roots are tried before falling back to text.
      var labelRoots = [documentOf(element), element.ownerDocument];
      for (var labelIndex = 0; labelIndex < labelRoots.length; labelIndex++) {
        var labelRoot = labelRoots[labelIndex];
        if (!labelRoot || !labelRoot.querySelector || labelRoot === labelRoots[0] && labelIndex > 0) continue;
        var associated = labelRoot.querySelector('label[for="' + cssEscape(id) + '"]');
        if (associated && !isGenericPrompt(textOf(associated))) return cleanFieldLabel(combineContextLabel(textOf(associated).trim(), ancestorContextLabels(element)));
      }
    }
    var label = element.closest && element.closest('label');
    if (label && !isGenericPrompt(textOf(label))) return cleanFieldLabel(combineContextLabel(textOf(label).trim(), ancestorContextLabels(element)));
    var attributes = ['aria-label', 'name', 'id', 'title', 'placeholder'];
    for (var i = 0; i < attributes.length; i++) { var attr = attributes[i]; if (element.getAttribute && element.getAttribute(attr)) { var value = element.getAttribute(attr).trim(); if (!isGenericPrompt(value)) return cleanFieldLabel(combineContextLabel(value, ancestorContextLabels(element))); } }
    var parent = element.parentElement;
    if (parent) {
      var own = Array.prototype.slice.call(parent.childNodes || []).filter(function (node) { return node !== element && node.nodeType === 3; }).map(function (node) { return node.textContent; }).join(' ').trim();
      if (own && !isGenericPrompt(own)) return cleanFieldLabel(combineContextLabel(own, ancestorContextLabels(element)));
    }
    return cleanFieldLabel(combineContextLabel('', ancestorContextLabels(element)));
  }
  function fieldAliases(key) {
    var short = String(key || '').split('.').pop().replace(/\[\d+\]$/, '').replace(/^\d+_/, '');
    return (ALIASES[short] || [DISPLAY_LABELS[short] || short]).map(normalizeText);
  }
  // Forms often annotate a label with its unit or a hint in brackets: 净身高(cm), 体重（kg）,
  // 英语等级(如CET-6). Dropping a trailing bracket lets those hit the plain wording.
  function withoutTrailingNote(text) {
    return String(text).replace(/[（(][^（()）]*[)）]\s*$/, '').trim();
  }
  // Sites qualify a column with the record it belongs to: 最高学历院校, 本科专业, 硕士导师.
  // Trying the wording without that prefix lets those reach the plain alias, without losing the
  // original: a bare 最高学历 still has to match 学历.
  var LEADING_QUALIFIER_RE = /^(最高学历|最高学位|第一学历|本科|研究生|硕士|博士|父亲|母亲|爸爸|妈妈|配偶|爱人|监护人|家庭成员|亲属|兄弟姐妹)/;
  function withoutLeadingQualifier(text) {
    var stripped = String(text).replace(LEADING_QUALIFIER_RE, '').trim();
    return stripped === String(text).trim() ? '' : stripped;
  }
  var CJK_RE = /[\u3400-\u9fff]/;
  function containsCjk(text) { return CJK_RE.test(String(text)); }
  function isLatinWordChar(ch) { return /[A-Za-z0-9]/.test(ch); }
  // Equal strings are handled before this runs. A latin alias must sit on a word boundary, or it
  // is matching inside an identifier rather than a wording: "gpa" inside "gpAbroad", "mail"
  // inside "mailingAddress", "name" inside "companyName". Chinese aliases need no such guard.
  function substringHit(haystack, needle) {
    var at = haystack.indexOf(needle);
    if (at < 0) return false;
    if (containsCjk(needle)) return true;
    var before = at === 0 ? '' : haystack.charAt(at - 1);
    var after = haystack.charAt(at + needle.length);
    return !isLatinWordChar(before) && !isLatinWordChar(after);
  }
  function labelVariants(label) {
    var seen = [];
    [label, withoutTrailingNote(label), withoutLeadingQualifier(label),
     withoutLeadingQualifier(withoutTrailingNote(label))].forEach(function (form) {
      var normalized = normalizeText(form);
      if (normalized && seen.indexOf(normalized) < 0) seen.push(normalized);
    });
    return seen;
  }
  function labelMatchStrength(label, key, extraAliases) {
    var normalized = normalizeText(label);
    if (!normalized) return 'none';
    var rawSegments = String(label).split(/\s+/).filter(Boolean);
    // Every segment, plus the same segment with its annotation removed. A single-segment label
    // is not segment-matched: variants.length > 1 below guards that.
    var variants = [];
    rawSegments.forEach(function (part) {
      labelVariants(part).forEach(function (form) { if (variants.indexOf(form) < 0) variants.push(form); });
      variants.push(normalizeText(part));
    });
    var wholeVariants = labelVariants(label);
    var aliases = fieldAliases(key).concat((extraAliases || []).map(normalizeText)).filter(Boolean);
    if (aliases.some(function (alias) { return wholeVariants.indexOf(alias) >= 0; })) return 'exact';
    if (variants.length > 1 && variants.some(function (variant) { return aliases.indexOf(variant) >= 0; })) return 'exact';
    if (aliases.some(function (alias) {
      return wholeVariants.some(function (variant) {
        if (variant.indexOf(alias) >= 0) return substringHit(variant, alias);
        if (alias.indexOf(variant) >= 0) return substringHit(alias, variant);
        return false;
      });
    })) return 'partial';
    return 'none';
  }
  function aliasMatches(label, key, extraAliases) {
    return labelMatchStrength(label, key, extraAliases) !== 'none';
  }
  function getSiteKey(context) { if (context && context.siteKey) return String(context.siteKey); if (typeof location !== 'undefined' && location.origin) return location.origin; return ''; }
  function makeFingerprint(control, label) { var type = normalizeText(control && (control.type || control.tagName || 'field')) || 'field'; var stable = control && (control.name || control.id || control.getAttribute && control.getAttribute('aria-label') || label || 'field'); return type + ':' + normalizeText(stable); }
  function isSensitiveField(controlLike) { var type = normalizeText(controlLike && controlLike.type); var text = [controlLike && controlLike.label, controlLike && controlLike.name, controlLike && controlLike.id, controlLike && controlLike.placeholder].filter(Boolean).join(' '); return type === 'password' || type === 'file' || SENSITIVE_RE.test(text); }
  function siteMappingMatches(mapping, siteKey, fingerprint, label) { if (!mapping || String(mapping.site_key || '') !== String(siteKey || '')) return false; if (mapping.fingerprint && String(mapping.fingerprint) === String(fingerprint)) return true; if (mapping.selector_hint && String(mapping.selector_hint) === String(fingerprint)) return true; return Boolean(mapping.label && normalizeText(mapping.label) === normalizeText(label)); }
  // 父亲姓名, 母亲联系电话, 亲属工作单位 …: an attribute of somebody else. Answering those with
  // the applicant's own name or phone would put wrong data on a form, so they are left unmatched
  // unless the field really is a relative's.
  var RELATIVE_ATTRIBUTE_RE = /(父亲|母亲|爸爸|妈妈|配偶|爱人|监护人|亲属|家庭成员|兄弟姐妹)(的)?\s*(联系电话|联系方式|工作单位|手机号码|姓名|名字|电话|手机|单位|职务|职位|关系)/;
  function isRelativeField(profileKey) {
    var key = String(profileKey || '');
    return key.indexOf('family') === 0 || key.indexOf('relatives') >= 0 || key.indexOf('emergency') >= 0 || key.indexOf('siblings') >= 0;
  }
  function profileLabelStrength(item, label, learned) {
    if (!item || !isUsableFieldLabel(label)) return 'none';
    if (RELATIVE_ATTRIBUTE_RE.test(String(label)) && !isRelativeField(item.profileKey)) return 'none';
    if (learnedMatch(learned, label, item.profileKey)) return 'exact';
    var profileKey = String(item.profileKey || '');
    var sectionKey = profileKey.replace(/\.\d+\./, '.');
    var normalizedLabel = normalizeText(label);
    var category = normalizeText(item.categoryValue || '');
    if (sectionKey.indexOf('skills.') === 0) {
      if (/(英语|外语|语言)/.test(normalizedLabel) && category && !/(英语|外语|语言)/.test(category)) return 'none';
      if (/(计算机|电脑)/.test(normalizedLabel) && category && !/(计算机|电脑)/.test(category)) return 'none';
      if (/(证书名称)/.test(normalizedLabel) && category && !/(英语|外语|语言|计算机|电脑)/.test(category)) return 'none';
      if (/(专业技能)/.test(normalizedLabel) && category && /(英语|外语|语言)/.test(category)) return 'none';
    }
    // A leaf keyed "name" under 荣誉/项目/活动 is not a person's name. Where a section defines
    // its own wording, use only that: it stops the leaf inheriting the generic aliases of its
    // key, which would otherwise let a project title match a 姓名 field.
    var contextAliases = CONTEXT_LABELS[sectionKey];
    var scoped = Boolean(contextAliases);
    var aliases = (item.aliases || []).concat(
      [item.label || '', scoped ? '' : (DISPLAY_LABELS[profileKey.split('.').pop()] || '')],
      contextAliases || []
    );
    return labelMatchStrength(label, scoped ? '' : item.profileKey, aliases);
  }
  // A label the user has already confirmed on some page, mapped to the field it meant.
  // Stored globally rather than per site: recruitment sites share vocabulary, so teaching
  // "意向岗位" once should count everywhere.
  function leafProfileKey(profileKey) {
    return String(profileKey == null ? '' : profileKey).replace(/\.\d+\./g, '.');
  }
  function buildLearnedMap(entries) {
    var map = Object.create(null);
    (entries || []).forEach(function (entry) {
      if (!entry) return;
      var label = normalizeText(entry.label);
      var key = leafProfileKey(entry.profile_key);
      if (!label || !key) return;
      if (!map[label]) map[label] = [];
      if (map[label].indexOf(key) < 0) map[label].push(key);
    });
    return map;
  }
  function findLearnedValue(label, values, used, learned) {
    if (!learned) return null;
    var keys = learned[normalizeText(label)];
    if (!keys || !keys.length) return null;
    return values.find(function (item) {
      return !used[item.profileKey] && item.value && keys.indexOf(leafProfileKey(item.profileKey)) >= 0;
    }) || null;
  }
  function learnedMatch(learned, label, profileKey) {
    if (!learned) return false;
    var keys = learned[normalizeText(label)];
    return Boolean(keys && keys.indexOf(leafProfileKey(profileKey)) >= 0);
  }
  function valueMatchesLabel(item, label, learned) {
    if (learned && item && learnedMatch(learned, label, item.profileKey)) return true;
    return profileLabelStrength(item, label) !== 'none';
  }
  function fieldConfidence(match, mapping, label, matchLabel, learned) {
    if (mapping) return 'high';
    if (!match) return 'none';
    if (profileLabelStrength(match, label, learned) === 'exact') return 'high';
    if (profileLabelStrength(match, matchLabel, learned) === 'exact') return 'high';
    return 'medium';
  }
  function flattenProfile(profile) {
    var values = [];
    function add(prefix, value, label, aliases) {
      if (value == null || value === '' || isPlaceholderValue(value)) return;
      if (Array.isArray(value)) return value.forEach(function (item, index) { add(prefix + '.' + (index + 1), item, label, aliases); });
      if (typeof value === 'object') return Object.keys(value).forEach(function (key) { if (key === 'extras' || key === 'site_mappings' || key === 'site_drafts' || key === 'label_mappings') return; var contextKey = prefix.split('.')[0] + '.' + key; var display = (CONTEXT_LABELS[contextKey] || [])[0] || DISPLAY_LABELS[key] || (key === 'courses' ? '课程' : key); add(prefix ? prefix + '.' + key : key, value[key], display, aliases); });
      values.push({ profileKey: prefix, value: String(value), label: label || prefix, aliases: aliases || [] });
    }
    Object.keys(profile || {}).forEach(function (section) {
      if (section === 'extras' || section === 'site_mappings' || section === 'site_drafts' || section === 'label_mappings') return;
      var value = profile[section];
      if (section === 'custom_fields') (value || []).forEach(function (item, index) { if (item && item.key) values.push({ profileKey: 'custom_fields.' + (index + 1), value: String(item.value || ''), label: item.label || item.key, aliases: item.aliases || [] }); });
      else if (section === 'self_evaluation' && value) add(section, value, '自我评价');
      else if (Array.isArray(value)) value.forEach(function (record, index) {
        var before = values.length;
        add(section + '.' + (index + 1), record, section);
        if (section === 'skills' && record && record.category) for (var offset = before; offset < values.length; offset++) values[offset].categoryValue = record.category;
        if (section === 'employment' && record && Array.isArray(record.duties) && record.duties.length) {
          var combinedDuties = record.duties.map(function (d) { return String(d || '').trim(); }).filter(Boolean).join('\n');
          if (combinedDuties) {
            values.push({ profileKey: 'employment.' + (index + 1) + '.duties', value: combinedDuties, label: '工作内容', aliases: ['工作内容', '工作职责', '岗位职责', '主要职责'] });
            if (!record.description) {
              values.push({ profileKey: 'employment.' + (index + 1) + '.description', value: combinedDuties, label: '工作内容', aliases: ['工作内容', '工作职责', '岗位职责', '主要职责'] });
            }
          }
        }
      });
      else if (typeof value === 'object') add(section, value, section);
      else add(section, value, section);
    });
    return values;
  }
  var OPTION_SUFFIX_RE = /(及以上|及以下|以上|以下|不限|均可|任意|优先|左右|之间)$/g;
  var OPTION_STOPWORDS = ['及以上', '及以下', '以上', '以下', '之间', '不限', '均可', '任意', '优先', '其中', '其他', '其它', '或', '及', '和', '与'];
  function stripOptionSuffix(value) { return normalizeText(value).replace(OPTION_SUFFIX_RE, ''); }
  function optionTokens(value) {
    return stripOptionSuffix(value).replace(/[（(][^（）()]*[)）]/g, '').split(/[\s·・,，、_\-/]+/).filter(function (token) { return token && token.length >= 2 && OPTION_STOPWORDS.indexOf(token) < 0; });
  }
  function tokensCover(allTokens, neededTokens) {
    return neededTokens.every(function (needed) { return allTokens.some(function (available) { return available.indexOf(needed) >= 0 || needed.indexOf(available) >= 0; }); });
  }
  var ENUM_SYNONYMS = [
    // 英语等级 (CET/TEM/IELTS/TOEFL)
    ['大学英语六级', '英语六级', '六级', 'cet6', 'cet-6', 'cet 6'],
    ['大学英语四级', '英语四级', '四级', 'cet4', 'cet-4', 'cet 4'],
    ['专业八级', '英语专业八级', '专八', 'tem8', 'tem-8', 'tem 8'],
    ['专业四级', '英语专业四级', '专四', 'tem4', 'tem-4', 'tem 4'],
    ['雅思', 'ielts'],
    ['托福', 'toefl'],
    // 性别
    ['男', '男性', 'male', 'm'],
    ['女', '女性', 'female', 'f'],
    // 学历 / 层次
    ['博士研究生', '博士', '博士生', 'doctor', 'phd'],
    ['硕士研究生', '硕士', '硕士生', '研究生', 'master'],
    ['大学本科', '本科', '学士', 'bachelor'],
    ['大学专科', '专科', '大专', '高职高专'],
    // 证件类型
    ['居民身份证', '身份证', '二代身份证', '二代居民身份证', '中国居民身份证'],
    ['护照', '中国护照'],
    ['港澳居民来往内地通行证', '港澳台居民居住证', '回乡证', '港澳通行证'],
    ['台湾居民来往大陆通行证', '台胞证'],
    // 政治面貌
    ['中共党员', '党员', '中共党员含预备党员', '预备党员', '中共预备党员'],
    ['共青团员', '团员', '共青团员团员'],
    ['群众', '普通群众'],
    // 婚姻与家庭
    ['未婚', '单身'],
    ['已婚', '已婚已育', '已婚未育'],
    // 是非 / 布尔选项
    ['无', '否', '没有', 'false', 'no', '0'],
    ['有', '是', 'true', 'yes', '1'],
    // 学习形式 / 培养方式 / 招聘类型
    ['全日制', '统招全日制', '普通全日制'],
    ['非全日制', '在职'],
    ['应届生', '应届毕业生', '应届'],
    ['往届生', '往届毕业生', '往届', '社会人员', '历届生'],
    // 手机区号
    ['+86', '86', '中国大陆+86', '中国大陆', '中国+86']
  ];

  function enumSynonymsFor(target) {
    if (!target) return [];
    var t = normalizeText(target);
    var result = [];
    for (var i = 0; i < ENUM_SYNONYMS.length; i++) {
      var group = ENUM_SYNONYMS[i];
      var hit = false;
      for (var j = 0; j < group.length; j++) {
        var syn = normalizeText(group[j]);
        if (t === syn) { hit = true; break; }
        if (syn.length >= 2 && t.indexOf(syn) >= 0) { hit = true; break; }
        if (t.length >= 2 && syn.indexOf(t) >= 0) { hit = true; break; }
        if ((syn === '男' && (t === '男' || t === '男性' || t === 'male' || t === 'm')) ||
            (syn === '女' && (t === '女' || t === '女性' || t === 'female' || t === 'f')) ||
            (syn === '无' && (t === '无' || t === '否' || t === '没有')) ||
            (syn === '有' && (t === '有' || t === '是'))) {
          hit = true;
          break;
        }
      }
      if (hit) {
        group.forEach(function (w) {
          var nw = normalizeText(w);
          if (result.indexOf(nw) < 0) result.push(nw);
        });
      }
    }
    return result;
  }

  function matchSelectOption(options, expected) {
    var target = normalizeText(expected); if (!target) return -1;
    for (var i = 0; i < options.length; i++) if (normalizeText(textOf(options[i])) === target || normalizeText(options[i].value) === target) return i;
    for (var j = 0; j < options.length; j++) { var candidate = normalizeText(textOf(options[j])); if (candidate && (candidate.indexOf(target) >= 0 || target.indexOf(candidate) >= 0)) return j; }
    var targetStripped = stripOptionSuffix(target); if (targetStripped && targetStripped !== target) {
      for (var k = 0; k < options.length; k++) { var stripped = stripOptionSuffix(textOf(options[k])); if (stripped && (stripped === targetStripped || stripped.indexOf(targetStripped) >= 0 || targetStripped.indexOf(stripped) >= 0)) return k; }
    }
    var synonyms = enumSynonymsFor(target);
    if (synonyms.length) {
      for (var s = 0; s < options.length; s++) {
        var optText = normalizeText(textOf(options[s]));
        var optVal = normalizeText(options[s] && options[s].value);
        for (var si = 0; si < synonyms.length; si++) {
          var syn = synonyms[si];
          if (optText === syn || optVal === syn) return s;
          if (optText && (optText.indexOf(syn) >= 0 || syn.indexOf(optText) >= 0)) return s;
        }
      }
    }
    var needed = optionTokens(target); if (!needed.length) return -1;
    for (var m = 0; m < options.length; m++) { var candidateTokens = optionTokens(textOf(options[m])); if (candidateTokens.length && candidateTokens.length <= needed.length * 3 && tokensCover(candidateTokens, needed)) return m; }
    return -1;
  }
  function matchChoice(choices, expected) { return matchSelectOption(choices.map(function (choice) { return { value: choice.value, text: textOf(choice) || choice.value }; }), expected); }
  function isSubmitLike(control) { var type = normalizeText(control && control.type); var text = normalizeText(control && (control.text || control.label || control.value || (isEditableControl(control) ? '' : textOf(control)))); return ['submit', 'reset', 'image'].indexOf(type) >= 0 || /(提交|保存|下一步|下一页|确认|投递|上传|submit|save|next|apply|upload)/i.test(text); }
  function findProfileValue(label, values, used, learned) {
    var candidates = [];
    (values || []).forEach(function (item) {
      if (!item || used[item.profileKey] || !item.value) return;
      var strength = profileLabelStrength(item, label, learned);
      if (strength === 'none') return;
      candidates.push({ item: item, exact: strength === 'exact', ownLabel: normalizeText(label) === normalizeText(item.label) });
    });
    if (!candidates.length) return null;
    // Strongest match first; the field whose own label is the page label breaks ties.
    candidates.sort(function (a, b) {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (a.ownLabel !== b.ownLabel) return a.ownLabel ? -1 : 1;
      return 0;
    });
    return candidates[0].item;
  }
  function findDraft(profile, siteKey, fingerprint, profileKey) { return (profile && profile.site_drafts || []).find(function (draft) { return String(draft.site_key || '') === String(siteKey || '') && String(draft.fingerprint || '') === String(fingerprint || '') && (!profileKey || String(draft.profile_key || '') === String(profileKey)); }) || null; }
  function isDateField(control, label) {
    if (!control) return false;
    var type = normalizeText(control.type);
    if (type === 'date' || type === 'month' || type === 'time') return true;
    var text = normalizeText([label, control.placeholder, control.name, control.id, control.getAttribute && control.getAttribute('aria-label')].filter(Boolean).join(' '));
    return /(日期|年月|生日|出生|毕业|入学|起始|结束|到岗|date|birth|yearmonth)/i.test(text);
  }
  function parseDateParts(value) {
    var match = String(value == null ? '' : value).trim().match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
    if (!match) return null;
    return { year: match[1], month: String(Number(match[2])).padStart(2, '0'), day: match[3] ? String(Number(match[3])).padStart(2, '0') : '' };
  }
  function isDateComponentLabel(label) {
    var raw = String(label == null ? '' : label).toLowerCase();
    return /(?:^|[\s:_-])(年|月|日|year|month|day)(?:$|[\s:_-])/.test(raw) || /(?:年|月|日)$/.test(raw);
  }
  function dateComponentValue(value, label) {
    var parts = parseDateParts(value);
    if (!parts) return '';
    var text = String(label == null ? '' : label).toLowerCase();
    var year = /(?:^|[\s:_-])(?:年|year)(?:$|[\s:_-])/.test(text) || /年$/.test(text);
    var month = /(?:^|[\s:_-])(?:月|month)(?:$|[\s:_-])/.test(text) || /月$/.test(text);
    var day = /(?:^|[\s:_-])(?:日|day)(?:$|[\s:_-])/.test(text) || /日$/.test(text);
    if (Number(year) + Number(month) + Number(day) !== 1) return String(value == null ? '' : value).trim();
    if (year) return parts.year;
    if (month) return parts.month;
    return parts.day;
  }
  function matchDateSelectOption(options, expected) {
    var index = matchSelectOption(options, expected);
    if (index >= 0) return index;
    var target = String(expected == null ? '' : expected).trim();
    if (!/^\d+$/.test(target)) return -1;
    var numeric = String(Number(target));
    for (var i = 0; i < options.length; i++) {
      var text = textOf(options[i]).trim();
      var value = String(options[i] && options[i].value || '').trim();
      if (text === numeric || value === numeric || (/^\d+$/.test(text) && String(Number(text)) === numeric) || (/^\d+$/.test(value) && String(Number(value)) === numeric)) return i;
    }
    return -1;
  }
  function expectedFieldValue(value, label) {
    return isDateComponentLabel(label) ? dateComponentValue(value, label) : String(value == null ? '' : value).trim();
  }
  function choiceGroupItems(control) {
    if (!control || (control.type !== 'radio' && control.type !== 'checkbox')) return [];
    var ownerDocument = documentOf(control);
    if (!ownerDocument) return [];
    var sameType = Array.prototype.slice.call(ownerDocument.querySelectorAll('input[type="' + control.type + '"]')).filter(function (item) { return !item.disabled && isVisible(item); });
    var byName = control.name ? sameType.filter(function (item) { return item.name === control.name; }) : [];
    if (byName.length) return byName;
    // Name-less radios: every option of the same question shares one container, so read the
    // group from there. Without it only the scanned option is known and picking any other
    // value (性别 女 when 男 was scanned) fails.
    if (control.type === 'radio') {
      var scope = scopedFieldContainer(control) || (control.closest && control.closest('fieldset'));
      if (scope) {
        var scoped = sameType.filter(function (item) { return scope.contains(item); });
        if (scoped.length) return scoped;
      }
    }
    return [control];
  }
  // A radio or checkbox inside a form item is labelled by the group ("可实习时间"), while the
  // option text the user picks is the immediate label ("周一"). Keep both roles apart.
  function choiceText(control) {
    var label = control && control.closest && control.closest('label');
    var text = cleanFieldLabel(textOf(label));
    if (isUsableFieldLabel(text)) return text;
    // Not wrapped in a <label>: the option text usually sits in the item next to the input.
    var holder = control && control.closest && control.closest('.ant-radio-wrapper, .ant-checkbox-wrapper, .el-radio, .el-checkbox, [class*="radio-item"], [class*="checkbox-item"]');
    var holderText = cleanFieldLabel(textOf(holder));
    if (isUsableFieldLabel(holderText)) return holderText;
    return cleanFieldLabel(deriveLabel(control));
  }
  // Wording that sits next to the control itself, for options that carry no label: the nearest
  // label element, the text of the immediate parent with the control's own text removed, or the
  // value attribute. Returns '' when nothing usable is found.
  function nearbyChoiceText(control) {
    if (!control) return '';
    var label = control.closest && control.closest('label');
    var fromLabel = cleanFieldLabel(textOf(label));
    if (isUsableFieldLabel(fromLabel)) return fromLabel;
    var parent = control.parentElement;
    if (parent) {
      var own = Array.prototype.slice.call(parent.childNodes || []).filter(function (node) {
        return node.nodeType === 3 || (node.nodeType === 1 && node !== control && !node.contains(control));
      }).map(function (node) { return node.textContent; }).join(' ').trim();
      var cleaned = cleanFieldLabel(own);
      if (isUsableFieldLabel(cleaned)) return cleaned;
    }
    return '';
  }
  function choiceItems(group) {
    var controls = group || [];
    var items = controls.map(function (item) { return { value: item.value, text: choiceText(item) || item.value }; });
    // Every option reporting the same wording means they all fell back to the group label, so
    // none of them can be told apart. Read the option wording instead.
    var allSame = items.length > 1 && items.every(function (item) { return item.text === items[0].text; });
    if (allSame) {
      return controls.map(function (item) {
        return { value: item.value, text: nearbyChoiceText(item) || item.value };
      });
    }
    return items;
  }
  // Some libraries draw the radio circles and checkbox squares themselves and keep the state in a
  // class, with no input anywhere for a scan to find. The group is then the control and its option
  // rows are the elements to click.
  // Token matches, not substrings: phoenix-radio-group__radioItem contains "radio-group" and would
  // otherwise be taken for a group of its own, adding a duplicate candidate per option.
  var CUSTOM_CHOICE_GROUP_SELECTOR = '[class~="phoenix-radio-group"], [class~="phoenix-checkbox-group"], [class~="radio-group"], [class~="checkbox-group"], [role="radiogroup"]';
  var CUSTOM_CHOICE_OPTION_SELECTOR = '[class~="phoenix-radio"], [class~="phoenix-checkbox"], [role="radio"], [role="checkbox"]';
  var CUSTOM_CHOICE_CHECKED_RE = /(^|[\s_-])(is-)?checked($|[\s_-])/;
  function customChoiceRows(group) {
    if (!group || !group.querySelectorAll) return [];
    return Array.prototype.slice.call(group.querySelectorAll(CUSTOM_CHOICE_OPTION_SELECTOR))
      .filter(function (row) { return !row.querySelector(CUSTOM_CHOICE_OPTION_SELECTOR); })
      // A nested group is a control of its own. Without this, an outer group would collect the rows
      // of every question inside it and read them as one field's options.
      // A nested group is a control of its own. The look-up starts from the parent because an option
      // row's own class name often contains the group's token (phoenix-radio-group__radio), which
      // would otherwise make the row look like the group it belongs to.
      .filter(function (row) {
        var owner = row.parentElement && row.parentElement.closest ? row.parentElement.closest(CUSTOM_CHOICE_GROUP_SELECTOR) : null;
        return !owner || owner === group;
      })
      // The wording can sit beside the drawn box rather than inside the row that carries the state.
      .filter(function (row) { return normalizeText(customChoiceText(row)) !== ''; });
  }
  function customChoiceText(row) {
    return cleanFieldLabel(nearbyChoiceText(row) || textOf(row));
  }
  // A group that carries native inputs is left alone: those inputs are scanned on their own, and
  // handling the group here as well would fill every option twice.
  function isCustomChoiceGroup(element) {
    if (!element || !element.matches || !element.querySelectorAll) return false;
    if (!element.matches(CUSTOM_CHOICE_GROUP_SELECTOR)) return false;
    if (element.querySelector('input[type="radio"], input[type="checkbox"]')) return false;
    return customChoiceRows(element).length > 0;
  }
  function customChoiceItems(group) {
    return customChoiceRows(group).map(function (row) {
      var text = customChoiceText(row);
      return { value: text, text: text, element: row };
    });
  }
  function customChoiceSelected(row) {
    if (!row) return false;
    if (row.getAttribute && row.getAttribute('aria-checked') === 'true') return true;
    return CUSTOM_CHOICE_CHECKED_RE.test(String(row.className || ''));
  }
  function customChoiceValue(group) {
    return customChoiceItems(group).filter(function (item) { return customChoiceSelected(item.element); })
      .map(function (item) { return item.text; }).join('、');
  }
  function clickCustomChoice(row) {
    if (!row) return false;
    if (typeof row.click === 'function') { try { row.click(); return true; } catch (_) {} }
    dispatchOpenSequence(row);
    return true;
  }
  function previewCustomChoice(group, expected) {
    var items = customChoiceItems(group);
    var indexes = matchChoiceIndexes(items, expected);
    if (!indexes.length) return null;
    return indexes.map(function (index) { return items[index].text; }).join('、');
  }
  // The state of a div-drawn group lives on its rows, and a component may re-render those rows at
  // any moment, so the row is looked up by its wording every time rather than holding on to a node
  // that may already be detached.
  function customChoiceState(control, text) {
    var live = customChoiceItems(control).filter(function (item) { return item.text === text; });
    return customChoiceSelected(live.length ? live[0].element : null);
  }
  async function fillCustomChoice(control, field) {
    var items = customChoiceItems(control);
    var chosen = matchChoiceIndexes(items, field.proposedValue);
    // A lone box drawn as a div ("我已阅读并同意") is a yes/no rather than a list of options.
    var wanted = items.length === 1 ? booleanChoice(field.proposedValue) : null;
    var unchecking = false;
    if (!chosen.length && wanted === true) chosen = [0];
    if (!chosen.length && wanted === false) unchecking = true;
    if (!chosen.length && !unchecking) return { id: field.id, status: 'failed', reason: '选项没有精确匹配项' };
    var labels = chosen.map(function (rowIndex) { return items[rowIndex].text; });
    if (unchecking && customChoiceSelected(items[0].element)) clickCustomChoice(items[0].element);
    function settled() {
      if (unchecking) return customChoiceState(control, items[0].text) ? null : true;
      if (!labels.length) return true;
      return labels.every(function (text) { return customChoiceState(control, text); }) ? true : null;
    }
    var applied = await waitFor(settled, 800);
    if (!applied) {
      // Some libraries only commit on the pointer sequence, not on a plain click().
      chosen.forEach(function (rowIndex) { dispatchOpenSequence(items[rowIndex].element); });
      applied = await waitFor(settled, 800);
    }
    if (!applied) return { id: field.id, status: 'failed', reason: '点了选项，页面没有确认这次选择' };
    return { id: field.id, status: 'filled' };
  }
  function choiceTokens(value) {
    return String(value == null ? '' : value).split(/[、,，;；|\/]+/).map(function (token) { return token.trim(); }).filter(Boolean);
  }
  function matchChoiceIndexes(items, expected) {
    var tokens = choiceTokens(expected);
    if (tokens.length > 1) {
      var indexes = [];
      tokens.forEach(function (token) { var index = matchChoice(items, token); if (index >= 0 && indexes.indexOf(index) < 0) indexes.push(index); });
      if (indexes.length === tokens.length) return indexes;
    }
    var whole = matchChoice(items, expected);
    return whole >= 0 ? [whole] : [];
  }
  var CHOICE_TRUE_RE = /^(是|有|同意|接受|服从|可以|能|愿意|true|yes|y|1|√|ok)$/;
  var CHOICE_FALSE_RE = /^(否|没有|不同意|不接受|不服从|不可以|不能|不愿意|false|no|n|0|×|x)$/;
  function booleanChoice(expected) {
    var normalized = normalizeText(expected);
    if (CHOICE_TRUE_RE.test(normalized)) return true;
    if (CHOICE_FALSE_RE.test(normalized)) return false;
    return null;
  }
  function previewChoice(control, expected) {
    var group = choiceGroupItems(control);
    if (!group.length) return null;
    var items = choiceItems(group);
    var indexes = matchChoiceIndexes(items, expected);
    if (indexes.length) return indexes.map(function (index) { return items[index].text || items[index].value; }).join('、');
    if (group.length === 1 && booleanChoice(expected) !== null) return String(expected == null ? '' : expected).trim();
    return null;
  }
  function previewSelect(control, expected) {
    var optionIndex = matchSelectOption(Array.prototype.slice.call(control.options), expected);
    return optionIndex < 0 ? null : textOf(control.options[optionIndex]) || control.options[optionIndex].value || expected;
  }
  function scan(profile, context) {
    if (typeof document === 'undefined') return [];
    context = context || {}; var siteKey = getSiteKey(context); var values = flattenProfile(profile); var used = Object.create(null); var mappings = context.mappings || profile.site_mappings || []; var learned = buildLearnedMap(profile && profile.label_mappings);
    var controls = allControls().filter(isScannableControl);
    controls = dedupeControlDescriptors(controls);
    return dedupeFieldDescriptors(controls.filter(function (control) { return isCustomChoiceGroup(control) || !isSubmitLike(control); }).map(function (control, index) {
      var label = cleanFieldLabel(deriveLabel(control)); var fingerprint = makeFingerprint(control, label); var sensitive = isSensitiveField({ type: control.type || control.tagName, label: label, name: control.name, id: control.id, placeholder: control.placeholder });
      var mapping = mappings.find(function (item) { return siteMappingMatches(item, siteKey, fingerprint, label); }); var match = mapping ? values.find(function (item) { return item.profileKey === mapping.profile_key; }) : null;
      var matchLabel = [label, control.name || '', control.id || '', control.getAttribute && control.getAttribute('aria-label') || ''].filter(Boolean).join(' '); if (!match) match = findLearnedValue(label, values, used, learned);
      if (!match) match = findProfileValue(matchLabel, values, used, learned);
      var currentValue = isCustomChoiceGroup(control) ? customChoiceValue(control) : isCustomSelectControl(control) ? customControlValue(control) : isEditableControl(control) ? textOf(control).trim() : control.value || '';
      var draft = mapping && findDraft(profile, siteKey, fingerprint, mapping.profile_key); var sourceValue = draft ? draft.value : match ? match.value : currentValue; var isNewField = !match; var confidence = fieldConfidence(match, mapping, label, matchLabel, learned);
      if (match && confidence === 'high' && !isDateComponentLabel(label)) used[match.profileKey] = true;
      var proposed = sourceValue;
      if (sourceValue) {
        if (control.tagName.toLowerCase() === 'select') {
          var dateExpected = expectedFieldValue(sourceValue, label);
          proposed = (isDateComponentLabel(label) ? matchDateSelectOption(Array.prototype.slice.call(control.options), dateExpected) : matchSelectOption(Array.prototype.slice.call(control.options), dateExpected)) >= 0 ? dateExpected : '';
          if (!isDateComponentLabel(label)) proposed = previewSelect(control, sourceValue) || '';
        } else if (isCustomSelectControl(control) && isDateComponentLabel(label)) {
          proposed = expectedFieldValue(sourceValue, label);
        }
        else if (control.type === 'radio' || control.type === 'checkbox') proposed = previewChoice(control, sourceValue) || sourceValue;
        else if (isCustomChoiceGroup(control)) proposed = previewCustomChoice(control, sourceValue) || sourceValue;
      }
      return { id: 'resume-field-' + index, controlType: isEditableControl(control) ? 'contenteditable' : control.tagName ? control.tagName.toLowerCase() : 'custom', label: label || '未标注字段', selectorHint: control.id ? '#' + cssEscape(control.id) : null, profileKey: match ? match.profileKey : null, confidence: confidence, currentValue: currentValue, proposedValue: proposed, isNewField: isNewField || !isUsableFieldLabel(label), fingerprint: fingerprint, siteKey: siteKey, sensitive: sensitive, remember: Boolean(mapping && mapping.confirmed), isDate: isDateField(control, label), name: control.name || '' };
    }).filter(shouldIncludeCandidate));
  }
  function isLiveControl(control) { return Boolean(control) && (typeof control.isConnected === 'undefined' || control.isConnected); }
  function controlIndex() {
    var index = { bySelector: Object.create(null), byFingerprint: Object.create(null), byLabel: Object.create(null) };
    allControls().filter(isScannableControl).forEach(function (control) {
      var label = cleanFieldLabel(deriveLabel(control));
      var fingerprint = makeFingerprint(control, label);
      if (!index.byFingerprint[fingerprint]) index.byFingerprint[fingerprint] = control;
      var normalizedLabel = normalizeText(label);
      if (normalizedLabel && !index.byLabel[normalizedLabel]) index.byLabel[normalizedLabel] = control;
      if (control.id) { var selector = '#' + cssEscape(control.id); if (!index.bySelector[selector]) index.bySelector[selector] = control; }
    });
    return index;
  }
  function resolveField(field, index) {
    if (typeof document === 'undefined' || !field) return null;
    if (index) {
      var selected = field.selectorHint ? index.bySelector[field.selectorHint] : null;
      if (isLiveControl(selected) && (!field.fingerprint || makeFingerprint(selected, cleanFieldLabel(deriveLabel(selected))) === field.fingerprint)) return selected;
      var byFingerprint = field.fingerprint ? index.byFingerprint[field.fingerprint] : null;
      if (isLiveControl(byFingerprint)) return byFingerprint;
      var byLabel = field.label ? index.byLabel[normalizeText(field.label)] : null;
      if (isLiveControl(byLabel)) return byLabel;
      if (isLiveControl(selected)) return selected;
    }
    if (field.selectorHint) {
      var roots = scanRoots();
      for (var rootIndex = 0; rootIndex < roots.length; rootIndex++) {
        try {
          var found = roots[rootIndex].querySelector(field.selectorHint);
          if (found) return found;
        } catch (_) {}
      }
    }
    return allControls().find(function (control) { return isScannableControl(control) && (normalizeText(deriveLabel(control)) === normalizeText(field.label) || makeFingerprint(control, deriveLabel(control)) === field.fingerprint); });
  }
  function emitChange(control) {
    var view = viewOf(control);
    var EventCtor = view && view.Event ? view.Event : (typeof Event !== 'undefined' ? Event : null);
    if (!EventCtor) return;
    ['input', 'change', 'blur'].forEach(function (type) { control.dispatchEvent(new EventCtor(type, { bubbles: true })); });
  }
  function setNativeValue(control, value) {
    if (!control) return false;
    var tagName = String(control.tagName || '').toLowerCase();
    var view = viewOf(control);
    var proto = tagName === 'textarea' ? view && view.HTMLTextAreaElement && view.HTMLTextAreaElement.prototype
      : tagName === 'input' ? view && view.HTMLInputElement && view.HTMLInputElement.prototype : null;
    var descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    if (descriptor && descriptor.set) {
      try { descriptor.set.call(control, value); } catch (_) { control.value = value; }
    } else control.value = value;
    emitChange(control);
    return true;
  }
  // React and Vue keep their own model for radios and checkboxes and commit on the click
  // event, so assigning .checked alone leaves the framework state untouched. A real click also
  // unchecks the rest of a native radio group. The assignment is the fallback for libraries
  // that swallow the click with preventDefault.
  function setChoiceChecked(control, checked) {
    if (!control) return;
    if (control.checked === checked) return;
    if (typeof control.click === 'function') {
      control.click();
      if (control.checked === checked) return;
    }
    control.checked = checked;
    emitChange(control);
  }
  function waitFor(condition, timeoutMs) {
    var started = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        try { var value = condition(); if (value) { resolve(value); return; } } catch (_) {}
        if (Date.now() - started >= (timeoutMs || 800)) { resolve(null); return; }
        setTimeout(poll, 50);
      })();
    });
  }
  // Option rows across libraries: role=option and data-value are the standard hooks, the
  // class checks cover the ones that render plain divs. A row is skipped when it merely wraps
  // another option row, so option groups do not shadow their own children.
  function optionItems(root) {
    if (!root || !root.querySelectorAll) return [];
    return Array.prototype.slice.call(root.querySelectorAll('[role="option"], [class~="phoenix-selectList__listItem"], li, [data-value], [class*="option"], [class*="select-item"], [class*="menu-item"]'))
      .filter(isVisible)
      // The select's own value row is an <li> as well. Reading it as an option would make the
      // current value look like something that can be picked from a menu.
      .filter(function (item) { return !(item.closest && item.closest('.phoenix-select__inputWrapper')); })
      .filter(function (item) {
        if (item.querySelector && item.querySelector('[role="option"], [class*="option"], [class~="phoenix-selectList__listItem"]')) return false;
        return normalizeText(textOf(item)) !== '' || (item.getAttribute && item.getAttribute('role') === 'option');
      });
  }
  // Only containers that actually float count as a dropdown. A static wrapper whose class
  // happens to contain "dropdown" is part of the page, not a menu that just opened.
  var POPUP_CONTAINER_SELECTOR = '.ant-select-dropdown:not(.ant-select-dropdown-hidden), .el-select-dropdown, .el-select-dropdown__wrap, .ivu-select-dropdown, .n-select-menu, .arco-select-popup, .t-select__dropdown, .semi-select-option-list, .phoenix-selectList, [class*="phoenix-selectList"], [role="listbox"], [class*="select-dropdown"], [class*="select-menu"], [class*="select-options"], [class*="dropdown"], [class*="popper"], [class*="popup"]';
  // A library menu root is a popup by definition. The position test below cannot be relied on for
  // it: the panel is often portalled into a positioned wrapper while the panel itself is static.
  var KNOWN_POPUP_CLASSES = ['phoenix-selectList'];
  function isKnownPopupRoot(container) {
    if (!container || !container.className) return false;
    var className = String(container.className);
    return KNOWN_POPUP_CLASSES.some(function (name) { return className.indexOf(name) >= 0; });
  }
  function isFloatingPopup(container) {
    if (!container) return false;
    if (isKnownPopupRoot(container)) return true;
    if (container.getAttribute && normalizeText(container.getAttribute('role')) === 'listbox') return true;
    var parent = container.parentElement;
    if (parent && parent.tagName && parent.tagName.toLowerCase() === 'body') return true;
    var view = viewOf(container);
    if (!view || !view.getComputedStyle) return false;
    try {
      var style = view.getComputedStyle(container);
      return style.position === 'absolute' || style.position === 'fixed';
    } catch (_) { return false; }
  }
  function referencedPopupIds(control) {
    var ids = [];
    ['aria-controls', 'aria-owns', 'aria-describedby'].forEach(function (attribute) {
      var value = control && control.getAttribute && control.getAttribute(attribute);
      if (!value) return;
      String(value).split(/\s+/).forEach(function (id) { if (id && ids.indexOf(id) < 0) ids.push(id); });
    });
    return ids;
  }
  function scopedFieldContainer(control) {
    if (!control || !control.closest) return null;
    return control.closest('.ant-form-item, .el-form-item, .ivu-form-item, .form-item, .form-cell, .field-card, [class*="form-item"], [class*="field-card"]');
  }
  // expectedValue turns a menu scan into a search: several menus can sit in the DOM at once
  // (a previous field's popup is often still open), so the first non-empty list is not
  // necessarily this control's. A list that holds the value wins; otherwise the first one seen
  // is kept purely so a failure can say which options were on offer.
  function findCustomOptions(control, expectedValue) {
    if (!control || typeof document === 'undefined') return [];
    var ownerDocument = documentOf(control);
    if (!ownerDocument) return [];
    var expected = expectedValue == null ? '' : normalizeText(expectedValue);
    var fallback = null;
    function accept(items) {
      if (!items || !items.length) return null;
      if (!expected) return items;
      if (matchSelectOption(items, expectedValue) >= 0) return items;
      if (!fallback) fallback = items;
      return null;
    }
    var next = control.nextElementSibling;
    if (next && (normalizeText(next.getAttribute && next.getAttribute('role')) === 'listbox' || /dropdown|menu|popup|popper/i.test(String(next.className || '')))) {
      var local = accept(optionItems(next));
      if (local) return local;
    }
    var owner = control.closest && control.closest('.ant-select, .el-select, .ivu-select, .n-select, .arco-select, .t-select, .semi-select, .phoenix-select, [role="combobox"]');
    if (owner) {
      var owned = accept(optionItems(owner));
      if (owned) return owned;
    }
    var scoped = scopedFieldContainer(control);
    if (scoped) {
      var scopedItems = accept(optionItems(scoped));
      if (scopedItems) return scopedItems;
    }
    var roots = searchRoots(control);
    var ids = referencedPopupIds(control);
    for (var idIndex = 0; idIndex < ids.length; idIndex++) {
      for (var idRoot = 0; idRoot < roots.length; idRoot++) {
        var referenced = roots[idRoot].getElementById ? roots[idRoot].getElementById(ids[idIndex]) : null;
        if (!referenced || !isVisible(referenced)) continue;
        var referencedItems = accept(optionItems(referenced));
        if (referencedItems) return referencedItems;
      }
    }
    for (var rootIndex = 0; rootIndex < roots.length; rootIndex++) {
      var containers = Array.prototype.slice.call(roots[rootIndex].querySelectorAll(POPUP_CONTAINER_SELECTOR));
      for (var index = 0; index < containers.length; index++) {
        var container = containers[index];
        if (!isVisible(container) || !isFloatingPopup(container)) continue;
        var items = accept(optionItems(container));
        if (items) return items;
      }
      var loose = accept(Array.prototype.slice.call(roots[rootIndex].querySelectorAll('[role="option"], [data-value]')).filter(isVisible));
      if (loose) return loose;
    }
    return fallback || [];
  }
  // A contenteditable box is an ordinary element with no value property, so it needs its own read
  // and write path everywhere a text control is handled.
  function isEditableControl(control) {
    if (!control || !control.getAttribute) return false;
    var editable = control.getAttribute('contenteditable');
    if (editable == null) return false;
    var value = String(editable).toLowerCase();
    return value === '' || value === 'true' || value === 'plaintext-only';
  }
  function isTextEntryControl(control) {
    if (isEditableControl(control)) return !control.disabled;
    var tagName = String(control && control.tagName || '').toLowerCase();
    if (tagName !== 'input' && tagName !== 'textarea') return false;
    return !control.readOnly && !control.disabled;
  }
  function readEditableText(control) {
    // A contenteditable box has no .value, and innerText folds runs of whitespace, so a value
    // written back verbatim could read back as a different string. textContent is what was set.
    if (isEditableControl(control)) return String(control.textContent == null ? '' : control.textContent).replace(/\r\n?/g, '\n');
    return String(control && control.value || '');
  }
  // A framework-managed box (date picker, auto-complete) commits on the native editing events
  // that only real typing produces, so insertText is tried before the value setter. The setter
  // stays as the fallback for inputs that refuse the command or hold a non-text type.
  function setTextValue(control, value) {
    if (!control) return false;
    var text = String(value == null ? '' : value);
    var editable = isEditableControl(control);
    // The element may live in an iframe or a shadow root: execCommand only exists on a document,
    // and it has to be the one that owns the control, or the text lands wherever the top
    // document has focused.
    var commandDocument = control.ownerDocument && control.ownerDocument.execCommand ? control.ownerDocument
      : (typeof document !== 'undefined' && document.execCommand ? document : null);
    if (commandDocument && typeof control.focus === 'function') {
      try {
        control.focus();
        if (!editable && typeof control.select === 'function') control.select();
        // A contenteditable box has no value to assign, so select-all plus insertText is what
        // replaces the previous text and notifies the framework.
        if (editable) commandDocument.execCommand('selectAll', false, null);
        if (commandDocument.execCommand('insertText', false, text)) { emitChange(control); return true; }
      } catch (_) {}
    }
    if (editable) {
      control.textContent = text;
      emitChange(control);
      return true;
    }
    return setNativeValue(control, text);
  }
  // Calendar panels keep the date in their own model: typing into the box can leave the page's
  // validation still saying 请选择日期. Picking the day cell is what the form actually records.
  // The panel opens on the month of the value already in the box, so no month navigation is
  // attempted; a panel showing some other month is left alone rather than clicked blindly.
  var DATE_PANEL_SELECTOR = '.el-picker-panel, .el-date-picker, .ant-picker-dropdown, .n-date-panel, .ivu-picker-panel, [class*="picker-panel"], [class*="date-panel"], [class*="picker-dropdown"]';
  var MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function pickerHeaderElement(panel) {
    if (!panel || !panel.querySelector) return null;
    return panel.querySelector('.el-date-picker__header, .ant-picker-header-view, .n-date-panel-header, .ivu-picker-panel-content-header, [class*="picker-header"], [class*="panel-header"], [class*="date-header"]');
  }
  function pickerHeaderMatches(panel, parts) {
    var header = pickerHeaderElement(panel);
    // No readable header means no way to know which month the cells belong to; refusing is the
    // only safe answer, because clicking a same-numbered day in the wrong month sets a wrong date.
    if (!header) return false;
    var text = normalizeText(textOf(header));
    if (!text || text.indexOf(parts.year) < 0) return false;
    var month = String(Number(parts.month));
    if (new RegExp('(^|[^0-9])' + month + '([^0-9]|$)').test(text)) return true;
    return text.indexOf(MONTH_ABBREVIATIONS[Number(parts.month) - 1]) >= 0;
  }
  function findDatePanel(control) {
    if (typeof document === 'undefined') return null;
    var panels = [];
    searchRoots(control).forEach(function (root) {
      panels = panels.concat(Array.prototype.slice.call(root.querySelectorAll(DATE_PANEL_SELECTOR)));
    });
    panels = panels.filter(isVisible);
    for (var index = 0; index < panels.length; index++) {
      if (panels[index].querySelector && panels[index].querySelector('td, [role="gridcell"], [class*="cell"]')) return panels[index];
    }
    return null;
  }
  function dayCellFor(panel, day) {
    if (!panel || !panel.querySelectorAll) return null;
    var wanted = String(Number(day));
    var cells = Array.prototype.slice.call(panel.querySelectorAll('td, [role="gridcell"], [class*="cell"]')).filter(isVisible);
    for (var index = 0; index < cells.length; index++) {
      var cell = cells[index];
      var text = textOf(cell).trim();
      if (text !== wanted && String(Number(text)) !== wanted) continue;
      var className = String(cell.className || '');
      if (/prev|next|disabled|outside|other|hidden/i.test(className)) continue;
      var tagName = String(cell.tagName || '').toLowerCase();
      var isDayLike = tagName === 'td' || /cell|day|date/i.test(className) || (cell.getAttribute && cell.getAttribute('role') === 'gridcell');
      if (!isDayLike) continue;
      return cell;
    }
    return null;
  }
  async function commitThroughDatePanel(control, expected) {
    var parts = parseDateParts(expected);
    if (!parts || !parts.day) return false;
    dispatchOpenSequence(control);
    var panel = await waitFor(function () { return findDatePanel(control); }, 600);
    if (!panel || !pickerHeaderMatches(panel, parts)) return false;
    var cell = dayCellFor(panel, parts.day);
    if (!cell) return false;
    dispatchOpenSequence(cell);
    var committed = await waitFor(function () {
      var digits = readControlValue(control).replace(/\D/g, '');
      return digits.indexOf(parts.year + parts.month + parts.day) >= 0 ? true : null;
    }, 800);
    return Boolean(committed);
  }
  // Reports success only when the value actually stuck. A readonly or framework-managed
  // control silently discards the write, and claiming a fill that never landed is worse than
  // admitting the failure, so the caller can fall back to picking from the dropdown.
  async function setTextValueVerified(control, value) {
    if (!isTextEntryControl(control)) return false;
    setTextValue(control, value);
    var expected = String(value == null ? '' : value).trim();
    var settled = await waitFor(function () {
      return readEditableText(control).trim() === expected ? true : null;
    }, 250);
    return Boolean(settled);
  }
  // The click handler is not always on the element itself: some libraries listen on an inner
  // selection row, others on the wrapper. Trying the control, its owner, its inner input and
  // its parent in turn covers all four layouts.
  function openTargets(control) {
    var targets = [control];
    var owner = control.closest && control.closest('.ant-select, .el-select, .ivu-select, .n-select, .arco-select, .t-select, .semi-select, .phoenix-select, [role="combobox"], [aria-haspopup]');
    if (owner && owner !== control) targets.push(owner);
    var inner = control.querySelector && control.querySelector('input, [class*="selection"], [class*="selector"], [class*="select-view"], [class*="select-input"]');
    if (inner && targets.indexOf(inner) < 0) targets.push(inner);
    // The parent is the last resort, so it is also the one most likely to be a link or a button:
    // clicking those would navigate away or submit the application.
    if (control.parentElement && !isClickHazard(control.parentElement) && targets.indexOf(control.parentElement) < 0) targets.push(control.parentElement);
    return targets;
  }
  // Some dropdowns open on pointerdown and never see a plain click().
  // A control's ancestor can be a link or a button that navigates or submits. This extension changes
  // field values and nothing else, so anything clickable in that sense is off limits.
  function isClickHazard(element) {
    if (!element || !element.closest) return false;
    if (element.closest('a[href]')) return true;
    var tag = String(element.tagName || '').toLowerCase();
    if (tag !== 'button' && !(element.getAttribute && element.getAttribute('role') === 'button')) return false;
    // A <button> without an explicit type is a submit button whenever it sits in a form, and a
    // reset button wipes the form as thoroughly as a submit sends it.
    var type = String(element.type || '').toLowerCase();
    return type === 'submit' || type === 'reset' || (type !== 'button' && Boolean(element.closest('form')));
  }
  // Some dropdowns open on pointerdown and never see a plain click().
  function dispatchOpenSequence(element) {
    if (!element) return;
    var view = viewOf(element);
    var MouseCtor = view && view.MouseEvent ? view.MouseEvent : (typeof MouseEvent !== 'undefined' ? MouseEvent : null);
    var PointerCtor = view && view.PointerEvent ? view.PointerEvent : (typeof PointerEvent !== 'undefined' ? PointerEvent : null);
    // A click on a bare <button> inside a form submits it. Blocking the submit event while the
    // click is dispatched keeps the component's own handler working without ever sending the form.
    var form = element.closest ? element.closest('form') : null;
    var guard = null;
    if (form) {
      guard = function (event) { event.preventDefault(); };
      form.addEventListener('submit', guard, true);
    }
    try {
      try {
        if (PointerCtor) element.dispatchEvent(new PointerCtor('pointerdown', { bubbles: true, cancelable: true }));
        if (MouseCtor) {
          element.dispatchEvent(new MouseCtor('mousedown', { bubbles: true, cancelable: true }));
          element.dispatchEvent(new MouseCtor('mouseup', { bubbles: true, cancelable: true }));
        }
        element.click();
      } catch (_) {
        try { element.click(); } catch (e) {}
      }
    } finally {
      if (guard) setTimeout(function () { form.removeEventListener('submit', guard, true); }, 0);
    }
  }
  function dismissCustomSelect(control) {
    try {
      var view = viewOf(control);
      var KeyCtor = view && view.KeyboardEvent ? view.KeyboardEvent : (typeof KeyboardEvent !== 'undefined' ? KeyboardEvent : null);
      if (KeyCtor) control.dispatchEvent(new KeyCtor('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    } catch (_) {}
  }
  async function openCustomOptions(control, expectedValue) {
    var targets = openTargets(control);
    for (var index = 0; index < targets.length; index++) {
      dispatchOpenSequence(targets[index]);
      var options = await waitFor(function () {
        var found = findCustomOptions(control, expectedValue);
        return found.length ? found : null;
      }, index === 0 ? 900 : 500);
      if (options) return options;
    }
    return null;
  }
  function optionLooksSelected(option) {
    if (!option || !option.getAttribute) return false;
    if (option.getAttribute('aria-selected') === 'true') return true;
    return /(^|[\s_-])(selected|active|checked|is-selected)([\s_-]|$)/i.test(String(option.className || ''));
  }
  // A cascading picker stores 省/市 (or 学校/学院) as one value while its menu offers the parts one
  // level at a time. Splitting is deliberately limited to the structural separators: a value with
  // a space in it (an English job title, say) must not be walked as if it were a hierarchy.
  var REGION_SUFFIX_RE = /(特别行政区|维吾尔自治区|回族自治区|壮族自治区|内蒙古自治区|自治区|自治州|自治县|自治旗|地区|盟|省|市|县|区|旗)$/;
  function valueParts(value) {
    return String(value == null ? '' : value).split(/[\/\-]+/).map(function (part) { return part.trim(); }).filter(Boolean);
  }
  // A province-level option can be nothing but the suffix (内蒙古自治区, 广西壮族自治区): stripping
  // it would leave an empty key that matches nothing, so keep the original when nothing remains.
  function regionKey(text) {
    var normalized = normalizeText(text);
    var stripped = normalized.replace(REGION_SUFFIX_RE, '');
    return stripped || normalized;
  }
  function matchCascadeOption(options, parts) {
    for (var exact = 0; exact < parts.length; exact++) {
      var wanted = regionKey(parts[exact]);
      if (!wanted) continue;
      for (var index = 0; index < options.length; index++) {
        if (regionKey(textOf(options[index])) === wanted) return { index: index, part: parts[exact] };
      }
    }
    // 辽宁省 answers a stored 辽宁, but a picker that offers only cities has to answer the second
    // part, so containment is the fallback rather than giving up.
    for (var loose = 0; loose < parts.length; loose++) {
      var looseWanted = regionKey(parts[loose]);
      if (!looseWanted) continue;
      for (var candidate = 0; candidate < options.length; candidate++) {
        var key = regionKey(textOf(options[candidate]));
        if (key && (key.indexOf(looseWanted) >= 0 || looseWanted.indexOf(key) >= 0)) return { index: candidate, part: parts[loose] };
      }
    }
    return null;
  }
  var CASCADE_CONFIRM_RE = /^(确定|确认|完成|完成选择|ok)$/i;
  // Only the picker's own 确定 counts, and 保存/提交 are deliberately absent from that list: a form
  // can carry a save or submit button, and clicking one of those is the worst thing this could do.
  // The menu is the outermost live ancestor of the option rows that is itself a menu root. It has to
  // be the outermost one: inner list wrappers carry the same class prefix, and a 确定 button lives on
  // the panel, not on an inner list.
  var MENU_ROOT_SELECTOR = '[class*="phoenix-selectList"], .ant-select-dropdown, .el-select-dropdown, .el-select-dropdown__wrap, .ivu-select-dropdown, .n-select-menu, .arco-select-popup, .t-select__dropdown, .semi-select-option-list, [role="listbox"]';
  function panelRootFor(rows) {
    if (!rows || !rows.length) return null;
    var start = null;
    for (var index = 0; index < rows.length && !start; index++) {
      if (rows[index] && rows[index].isConnected !== false) start = rows[index];
    }
    if (!start) return null;
    var node = start;
    var panel = null;
    while (node && node.matches) {
      if (node.isConnected !== false && node.matches(MENU_ROOT_SELECTOR)) panel = node;
      node = node.parentElement;
    }
    // A "panel" that contains a form is a page container, and a 确定 button found inside one of
    // those could be anything. Refusing is the safe answer.
    if (panel && panel.querySelector && panel.querySelector('form')) return null;
    return panel;
  }
  function findCascadeConfirm(rows) {
    var panel = panelRootFor(rows);
    if (!panel || !panel.querySelectorAll) return null;
    var buttons = Array.prototype.slice.call(panel.querySelectorAll('button, [role="button"], [class*="btn"], [class*="button"]')).filter(isVisible);
    for (var index = 0; index < buttons.length; index++) {
      if (CASCADE_CONFIRM_RE.test(normalizeText(cleanFieldLabel(textOf(buttons[index]))))) return buttons[index];
    }
    return null;
  }
  // Words that say the field is a picker rather than a plain list of options.
  var CASCADE_LABEL_RE = /(地区|城市|省|市|县|区|生源|籍贯|户口|户籍|居住|所在地|地址|学校|院校|学院|单位|部门|机构)/;
  async function fillCascadeSelect(control, expected) {
    var parts = valueParts(expected);
    if (parts.length < 2) return false;
    var remaining = parts.slice();
    var clickedParts = [];
    var lastRows = null;
    for (var level = 0; level < parts.length && remaining.length; level++) {
      var options = await waitFor(function () { var found = findCustomOptions(control, null); return found.length ? found : null; }, 600);
      if (!options) break;
      var hit = matchCascadeOption(options, remaining);
      if (!hit) break;
      var seenBefore = options.slice();
      lastRows = options;
      dispatchOpenSequence(options[hit.index]);
      clickedParts.push(hit.part);
      remaining = remaining.filter(function (part) { return part !== hit.part; });
      if (!remaining.length) break;
      // The next level has to render before it can be clicked, and it has to be a *different* list:
      // clicking a second time into the same list would only move the selection to another
      // first-level item and leave a wrong value behind.
      var advanced = await waitFor(function () {
        var fresh = findCustomOptions(control, null);
        return fresh.length && fresh.some(function (row) { return seenBefore.indexOf(row) < 0; }) ? true : null;
      }, 600);
      if (!advanced) break;
    }
    if (!clickedParts.length) return false;
    // The rows may have been re-rendered since they were clicked, so read the live ones back before
    // looking for the panel's own confirm button.
    var live = await waitFor(function () { var found = findCustomOptions(control, null); return found.length ? found : null; }, 300);
    var confirm = findCascadeConfirm(live || lastRows || []);
    if (confirm) dispatchOpenSequence(confirm);
    var applied = await waitFor(function () {
      var shown = regionKey(readControlValue(control));
      if (!shown) return null;
      // Every level that was clicked has to show up in what the control now reads back.
      return clickedParts.every(function (part) {
        var key = regionKey(part);
        return key && (shown.indexOf(key) >= 0 || key.indexOf(shown) >= 0);
      }) ? true : null;
    }, 900);
    if (!applied) dismissCustomSelect(control);
    return Boolean(applied);
  }
  async function fillCustomSelect(control, field) {
    var expected = expectedFieldValue(field.proposedValue, field.label);
    if (!expected) return { id: field.id, status: 'failed', reason: '模板缺少该日期的具体日值' };
    var options = await openCustomOptions(control, expected);
    if (!options) return { id: field.id, status: 'failed', reason: '下拉选项没有出现，可能需要手动选择' };
    // Give an async menu a moment to render before settling for a list that lacks the value.
    var matchedContainer = await waitFor(function () {
      var found = findCustomOptions(control, expected);
      return found.length && matchSelectOption(found, expected) >= 0 ? found : null;
    }, 400);
    if (matchedContainer) options = matchedContainer;
    var optionIndex = isDateComponentLabel(field.label) ? matchDateSelectOption(options, expected) : matchSelectOption(options, expected);
    if (optionIndex < 0) {
      // A cascading picker offers its parts one level at a time, so no option ever reads as the whole
      // stored value and the lookup above comes back empty. Walk the value's parts instead; matching
      // is by wording, so it does not matter which library drew the menu. Only a field whose wording
      // says it is such a picker takes this path: a value that merely contains a separator (a job
      // title like 电气-仪表, a date range) must not be walked as if it were a hierarchy.
      if (CASCADE_LABEL_RE.test(String(field.label || '')) && await fillCascadeSelect(control, expected)) {
        dismissCustomSelect(control);
        return { id: field.id, status: 'filled' };
      }
      dismissCustomSelect(control);
      return { id: field.id, status: 'failed', reason: '下拉选项里没有“' + expected + '”' };
    }
    var option = options[optionIndex];
    var optionText = textOf(option);
    try { option.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    dispatchOpenSequence(option);
    var applied = await waitFor(function () {
      var shown = readControlValue(control);
      var normalizedOption = normalizeText(optionText);
      if (shown && normalizedOption && normalizeText(shown).indexOf(normalizedOption) >= 0) return true;
      return optionLooksSelected(option) ? true : null;
    }, 1000);
    if (applied) { dismissCustomSelect(control); return { id: field.id, status: 'filled' }; }
    return { id: field.id, status: 'failed', reason: '选了“' + optionText + '”，页面没有确认这次选择' };
  }
  async function fill(fields) {
    if (typeof document === 'undefined') return [];
    var results = [];
    var controlMap = controlIndex();
    for (var index = 0; index < (fields || []).length; index++) {
      var field = fields[index];
      if (!field || !field.proposedValue || isPlaceholderValue(field.proposedValue) || field.confidence === 'none' || field.isNewField) { results.push({ id: field && field.id, status: 'skipped', reason: '没有可用的已确认资料' }); continue; }
      var control = resolveField(field, controlMap); if (!control || (isSubmitLike(control) && !isCustomChoiceGroup(control))) { results.push({ id: field.id, status: 'skipped', reason: '控件不存在或为提交控件' }); continue; }
      if (control.tagName.toLowerCase() === 'select') {
        var expectedSelectValue = expectedFieldValue(field.proposedValue, field.label);
        if (!expectedSelectValue) { results.push({ id: field.id, status: 'failed', reason: '模板缺少该日期的具体日值' }); continue; }
        var selectIndex = isDateComponentLabel(field.label) ? matchDateSelectOption(Array.prototype.slice.call(control.options), expectedSelectValue) : matchSelectOption(Array.prototype.slice.call(control.options), expectedSelectValue);
        if (selectIndex < 0) { results.push({ id: field.id, status: 'failed', reason: '下拉选项没有匹配项' }); continue; }
        control.selectedIndex = selectIndex; emitChange(control); results.push({ id: field.id, status: 'filled' }); continue;
      }
      if (control.type === 'radio' || control.type === 'checkbox') {
        var group = choiceGroupItems(control);
        if (!group.length) group = [control];
        if (control.type === 'checkbox' && group.length === 1) {
          var flag = booleanChoice(field.proposedValue);
          if (flag !== null) { setChoiceChecked(group[0], flag); results.push({ id: field.id, status: 'filled' }); continue; }
        }
        var choiceIndexes = matchChoiceIndexes(choiceItems(group), field.proposedValue);
        if (!choiceIndexes.length) { results.push({ id: field.id, status: 'failed', reason: '选项没有精确匹配项' }); continue; }
        if (control.type === 'checkbox') {
          group.forEach(function (item, itemIndex) {
            setChoiceChecked(item, choiceIndexes.indexOf(itemIndex) >= 0);
          });
        } else {
          setChoiceChecked(group[choiceIndexes[0]], true);
        }
        results.push({ id: field.id, status: 'filled' });
        continue;
      }
      if (isCustomChoiceGroup(control)) {
        results.push(await fillCustomChoice(control, field));
        continue;
      }
      if (isCustomSelectControl(control)) {
        results.push(await fillCustomSelect(control, field));
        continue;
      }
      // Plain text is the common case, but a site-specific dropdown is often a readonly or
      // decorative element that silently ignores the write. Verify the value stuck before
      // claiming success, and pick from its popup when it did not.
      if (await setTextValueVerified(control, field.proposedValue)) {
        // A date picker may hold the typed value on screen while its own model stays empty;
        // confirming through the calendar is what clears the page's 请选择日期 error.
        if (isDateField(control, field.label)) await commitThroughDatePanel(control, expectedFieldValue(field.proposedValue, field.label));
        results.push({ id: field.id, status: 'filled' });
        continue;
      }
      var fallback = await fillCustomSelect(control, field);
      if (fallback.status !== 'filled' && isTextEntryControl(control)) {
        // A writable text box that refused the value is a format or length problem, not a
        // missing dropdown, and saying so saves the applicant a pointless hunt.
        fallback = { id: field.id, status: 'failed', reason: '输入框没有接受这个值，请检查格式或长度' };
      }
      results.push(fallback);
    }
    return results;
  }
  function collectDraftValues(fields) { return (fields || []).filter(function (field) { return field && field.remember && !field.sensitive && field.siteKey && field.fingerprint && field.profileKey && field.proposedValue && !isPlaceholderValue(field.proposedValue); }).map(function (field) { return { site_key: field.siteKey, fingerprint: field.fingerprint, profile_key: field.profileKey, value: String(field.proposedValue) }; }); }
  function upsertDrafts(existing, updates, timestamp) {
    var drafts = (existing || []).map(function (item) { return Object.assign({}, item); });
    (updates || []).forEach(function (draft) {
      if (!draft || !draft.site_key || !draft.fingerprint || !draft.profile_key) return;
      var found = drafts.find(function (item) { return item.site_key === draft.site_key && item.fingerprint === draft.fingerprint && item.profile_key === draft.profile_key; });
      if (found) { found.value = String(draft.value == null ? '' : draft.value); found.updated_at = timestamp; }
      else drafts.push({ site_key: draft.site_key, fingerprint: draft.fingerprint, profile_key: draft.profile_key, value: String(draft.value == null ? '' : draft.value), updated_at: timestamp });
    });
    return drafts;
  }
  // chrome.storage.local has no compare-and-swap, so a draft is written as a read-modify-write and
  // then read back. The popup and the editor do their own read-modify-write of the same key, and
  // the content script cannot share their merge: it is injected on its own and cannot require
  // shared.js. When another page's write lands between this read and this write, its copy was
  // taken before the draft existed and the draft is gone from storage again. The read-back sees
  // that and re-applies the draft on top of whatever is stored now, so the other page's change
  // survives instead of being overwritten with a stale profile.
  //
  // This narrows the window rather than closing it: a write landing between the read-back and the
  // next attempt is still lost by whoever writes second. Only a storage-side atomic compare-and-set
  // would remove that, and chrome.storage does not offer one.
  var DRAFT_WRITE_ATTEMPTS = 3;
  function draftMatches(item, draft) {
    return Boolean(item) && item.site_key === draft.site_key && item.fingerprint === draft.fingerprint
      && item.profile_key === draft.profile_key;
  }
  function draftIsStored(stored, draft) {
    return (stored || []).some(function (item) {
      return draftMatches(item, draft) && String(item.value) === String(draft.value);
    });
  }
  async function writeDraft(draft, io, attemptsLeft) {
    var data = await io.read();
    var profile = (data && data.resumeProfile) || {};
    profile.site_drafts = upsertDrafts(Array.isArray(profile.site_drafts) ? profile.site_drafts : [], [draft], new Date().toISOString());
    await io.write(profile);
    var confirmed = await io.read();
    if (draftIsStored(confirmed && confirmed.resumeProfile && confirmed.resumeProfile.site_drafts, draft)) return true;
    if (attemptsLeft > 1) return writeDraft(draft, io, attemptsLeft - 1);
    return false;
  }
  function localDraftIo() {
    return {
      read: function () {
        return new Promise(function (resolve) {
          chrome.storage.local.get({ resumeProfile: {} }, function (data) { resolve(data || {}); });
        });
      },
      write: function (profile) {
        return new Promise(function (resolve) {
          chrome.storage.local.set({ resumeProfile: profile }, function () { resolve(); });
        });
      }
    };
  }
  // Drafts arrive one keystroke at a time, so the writes are queued: two in flight at once would
  // each read the profile before the other's write and the second would drop the first.
  var draftWriteChain = null;
  function updateLocalDraft(draft) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    var write = function () { return writeDraft(draft, localDraftIo(), DRAFT_WRITE_ATTEMPTS); };
    var pending = draftWriteChain ? draftWriteChain.then(write, write) : write();
    draftWriteChain = pending.then(function () {}, function () {});
  }
  function rememberFields(fields, siteKey) {
    var controlMap = controlIndex();
    var safeFields = (fields || []).filter(function (field) { return field && field.remember && !field.sensitive && field.profileKey && field.fingerprint; }).map(function (field) { return { siteKey: field.siteKey || siteKey, fingerprint: field.fingerprint, profileKey: field.profileKey, selectorHint: field.selectorHint, label: field.label }; });
    if (typeof document === 'undefined') return safeFields.length;
    safeFields.forEach(function (field) {
      var control = resolveField({ selectorHint: field.selectorHint, label: field.label, fingerprint: field.fingerprint }, controlMap);
      if (!control) return;
      var timer = null;
      var save = function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          if (isSensitiveField({ type: control.type || control.tagName, label: field.label, name: control.name, id: control.id })) return;
        var value = isCustomChoiceGroup(control) ? customChoiceValue(control) : readControlValue(control);
          if (value && !isGenericPrompt(value)) updateLocalDraft({ site_key: field.siteKey || siteKey, fingerprint: field.fingerprint, profile_key: field.profileKey, value: value });
        }, 350);
      };
      control.addEventListener('input', save, true);
      control.addEventListener('change', save, true);
      if (isCustomSelectControl(control)) {
        control.addEventListener('click', save, true);
        if (typeof MutationObserver !== 'undefined') {
          var observer = new MutationObserver(save);
          observer.observe(control, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'data-value'] });
        }
      }
    });
    return safeFields.length;
  }
  var currentHighlightEl = null;
  var highlightTimer = null;
  // A document stylesheet does not cross a shadow boundary, so a control inside a web component
  // needs its own copy of the rule or the highlight is invisible on it. Frames need the same
  // treatment for the same reason: the sheet has to live in the tree that paints the element.
  function ensureHighlightStyle(root) {
    var target = root && root.querySelector ? root : (typeof document !== 'undefined' ? document : null);
    if (!target) return;
    var id = '__resume_autofill_style';
    var existing = target.getElementById ? target.getElementById(id) : target.querySelector('#' + id);
    if (existing) return;
    var owner = target.nodeType === 9 ? target : (target.ownerDocument || (typeof document !== 'undefined' ? document : null));
    if (!owner || !owner.createElement) return;
    var style = owner.createElement('style');
    style.id = id;
    style.textContent = '@keyframes __resume_pulse { 0% { box-shadow: 0 0 0 0 rgba(0, 120, 212, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(0, 120, 212, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 120, 212, 0); } } .__resume_autofill_highlight { outline: 3px solid #0078d4 !important; outline-offset: 3px !important; animation: __resume_pulse 1.6s infinite !important; border-radius: 4px !important; transition: outline 0.2s ease !important; }';
    (target.head || target).appendChild(style);
  }
  function clearHighlight() {
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
    if (typeof document !== 'undefined') {
      var highlighted = [];
      scanRoots().forEach(function (root) { highlighted = highlighted.concat(Array.prototype.slice.call(root.querySelectorAll('.__resume_autofill_highlight'))); });
      for (var i = 0; i < highlighted.length; i++) {
        highlighted[i].classList.remove('__resume_autofill_highlight');
      }
    }
    currentHighlightEl = null;
    return true;
  }
  function highlight(field) {
    if (typeof document === 'undefined' || !field) return false;
    clearHighlight();
    var control = resolveField(field, controlIndex());
    if (!control) return false;
    ensureHighlightStyle(typeof document !== 'undefined' ? document : null);
    if (control.ownerDocument && control.ownerDocument !== document) ensureHighlightStyle(control.ownerDocument);
    if (control.getRootNode) {
      var styleRoot = control.getRootNode();
      if (styleRoot && styleRoot.nodeType === 11) ensureHighlightStyle(styleRoot);
    }
    var target = control;
    if (control.offsetWidth === 0 && control.offsetHeight === 0 && control.closest) {
      target = control.closest('.el-select') || control.closest('.ant-select') || control.parentElement || control;
    }
    target.classList.add('__resume_autofill_highlight');
    currentHighlightEl = target;
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (_) {
      try { target.scrollIntoView(false); } catch (e) {}
    }
    highlightTimer = setTimeout(function () {
      clearHighlight();
    }, 3000);
    return true;
  }
  return { normalizeText: normalizeText, controlSelector: controlSelector, isRendered: isRendered, nearbyChoiceText: nearbyChoiceText, labelVariants: labelVariants, withoutLeadingQualifier: withoutLeadingQualifier, isPlaceholderValue: isPlaceholderValue, buildLearnedMap: buildLearnedMap, findLearnedValue: findLearnedValue, leafProfileKey: leafProfileKey, learnedMatch: learnedMatch, fieldConfidence: fieldConfidence, labelMatchStrength: labelMatchStrength, profileLabelStrength: profileLabelStrength, matchChoiceIndexes: matchChoiceIndexes, choiceTokens: choiceTokens, booleanChoice: booleanChoice, choiceItems: choiceItems, choiceText: choiceText, scanRoots: scanRoots, searchRoots: searchRoots, allControls: allControls, controlIndex: controlIndex, isLiveControl: isLiveControl, deriveLabel: deriveLabel, flattenProfile: flattenProfile, matchSelectOption: matchSelectOption, matchDateSelectOption: matchDateSelectOption, matchChoice: matchChoice, isSubmitLike: isSubmitLike, isSensitiveField: isSensitiveField, isGenericPrompt: isGenericPrompt, cleanFieldLabel: cleanFieldLabel, isUsableFieldLabel: isUsableFieldLabel, shouldIncludeCandidate: shouldIncludeCandidate, customControlValue: customControlValue, readControlValue: readControlValue, isScannableControl: isScannableControl, isCustomSelectControl: isCustomSelectControl, isEditableControl: isEditableControl, isTextEntryControl: isTextEntryControl, readEditableText: readEditableText, isCustomChoiceGroup: isCustomChoiceGroup, customChoiceItems: customChoiceItems, customChoiceValue: customChoiceValue, customChoiceSelected: customChoiceSelected, previewCustomChoice: previewCustomChoice, isKnownPopupRoot: isKnownPopupRoot, panelRootFor: panelRootFor, findCascadeConfirm: findCascadeConfirm, customChoiceText: customChoiceText, customChoiceState: customChoiceState, fillCustomChoice: fillCustomChoice, isClickHazard: isClickHazard, dispatchOpenSequence: dispatchOpenSequence, valueParts: valueParts, regionKey: regionKey, matchCascadeOption: matchCascadeOption, findCustomOptions: findCustomOptions, combineContextLabel: combineContextLabel, findContainerLabel: findContainerLabel, preferredContainerSelectors: preferredContainerSelectors, isNavigationOnlyLabel: isNavigationOnlyLabel, isDateComponentLabel: isDateComponentLabel, dateComponentValue: dateComponentValue, dedupeControlDescriptors: dedupeControlDescriptors, dedupeFieldDescriptors: dedupeFieldDescriptors, valueMatchesLabel: valueMatchesLabel, setNativeValue: setNativeValue, makeFingerprint: makeFingerprint, siteMappingMatches: siteMappingMatches, collectDraftValues: collectDraftValues, upsertDrafts: upsertDrafts, draftIsStored: draftIsStored, writeDraft: writeDraft, scan: scan, fill: fill, rememberFields: rememberFields, highlight: highlight, clearHighlight: clearHighlight };
}));
