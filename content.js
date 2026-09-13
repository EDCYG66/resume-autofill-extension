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
  var CONTROL_SELECTOR = 'input:not([type="hidden"]), textarea, select, [role="combobox"], [aria-haspopup="listbox"]';
  var MAX_FRAMES = 12;

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
    // 教育经历
    school: ['学校', '学校名称', '毕业院校', '毕业院校名称', '毕业学校', '就读学校', '就读院校', '就读高校', '高校名称', '院校名称', '院校', '母校'],
    college: ['学院', '学院名称', '所在学院', '所在院系', '院系', '系别'],
    start_date: ['开始时间', '开始年月', '开始日期', '起始时间', '起始年月', '起始日期', '入学时间', '入学年月', '入职时间', 'start date'],
    end_date: ['结束时间', '结束年月', '结束日期', '截止时间', '截止日期', '毕业时间', '毕业年月', '离校时间', '离职时间', 'end date'],
    duration_years: ['学制', '学制年限', '修业年限'],
    level: ['学历', '学历层次', '最高学历', '现有学历', '目前学历', '培养层次'],
    admission_type: ['招生类型', '培养类型', '招生方式', '录取类型', '录取批次', '统招', '非统招', '统招统分'],
    study_mode: ['学习形式', '学习方式', '就读形式', '培养方式', '全日制', '非全日制'],
    graduate_type: ['应届往届', '应届/往届', '毕业生类型', '生源类型', '是否应届'],
    degree_certificate: ['学位证', '学位证书', '是否取得学位'],
    degree_name: ['学位名称', '所获学位', '授予学位', '学位'],
    major: ['专业', '专业名称', '所学专业', '就读专业', '主修专业', '本科专业'],
    second_major: ['第二专业', '第二学位专业', '辅修专业', '双学位专业'],
    major_category: ['专业分类', '专业类别', '专业大类'],
    major_rank: ['专业排名', '成绩排名', '年级排名', '排名'],
    gpa: ['绩点', '平均绩点', '成绩绩点', '平均成绩', '均分', '平均分', 'gpa'],
    english_level: ['英语等级', '英语级别', '英语水平', '外语等级', '外语水平'],
    english_score: ['英语等级成绩', '英语成绩', '英语分数', '四六级成绩', '外语成绩'],
    research_direction: ['研究方向', '研究领域'],
    advisor: ['导师', '导师姓名', '指导教师', '指导老师'],
    thesis_title: ['毕业论文题目', '毕业论文', '论文题目', '学位论文题目', '毕业设计题目'],
    // 工作 / 实习
    employer: ['公司', '公司名称', '企业名称', '单位', '单位名称', '工作单位', '任职单位', '雇主'],
    role: ['职位', '职位名称', '职务', '职务名称', '岗位', '担任职务'],
    organization: ['组织', '组织名称', '项目单位'],
    employer_type: ['单位性质', '公司性质', '企业性质', '单位类型', '单位分类'],
    location: ['工作地点', '上班地点', '工作地区'],
    description: ['描述', '说明', '简介'],
    duties: ['工作内容', '工作职责', '岗位职责', '主要职责'],
    // 自定义 / 其他
    self_evaluation: ['自我评价', '个人评价', '个人陈述', '自我介绍', '个人介绍', '自我描述', '個人簡介', '个人简介', '自我鉴定', '自我认知'],
    political: ['政治面貌'],
    // 附加信息
    hobbies: ['兴趣爱好', '个人爱好', '业余爱好', '爱好'],
    specialty: ['特长', '个人特长', '专业特长', '技能特长', '专长'],
    punishment: ['受处分情况', '处分情况', '是否受过处分', '有无处分'],
    academic_works: ['学术专著', '学术成果', '论文著作', '专著'],
    patents: ['专利成果', '发明专利', '专利情况', '专利'],
    law_violation: ['是否有触犯国家法律法规', '违法犯罪记录', '是否有违法违纪', '违法违纪', '是否违法犯罪'],
    applied_subsidiary: ['是否应聘过本公司', '是否投递过本公司', '是否有应聘过', '是否有投递过', '是否应聘过', '是否投递过'],
    relatives_in_company: ['是否有亲属在本公司', '是否有亲友在本公司', '亲戚朋友', '亲属在本公司', '是否有亲友'],
    medical_history: ['手术史', '重大疾病史', '重大疾病', '既往病史', '疾病史'],
    referral_code: ['校园大使推荐码', '内推推荐码', '推荐码', '内推码']
  };
  var DISPLAY_LABELS = {
    name: '姓名', gender: '性别', birth_date: '出生日期', ethnicity: '民族', native_place: '籍贯', political_status: '政治面貌', household_registration: '户口所在地', place_of_origin: '生源地', current_residence: '现居住地', mailing_address: '通信地址', phone: '联系电话', email: '邮箱', target_role: '期望职位', industry: '期望行业', city: '期望城市', salary: '期望薪资', employment_type: '工作性质', available_date: '可到岗时间', school: '学校', college: '学院', start_date: '开始时间', end_date: '结束时间', duration_years: '学制', level: '学历', admission_type: '招生类型', study_mode: '学习形式', degree_certificate: '学位证', degree_name: '学位名称', major: '专业', major_category: '专业分类', major_rank: '专业排名', gpa: '绩点/均分', research_direction: '研究方向', advisor: '导师', employer: '单位', role: '职位', organization: '组织', self_evaluation: '自我评价', courses: '课程', duties: '工作内容', description: '描述', introduction: '项目介绍', outcomes: '项目成果', related_paper: '相关论文', category: '分类', skills: '相关技能', evidence: '应用说明', question: '题目', answer: '回答', custom_fields: '自定义字段', phone_code: '手机区号 / 类别', id_type: '证件类型', id_number: '身份证号', has_children: '有无子女', qq: 'QQ', emergency_contact: '紧急联系人', emergency_phone: '紧急联系电话', interview_site: '面试站点', second_major: '第二专业', graduate_type: '应届往届', english_level: '英语等级', english_score: '英语等级成绩', thesis_title: '毕业论文题目', hobbies: '兴趣爱好', specialty: '特长', punishment: '受处分情况', academic_works: '学术专著', patents: '专利成果', law_violation: '违法违纪情况', applied_subsidiary: '是否应聘过本公司', relatives_in_company: '是否有亲友在本公司', medical_history: '手术史或重大疾病史', referral_code: '推荐码'
  };
  // Per-section aliases for leaves whose plain name means something different in each
  // section. A "name" under 荣誉 is an award, not a person. Defining an entry here also
  // scopes that leaf: it stops inheriting the generic aliases of its leaf key.
  var CONTEXT_LABELS = {
    'skills.name': ['技能名称', '证书名称', '英语证书名称', '技能证书'],
    'skills.category': ['技能分类', '语言类别'],
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
    'projects.introduction': ['项目介绍', '项目简介'],
    'projects.duties': ['项目职责', '项目工作', '承担工作'],
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
    'employment.description': ['工作内容', '工作职责', '岗位职责'],
    'application_answers.question': ['题目'],
    'application_answers.answer': ['回答']
  };
  var SENSITIVE_RE = /(密码|password|passwd|验证码|captcha|verification.?code|短信码|身份证|证件号码|银行卡|bank.?card|cvv|安全码|security.?code|social.?security)/i;

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/[：:]/g, '').replace(/[\/]/g, '-').replace(/[\u00a0\t\r\n ]+/g, '').replace(/[（）()【】\[\]，,。；;、]/g, '').toLowerCase();
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
  function isCustomSelectControl(element) {
    if (!element) return false;
    var role = normalizeText(element.role || (element.getAttribute && element.getAttribute('role')));
    var popup = normalizeText(element.ariaHaspopup || element['aria-haspopup'] || (element.getAttribute && element.getAttribute('aria-haspopup')));
    var className = String(element.className || '').toLowerCase();
    return (role === 'combobox' || role === 'listbox') && role !== 'option' || popup === 'listbox' || /(^|[ _-])(el-select|ant-select|ivu-select|select2-selection)([ _-]|$)/.test(className);
  }
  function isScannableControl(element) {
    if (!element || element.disabled || element.hidden) return false;
    var type = normalizeText(element.type);
    if (['hidden', 'submit', 'reset', 'button', 'image', 'file'].indexOf(type) >= 0) return false;
    if (element.getAttribute && element.getAttribute('aria-hidden') === 'true') return false;
    if (!isRendered(element)) return false;
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
  function preferredContainerSelectors() { return ['.resume-operation-wrap .form-cell', '.resume-operation-wrap .form-cell-right', '.ant-form-item', '.el-form-item']; }
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
    var labelSelectors = ['.ant-form-item-label', '.el-form-item__label', 'label', '.form-label', '[class*="label"]'];
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
  function dedupeControlDescriptors(controls) {
    var seen = Object.create(null);
    return (controls || []).filter(function (control) {
      var type = normalizeText(control && control.type);
      if (type !== 'radio' && type !== 'checkbox') return true;
      var name = String(control.name || control.id || '');
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
  function documentOf(element) {
    var ownerDocument = element && element.ownerDocument;
    if (ownerDocument && ownerDocument.querySelectorAll) return ownerDocument;
    return typeof document !== 'undefined' && document.querySelectorAll ? document : null;
  }
  function isFrameVisible(frame, ownerDocument) {
    var view = ownerDocument && ownerDocument.defaultView ? ownerDocument.defaultView : (typeof window !== 'undefined' ? window : null);
    if (!view || !view.getComputedStyle) return true;
    try {
      var style = view.getComputedStyle(frame);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (_) { return true; }
  }
  function scanRoots() {
    var roots = [];
    if (typeof document === 'undefined' || !document.querySelectorAll) return roots;
    roots.push(document);
    for (var index = 0; index < roots.length && roots.length < MAX_FRAMES; index++) {
      var ownerDocument = roots[index];
      var frames = ownerDocument.querySelectorAll('iframe, frame');
      for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        var frame = frames[frameIndex];
        if (!isFrameVisible(frame, ownerDocument)) continue;
        var inner = null;
        try { inner = frame.contentDocument; } catch (_) { inner = null; }
        if (inner && inner.querySelectorAll && inner.body && roots.indexOf(inner) < 0) roots.push(inner);
      }
    }
    return roots;
  }
  function queryControls(root) {
    if (!root || !root.querySelectorAll) return [];
    return Array.prototype.slice.call(root.querySelectorAll(CONTROL_SELECTOR));
  }
  function allControls() {
    var controls = [];
    scanRoots().forEach(function (root) { controls = controls.concat(queryControls(root)); });
    return controls;
  }
  // True when the control is actually rendered. An ancestor with display:none hides it, but
  // getComputedStyle on the descendant still reports its own display value, so the plain style
  // reads are not enough on their own.
  function isRendered(element) {
    if (!element) return false;
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
    }
    if (element.offsetParent === null) {
      var view = viewOf(element);
      var position = view && view.getComputedStyle ? view.getComputedStyle(element).position : '';
      // offsetParent is also null for fixed positioning, where the element is on screen.
      if (position !== 'fixed') return false;
    }
    return true;
  }
  function isVisible(element) {
    if (!element || element.disabled || element.hidden) return false;
    return isRendered(element);
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
    var ownerDocument = documentOf(element);
    if (id && ownerDocument) {
      var associated = ownerDocument.querySelector('label[for="' + cssEscape(id) + '"]');
      if (associated && !isGenericPrompt(textOf(associated))) return cleanFieldLabel(combineContextLabel(textOf(associated).trim(), ancestorContextLabels(element)));
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
  var LEADING_QUALIFIER_RE = /^(最高学历|最高学位|第一学历|本科|研究生|硕士|博士)/;
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
  function profileLabelStrength(item, label, learned) {
    if (!item || !isUsableFieldLabel(label)) return 'none';
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
  function isSubmitLike(control) { var type = normalizeText(control && control.type); var text = normalizeText(control && (control.text || control.label || control.value || textOf(control))); return ['submit', 'reset', 'image'].indexOf(type) >= 0 || /(提交|保存|下一步|下一页|确认|投递|上传|submit|save|next|apply|upload)/i.test(text); }
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
    return Array.prototype.slice.call(ownerDocument.querySelectorAll('input[type="' + control.type + '"]')).filter(function (item) { return item.name === control.name && isVisible(item); });
  }
  // A radio or checkbox inside a form item is labelled by the group ("可实习时间"), while the
  // option text the user picks is the immediate label ("周一"). Keep both roles apart.
  function choiceText(control) {
    var label = control && control.closest && control.closest('label');
    var text = cleanFieldLabel(textOf(label));
    if (isUsableFieldLabel(text)) return text;
    return cleanFieldLabel(deriveLabel(control));
  }
  function choiceItems(group) {
    return (group || []).map(function (item) { return { value: item.value, text: choiceText(item) || item.value }; });
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
    return dedupeFieldDescriptors(controls.filter(function (control) { return !isSubmitLike(control); }).map(function (control, index) {
      var label = cleanFieldLabel(deriveLabel(control)); var fingerprint = makeFingerprint(control, label); var sensitive = isSensitiveField({ type: control.type || control.tagName, label: label, name: control.name, id: control.id, placeholder: control.placeholder });
      var mapping = mappings.find(function (item) { return siteMappingMatches(item, siteKey, fingerprint, label); }); var match = mapping ? values.find(function (item) { return item.profileKey === mapping.profile_key; }) : null;
      var matchLabel = [label, control.name || '', control.id || '', control.getAttribute && control.getAttribute('aria-label') || ''].filter(Boolean).join(' '); if (!match) match = findLearnedValue(label, values, used, learned);
      if (!match) match = findProfileValue(matchLabel, values, used, learned);
      var currentValue = isCustomSelectControl(control) ? customControlValue(control) : control.value || '';
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
      }
      return { id: 'resume-field-' + index, controlType: control.tagName ? control.tagName.toLowerCase() : 'custom', label: label || '未标注字段', selectorHint: control.id ? '#' + cssEscape(control.id) : null, profileKey: match ? match.profileKey : null, confidence: confidence, currentValue: currentValue, proposedValue: proposed, isNewField: isNewField || !isUsableFieldLabel(label), fingerprint: fingerprint, siteKey: siteKey, sensitive: sensitive, remember: Boolean(mapping && mapping.confirmed), isDate: isDateField(control, label), name: control.name || '' };
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
  function setTextValue(control, value) { return setNativeValue(control, value); }
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
  function findCustomOptions(control) {
    if (!control || typeof document === 'undefined') return [];
    var ownerDocument = documentOf(control);
    if (!ownerDocument) return [];
    var next = control.nextElementSibling;
    if (next && (normalizeText(next.getAttribute && next.getAttribute('role')) === 'listbox' || /dropdown|menu/i.test(String(next.className || '')))) {
      var local = Array.prototype.slice.call(next.querySelectorAll('[role="option"], li, [data-value]')).filter(isVisible);
      if (local.length) return local;
    }
    var owner = control.closest && control.closest('.ant-select, .el-select, .ivu-select, [role="combobox"]');
    if (owner) {
      var owned = Array.prototype.slice.call(owner.querySelectorAll('[role="option"], li, [data-value]')).filter(isVisible);
      if (owned.length) return owned;
    }
    var groups = Array.prototype.slice.call(ownerDocument.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden), .el-select-dropdown, .ivu-select-dropdown, [role="listbox"]')).filter(isVisible);
    var options = [];
    groups.forEach(function (group) { options = options.concat(Array.prototype.slice.call(group.querySelectorAll('[role="option"], li, [data-value]')).filter(isVisible)); });
    if (options.length) return options;
    return Array.prototype.slice.call(ownerDocument.querySelectorAll('[role="option"], [data-value]')).filter(isVisible);
  }
  async function fill(fields) {
    if (typeof document === 'undefined') return [];
    var results = [];
    var controlMap = controlIndex();
    for (var index = 0; index < (fields || []).length; index++) {
      var field = fields[index];
      if (!field || !field.proposedValue || isPlaceholderValue(field.proposedValue) || field.confidence === 'none' || field.isNewField) { results.push({ id: field && field.id, status: 'skipped', reason: '没有可用的已确认资料' }); continue; }
      var control = resolveField(field, controlMap); if (!control || isSubmitLike(control)) { results.push({ id: field.id, status: 'skipped', reason: '控件不存在或为提交控件' }); continue; }
      if (control.tagName.toLowerCase() === 'select') {
        var expectedSelectValue = expectedFieldValue(field.proposedValue, field.label);
        if (!expectedSelectValue) { results.push({ id: field.id, status: 'failed', reason: '模板缺少该日期的具体日值' }); continue; }
        var selectIndex = isDateComponentLabel(field.label) ? matchDateSelectOption(Array.prototype.slice.call(control.options), expectedSelectValue) : matchSelectOption(Array.prototype.slice.call(control.options), expectedSelectValue);
        if (selectIndex < 0) { results.push({ id: field.id, status: 'failed', reason: '下拉选项没有匹配项' }); continue; }
        control.selectedIndex = selectIndex; emitChange(control); results.push({ id: field.id, status: 'filled' }); continue;
      }
      if (control.type === 'radio' || control.type === 'checkbox') {
        var group = control.name ? choiceGroupItems(control) : [control];
        if (!group.length) group = [control];
        if (control.type === 'checkbox' && group.length === 1) {
          var flag = booleanChoice(field.proposedValue);
          if (flag !== null) { group[0].checked = flag; emitChange(group[0]); results.push({ id: field.id, status: 'filled' }); continue; }
        }
        var choiceIndexes = matchChoiceIndexes(choiceItems(group), field.proposedValue);
        if (!choiceIndexes.length) { results.push({ id: field.id, status: 'failed', reason: '选项没有精确匹配项' }); continue; }
        if (control.type === 'checkbox') {
          group.forEach(function (item, itemIndex) {
            var next = choiceIndexes.indexOf(itemIndex) >= 0;
            if (item.checked !== next) { item.checked = next; emitChange(item); }
          });
        } else {
          group[choiceIndexes[0]].checked = true;
          emitChange(group[choiceIndexes[0]]);
        }
        results.push({ id: field.id, status: 'filled' });
        continue;
      }
      if (isCustomSelectControl(control)) {
        control.click();
        var optionContainer = await waitFor(function () { var options = findCustomOptions(control); return options.length ? options : null; }, 1000);
        if (!optionContainer) { results.push({ id: field.id, status: 'failed', reason: '自定义下拉没有出现选项' }); continue; }
        var customExpectedValue = expectedFieldValue(field.proposedValue, field.label);
        if (!customExpectedValue) { results.push({ id: field.id, status: 'failed', reason: '模板缺少该日期的具体日值' }); continue; }
        var customIndex = isDateComponentLabel(field.label) ? matchDateSelectOption(optionContainer, customExpectedValue) : matchSelectOption(optionContainer, customExpectedValue);
        if (customIndex < 0) { results.push({ id: field.id, status: 'failed', reason: '自定义下拉选项没有匹配项' }); continue; }
        optionContainer[customIndex].click();
        var updated = await waitFor(function () {
          var shown = customControlValue(control);
          return shown && !isGenericPrompt(shown) ? shown : null;
        }, 1000);
        if (updated && (normalizeText(updated) === normalizeText(textOf(optionContainer[customIndex])) || normalizeText(updated).indexOf(normalizeText(textOf(optionContainer[customIndex]))) >= 0)) results.push({ id: field.id, status: 'filled' });
        else results.push({ id: field.id, status: 'failed', reason: '下拉选项点击后页面状态没有更新' });
        continue;
      }
      setTextValue(control, field.proposedValue); results.push({ id: field.id, status: 'filled' });
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
  var draftWriteChain = null;
  function updateLocalDraft(draft) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    var write = function () {
      return new Promise(function (resolve) {
        chrome.storage.local.get({ resumeProfile: { site_drafts: [] } }, function (data) {
          var profile = data.resumeProfile || {};
          profile.site_drafts = upsertDrafts(Array.isArray(profile.site_drafts) ? profile.site_drafts : [], [draft], new Date().toISOString());
          chrome.storage.local.set({ resumeProfile: profile }, function () { resolve(); });
        });
      });
    };
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
          var value = readControlValue(control);
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
  function ensureHighlightStyle() {
    if (typeof document === 'undefined') return;
    var id = '__resume_autofill_style';
    if (!document.getElementById(id)) {
      var style = document.createElement('style');
      style.id = id;
      style.textContent = '@keyframes __resume_pulse { 0% { box-shadow: 0 0 0 0 rgba(0, 120, 212, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(0, 120, 212, 0); } 100% { box-shadow: 0 0 0 0 rgba(0, 120, 212, 0); } } .__resume_autofill_highlight { outline: 3px solid #0078d4 !important; outline-offset: 3px !important; animation: __resume_pulse 1.6s infinite !important; border-radius: 4px !important; transition: outline 0.2s ease !important; }';
      (document.head || document.documentElement).appendChild(style);
    }
  }
  function clearHighlight() {
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
    if (typeof document !== 'undefined') {
      var highlighted = document.querySelectorAll('.__resume_autofill_highlight');
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
    ensureHighlightStyle();
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
  return { normalizeText: normalizeText, isRendered: isRendered, labelVariants: labelVariants, withoutLeadingQualifier: withoutLeadingQualifier, isPlaceholderValue: isPlaceholderValue, buildLearnedMap: buildLearnedMap, findLearnedValue: findLearnedValue, leafProfileKey: leafProfileKey, learnedMatch: learnedMatch, fieldConfidence: fieldConfidence, labelMatchStrength: labelMatchStrength, profileLabelStrength: profileLabelStrength, matchChoiceIndexes: matchChoiceIndexes, choiceTokens: choiceTokens, booleanChoice: booleanChoice, choiceItems: choiceItems, choiceText: choiceText, scanRoots: scanRoots, allControls: allControls, controlIndex: controlIndex, isLiveControl: isLiveControl, deriveLabel: deriveLabel, flattenProfile: flattenProfile, matchSelectOption: matchSelectOption, matchDateSelectOption: matchDateSelectOption, matchChoice: matchChoice, isSubmitLike: isSubmitLike, isSensitiveField: isSensitiveField, isGenericPrompt: isGenericPrompt, cleanFieldLabel: cleanFieldLabel, isUsableFieldLabel: isUsableFieldLabel, shouldIncludeCandidate: shouldIncludeCandidate, customControlValue: customControlValue, readControlValue: readControlValue, isScannableControl: isScannableControl, isCustomSelectControl: isCustomSelectControl, findCustomOptions: findCustomOptions, combineContextLabel: combineContextLabel, findContainerLabel: findContainerLabel, preferredContainerSelectors: preferredContainerSelectors, isNavigationOnlyLabel: isNavigationOnlyLabel, isDateComponentLabel: isDateComponentLabel, dateComponentValue: dateComponentValue, dedupeControlDescriptors: dedupeControlDescriptors, dedupeFieldDescriptors: dedupeFieldDescriptors, valueMatchesLabel: valueMatchesLabel, setNativeValue: setNativeValue, makeFingerprint: makeFingerprint, siteMappingMatches: siteMappingMatches, collectDraftValues: collectDraftValues, upsertDrafts: upsertDrafts, scan: scan, fill: fill, rememberFields: rememberFields, highlight: highlight, clearHighlight: clearHighlight };
}));
