(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ResumeProfile = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ARRAY_KEYS = {
    course: 'courses',
    courses: 'courses',
    duty: 'duties',
    duties: 'duties',
    skill: 'skills',
    skills: 'skills',
    alias: 'aliases',
    aliases: 'aliases',
    answer: 'application_answers',
    question: 'application_answers'
  };
  var ARRAY_SECTIONS = {
    education: 'education',
    employment: 'employment',
    work: 'employment',
    projects: 'projects',
    project: 'projects',
    honors: 'honors',
    honor: 'honors',
    activities: 'activities',
    activity: 'activities',
    campus_roles: 'campus_roles',
    campus_role: 'campus_roles',
    skills: 'skills',
    application_answers: 'application_answers',
    custom_fields: 'custom_fields',
    site_mappings: 'site_mappings',
    site_drafts: 'site_drafts',
    label_mappings: 'label_mappings'
  };
  var SECTION_ORDER = [
    'basic', 'intention', 'education', 'employment', 'projects', 'honors',
    'activities', 'campus_roles', 'skills', 'self_evaluation',
    'application_answers', 'custom_fields', 'site_mappings', 'site_drafts', 'label_mappings',
    'additional'
  ];
  var KNOWN_KEYS = {
    basic: ['name', 'gender', 'birth_date', 'age', 'work_start_date', 'work_years', 'ethnicity', 'native_place', 'political_status', 'marital_status', 'household_registration', 'place_of_origin', 'current_residence', 'mailing_address', 'phone', 'phone_code', 'email', 'wechat', 'qq', 'id_type', 'id_number', 'has_children', 'emergency_contact', 'emergency_phone', 'height', 'weight'],
    intention: ['target_role', 'industry', 'city', 'salary', 'employment_type', 'available_date', 'interview_site'],
    education: ['school', 'college', 'start_date', 'end_date', 'duration_years', 'level', 'admission_type', 'study_mode', 'graduate_type', 'degree_certificate', 'degree_name', 'major', 'second_major', 'major_category', 'major_rank', 'gpa', 'english_level', 'english_score', 'research_direction', 'advisor', 'thesis_title', 'courses', 'description'],
    additional: ['hobbies', 'specialty', 'punishment', 'academic_works', 'patents', 'law_violation', 'applied_subsidiary', 'relatives_in_company', 'medical_history', 'referral_code'],
    employment: ['employer', 'role', 'start_date', 'end_date', 'employer_type', 'location', 'project_name', 'salary', 'duties', 'description'],
    projects: ['name', 'start_date', 'end_date', 'role', 'organization', 'participant_count', 'research_direction', 'introduction', 'duties', 'outcomes', 'skills', 'related_paper'],
    honors: ['name', 'date', 'issuer', 'description'],
    activities: ['name', 'start_date', 'end_date', 'role', 'organization', 'description'],
    campus_roles: ['organization', 'role', 'start_date', 'end_date', 'duties', 'gains'],
    skills: ['category', 'name', 'level', 'evidence'],
    application_answers: ['question', 'answer'],
    custom_fields: ['key', 'label', 'category', 'value', 'aliases', 'field_type', 'enabled'],
    site_mappings: ['site_key', 'fingerprint', 'selector_hint', 'label', 'profile_key', 'field_type', 'confirmed'],
    site_drafts: ['site_key', 'fingerprint', 'profile_key', 'value', 'updated_at'],
    label_mappings: ['label', 'profile_key', 'updated_at']
  };

  function createEmptyProfile() {
    return {
      basic: {}, intention: {}, additional: {}, education: [], employment: [], projects: [],
      honors: [], activities: [], campus_roles: [], skills: [],
      self_evaluation: '', application_answers: [], custom_fields: [],
      site_mappings: [], site_drafts: [], label_mappings: [], extras: {}
    };
  }

  function trim(value) { return String(value == null ? '' : value).trim(); }
  function isUnsafeName(value) { return ['__proto__', 'prototype', 'constructor'].indexOf(String(value).toLowerCase()) >= 0; }
  function sectionParts(section) {
    var match = /^([^.]+)(?:\.(\d+))?$/.exec(section);
    if (match && isUnsafeName(match[1])) throw new Error('unsafe section name: ' + section);
    return match ? { name: match[1], index: match[2] ? Number(match[2]) : null } : null;
  }
  function targetForSection(section) {
    var parts = sectionParts(section);
    if (!parts) return null;
    if (parts.name === 'attachments') return { ignore: true };
    var target = ARRAY_SECTIONS[parts.name];
    if (target) return { key: target, index: parts.index == null ? 0 : Math.max(parts.index - 1, 0), record: true };
    if (parts.name === 'basic' || parts.name === 'intention' || parts.name === 'additional' || parts.name === 'self_evaluation') {
      return { key: parts.name, index: null, record: false };
    }
    return null;
  }
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  // A template the user has not finished filling still carries the sample wording. Those
  // markers must behave as "no value" everywhere, otherwise importing a half-filled template
  // types 请填写 into a phone field. 待补充 is the marker older profiles already use.
  var PLACEHOLDER_VALUES = ['请填写', '请输入', '请选择', '请上传', '请搜索', '待补充', '待填写', '待完善'];
  function isPlaceholder(value) {
    return typeof value === 'string' && PLACEHOLDER_VALUES.indexOf(value.trim()) >= 0;
  }
  function isBlankValue(value) {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim() === '' || isPlaceholder(value);
    if (Array.isArray(value)) return value.every(isBlankValue);
    return false;
  }
  function isEmpty(value) {
    return isBlankValue(value);
  }
  // A record whose every field is blank is template scaffolding, not data. Both parse and
  // stringify drop it, so an unfinished template does not become a screenful of empty cards
  // and a profile still round-trips byte for byte.
  function recordHasNoValue(record) {
    if (!record || typeof record !== 'object') return true;
    return Object.keys(record).every(function (key) { return isBlankValue(record[key]); });
  }

  // Fields an unrecognised page field can be assigned to. The popup builds its dropdown from
  // this; options.js keeps its own tables because those also carry grid-layout hints.
  var ASSIGNABLE_FIELDS = [
    { section: 'basic', label: '基本信息', scalar: true, fields: [['name', '姓名'], ['gender', '性别'], ['birth_date', '出生日期'], ['age', '年龄'], ['work_start_date', '参加工作时间'], ['work_years', '工作经验'], ['ethnicity', '民族'], ['native_place', '籍贯'], ['political_status', '政治面貌'], ['marital_status', '婚姻状况'], ['household_registration', '户口所在地'], ['place_of_origin', '生源地'], ['current_residence', '现居住地'], ['mailing_address', '通信地址'], ['phone', '联系电话'], ['phone_code', '手机区号/类别'], ['email', '邮箱'], ['wechat', '微信'], ['qq', 'QQ'], ['id_type', '证件类型'], ['id_number', '身份证号'], ['has_children', '有无子女'], ['emergency_contact', '紧急联系人'], ['emergency_phone', '紧急联系电话'], ['height', '身高'], ['weight', '体重']] },
    { section: 'intention', label: '求职意向', scalar: true, fields: [['target_role', '期望职位'], ['industry', '期望行业'], ['city', '期望城市'], ['salary', '期望薪资'], ['employment_type', '工作性质'], ['available_date', '可到岗时间'], ['interview_site', '面试站点']] },
    { section: 'education', label: '教育经历', fields: [['school', '学校'], ['college', '学院'], ['start_date', '开始时间'], ['end_date', '结束时间'], ['duration_years', '学制'], ['level', '学历'], ['admission_type', '招生类型'], ['study_mode', '学习形式'], ['graduate_type', '应届往届'], ['degree_certificate', '学位证'], ['degree_name', '学位名称'], ['major', '专业'], ['second_major', '第二专业'], ['major_category', '专业分类'], ['major_rank', '专业排名'], ['gpa', '绩点/均分'], ['english_level', '英语等级'], ['english_score', '英语等级成绩'], ['research_direction', '研究方向'], ['advisor', '导师'], ['thesis_title', '毕业论文题目'], ['description', '描述']] },
    { section: 'employment', label: '工作/实习', fields: [['employer', '单位'], ['role', '职位'], ['start_date', '开始时间'], ['end_date', '结束时间'], ['employer_type', '单位性质'], ['location', '工作地点'], ['salary', '税前月薪'], ['description', '工作内容']] },
    { section: 'projects', label: '项目经历', fields: [['name', '项目名称'], ['role', '担任角色'], ['organization', '项目单位'], ['start_date', '开始时间'], ['end_date', '结束时间'], ['introduction', '项目介绍'], ['outcomes', '项目成果'], ['related_paper', '相关论文']] },
    { section: 'honors', label: '荣誉奖励', fields: [['name', '荣誉名称'], ['date', '获得时间'], ['issuer', '颁发单位'], ['description', '说明']] },
    { section: 'activities', label: '实践活动', fields: [['name', '活动名称'], ['role', '身份/角色'], ['organization', '组织'], ['start_date', '开始时间'], ['end_date', '结束时间'], ['description', '活动描述']] },
    { section: 'campus_roles', label: '校内职务', fields: [['organization', '组织/学校'], ['role', '职务'], ['start_date', '开始时间'], ['end_date', '结束时间'], ['gains', '任职收获']] },
    { section: 'skills', label: '技能', fields: [['name', '技能名称'], ['category', '分类'], ['level', '熟练程度'], ['evidence', '应用说明']] },
    { section: 'additional', label: '附加信息', scalar: true, fields: [['hobbies', '兴趣爱好'], ['specialty', '特长'], ['punishment', '受处分情况'], ['academic_works', '学术专著'], ['patents', '专利成果'], ['law_violation', '违法违纪情况'], ['applied_subsidiary', '是否应聘过本公司'], ['relatives_in_company', '是否有亲友在本公司'], ['medical_history', '手术史或重大疾病史'], ['referral_code', '推荐码']] },
    { section: 'self_evaluation', label: '自我评价', single: true, fields: [['self_evaluation', '自我评价']] }
  ];

  // Reads the value a freshly assigned field should offer, e.g. education.1.school -> 示例大学.
  // Offers the value a freshly assigned page field should be filled with. A leftover template
  // marker is reported as empty so it can never be confirmed into a real form.
  function readValueOrEmpty(value) {
    if (Array.isArray(value)) return value.map(trim).filter(Boolean).join('\n');
    var text = trim(value);
    return isPlaceholder(text) ? '' : text;
  }
  function readAssignedValue(profile, profileKey) {
    var parts = String(profileKey == null ? '' : profileKey).split('.');
    var source = profile || {};
    if (parts.length === 1) return readValueOrEmpty(source[parts[0]]);
    if (parts.length === 2) {
      var holder = source[parts[0]];
      return holder && typeof holder === 'object' && !Array.isArray(holder) ? readValueOrEmpty(holder[parts[1]]) : '';
    }
    var records = source[parts[0]];
    var record = Array.isArray(records) ? records[Number(parts[1]) - 1] : null;
    return record ? readValueOrEmpty(record[parts[2]]) : '';
  }

  // Records "this page wording means that field". Stored globally, not per site, because
  // recruitment sites share vocabulary. Returns true when something was added.
  function upsertLabelMapping(profile, label, profileKey, updatedAt) {
    var text = trim(label);
    var key = trim(profileKey);
    if (!profile || !text || !key) return false;
    if (!Array.isArray(profile.label_mappings)) profile.label_mappings = [];
    var existing = profile.label_mappings.some(function (entry) {
      return entry && trim(entry.label) === text && trim(entry.profile_key) === key;
    });
    if (existing) return false;
    profile.label_mappings.push({ label: text, profile_key: key, updated_at: updatedAt || new Date().toISOString() });
    return true;
  }

  function mergeDuplicateEducation(records) {
    var output = [];
    var indexes = Object.create(null);
    (records || []).forEach(function (input) {
      var record = clone(input || {});
      var key = [record.school, record.level, record.major, record.start_date, record.end_date]
        .map(function (value) { return trim(value).toLowerCase(); }).join('|');
      var duplicate = record.level === '本科' && key !== '||||' && indexes[key] != null;
      if (!duplicate) {
        if (record.level === '本科' && key !== '||||') indexes[key] = output.length;
        output.push(record);
        return;
      }
      var existing = output[indexes[key]];
      Object.keys(record).forEach(function (field) {
        if (isEmpty(existing[field]) && !isEmpty(record[field])) existing[field] = record[field];
        if (Array.isArray(record[field])) {
          existing[field] = (existing[field] || []).concat(record[field] || [])
            .filter(function (item, index, array) { return item && array.indexOf(item) === index; });
        }
      });
    });
    return output;
  }

  function mergeRecordsByKey(records, keyFields) {
    var output = [];
    var indexes = Object.create(null);
    (records || []).forEach(function (input) {
      var record = clone(input || {});
      var key = keyFields.map(function (field) { return trim(record[field]).toLowerCase(); }).join('|');
      if (!key || keyFields.every(function (field) { return !trim(record[field]); })) {
        output.push(record);
        return;
      }
      if (indexes[key] == null) {
        indexes[key] = output.length;
        output.push(record);
        return;
      }
      var existing = output[indexes[key]];
      Object.keys(record).forEach(function (field) {
        if (isEmpty(existing[field]) && !isEmpty(record[field])) existing[field] = record[field];
        if (Array.isArray(record[field])) {
          existing[field] = (existing[field] || []).concat(record[field] || [])
            .filter(function (item, index, array) { return item && array.indexOf(item) === index; });
        }
      });
    });
    return output;
  }

  function recordKey(record, keyFields) {
    return keyFields.map(function (field) { return trim(record && record[field]); }).join('\u0000');
  }
  // Three way merge used before writing storage: keep everything the editor has, append
  // records another context stored since the editor loaded, and never resurrect a record
  // the editor deleted. Current entries keep their identity so open editors stay bound.
  function mergeRecords(baseline, current, stored, keyFields, preferStored) {
    var fields = keyFields && keyFields.length ? keyFields : ['key'];
    var output = (current || []).slice();
    var position = Object.create(null);
    var previous = Object.create(null);
    output.forEach(function (record, index) { position[recordKey(record, fields)] = index; });
    (baseline || []).forEach(function (record) { previous[recordKey(record, fields)] = true; });
    (stored || []).forEach(function (record) {
      var key = recordKey(record, fields);
      var index = position[key];
      if (index !== undefined) {
        // The record exists on both sides. Page recorded values win over a stale editor copy.
        if (preferStored) output[index] = clone(record);
        return;
      }
      if (previous[key]) return;
      position[key] = output.length;
      output.push(clone(record));
    });
    return output;
  }
  // Write merged records back into the live array so controls already bound to it keep working.
  function replaceRecords(target, merged) {
    if (!Array.isArray(target)) return merged || [];
    target.length = 0;
    (merged || []).forEach(function (record) { target.push(record); });
    return target;
  }

  function normalize(profile) {
    var base = createEmptyProfile();
    var input = profile || {};
    var arrayKeys = ['education', 'employment', 'projects', 'honors', 'activities', 'campus_roles', 'skills', 'application_answers', 'custom_fields', 'site_mappings', 'site_drafts', 'label_mappings'];
    var objectKeys = ['basic', 'intention', 'additional'];
    Object.keys(base).forEach(function (key) {
      if (key === 'extras') return;
      if (arrayKeys.indexOf(key) >= 0) {
        if (Array.isArray(input[key])) base[key] = clone(input[key]);
      } else if (objectKeys.indexOf(key) >= 0) {
        if (input[key] && typeof input[key] === 'object' && !Array.isArray(input[key])) base[key] = clone(input[key]);
      } else if (key === 'self_evaluation' && typeof input[key] === 'string') {
        base[key] = input[key];
      }
    });
    base.education = mergeDuplicateEducation(base.education);
    base.employment.forEach(function (emp) {
      if (emp && emp.description && (!emp.duties || !emp.duties.length)) {
        emp.duties = emp.description.split(/\r?\n/).map(trim).filter(Boolean);
      }
    });
    base.custom_fields = mergeRecordsByKey(base.custom_fields, ['key']);
    base.site_mappings = mergeRecordsByKey(base.site_mappings, ['site_key', 'fingerprint', 'profile_key']);
    base.site_drafts = mergeRecordsByKey(base.site_drafts, ['site_key', 'fingerprint', 'profile_key']);
    base.label_mappings = mergeRecordsByKey(base.label_mappings, ['label', 'profile_key']);
    base.custom_fields.forEach(function (record) { record.aliases = Array.isArray(record.aliases) ? record.aliases : []; });
    base.extras = clone(input.extras || {});
    return base;
  }

  function parse(text) {
    var profile = createEmptyProfile();
    var currentSection = null;
    var seen = Object.create(null);
    var lines = String(text == null ? '' : text).replace(/^\uFEFF/, '').split(/\r?\n/);
    lines.forEach(function (raw, offset) {
      var lineNumber = offset + 1;
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') return;
      var header = /^\[([^\]]+)\]$/.exec(line);
      if (header) { currentSection = header[1].trim(); return; }
      if (!currentSection) throw new Error('line ' + lineNumber + ': key/value line appears before a section');
      var separator = line.indexOf('=');
      if (separator < 1) throw new Error('line ' + lineNumber + ': expected key=value');
      var rawKey = line.slice(0, separator).trim();
      var value = line.slice(separator + 1).trim();
      if (isUnsafeName(rawKey.replace(/\[\]$/, ''))) throw new Error('line ' + lineNumber + ': unsafe key ' + rawKey);
      var target = targetForSection(currentSection);
      if (target && target.ignore) return;
      if (!target) {
        profile.extras[currentSection] = profile.extras[currentSection] || {};
        writeValue(profile.extras[currentSection], rawKey, value, seen, currentSection, lineNumber);
        return;
      }
      if (target.record) {
        profile[target.key][target.index] = profile[target.key][target.index] || {};
        var record = profile[target.key][target.index];
        var recordKey = rawKey.replace(/\[\]$/, '');
        // ARRAY_KEYS maps the plural-less spelling (course -> courses) onto the record field.
        // question/answer map onto the section name instead, which is not a record field, so
        // the raw key has to be accepted too or 网申问答 silently lands in extras and is
        // never shown in the editor nor filled.
        var knownKeys = KNOWN_KEYS[target.key] || [];
        var canonicalKey = ARRAY_KEYS[recordKey] || recordKey;
        if (knownKeys.indexOf(canonicalKey) < 0 && knownKeys.indexOf(recordKey) < 0) {
          profile.extras[currentSection] = profile.extras[currentSection] || {};
          writeRecordValue(profile.extras[currentSection], rawKey, value, seen, currentSection, lineNumber);
        } else {
          writeRecordValue(record, rawKey, value, seen, currentSection, lineNumber);
        }
      } else if (target.key === 'self_evaluation') {
        if (rawKey === 'text' || rawKey === 'value') profile.self_evaluation = value;
        else {
          profile.extras.self_evaluation = profile.extras.self_evaluation || {};
          writeValue(profile.extras.self_evaluation, rawKey, value, seen, currentSection, lineNumber);
        }
      } else {
        if ((KNOWN_KEYS[target.key] || []).indexOf(rawKey) < 0) {
          profile.extras[currentSection] = profile.extras[currentSection] || {};
          writeValue(profile.extras[currentSection], rawKey, value, seen, currentSection, lineNumber);
        } else {
          writeValue(profile[target.key], rawKey, value, seen, currentSection, lineNumber);
        }
      }
    });
    Object.keys(ARRAY_SECTIONS).forEach(function (name) {
      var key = ARRAY_SECTIONS[name];
      if (Array.isArray(profile[key])) {
        profile[key] = profile[key].filter(function (record) { return record && !recordHasNoValue(record); });
      }
    });
    return normalize(profile);
  }

  function writeRecordValue(record, rawKey, value, seen, section, lineNumber) {
    var arrayMatch = /^(.+)\[\]$/.exec(rawKey);
    if (arrayMatch) {
      var arrayKey = ARRAY_KEYS[arrayMatch[1]] || arrayMatch[1] + 's';
      record[arrayKey] = record[arrayKey] || [];
      record[arrayKey].push(value);
      return;
    }
    writeValue(record, rawKey, value, seen, section, lineNumber);
  }
  function writeValue(target, rawKey, value, seen, section, lineNumber) {
    var key = section + '::' + rawKey;
    if (seen[key]) throw new Error('line ' + lineNumber + ': duplicate key ' + rawKey + ' in [' + section + ']');
    seen[key] = true;
    target[rawKey] = value;
  }

  function stringify(profile) {
    var normalized = normalize(profile);
    var lines = [];
    function addSection(name, values) {
      if (!values) return;
      if (typeof values === 'string') {
        if (isBlankValue(values)) return;
        lines.push('[' + name + ']', 'text=' + values, '');
        return;
      }
      // An object whose values are all blank would emit a bare section header, which parses
      // back as {} and breaks the export/import round trip. Drop it instead.
      if (recordHasNoValue(values)) return;
      lines.push('[' + name + ']');
      Object.keys(values).sort().forEach(function (key) {
        var value = values[key];
        if (Array.isArray(value)) value.forEach(function (item) {
          var arrayName = key === 'courses' ? 'course' : key === 'duties' ? 'duty' : key === 'skills' ? 'skill' : key === 'aliases' ? 'alias' : key === 'application_answers' ? 'answer' : key;
          lines.push(arrayName + '[]=' + item);
        });
        else if (value !== undefined && value !== null && value !== '') lines.push(key + '=' + value);
      });
      lines.push('');
    }
    addSection('basic', normalized.basic);
    addSection('intention', normalized.intention);
    addSection('additional', normalized.additional);
    ['education', 'employment', 'projects', 'honors', 'activities', 'campus_roles', 'skills', 'application_answers', 'custom_fields', 'site_mappings', 'site_drafts', 'label_mappings']
      .forEach(function (key) {
        var position = 0;
        (normalized[key] || []).forEach(function (record) {
          if (recordHasNoValue(record)) return;
          position += 1;
          addSection(key + '.' + position, record);
        });
      });
    addSection('self_evaluation', normalized.self_evaluation);
    Object.keys(normalized.extras || {}).sort().forEach(function (section) { addSection(section, normalized.extras[section]); });
    return lines.join('\n').replace(/\n{3,}$/g, '\n\n');
  }

  return {
    ARRAY_KEYS: ARRAY_KEYS,
    createEmptyProfile: createEmptyProfile,
    mergeDuplicateEducation: mergeDuplicateEducation,
    ASSIGNABLE_FIELDS: ASSIGNABLE_FIELDS,
    PLACEHOLDER_VALUES: PLACEHOLDER_VALUES,
    isBlankValue: isBlankValue,
    readAssignedValue: readAssignedValue,
    upsertLabelMapping: upsertLabelMapping,
    mergeRecords: mergeRecords,
    replaceRecords: replaceRecords,
    normalize: normalize,
    parse: parse,
    stringify: stringify
  };
}));
