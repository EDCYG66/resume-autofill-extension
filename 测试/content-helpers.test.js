const test = require('node:test');
const assert = require('node:assert/strict');
const Content = require('../content.js');

test('normalizes Chinese labels and date punctuation', () => {
  assert.equal(Content.normalizeText('  联系电话：  '), '联系电话');
  assert.equal(Content.normalizeText('2024/09 至 2027/06'), '2024-09至2027-06');
});

test('matches native options by exact normalized label', () => {
  const options = [{ text: '请选择' }, { text: '全日制' }, { text: '非全日制' }];
  assert.equal(Content.matchSelectOption(options, '全日制'), 1);
  assert.equal(Content.matchSelectOption(options, '不存在'), -1);
});

test('fuzzy matches options with range suffixes and qualifiers', () => {
  const options = [{ text: '请选择' }, { text: '硕士及以上' }, { text: '本科' }, { text: '大专（专科）' }];
  assert.equal(Content.matchSelectOption(options, '硕士'), 1);
  assert.equal(Content.matchSelectOption(options, '本科及以上'), 2);
  assert.equal(Content.matchSelectOption(options, '专科'), 3);
  assert.equal(Content.matchSelectOption(options, '博士'), -1);
});

test('fuzzy matches radio choices without overmatching', () => {
  const choices = [{ value: '女', text: '女' }, { value: '男', text: '男' }, { value: '硕士及以上', text: '硕士及以上' }];
  assert.equal(Content.matchChoice(choices, '男'), 1);
  assert.equal(Content.matchChoice(choices, '硕士'), 2);
  assert.equal(Content.matchChoice(choices, '其他'), -1);
});

test('rejects submit-like controls from fill candidates', () => {
  assert.equal(Content.isSubmitLike({ type: 'submit', text: '提交申请' }), true);
  assert.equal(Content.isSubmitLike({ type: 'button', text: '扫描字段' }), false);
});

test('matches a radio or checkbox choice by its visible value', () => {
  const choices = [{ value: '女', text: '女' }, { value: '男', text: '男' }];
  assert.equal(Content.matchChoice(choices, '男'), 1);
  assert.equal(Content.matchChoice(choices, '未知'), -1);
});

test('blocks sensitive fields from automatic draft saving', () => {
  assert.equal(Content.isSensitiveField({ type: 'password', label: '密码' }), true);
  assert.equal(Content.isSensitiveField({ type: 'text', label: '短信验证码' }), true);
  assert.equal(Content.isSensitiveField({ type: 'text', label: '岗位编号' }), false);
});

test('matches a confirmed site mapping by selector before label aliases', () => {
  const mapping = { site_key: 'example.com', selector_hint: '#job-code', label: '岗位编号', value: 'R-001' };
  assert.equal(Content.siteMappingMatches(mapping, 'example.com', '#job-code', '其他标签'), true);
  assert.equal(Content.siteMappingMatches(mapping, 'other.example', '#job-code', '岗位编号'), false);
});

test('discovers an unmatched ordinary field with a stable fingerprint', () => {
  const control = { type: 'text', tagName: 'INPUT', name: 'jobCode', id: 'job-code' };
  const first = Content.makeFingerprint(control, '岗位编号');
  const second = Content.makeFingerprint(control, '岗位编号');
  assert.equal(first, second);
  assert.match(first, /^text:/);
});

test('collects only explicitly remembered safe drafts', () => {
  const drafts = Content.collectDraftValues([
    { remember: true, sensitive: false, siteKey: 'example.com', fingerprint: 'text:job-code', profileKey: 'custom_fields.1', proposedValue: 'R-001' },
    { remember: true, sensitive: true, siteKey: 'example.com', fingerprint: 'text:captcha', profileKey: 'custom_fields.2', proposedValue: '1234' },
    { remember: false, sensitive: false, siteKey: 'example.com', fingerprint: 'text:skip', profileKey: 'custom_fields.3', proposedValue: 'skip' }
  ]);
  assert.deepEqual(drafts, [{ site_key: 'example.com', fingerprint: 'text:job-code', profile_key: 'custom_fields.1', value: 'R-001' }]);
});

test('flattens each custom field exactly once', () => {
  const values = Content.flattenProfile({ custom_fields: [{ key: 'job_code', label: '岗位编号', value: 'R-001', aliases: ['职位编号'] }] });
  assert.equal(values.filter((item) => item.profileKey === 'custom_fields.1').length, 1);
});

