(function () {
  'use strict';
  var profile = ResumeProfile.createEmptyProfile();
  var activeSection = 'basic';
  var $ = function (id) { return document.getElementById(id); };
  // 20x20 outline glyphs, drawn to match the Fluent System Icons weight.
  var ICONS = {
    basic: '<circle cx="10" cy="6.75" r="2.75"/><path d="M4.75 16.25c0-2.5 2.35-4 5.25-4s5.25 1.5 5.25 4"/>',
    intention: '<rect x="2.75" y="6.5" width="14.5" height="9.25" rx="2"/><path d="M7.5 6.5V5.25A1.5 1.5 0 0 1 9 3.75h2a1.5 1.5 0 0 1 1.5 1.5V6.5"/><path d="M2.75 10.75h14.5"/>',
    additional: '<circle cx="10" cy="10" r="7.25"/><line x1="10" y1="6.5" x2="10" y2="13.5"/><line x1="6.5" y1="10" x2="13.5" y2="10"/>',
    education: '<path d="M2.5 7.5 10 3.9l7.5 3.6L10 11.1 2.5 7.5Z"/><path d="M5.75 9.4v3.1c0 1.05 1.9 1.9 4.25 1.9s4.25-.85 4.25-1.9V9.4"/><path d="M17.5 7.5v4"/>',
    employment: '<path d="M3.5 4.75A1.25 1.25 0 0 1 4.75 3.5h5.5a1.25 1.25 0 0 1 1.25 1.25v11.75"/><path d="M11.5 7.75h3.75A1.25 1.25 0 0 1 16.5 9v6.5"/><path d="M2.75 16.5h14.5"/><path d="M6.25 6.5h2.5M6.25 9.5h2.5M6.25 12.5h2.5"/>',
    projects: '<path d="M2.75 6.25A1.5 1.5 0 0 1 4.25 4.75h2.9l1.6 2h7A1.5 1.5 0 0 1 17.25 8.25v6A1.5 1.5 0 0 1 15.75 15.75H4.25a1.5 1.5 0 0 1-1.5-1.5v-8Z"/>',
    honors: '<path d="M6.5 3.5h7v4.25a3.5 3.5 0 1 1-7 0V3.5Z"/><path d="M6.5 4.75H5.25A1.75 1.75 0 0 0 3.5 6.5c0 1.5 1.2 2.75 2.75 2.75"/><path d="M13.5 4.75h1.25a1.75 1.75 0 0 1 1.75 1.75c0 1.5-1.2 2.75-2.75 2.75"/><path d="M10 11.25V14"/><path d="M8.25 16.5V14h3.5v2.5"/><path d="M6.75 16.5h6.5"/>',
    activities: '<circle cx="7.75" cy="7" r="2.6"/><path d="M3 16.25c0-2.2 2.15-3.6 4.75-3.6s4.75 1.4 4.75 3.6"/><path d="M13.25 5.1a2.4 2.4 0 0 1 0 4.5"/><path d="M14.25 12.9c1.75.35 2.75 1.5 2.75 3.35"/>',
    campus_roles: '<path d="M10 3.25l2.06 4.18 4.61.67-3.34 3.25.79 4.6L10 13.78l-4.12 2.17.79-4.6L3.33 8.1l4.61-.67L10 3.25Z"/>',
    skills: '<path d="M11.25 2.75 4.75 11.1h4.4l-.4 6.15 6.5-8.35h-4.4l.4-6.15Z"/>',
    self_evaluation: '<path d="M5.25 3.25h6.1l3.4 3.4v10.1a1 1 0 0 1-1 1H5.25a1 1 0 0 1-1-1V4.25a1 1 0 0 1 1-1Z"/><path d="M11.25 3.5v3.4h3.4"/><path d="M7 11h6M7 13.75h4"/>',
    application_answers: '<circle cx="10" cy="10" r="7.25"/><path d="M8.15 7.85a1.95 1.95 0 0 1 3.8.6c0 1.3-1.95 1.95-1.95 1.95"/><path d="M10 13.6h.01"/>',
    custom_fields: '<path d="M3.25 9.85V4.75a1.5 1.5 0 0 1 1.5-1.5h5.1a1.5 1.5 0 0 1 1.06.44l6.05 6.05a1.5 1.5 0 0 1 0 2.12l-5.1 5.1a1.5 1.5 0 0 1-2.12 0l-6.05-6.05a1.5 1.5 0 0 1-.44-1.06Z"/><circle cx="7" cy="7" r="1.05"/>'
  };
  // Accent choices mirror the Windows personalisation palette.
  var ACCENTS = [ResumeShared.DEFAULT_ACCENT, '#0099bc', '#00b294', '#107c10', '#8764b8', '#c239b3', '#ca5010', '#e81123'];
  var DEFAULT_ACCENT = ACCENTS[0];
  var accent = DEFAULT_ACCENT;
  var tabs = [
    ['basic', '基本信息'], ['intention', '求职意向'], ['additional', '附加信息'], ['education', '教育经历'],
    ['employment', '工作/实习'], ['projects', '项目经历'], ['honors', '荣誉奖励'],
    ['activities', '实践活动'], ['campus_roles', '校内职务'], ['skills', '技能'], ['family', '家庭背景'],
    ['self_evaluation', '自我评价'], ['application_answers', '网申问答'], ['custom_fields', '我加的项']
  ];
  var scalarFields = {
    basic: [['name', '姓名'], ['gender', '性别'], ['birth_date', '出生日期', 'date'], ['age', '年龄'], ['work_start_date', '参加工作时间'], ['work_years', '工作经验'], ['ethnicity', '民族'], ['native_place', '籍贯'], ['political_status', '政治面貌'], ['marital_status', '婚姻状况'], ['household_registration', '户口所在地'], ['place_of_origin', '生源地'], ['current_residence', '现居住地'], ['mailing_address', '通信地址', 'wide'], ['phone', '联系电话'], ['phone_code', '手机区号 / 类别（如 +86 / 中国大陆）'], ['email', '邮箱'], ['wechat', '微信'], ['qq', 'QQ'], ['id_type', '证件类型'], ['id_number', '身份证号'], ['has_children', '有无子女'], ['emergency_contact', '紧急联系人'], ['emergency_phone', '紧急联系电话'], ['height', '身高（cm，只填数字）'], ['weight', '体重（kg，只填数字）']],
    intention: [['target_role', '期望职位'], ['industry', '期望行业', 'wide'], ['city', '期望城市'], ['salary', '期望薪资'], ['employment_type', '工作性质'], ['interview_site', '面试站点'], ['available_date', '可到岗时间']],
    additional: [['hobbies', '兴趣爱好', 'wide'], ['specialty', '特长', 'wide'], ['punishment', '受处分情况', 'wide'], ['academic_works', '学术专著', 'wide'], ['patents', '专利成果', 'wide'], ['law_violation', '违法违纪情况'], ['applied_subsidiary', '是否应聘过本公司'], ['relatives_in_company', '是否有亲友在本公司'], ['medical_history', '手术史或重大疾病史', 'wide'], ['referral_code', '推荐码'], ['accept_adjustment', '是否接受岗位调剂'], ['siblings_count', '兄弟姐妹数量']]
  };
  var recordFields = {
    education: [['school', '学校'], ['college', '学院'], ['student_id', '学号'], ['start_date', '开始时间', 'period'], ['end_date', '结束时间', 'period'], ['duration_years', '学制（年）'], ['level', '学历'], ['admission_type', '招生类型'], ['study_mode', '学习形式'], ['graduate_type', '应届往届'], ['degree_certificate', '学位证'], ['degree_name', '学位名称'], ['major', '专业'], ['second_major', '第二专业'], ['major_category', '专业分类'], ['major_rank', '专业排名'], ['major_rank_percent', '专业排名（百分比）'], ['gpa', '绩点/均分'], ['gpa_max', '满分平均学分绩点'], ['weighted_score', '加权平均分'], ['score_max', '满分'], ['has_failed_course', '是否有挂科经历'], ['english_level', '英语等级'], ['english_score', '英语等级成绩'], ['research_direction', '研究方向', 'wide'], ['advisor', '导师'], ['thesis_title', '毕业论文题目', 'full'], ['description', '教育经历描述', 'full']],
    employment: [['employer', '单位'], ['role', '职位'], ['start_date', '开始时间', 'period'], ['end_date', '结束时间', 'period'], ['employer_type', '单位性质'], ['location', '工作地点'], ['project_name', '项目名称'], ['salary', '税前月薪']],
    projects: [['name', '项目名称'], ['start_date', '开始时间', 'period'], ['end_date', '结束时间', 'period'], ['role', '担任角色'], ['organization', '项目单位'], ['participant_count', '参加人数'], ['research_direction', '研究方向', 'wide'], ['introduction', '项目介绍', 'full'], ['outcomes', '项目成果', 'full'], ['related_paper', '相关论文', 'wide']],
    honors: [['name', '荣誉名称'], ['date', '获得时间', 'period'], ['issuer', '颁发单位'], ['description', '说明', 'full']],
    activities: [['name', '活动名称'], ['start_date', '开始时间', 'period'], ['end_date', '结束时间', 'period'], ['role', '身份/角色'], ['organization', '组织'], ['description', '活动描述', 'full']],
    campus_roles: [['organization', '组织/学校'], ['role', '职务'], ['start_date', '开始时间', 'period'], ['end_date', '结束时间', 'period'], ['gains', '任职收获', 'full']],
    skills: [['category', '分类'], ['name', '技能名称'], ['level', '熟练程度'], ['score', '成绩'], ['evidence', '应用说明', 'wide']],
    family: [['relation', '关系'], ['name', '姓名'], ['employer', '工作单位'], ['role', '职务'], ['phone', '联系电话']],
    application_answers: [['question', '题目', 'wide'], ['answer', '回答', 'full']],
    custom_fields: [['key', '名称'], ['label', '显示标签'], ['category', '分类'], ['value', '默认内容', 'wide'], ['field_type', '类型']]
  };
  var arrayFields = { education: ['courses', '课程'], employment: ['duties', '工作内容'], projects: ['duties', '项目职责'], skills: ['skills', '相关技能'], campus_roles: ['duties', '工作内容'], custom_fields: ['aliases', '网页上的其他叫法'] };

  // The three-way merge and the accent live in shared.js, which the popup loads too, so the two
  // pages cannot drift apart.
  var store = ResumeShared.createStore();
  // Only the base accent is stored; hover and pressed steps derive from it in CSS.
  var applyAccent = ResumeShared.applyAccent;
  function renderAccentPicker() {
    var wrap = $('accentPicker');
    if (!wrap) return;
    wrap.textContent = '';
    ACCENTS.forEach(function (color) {
      var active = String(accent).toLowerCase() === color.toLowerCase();
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'accent-swatch' + (active ? ' active' : '');
      swatch.style.setProperty('--swatch', color);
      swatch.title = color;
      swatch.setAttribute('role', 'radio');
      swatch.setAttribute('aria-label', '颜色 ' + color);
      swatch.setAttribute('aria-checked', active ? 'true' : 'false');
      swatch.addEventListener('click', function () {
        accent = color;
        applyAccent(color);
        chrome.storage.local.set({ resumeAccent: color });
        renderAccentPicker();
      });
      wrap.appendChild(swatch);
    });
  }
  function navIcon(key) {
    var span = document.createElement('span');
    span.className = 'nav-icon';
    span.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[key] || '') + '</svg>';
    return span;
  }
  function navLabel(text) {
    var span = document.createElement('span');
    span.className = 'nav-label';
    span.textContent = text;
    return span;
  }

  function save() {
    return store.saveProfile(profile).then(function (saved) {
      // The editor renders from this object, so keep the merged result on screen.
      profile = saved;
      return saved;
    });
  }
  function load() {
    return store.loadProfile().then(function (loaded) {
      profile = loaded.profile;
      accent = loaded.accent || DEFAULT_ACCENT;
      applyAccent(accent);
    });
  }
  // A period keeps month precision valid ("2024-09") while allowing day precision
  // ("2024-09-18"). A native date input cannot represent the month-only form: it would
  // blank the field and the next save would drop the value, so this stays a text input.
  var PERIOD_RE = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/;
  function normalizePeriod(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    var match = PERIOD_RE.exec(text);
    if (!match) return text;
    var pad = function (part) { return part.length < 2 ? '0' + part : part; };
    var day = match[3] ? '-' + pad(String(Number(match[3]))) : '';
    return match[1] + '-' + pad(String(Number(match[2]))) + day;
  }
  function isValidPeriod(text) {
    if (!text) return true;
    var match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text);
    if (!match) return false;
    if (Number(match[2]) < 1 || Number(match[2]) > 12) return false;
    if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 31)) return false;
    return true;
  }

  var PRESET_FIELD_OPTIONS = {
    gender: ['男', '女'],
    phone_code: ['+86', '+852', '+853', '+886'],
    id_type: ['身份证', '护照', '港澳居民来往内地通行证', '台湾居民来往大陆通行证', '其他'],
    political_status: ['中共党员', '共青团员', '群众', '中共预备党员', '民主党派'],
    marital_status: ['未婚', '已婚', '离异'],
    has_children: ['无', '有'],
    level: ['硕士研究生', '本科', '博士研究生', '专科'],
    degree_certificate: ['硕士学位', '学士学位', '博士学位', '无'],
    admission_type: ['普通统招', '推荐免试(保研)', '全国统考', '定向培养'],
    study_mode: ['全日制', '非全日制'],
    graduate_type: ['应届生', '往届生'],
    english_level: ['大学英语六级(CET-6)', '大学英语四级(CET-4)', '专业八级(TEM-8)', '专业四级(TEM-4)', '雅思(IELTS)', '托福(TOEFL)', '无'],
    employment_type: ['全职', '实习', '兼职'],
    law_violation: ['无', '有'],
    applied_subsidiary: ['否', '是'],
    relatives_in_company: ['否', '是'],
    medical_history: ['无', '有'],
    has_failed_course: ['否', '是'],
    accept_adjustment: ['是', '否'],
    relation: ['父亲', '母亲', '配偶', '其他']
  };
  function field(key, label, value, kind) {
    var wrapper = document.createElement('div'); wrapper.className = 'field ' + (kind === 'wide' ? 'wide' : kind === 'full' ? 'full' : '');
    var labelNode = document.createElement('label'); labelNode.textContent = label; labelNode.htmlFor = 'field-' + key;
    var input = (kind === 'full' || key === 'research_direction' || key === 'introduction' || key === 'outcomes' || key === 'description' || key === 'gains' || key === 'answer') ? document.createElement('textarea') : document.createElement('input');
    input.id = 'field-' + key; input.value = value || '';
    if (kind === 'date') input.type = 'date';
    if (kind === 'period') {
      input.type = 'text';
      input.placeholder = 'YYYY-MM 或 YYYY-MM-DD';
      input.autocomplete = 'off';
      input.spellcheck = false;
    }
    var fieldName = key.indexOf('-') >= 0 ? key.split('-').pop() : key;
    if (fieldName === 'id_number') input.placeholder = '18位居民身份证号';
    else if (fieldName === 'phone_code') input.placeholder = '+86';
    else if (fieldName === 'phone' || fieldName === 'emergency_phone') input.placeholder = '11位手机号码';

    input.addEventListener('input', function () { wrapper.__onChange(input.value); }); wrapper.__onChange = function () {};
    wrapper.append(labelNode, input);

    var presets = PRESET_FIELD_OPTIONS[fieldName];
    if (presets && input.tagName.toLowerCase() === 'input') {
      var datalistId = 'datalist-' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
      input.setAttribute('list', datalistId);
      var datalist = document.createElement('datalist');
      datalist.id = datalistId;
      presets.forEach(function (opt) {
        var option = document.createElement('option');
        option.value = opt;
        datalist.appendChild(option);
      });
      wrapper.appendChild(datalist);

      var chipsWrap = document.createElement('div');
      chipsWrap.className = 'field-chips';
      var chips = presets.map(function (opt) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'field-chip';
        chip.textContent = opt;
        chip.addEventListener('click', function () {
          input.value = opt;
          wrapper.__onChange(opt);
          updateChipsState();
        });
        chipsWrap.appendChild(chip);
        return chip;
      });
      wrapper.appendChild(chipsWrap);

      var updateChipsState = function () {
        chips.forEach(function (chip) {
          chip.classList.toggle('active', chip.textContent === input.value);
        });
      };
      input.addEventListener('input', updateChipsState);
      updateChipsState();
    }
    if (kind === 'period') {
      var hint = document.createElement('small');
      hint.className = 'field-hint';
      hint.textContent = '写成 2024-09 或 2024-09-18 都可以，精确到日就写全';
      wrapper.appendChild(hint);
      var syncPeriodState = function () {
        var valid = isValidPeriod(normalizePeriod(input.value));
        input.classList.toggle('is-invalid', !valid);
        hint.hidden = valid;
      };
      input.addEventListener('input', syncPeriodState);
      input.addEventListener('change', function () {
        var normalized = normalizePeriod(input.value);
        if (normalized !== input.value) { input.value = normalized; wrapper.__onChange(normalized); }
        syncPeriodState();
      });
      syncPeriodState();
    }
    return { wrapper: wrapper, set: function (handler) { wrapper.__onChange = handler; } };
  }
  function renderScalar(section) {
    var panel = document.createElement('section'); panel.className = 'panel'; var heading = document.createElement('div'); heading.className = 'panel-heading'; var h = document.createElement('h2'); h.textContent = tabs.find(function (tab) { return tab[0] === section; })[1]; heading.appendChild(h); panel.appendChild(heading);
    var grid = document.createElement('div'); grid.className = 'field-grid'; (scalarFields[section] || []).forEach(function (meta) { var item = field(meta[0], meta[1], profile[section][meta[0]], meta[2]); item.set(function (value) { profile[section][meta[0]] = value; }); grid.appendChild(item.wrapper); }); panel.appendChild(grid); return panel;
  }
  function renderSelfEvaluation() { var panel = document.createElement('section'); panel.className = 'panel'; var h = document.createElement('h2'); h.textContent = '自我评价'; panel.appendChild(h); var item = field('self_evaluation', '自我评价', profile.self_evaluation, 'full'); item.set(function (value) { profile.self_evaluation = value; }); panel.appendChild(item.wrapper); return panel; }
  function renderRecord(section, record, index) {
    var panel = document.createElement('section'); panel.className = 'panel record'; var heading = document.createElement('div'); heading.className = 'record-heading'; var title = document.createElement('strong'); title.textContent = (tabs.find(function (tab) { return tab[0] === section; }) || ['', section])[1] + ' ' + (index + 1); var remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = '删除'; remove.addEventListener('click', function () { profile[section].splice(index, 1); render(); }); heading.append(title, remove); panel.appendChild(heading);
    var grid = document.createElement('div'); grid.className = 'field-grid'; (recordFields[section] || []).forEach(function (meta) { var item = field(section + '-' + index + '-' + meta[0], meta[1], record[meta[0]], meta[2]); item.set(function (value) { record[meta[0]] = value; }); grid.appendChild(item.wrapper); });
    var arrayMeta = arrayFields[section]; if (arrayMeta) { var arrayWrap = document.createElement('div'); arrayWrap.className = 'field full array-editor'; var arrayLabel = document.createElement('label'); arrayLabel.textContent = arrayMeta[1]; arrayWrap.appendChild(arrayLabel); var values = record[arrayMeta[0]] || []; values.forEach(function (value, valueIndex) { var row = document.createElement('div'); row.className = 'array-row'; var input = document.createElement('input'); input.value = value; input.addEventListener('input', function () { record[arrayMeta[0]][valueIndex] = input.value; }); var removeValue = document.createElement('button'); removeValue.textContent = '移除'; removeValue.addEventListener('click', function () { record[arrayMeta[0]].splice(valueIndex, 1); render(); }); row.append(input, removeValue); arrayWrap.appendChild(row); }); var addValue = document.createElement('button'); addValue.textContent = '再加一项'; addValue.addEventListener('click', function () { record[arrayMeta[0]] = record[arrayMeta[0]] || []; record[arrayMeta[0]].push(''); render(); }); arrayWrap.appendChild(addValue); grid.appendChild(arrayWrap); }
    panel.appendChild(grid); return panel;
  }
  function renderRecords(section) {
    var container = document.createElement('div');
    var records = Array.isArray(profile[section]) ? profile[section] : [];
    records.forEach(function (record, index) { container.appendChild(renderRecord(section, record || {}, index)); });
    var add = document.createElement('button'); add.className = 'add-record'; add.textContent = '再加一条'; add.addEventListener('click', function () { profile[section] = Array.isArray(profile[section]) ? profile[section] : []; profile[section].push({}); render(); });
    container.appendChild(add);
    return container;
  }
  function renderSiteMemory() {
    var panel = document.createElement('section'); panel.className = 'panel'; var heading = document.createElement('div'); heading.className = 'panel-heading'; var h = document.createElement('h2'); h.textContent = '记住的网页项目'; var note = document.createElement('p'); note.className = 'panel-note'; note.textContent = '这里只显示记住了哪些网站和名称，不显示你填的内容。'; heading.append(h, note); panel.appendChild(heading);
    var mappings = profile.site_mappings || []; var drafts = profile.site_drafts || [];
    if (!mappings.length) { var empty = document.createElement('p'); empty.className = 'panel-note'; empty.textContent = '还没有记住过任何网页项目。'; panel.appendChild(empty); return panel; }
    mappings.forEach(function (mapping, index) { var row = document.createElement('div'); row.className = 'memory-row'; var text = document.createElement('div'); var title = document.createElement('strong'); title.textContent = (mapping.site_key || '当前网站') + ' · ' + (mapping.label || mapping.profile_key || '没有名称'); var meta = document.createElement('span'); var draft = drafts.find(function (item) { return item.site_key === mapping.site_key && item.fingerprint === mapping.fingerprint && item.profile_key === mapping.profile_key; }); meta.textContent = draft ? '已记住你填的内容' : '已记住'; text.append(title, meta); var remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = '移除'; remove.addEventListener('click', function () { profile.site_mappings.splice(index, 1); profile.site_drafts = drafts.filter(function (item) { return !(item.site_key === mapping.site_key && item.fingerprint === mapping.fingerprint && item.profile_key === mapping.profile_key); }); render(); }); row.append(text, remove); panel.appendChild(row); }); return panel;
  }
  function renderCustomFields() { var container = renderRecords('custom_fields'); container.appendChild(renderSiteMemory()); return container; }
  function render() {
    var tabWrap = $('tabs');
    tabWrap.textContent = '';
    tabs.forEach(function (tab) {
      var selected = activeSection === tab[0];
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-item' + (selected ? ' active' : '');
      button.title = tab[1];
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.append(navIcon(tab[0]), navLabel(tab[1]));
      button.addEventListener('click', function () { activeSection = tab[0]; render(); });
      tabWrap.appendChild(button);
    });
    var editor = $('editor'); editor.textContent = ''; if (activeSection === 'self_evaluation') editor.appendChild(renderSelfEvaluation()); else if (scalarFields[activeSection]) editor.appendChild(renderScalar(activeSection)); else if (activeSection === 'custom_fields') editor.appendChild(renderCustomFields()); else editor.appendChild(renderRecords(activeSection)); }
  $('saveButton').addEventListener('click', function () {
    save().then(function () { $('status').textContent = '已保存。'; })
      .catch(function (error) { $('status').textContent = '保存失败：' + (error && error.message ? error.message : '未知错误'); });
  });
  $('importButton').addEventListener('click', function () { $('fileInput').click(); });
  $('fileInput').addEventListener('change', function () { var file = $('fileInput').files[0]; if (!file) return; var reader = new FileReader(); reader.onload = function () { try { profile = ResumeProfile.parse(reader.result); render(); save().then(function () { $('status').textContent = '模板导入成功，重复本科记录已合并。'; }).catch(function (error) { $('status').textContent = '导入后保存失败：' + (error && error.message ? error.message : '未知错误'); }); } catch (error) { $('status').textContent = '导入失败：' + error.message; } }; reader.readAsText(file, 'utf-8'); });
  $('exportButton').addEventListener('click', function () {
    try {
      var blob = new Blob([ResumeProfile.stringify(profile)], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = '简历资料导出.txt';
      link.click();
      URL.revokeObjectURL(url);
      $('status').textContent = '资料已导出到本地。';
    } catch (error) {
      $('status').textContent = '导出失败：' + (error && error.message ? error.message : '未知错误');
    }
  });
  var navToggle = $('navToggle');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var collapsed = $('app').classList.toggle('is-collapsed');
      navToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      navToggle.title = collapsed ? '展开菜单' : '收起菜单';
    });
  }
  load().then(function () { render(); renderAccentPicker(); }).catch(function (error) {
    profile = ResumeProfile.createEmptyProfile();
    render();
    renderAccentPicker();
    $('status').textContent = '本地资料读取失败，已显示空白编辑器：' + (error && error.message ? error.message : '未知错误');
  });
}());