test('updates a site draft without crossing origins', () => {
  const existing = [{ site_key: 'https://one.example', fingerprint: 'text:job-code', profile_key: 'custom_fields.1', value: 'old' }];
  const updated = Content.upsertDrafts(existing, [
    { site_key: 'https://one.example', fingerprint: 'text:job-code', profile_key: 'custom_fields.1', value: 'new' },
    { site_key: 'https://two.example', fingerprint: 'text:job-code', profile_key: 'custom_fields.1', value: 'other' }
  ], '2026-09-08T00:00:00.000Z');
  assert.deepEqual(updated, [
    { site_key: 'https://one.example', fingerprint: 'text:job-code', profile_key: 'custom_fields.1', value: 'new', updated_at: '2026-09-08T00:00:00.000Z' },
    { site_key: 'https://two.example', fingerprint: 'text:job-code', profile_key: 'custom_fields.1', value: 'other', updated_at: '2026-09-08T00:00:00.000Z' }
  ]);
});

test('ignores hidden helper controls and generic placeholders', () => {
  assert.equal(Content.isScannableControl({ type: 'hidden', disabled: false, hidden: false }), false);
  assert.equal(Content.isGenericPrompt('请填写评价内容'), true);
  assert.equal(Content.isGenericPrompt('请选择英语证书名称'), true);
  assert.equal(Content.isGenericPrompt('姓名'), false);
});

test('normalizes a nested section label for self-evaluation', () => {
  const label = Content.combineContextLabel('评价内容', ['自我评价', '简历信息']);
  assert.equal(Content.normalizeText(label).includes('自我评价'), true);
  assert.equal(Content.normalizeText(label).includes('评价内容'), true);
});

test('deduplicates radio and checkbox controls by group fingerprint', () => {
  const controls = [
    { type: 'radio', name: 'gender', id: 'male' },
    { type: 'radio', name: 'gender', id: 'female' },
    { type: 'text', name: 'name', id: 'name' }
  ];
  assert.deepEqual(Content.dedupeControlDescriptors(controls), [controls[0], controls[2]]);
});

test('creates React-compatible input events through the native setter', () => {
  assert.equal(typeof Content.setNativeValue, 'function');
});

test('recognizes dynamic dropdown controls and filters helper inputs', () => {
  assert.equal(Content.isCustomSelectControl({ role: 'combobox', tagName: 'INPUT' }), true);
  assert.equal(Content.isCustomSelectControl({ ariaHaspopup: 'listbox', tagName: 'DIV' }), true);
  assert.equal(Content.isScannableControl({ type: 'text', hidden: true }), false);
});

test('normalizes labels without placeholder text and class noise', () => {
  assert.equal(Content.cleanFieldLabel('英语证书名称* 请选择英语证书名称'), '英语证书名称');
  assert.equal(Content.cleanFieldLabel('评价内容 必填'), '评价内容');
});

test('groups controls by visible field identity instead of raw DOM nodes', () => {
  const descriptors = [
    { type: 'text', name: 'evaluation', label: '自我评价', id: 'eval-a' },
    { type: 'text', name: 'evaluation', label: '自我评价', id: 'eval-b' },
    { type: 'select', name: 'degree', label: '学历', id: 'degree' }
  ];
  assert.deepEqual(Content.dedupeFieldDescriptors(descriptors).map((item) => item.id), ['eval-a', 'degree']);
});

test('uses semantic context labels for profile leaves', () => {
  const profile = {
    basic: { name: '测试姓名' },
    skills: [{ category: '英语', name: '大学英语四级、六级', level: '已通过' }]
  };
  const values = Content.flattenProfile(profile);
  const english = values.find((item) => item.value.includes('四级'));
  assert.equal(english.label, '技能名称');
  assert.equal(Content.valueMatchesLabel(english, '英语证书名称'), true);
});

test('does not treat generic page prompts as new field labels', () => {
  assert.equal(Content.isUsableFieldLabel('请填写评价内容'), false);
  assert.equal(Content.isUsableFieldLabel('评价内容'), true);
  assert.equal(Content.isUsableFieldLabel('自定义字段'), false);
});

test('supports a stable selector for dynamic custom controls', () => {
  const descriptor = { type: 'custom', id: 'degree', name: 'degree', label: '学历', className: 'el-select' };
  assert.equal(Content.makeFingerprint(descriptor, '学历'), 'custom:degree');
  assert.equal(Content.isCustomSelectControl(descriptor), true);
});

test('matches semantic display labels instead of internal profile keys', () => {
  const item = { profileKey: 'self_evaluation', label: '自我评价', value: '一段评价' };
  assert.equal(Content.valueMatchesLabel(item, '自我评价 评价内容'), true);
});

test('selects one compatible option from a compound certificate value', () => {
  const options = [{ text: '请选择' }, { text: '大学英语四级' }, { text: '大学英语六级' }];
  assert.equal(Content.matchSelectOption(options, '大学英语四级、六级均已通过'), 1);
});

test('does not reuse an English skill for an unrelated computer certificate field', () => {
  const english = { profileKey: 'skills.1.name', label: '技能名称', value: '大学英语四级、六级', aliases: ['英语证书名称'], categoryValue: '英语' };
  const computer = { profileKey: 'skills.1.name', label: '技能名称', value: '大学英语四级、六级', aliases: ['证书名称'], categoryValue: '英语' };
  assert.equal(Content.valueMatchesLabel(english, '英语能力 英语证书名称'), true);
  assert.equal(Content.valueMatchesLabel(computer, '计算机技能 证书名称'), false);
});

test('does not reuse a programming skill as a computer certificate', () => {
  const python = { profileKey: 'skills.2.name', label: '技能名称', value: 'Python', aliases: ['证书名称'], categoryValue: '编程与算法' };
  assert.equal(Content.valueMatchesLabel(python, '计算机技能 证书名称'), false);
});

test('requires a meaningful label for a candidate and uses visible custom-select text', () => {
  assert.equal(Content.shouldIncludeCandidate({ label: '未标注字段', isCustom: false }), false);
  assert.equal(Content.shouldIncludeCandidate({ label: '评价内容', isCustom: false }), true);
  assert.equal(Content.customControlValue({ textContent: '请选择英语证书名称', value: '' }), '请选择英语证书名称');
});

test('recognizes listbox containers as custom selects', () => {
  assert.equal(Content.isCustomSelectControl({ role: 'listbox', tagName: 'DIV' }), true);
  assert.equal(Content.isCustomSelectControl({ role: 'option', tagName: 'DIV' }), false);
});

test('scopes custom options to the active control popup', () => {
  assert.equal(typeof Content.findCustomOptions, 'function');
});

test('extracts labels from common resume form containers', () => {
  assert.equal(typeof Content.findContainerLabel, 'function');
  assert.equal(Content.findContainerLabel({
    containerTexts: ['英语证书名称*', '请选择英语证书名称'],
    contextTexts: ['英语能力', '必填']
  }), '英语能力 英语证书名称');
});

test('rejects opaque item ids as field labels', () => {
  assert.equal(Content.isUsableFieldLabel('11_37'), false);
  assert.equal(Content.isUsableFieldLabel('resume-item-11-37'), false);
  assert.equal(Content.isUsableFieldLabel('联系电话'), true);
});

test('reads selected values from Ant Design and Element custom selects', () => {
  assert.equal(Content.customControlValue({
    querySelector: function (selector) { return selector === '.ant-select-selection-selected-value' ? { textContent: '大学英语四级' } : null; },
    textContent: '请选择英语证书名称'
  }), '大学英语四级');
});

test('reads remembered values from native and custom controls', () => {
  assert.equal(Content.readControlValue({ value: '岗位编号' }), '岗位编号');
  assert.equal(Content.readControlValue({
    querySelector: function (selector) { return selector === '.ant-select-selection-selected-value' ? { textContent: '大学英语四级' } : null; },
    textContent: '请选择英语证书名称'
  }), '大学英语四级');
});

test('splits complete dates for year month and day controls', () => {
  assert.equal(Content.isDateComponentLabel('入学时间 年'), true);
  assert.equal(Content.isDateComponentLabel('出生日期'), false);
  assert.equal(Content.dateComponentValue('2024-09-18', '入学时间 年'), '2024');
  assert.equal(Content.dateComponentValue('2024-09-18', '入学时间 月'), '09');
  assert.equal(Content.dateComponentValue('2024-09-18', '入学时间 日'), '18');
  assert.equal(Content.dateComponentValue('2001-06-03', '出生日期'), '2001-06-03');
  assert.equal(Content.dateComponentValue('2024-09', '入学时间 日'), '');
});

test('prefers Ant Design form labels over technical ids', () => {
  assert.equal(Content.preferredContainerSelectors().includes('.resume-operation-wrap .form-cell'), true);
  assert.equal(Content.cleanFieldLabel('11_37'), '');
});

test('does not use navigation section headers as field labels', () => {
  assert.equal(Content.isNavigationOnlyLabel('英语能力'), true);
  assert.equal(Content.isNavigationOnlyLabel('英语能力 英语证书名称'), false);
});

test('removes required markers embedded in dynamic section labels', () => {
  assert.equal(Content.cleanFieldLabel('英语能力 必填 英语证书名称*'), '英语能力 英语证书名称');
});

test('maps self-evaluation and English certificate labels to real profile values', () => {
  const evaluation = { profileKey: 'self_evaluation', label: '自我评价', value: '一段评价' };
  const certificate = { profileKey: 'skills.1.name', label: '技能名称', value: '大学英语四级、六级', aliases: ['英语证书名称'] };
  assert.equal(Content.valueMatchesLabel(evaluation, '自我评价 评价内容'), true);
  assert.equal(Content.valueMatchesLabel(certificate, '英语证书名称'), true);
});

test('filters generic prompts and remembers only semantic field controls', () => {
  assert.equal(Content.isUsableFieldLabel('请填写评价内容'), false);
  assert.equal(Content.isUsableFieldLabel('自定义字段'), false);
  assert.equal(Content.isUsableFieldLabel('岗位编号'), true);
  assert.equal(Content.isScannableControl({ type: 'hidden', hidden: false }), false);
});

test('keeps exact label hits at high confidence and fuzzy hits for review', () => {
  assert.equal(Content.fieldConfidence({ profileKey: 'basic.name' }, null, '姓名', '姓名 fullName full-name'), 'high');
  // 常用联络邮箱 only overlaps the aliases as a substring, so it stays a fuzzy hit.
  assert.equal(Content.fieldConfidence({ profileKey: 'basic.email' }, null, '常用联络邮箱', '常用联络邮箱'), 'medium');
  assert.equal(Content.fieldConfidence({ profileKey: 'custom_fields.1' }, { site_key: 'https://example.com' }, '岗位编号', '岗位编号'), 'high');
  assert.equal(Content.fieldConfidence(null, null, '岗位编号', '岗位编号'), 'none');
});

test('treats a section plus field label as an exact alias hit', () => {
  const certificate = { profileKey: 'skills.1.name', label: '技能名称', value: '大学英语四级', aliases: ['英语证书名称'] };
  assert.equal(Content.profileLabelStrength(certificate, '英语能力 英语证书名称'), 'exact');
  assert.equal(Content.profileLabelStrength(certificate, '英语等级证书名称'), 'partial');
  assert.equal(Content.profileLabelStrength(certificate, '期望职位'), 'none');
});

test('does not let a skill value match a name field', () => {
  const python = { profileKey: 'skills.2.name', label: '技能名称', value: 'Python', categoryValue: '编程与算法' };
  assert.equal(Content.valueMatchesLabel(python, '姓名'), false);
  assert.equal(Content.valueMatchesLabel(python, '技能名称'), true);
});

test('splits a multi value answer into every matching checkbox', () => {
  const items = [{ value: '周一', text: '周一' }, { value: '周二', text: '周二' }, { value: '周三', text: '周三' }];
  assert.deepEqual(Content.matchChoiceIndexes(items, '周一、周三'), [0, 2]);
  assert.deepEqual(Content.matchChoiceIndexes(items, '周二'), [1]);
  assert.deepEqual(Content.matchChoiceIndexes(items, '周日'), []);
  assert.deepEqual(Content.choiceTokens('周一、周三, 周五'), ['周一', '周三', '周五']);
});

test('reads a lone checkbox as a yes or no answer', () => {
  assert.equal(Content.booleanChoice('是'), true);
  assert.equal(Content.booleanChoice('接受'), true);
  assert.equal(Content.booleanChoice('否'), false);
  assert.equal(Content.booleanChoice('也许'), null);
});

test('derives option text from the option label instead of the group label', () => {
  assert.equal(Content.choiceText({ closest: function () { return { textContent: '周一' }; } }), '周一');
  assert.equal(Content.choiceText({ closest: function () { return { textContent: '可实习时间' }; } }), '可实习时间');
  assert.equal(Content.choiceText({}), '');
});

test('rejects a cached control that the page has detached', () => {
  assert.equal(Content.isLiveControl({ isConnected: true }), true);
  assert.equal(Content.isLiveControl({ isConnected: false }), false);
  assert.equal(Content.isLiveControl(null), false);
  assert.deepEqual(Content.scanRoots(), []);
});

test('recognises the synonym variants real recruitment sites use', () => {
  const cases = [
    ['basic.name', '名字'],
    ['basic.phone', '移动电话'],
    ['basic.email', 'E-mail'],
    ['basic.email', '电子邮件'],
    ['education.1.school', '毕业学校'],
    ['education.1.school', '就读院校'],
    ['education.1.school', '母校'],
    ['education.1.level', '最高学历'],
    ['education.1.level', '培养层次'],
    ['education.1.start_date', '入学年月'],
    ['education.1.gpa', '平均绩点'],
    ['intention.target_role', '意向岗位'],
    ['intention.target_role', '期望岗位'],
    ['self_evaluation', '自我介绍'],
    ['self_evaluation', '个人简介']
  ];
  cases.forEach(([key, label]) => {
    const item = { profileKey: key, label: key.split('.').pop(), value: 'x' };
    assert.equal(Content.profileLabelStrength(item, label), 'exact', label + ' should match ' + key);
  });
});

test('treats a confirmed label as an exact hit everywhere', () => {
  // 个人自述 is not in the alias table at all, which is exactly the long tail the
  // learned dictionary exists to cover.
  const learned = Content.buildLearnedMap([{ label: '个人自述', profile_key: 'self_evaluation' }]);
  const item = { profileKey: 'self_evaluation', label: '自我评价', value: '一段评价' };
  assert.notEqual(Content.profileLabelStrength(item, '个人自述'), 'exact', 'precondition: unknown before learning');
  assert.equal(Content.profileLabelStrength(item, '个人自述', learned), 'exact');
  assert.equal(Content.valueMatchesLabel(item, '个人自述', learned), true);
  assert.equal(Content.fieldConfidence(item, null, '个人自述', '个人自述', learned), 'high');
});

test('a learned label does not leak onto unrelated fields', () => {
  const learned = Content.buildLearnedMap([{ label: '意向岗位', profile_key: 'intention.1.target_role' }]);
  const other = { profileKey: 'education.1.school', label: '学校', value: '示例大学' };
  assert.equal(Content.profileLabelStrength(other, '意向岗位', learned), 'none');
});

test('matches a learned label across records of the same section', () => {
  // Learned against record 1, but the field being filled belongs to record 2.
  const learned = Content.buildLearnedMap([{ label: '毕业学校', profile_key: 'education.1.school' }]);
  const second = { profileKey: 'education.2.school', label: '学校', value: '示例理工大学' };
  assert.equal(Content.profileLabelStrength(second, '毕业学校', learned), 'exact');
});

test('ignores malformed learned entries instead of throwing', () => {
  const learned = Content.buildLearnedMap([null, {}, { label: '', profile_key: 'a.b' }, { label: 'x', profile_key: '' }]);
  assert.deepEqual(Object.keys(learned), []);
  assert.equal(Content.learnedMatch(null, '任意', 'a.b'), false);
});

test('never offers the learned dictionary itself as a fillable value', () => {
  const values = Content.flattenProfile({
    basic: { name: '示例姓名' },
    label_mappings: [{ label: '意向岗位', profile_key: 'intention.1.target_role' }]
  });
  assert.equal(values.some((item) => item.profileKey.indexOf('label_mappings') === 0), false);
  assert.equal(values.some((item) => item.value === '意向岗位'), false);
});

test('finds a learned value even when the page label carries name and id', () => {
  // scan() builds its match string as "label + name + id", while the dictionary is keyed on
  // the clean label. Looking the dictionary up through the composite string silently missed.
  const learned = Content.buildLearnedMap([{ label: '个人陈述', profile_key: 'self_evaluation' }]);
  const values = Content.flattenProfile({ self_evaluation: '一段评价' });
  const hit = Content.findLearnedValue('个人陈述', values, {}, learned);
  assert.ok(hit, 'clean label should resolve through the learned dictionary');
  assert.equal(hit.profileKey, 'self_evaluation');
  assert.equal(Content.findLearnedValue('个人陈述 statement statement', values, {}, learned), null);
  assert.equal(Content.findLearnedValue('个人陈述', values, { self_evaluation: true }, learned), null);
  assert.equal(Content.findLearnedValue('个人陈述', values, {}, null), null);
});

test('matches the wording recruitment application forms use', () => {
  const cases = [
    ['basic.phone_code', '手机类别'],
    ['basic.qq', 'QQ号'],
    ['basic.id_type', '证件类型'],
    ['basic.has_children', '有无子女'],
    ['basic.emergency_contact', '紧急联系人姓名'],
    ['basic.emergency_phone', '紧急联系电话'],
    ['intention.interview_site', '面试站点'],
    ['education.1.second_major', '第二专业'],
    ['education.1.graduate_type', '应届/往届'],
    ['education.1.english_level', '英语等级'],
    ['education.1.english_score', '四六级成绩'],
    ['education.1.thesis_title', '毕业论文题目'],
    ['additional.hobbies', '兴趣爱好'],
    ['additional.specialty', '个人特长'],
    ['additional.punishment', '受处分情况'],
    ['additional.academic_works', '学术专著'],
    ['additional.patents', '专利'],
    ['additional.law_violation', '是否有触犯国家法律法规'],
    ['additional.relatives_in_company', '亲戚朋友'],
    ['additional.medical_history', '重大疾病史'],
    ['additional.referral_code', '校园大使推荐码']
  ];
  cases.forEach(([key, label]) => {
    const item = { profileKey: key, label: key.split('.').pop(), value: 'x' };
    assert.notEqual(Content.profileLabelStrength(item, label), 'none', label + ' should reach ' + key);
  });
});

test('offers the additional section fields to the assignment picker', () => {
  const groups = Content.buildLearnedMap([]) && null; // keep the import path exercised
  const catalog = require('../profile-parser.js').ASSIGNABLE_FIELDS;
  const additional = catalog.filter((g) => g.section === 'additional');
  assert.equal(additional.length, 1, 'additional should appear once in the picker');
  assert.equal(additional[0].scalar, true);
  assert.equal(additional[0].fields.length, 10);
});

test('keeps a section leaf from inheriting the generic aliases of its key', () => {
  // A "name" under 荣誉/项目/活动 is an award, a project or an event, not a person.
  // Before section scoping, 姓名 matched all four and a project title could land in a name field.
  const bySection = {
    'basic.name': '姓名',
    'honors.1.name': '荣誉名称',
    'projects.1.name': '项目名称',
    'activities.1.name': '活动名称',
    'skills.1.name': '技能名称'
  };
  Object.entries(bySection).forEach(([key, label]) => {
    const mine = { profileKey: key, label: label, value: 'x' };
    assert.equal(Content.profileLabelStrength(mine, label), 'exact', label + ' should match ' + key);
    // ...and must not match any of the other sections' wordings.
    Object.entries(bySection).forEach(([otherKey, otherLabel]) => {
      if (otherKey === key) return;
      assert.equal(Content.profileLabelStrength(mine, otherLabel), 'none',
        otherLabel + ' must not reach ' + key);
    });
  });
  // 姓名 still belongs to the person's name alone.
  assert.equal(Content.profileLabelStrength({ profileKey: 'basic.name', label: '姓名', value: 'x' }, '姓名'), 'exact');
});

test('matches the many wordings each section field appears under', () => {
  const cases = {
    'basic.name': ['姓名', '名字', '真实姓名', '本人姓名', '申请人姓名', '中文姓名'],
    'basic.phone': ['联系电话', '手机号码', '电话号码', '联系手机', '本人手机', '移动电话'],
    'basic.email': ['电子邮箱', '电子邮件', '邮箱地址', '电子信箱', '常用邮箱', 'E-mail'],
    'basic.height': ['身高', '净身高', '身高(cm)', '身高（cm）'],
    'basic.weight': ['体重', '净体重', '体重(kg)', '体重（kg）'],
    'basic.birth_date': ['出生日期', '出生年月日', '出生日', '生日', '出生时间'],
    'basic.mailing_address': ['通信地址', '通讯地址', '邮寄地址', '收件地址'],
    'intention.target_role': ['期望职位', '意向岗位', '期望职业', '求职岗位', '应聘意向'],
    'intention.city': ['期望城市', '意向城市', '期望工作城市', '期望地区'],
    'education.1.college': ['学院', '学院名称', '所在学院', '院系', '系别'],
    'education.1.major_rank': ['专业排名', '成绩排名', '年级排名'],
    'education.1.gpa': ['绩点', '平均绩点', '平均成绩', '均分', '平均分'],
    'education.1.thesis_title': ['毕业论文题目', '论文题目', '学位论文题目', '毕业设计题目'],
    'education.1.advisor': ['导师', '导师姓名', '指导教师', '指导老师'],
    'employment.1.employer': ['公司', '公司名称', '企业名称', '单位名称', '任职单位'],
    'honors.1.name': ['荣誉名称', '奖项名称', '获奖名称', '奖励名称'],
    'honors.1.issuer': ['颁发单位', '授予单位', '颁发机构'],
    'projects.1.outcomes': ['项目成果', '项目成果与收获'],
    'projects.1.related_paper': ['相关论文', '发表论文'],
    'activities.1.organization': ['主办单位', '组织单位'],
    'campus_roles.1.role': ['担任职务', '学生职务', '职务名称'],
    'skills.1.level': ['熟练程度', '掌握程度'],
    'additional.academic_works': ['学术专著', '学术成果', '论文著作'],
    'additional.medical_history': ['手术史', '重大疾病史', '既往病史'],
    'self_evaluation': ['自我评价', '个人评价', '个人陈述', '自我鉴定']
  };
  Object.entries(cases).forEach(([key, labels]) => {
    labels.forEach((label) => {
      const item = { profileKey: key, label: key.split('.').pop(), value: 'x' };
      assert.notEqual(Content.profileLabelStrength(item, label), 'none', label + ' should reach ' + key);
    });
  });
});

test('never matches a label that is only a bare generic word', () => {
  // These are the words a careless alias addition would break on: they belong to no single
  // field, so matching any of them would fill a value into the wrong box.
  ['名称', '时间', '信息', '内容', '类型', '情况', '地址'].forEach((word) => {
    const matched = [
      'basic.name', 'education.1.start_date', 'honors.1.name', 'projects.1.name',
      'employment.1.duties', 'basic.mailing_address', 'additional.punishment'
    ].filter((key) => Content.profileLabelStrength({ profileKey: key, label: key.split('.').pop(), value: 'x' }, word) === 'exact');
    assert.deepEqual(matched, [], word + ' should not exactly match any field');
  });
});

test('keeps the alias table free of cross-purpose duplicates', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'content.js'), 'utf8');
  const table = source.match(/var ALIASES = \{([\s\S]*?)\n  \};/)[1];
  const owners = {};
  for (const m of table.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    for (const w of m[2].matchAll(/'([^']*)'/g)) {
      (owners[w[1]] = owners[w[1]] || []).push(m[1]);
    }
  }
  // 岗位/职位 legitimately mean both 期望职位 and 工作职位; 政治面貌 appears twice by history.
  // Anything else sharing a word between unrelated fields is a mistake.
  const allowed = [['political_status', 'political'], ['target_role', 'role']];
  const unexpected = Object.entries(owners).filter(([, keys]) => {
    if (keys.length < 2) return false;
    return !allowed.some((pair) => keys.length === pair.length && pair.every((k) => keys.includes(k)));
  });
  assert.deepEqual(unexpected.map(([w, ks]) => w + ' -> ' + ks.join(',')), []);
});

test('treats an unfinished template marker as no value on the content side too', () => {
  const Parser = require('../profile-parser.js');
  // The marker list is duplicated in content.js because the injected script cannot require
  // the parser module. This is the test that keeps the two copies from drifting apart.
  for (const marker of Parser.PLACEHOLDER_VALUES) {
    assert.equal(Content.isPlaceholderValue(marker), true, marker + ' should be a placeholder');
    assert.equal(Parser.isBlankValue(marker), true, marker + ' should count as blank');
    assert.equal(Parser.isBlankValue('  ' + marker + '  '), true, marker + ' with padding');
  }
  assert.equal(Parser.isBlankValue(''), true);
  assert.equal(Content.isPlaceholderValue('示例姓名'), false);
  assert.equal(Content.isPlaceholderValue(''), false);
});

test('never proposes a half-filled template value to a page', () => {
  const Parser = require('../profile-parser.js');
  const profile = Parser.parse([
    '[basic]', 'name=请填写', 'phone=待补充', 'email=me@example.com',
    '[education.1]', 'school=示例大学', 'major=请填写',
    '[honors.1]', 'name=请填写',
  ].join('\n'));

  assert.deepEqual(
    Content.flattenProfile(profile).map((item) => item.profileKey + '=' + item.value),
    ['basic.email=me@example.com', 'education.1.school=示例大学']
  );
});

test('never remembers a placeholder as a draft value', () => {
  const fields = [
    { remember: true, siteKey: 'https://example.com', fingerprint: 'text:name', profileKey: 'basic.name', proposedValue: '请填写' },
    { remember: true, siteKey: 'https://example.com', fingerprint: 'text:city', profileKey: 'intention.city', proposedValue: '示例城市' },
  ];

  assert.deepEqual(Content.collectDraftValues(fields).map((draft) => draft.fingerprint), ['text:city']);
});

test('the shipped fillable template proposes nothing until the user fills it in', () => {
  const Parser = require('../profile-parser.js');
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '模板文件.txt'), 'utf8');
  const profile = Parser.parse(source);

  assert.deepEqual(Content.flattenProfile(profile), []);
  assert.deepEqual(profile.extras, {});
  assert.deepEqual(profile.education, []);
});


test('matches a column whose wording carries its section prefix', () => {
  // 国聘 qualifies its education columns with 最高学历. Stripping that as an extra variant
  // reaches the plain alias without breaking a bare 最高学历, which means 学历.
  const cases = [
    ['education.1.school', '最高学历院校'],
    ['education.1.end_date', '最高学历毕业时间'],
    ['education.1.major_category', '最高学历专业分类'],
    ['education.1.gpa', '最高学历平均绩点'],
    ['education.1.study_mode', '最高学历全日制'],
    ['education.1.admission_type', '最高学历统招'],
    ['education.1.level', '最高学历']
  ];
  cases.forEach(([key, label]) => {
    const item = { profileKey: key, label: key.split('.').pop(), value: 'x' };
    assert.equal(Content.profileLabelStrength(item, label), 'exact', label + ' should reach ' + key);
  });
  assert.equal(Content.withoutLeadingQualifier('最高学历院校'), '院校');
  assert.equal(Content.withoutLeadingQualifier('姓名'), '', 'a label with no qualifier strips to nothing');
});

test('does not let a latin alias match inside an identifier', () => {
  // The scanner joins the visible label with the control's name and id. "gpa" sits inside
  // "gpAbroad", "mail" inside "mailingAddress", "name" inside "companyName".
  const composite = '最高学历海外留学 gpAbroad gp-abroad';
  assert.equal(Content.profileLabelStrength({ profileKey: 'education.1.gpa', label: '绩点/均分', value: '3.8' }, composite), 'none');
  assert.equal(Content.profileLabelStrength({ profileKey: 'basic.email', label: '邮箱', value: 'x' }, 'mailingAddress'), 'none');
  assert.equal(Content.profileLabelStrength({ profileKey: 'basic.name', label: '姓名', value: 'x' }, 'companyName'), 'none');
  // A latin alias on a real word boundary still matches, and Chinese is unaffected.
  assert.notEqual(Content.profileLabelStrength({ profileKey: 'education.1.gpa', label: '绩点/均分', value: '3.8' }, 'gpa成绩'), 'none');
  assert.equal(Content.profileLabelStrength({ profileKey: 'education.1.level', label: '学历', value: 'x' }, '最高学历'), 'exact');
});

test('prefers the stronger match over whichever candidate comes first', () => {
  // 最高学历专业分类 is an exact alias hit for 专业分类 and only a substring hit for 专业.
  // Profile order puts 专业 first, so ranking on strength is what keeps them apart.
  const values = Content.flattenProfile({
    education: [{ major: '电子信息', major_category: '电子信息' }]
  });
  const strongest = values
    .map((item) => ({ item: item, strength: Content.profileLabelStrength(item, '最高学历专业分类') }))
    .filter((entry) => entry.strength !== 'none');
  assert.ok(strongest.length > 0);
  const majors = strongest.filter((entry) => entry.strength === 'exact').map((entry) => entry.item.profileKey);
  assert.deepEqual(majors, ['education.1.major_category']);
});

test('matches id_number and phone_code aliases on recruitment forms', () => {
  const cases = [
    ['basic.id_number', '身份证号'],
    ['basic.id_number', '身份证号码'],
    ['basic.id_number', '证件号码'],
    ['basic.id_number', '公民身份号码'],
    ['basic.phone_code', '手机区号'],
    ['basic.phone_code', '电话区号'],
    ['basic.phone_code', '国家/地区代码']
  ];
  cases.forEach(([key, label]) => {
    const item = { profileKey: key, label: key.split('.').pop(), value: 'x' };
    assert.equal(Content.profileLabelStrength(item, label), 'exact', label + ' should reach ' + key);
  });
});

test('semantically matches dropdown options across synonymous formats', () => {
  const englishOptions = [
    { value: '', text: '请选择英语等级' },
    { value: '1', text: 'CET-4 / 英语四级' },
    { value: '2', text: 'CET-6 / 英语六级' },
    { value: '3', text: 'TEM-8 / 专八' }
  ];
  assert.equal(Content.matchSelectOption(englishOptions, '大学英语六级(CET-6)'), 2);
  assert.equal(Content.matchSelectOption(englishOptions, 'CET6'), 2);
  assert.equal(Content.matchSelectOption(englishOptions, '英语六级'), 2);

  const genderOptions = [
    { value: '', text: '请选择性别' },
    { value: 'M', text: '男性' },
    { value: 'F', text: '女性' }
  ];
  assert.equal(Content.matchSelectOption(genderOptions, '男'), 1);
  assert.equal(Content.matchSelectOption(genderOptions, '女'), 2);

  const eduOptions = [
    { value: '0', text: '专科' },
    { value: '1', text: '本科' },
    { value: '2', text: '硕士' },
    { value: '3', text: '博士' }
  ];
  assert.equal(Content.matchSelectOption(eduOptions, '硕士研究生'), 2);
  assert.equal(Content.matchSelectOption(eduOptions, '大学本科'), 1);

  const idOptions = [
    { value: '1', text: '居民身份证' },
    { value: '2', text: '中国护照' }
  ];
  assert.equal(Content.matchSelectOption(idOptions, '身份证'), 0);

  const phoneCodeOptions = [
    { value: '+86', text: '中国大陆 (+86)' },
    { value: '+852', text: '中国香港 (+852)' }
  ];
  assert.equal(Content.matchSelectOption(phoneCodeOptions, '+86'), 0);
  assert.equal(Content.matchSelectOption(phoneCodeOptions, '86'), 0);
});

test('every name shown in the UI is a name the matcher accepts', () => {
  // The quick-copy list and the assignment picker both print the label from ASSIGNABLE_FIELDS.
  // If one of those labels stops resolving, users see a field名 that looks right but never
  // matches anything. This is the guard against the label tables drifting apart again.
  const ResumeProfile = require('../profile-parser.js');
  const failures = [];
  ResumeProfile.ASSIGNABLE_FIELDS.forEach((group) => {
    group.fields.forEach((meta) => {
      const key = group.single
        ? group.section
        : group.scalar ? group.section + '.' + meta[0] : group.section + '.1.' + meta[0];
      const strength = Content.profileLabelStrength({ profileKey: key, label: meta[1], value: 'x' }, meta[1]);
      if (strength === 'none') failures.push(group.section + '.' + meta[0] + ' (' + meta[1] + ')');
    });
  });
  assert.deepEqual(failures, [], 'these labels are printed in the UI but match nothing');
});

test('the quick copy list is built from the catalog, not a second label table', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'popup.js'), 'utf8');
  assert.ok(source.includes('ResumeProfile.ASSIGNABLE_FIELDS.forEach'), 'the quick copy list should read the shared catalog');
  // The hand-written tables that used to duplicate the schema labels.
  assert.ok(!/basicLabels\s*=/.test(source), 'popup.js should not carry its own basic label table');
  assert.ok(!/intentionLabels\s*=/.test(source), 'popup.js should not carry its own intention label table');
});
