const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ResumeProfile = require('../profile-parser.js');

test('parses a rich education record and repeated courses', () => {
  const profile = ResumeProfile.parse(`[education.1]\nschool=示例大学\ncollege=示例学院\nstart_date=2024-09\nend_date=2027-06\nduration_years=3\nlevel=硕士\nadmission_type=统招\nstudy_mode=全日制\ndegree_certificate=有\nmajor=电子信息\nmajor_category=电子信息\nmajor_rank=前10%\ncourse[]=深度学习\ncourse[]=强化学习\n`);

  assert.equal(profile.education.length, 1);
  assert.equal(profile.education[0].college, '示例学院');
  assert.deepEqual(profile.education[0].courses, ['深度学习', '强化学习']);
});

test('ignores Chinese field explanations in the example template', () => {
  const source = '# 姓名：真实姓名\n[basic]\n# name：姓名\nname=示例姓名\n# birth_date：出生日期，格式 YYYY-MM-DD\nbirth_date=2000-01-01\n';
  const profile = ResumeProfile.parse(source);
  assert.equal(profile.basic.name, '示例姓名');
  assert.equal(profile.basic.birth_date, '2000-01-01');
});

test('the shipped fillable template parses and offers nothing until it is filled in', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '模板文件.txt'), 'utf8');
  const profile = ResumeProfile.parse(source);

  // Every value ships blank, so no record may materialise and nothing may leak into extras.
  assert.deepEqual(profile.education, []);
  assert.deepEqual(profile.employment, []);
  assert.deepEqual(profile.skills, []);
  assert.deepEqual(profile.application_answers, []);
  assert.deepEqual(profile.extras, {});
  assert.equal(profile.basic.name, '');
  assert.equal(profile.self_evaluation, '');
});

test('treats an unfinished template marker as empty instead of as a value', () => {
  const profile = ResumeProfile.parse('[basic]\nname=请填写\nphone=待补充\n\n[education.1]\nschool=示例大学\ncollege=请填写\n');

  assert.equal(ResumeProfile.readAssignedValue(profile, 'basic.phone'), '');
  assert.equal(ResumeProfile.readAssignedValue(profile, 'education.1.college'), '');
  assert.equal(ResumeProfile.readAssignedValue(profile, 'education.1.school'), '示例大学');
  // A record left with nothing but markers is scaffolding, not an education entry.
  assert.equal(ResumeProfile.parse('[education.1]\nschool=请填写\ncollege=\n').education.length, 0);
});

test('drops blank record scaffolding and keeps the export round trip stable', () => {
  const profile = ResumeProfile.parse('[basic]\nname=\n\n[education.1]\nschool=\ncollege=\n\n[education.2]\nschool=示例大学\n');

  assert.equal(profile.education.length, 1);
  assert.equal(profile.education[0].school, '示例大学');
  const once = ResumeProfile.stringify(profile);
  assert.equal(ResumeProfile.stringify(ResumeProfile.parse(once)), once);
});

test('reads the application answers written in a template instead of losing them to extras', () => {
  const profile = ResumeProfile.parse('[application_answers.1]\nquestion=您选择一份工作最看重什么？\nanswer=专业匹配\n');

  assert.deepEqual(profile.application_answers, [{ question: '您选择一份工作最看重什么？', answer: '专业匹配' }]);
  assert.deepEqual(profile.extras, {});
});

test('round-trips stable sections and preserves unknown keys', () => {
  const source = `[basic]\nname=示例姓名\ncustom_label=保留\n\n[education.1]\nschool=示例大学\ncourse[]=课程一\n`;
  const parsed = ResumeProfile.parse(source);
  const exported = ResumeProfile.stringify(parsed);
  const reparsed = ResumeProfile.parse(exported);

  assert.equal(reparsed.basic.name, '示例姓名');
  assert.equal(reparsed.extras.basic.custom_label, '保留');
  assert.deepEqual(reparsed.education[0].courses, ['课程一']);
  assert.ok(exported.indexOf('[basic]') < exported.indexOf('[education.1]'));
});

test('merges duplicate bachelor records without dropping later non-empty fields', () => {
  const records = [
    { school: '示例大学', level: '本科', major: '示例专业', start_date: '2018-09', end_date: '2022-06', major_rank: '前10%', degree_name: '' },
    { school: '示例大学', level: '本科', major: '示例专业', start_date: '2018-09', end_date: '2022-06', major_category: '示例专业类', degree_name: '工学学士' },
  ];
  const merged = ResumeProfile.mergeDuplicateEducation(records);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].major_rank, '前10%');
  assert.equal(merged[0].major_category, '示例专业类');
  assert.equal(merged[0].degree_name, '工学学士');
});

test('rejects malformed lines with useful line numbers', () => {
  assert.throws(() => ResumeProfile.parse('[basic]\nmissing separator\n'), /line 2/i);
});

test('rejects unsafe template keys before writing profile data', () => {
  assert.throws(() => ResumeProfile.parse('[basic]\n__proto__=unsafe\n'), /unsafe key/i);
  assert.throws(() => ResumeProfile.parse('[__proto__]\nname=unsafe\n'), /unsafe section/i);
});

test('parses custom fields and site mappings while excluding attachments', () => {
  const profile = ResumeProfile.parse(`[custom_fields.1]\nkey=job_code\nlabel=岗位编号\nvalue=R-001\ncategory=求职意向\naliases[]=职位编号\n\n[site_mappings.1]\nsite_key=example.com\nprofile_key=custom_fields.1\nlabel=岗位编号\nselector_hint=#job-code\nfield_type=text\nvalue=R-001\n\n[attachments.1]\ndisplay_name=should-not-appear.pdf\n`);

  assert.equal(profile.custom_fields.length, 1);
  assert.equal(profile.custom_fields[0].key, 'job_code');
  assert.deepEqual(profile.custom_fields[0].aliases, ['职位编号']);
  assert.equal(profile.site_mappings.length, 1);
  assert.equal(profile.site_mappings[0].site_key, 'example.com');
  assert.equal(Object.prototype.hasOwnProperty.call(profile, 'attachments'), false);
  assert.equal(ResumeProfile.stringify(profile).includes('attachments'), false);
});

test('round-trips a remembered site draft value', () => {
  const profile = ResumeProfile.parse(`[custom_fields.1]\nkey=job_code\nlabel=岗位编号\nvalue=\n\n[site_drafts.1]\nsite_key=https://example.com\nfingerprint=text:jobcode\nprofile_key=custom_fields.1\nvalue=R-001\nupdated_at=2026-09-08T00:00:00.000Z\n`);
  const exported = ResumeProfile.stringify(profile);
  const restored = ResumeProfile.parse(exported);
  assert.equal(restored.site_drafts[0].value, 'R-001');
  assert.equal(restored.site_drafts[0].site_key, 'https://example.com');
});

test('normalizes legacy null sections into renderable empty values', () => {
  const normalized = ResumeProfile.normalize({ basic: null, intention: null, education: null, custom_fields: null, site_mappings: null, site_drafts: null });
  assert.deepEqual(normalized.basic, {});
  assert.deepEqual(normalized.intention, {});
  assert.deepEqual(normalized.education, []);
  assert.deepEqual(normalized.custom_fields, []);
  assert.deepEqual(normalized.site_mappings, []);
  assert.deepEqual(normalized.site_drafts, []);
});

test('keeps editor deletions while picking up drafts stored elsewhere', () => {
  const fields = ['site_key', 'fingerprint', 'profile_key'];
  const baseline = [{ site_key: 'a', fingerprint: 'f1', profile_key: 'custom_fields.1', value: 'removed' }];
  const stored = [
    { site_key: 'a', fingerprint: 'f1', profile_key: 'custom_fields.1', value: 'removed' },
    { site_key: 'a', fingerprint: 'f2', profile_key: 'custom_fields.1', value: 'typed-on-page' }
  ];
  const merged = ResumeProfile.mergeRecords(baseline, [], stored, fields, true);
  assert.deepEqual(merged.map((record) => record.value), ['typed-on-page']);
});

test('lets a stored draft win over a stale editor copy', () => {
  const fields = ['site_key', 'fingerprint', 'profile_key'];
  const stale = { site_key: 'a', fingerprint: 'f1', profile_key: 'custom_fields.1', value: 'stale' };
  const merged = ResumeProfile.mergeRecords([stale], [stale], [{ site_key: 'a', fingerprint: 'f1', profile_key: 'custom_fields.1', value: 'typed-on-page' }], fields, true);
  assert.equal(merged[0].value, 'typed-on-page');
});

test('keeps the editor value when the editor owns the record', () => {
  const fields = ['key'];
  const edited = { key: 'job_code', value: 'edited' };
  const merged = ResumeProfile.mergeRecords([], [edited], [{ key: 'job_code', value: 'stored' }], fields);
  assert.equal(merged[0].value, 'edited');
});

test('writes merged records back into the live array', () => {
  const live = [{ key: 'job_code' }];
  const merged = ResumeProfile.mergeRecords([], live, [{ key: 'job_code' }, { key: 'other' }], ['key']);
  const result = ResumeProfile.replaceRecords(live, merged);
  assert.equal(result, live);
  assert.equal(live.length, 2);
  assert.equal(live[0], merged[0]);
  assert.deepEqual(ResumeProfile.replaceRecords(null, merged), merged);
});

test('round-trips learned label mappings so they can be reviewed and removed', () => {
  const profile = ResumeProfile.parse('[basic]\nname=示例姓名\n\n[label_mappings.1]\nlabel=意向岗位\nprofile_key=intention.1.target_role\nupdated_at=2026-09-11T00:00:00.000Z\n');
  assert.equal(profile.label_mappings.length, 1);
  assert.equal(profile.label_mappings[0].label, '意向岗位');
  const exported = ResumeProfile.stringify(profile);
  assert.ok(exported.includes('label=意向岗位'), 'learned label should appear in the exported template');
  const restored = ResumeProfile.parse(exported);
  assert.deepEqual(restored.label_mappings, profile.label_mappings);
});

test('deduplicates learned labels that repeat across sites', () => {
  const normalized = ResumeProfile.normalize({
    label_mappings: [
      { label: '意向岗位', profile_key: 'intention.1.target_role', updated_at: '2026-09-01T00:00:00.000Z' },
      { label: '意向岗位', profile_key: 'intention.1.target_role', updated_at: '2026-09-11T00:00:00.000Z' }
    ]
  });
  assert.equal(normalized.label_mappings.length, 1);
});

test('starts with an empty learned dictionary on legacy profiles', () => {
  assert.deepEqual(ResumeProfile.normalize({ basic: {} }).label_mappings, []);
  assert.deepEqual(ResumeProfile.createEmptyProfile().label_mappings, []);
});

test('offers a catalog of built-in fields for assignment', () => {
  const groups = ResumeProfile.ASSIGNABLE_FIELDS;
  assert.ok(groups.length >= 8, 'catalog should cover the main sections');
  const total = groups.reduce((n, g) => n + g.fields.length, 0);
  assert.ok(total >= 50, 'catalog should be reasonably complete');
  groups.forEach((group) => {
    assert.ok(group.section && group.label, 'each group needs a section and a label');
    assert.ok(group.fields.length > 0, group.section + ' has no fields');
    group.fields.forEach((meta) => {
      assert.equal(meta.length, 2, 'each field is [key, label]');
      assert.ok(meta[0] && meta[1]);
    });
  });
  // Sections that are flat objects must be flagged so callers build the right profile key.
  const scalar = groups.filter((g) => g.scalar).map((g) => g.section);
  assert.deepEqual(scalar.sort(), ['additional', 'basic', 'intention']);
  const single = groups.filter((g) => g.single).map((g) => g.section);
  assert.deepEqual(single, ['self_evaluation']);
});

test('reads the value a newly assigned field should offer', () => {
  const profile = { basic: { name: '示例姓名' }, education: [{ school: '示例大学' }, { school: '示例理工大学' }], self_evaluation: '一段评价' };
  assert.equal(ResumeProfile.readAssignedValue(profile, 'basic.name'), '示例姓名');
  assert.equal(ResumeProfile.readAssignedValue(profile, 'education.1.school'), '示例大学');
  assert.equal(ResumeProfile.readAssignedValue(profile, 'education.2.school'), '示例理工大学');
  assert.equal(ResumeProfile.readAssignedValue(profile, 'self_evaluation'), '一段评价');
  // Missing or malformed inputs must not throw.
  assert.equal(ResumeProfile.readAssignedValue(profile, 'education.9.school'), '');
  assert.equal(ResumeProfile.readAssignedValue(profile, 'basic.nope'), '');
  assert.equal(ResumeProfile.readAssignedValue(null, 'basic.name'), '');
  assert.equal(ResumeProfile.readAssignedValue(profile, ''), '');
});

test('records an assignment once and ignores repeats', () => {
  const profile = {};
  assert.equal(ResumeProfile.upsertLabelMapping(profile, '学习经历', 'education.1.school', 'T1'), true);
  assert.equal(ResumeProfile.upsertLabelMapping(profile, '学习经历', 'education.1.school', 'T2'), false);
  assert.deepEqual(profile.label_mappings, [{ label: '学习经历', profile_key: 'education.1.school', updated_at: 'T1' }]);
  // The same wording can legitimately mean two different fields on different sites.
  assert.equal(ResumeProfile.upsertLabelMapping(profile, '学习经历', 'employment.1.employer', 'T3'), true);
  assert.equal(profile.label_mappings.length, 2);
  // Rejects incomplete input rather than storing junk.
  assert.equal(ResumeProfile.upsertLabelMapping(profile, '', 'basic.name'), false);
  assert.equal(ResumeProfile.upsertLabelMapping(profile, '姓名', ''), false);
  assert.equal(ResumeProfile.upsertLabelMapping(profile, '   ', 'basic.name'), false);
});

test('an assignment makes the wording match on every later scan', () => {
  const Content = require('../content.js');
  const profile = { basic: { name: '示例姓名' }, education: [{ school: '示例大学' }] };
  // An unrecognised wording is unmatched before the assignment...
  assert.equal(Content.profileLabelStrength({ profileKey: 'education.1.school', label: '学校', value: '示例大学' }, '学习经历'), 'none');
  ResumeProfile.upsertLabelMapping(profile, '学习经历', 'education.1.school');
  const learned = Content.buildLearnedMap(profile.label_mappings);
  // ...and an exact hit afterwards.
  assert.equal(Content.profileLabelStrength({ profileKey: 'education.1.school', label: '学校', value: '示例大学' }, '学习经历', learned), 'exact');
  assert.equal(Content.findLearnedValue('学习经历', Content.flattenProfile(profile), {}, learned).value, '示例大学');
});

test('round-trips the application form fields from a recruitment site', () => {
  const profile = ResumeProfile.parse(
    '[basic]\nname=示例姓名\nphone_code=+86\nqq=123456\nid_type=身份证\nhas_children=无\nemergency_contact=示例联系人\nemergency_phone=13800138000\n' +
    'height=178\nweight=75\n\n[intention]\ninterview_site=示例城市\n\n' +
    '[additional]\nhobbies=摄影\nspecialty=长跑\npunishment=无\nacademic_works=无\npatents=无\n' +
    'law_violation=否\napplied_subsidiary=否\nrelatives_in_company=否\nmedical_history=否\nreferral_code=\n\n' +
    '[education.1]\nschool=示例大学\nsecond_major=辅修专业\ngraduate_type=应届\nenglish_level=大学英语六级\nenglish_score=528\nthesis_title=示例论文题目\n');
  assert.equal(profile.basic.phone_code, '+86');
  assert.equal(profile.basic.qq, '123456');
  assert.equal(profile.basic.height, '178');
  assert.equal(profile.intention.interview_site, '示例城市');
  assert.equal(profile.additional.specialty, '长跑');
  assert.equal(profile.additional.law_violation, '否');
  assert.equal(profile.education[0].second_major, '辅修专业');
  assert.equal(profile.education[0].english_score, '528');
  assert.equal(profile.education[0].thesis_title, '示例论文题目');
  const exported = ResumeProfile.stringify(profile);
  assert.ok(exported.includes('[additional]'), 'the additional section should survive export');
  assert.equal(ResumeProfile.stringify(ResumeProfile.parse(exported)), exported);
});

test('treats the additional section as a flat object, not a record list', () => {
  const profile = ResumeProfile.normalize({ additional: { hobbies: '摄影' } });
  assert.deepEqual(profile.additional, { hobbies: '摄影' });
  // Legacy profiles have no additional section at all.
  assert.deepEqual(ResumeProfile.normalize({ basic: {} }).additional, {});
  assert.deepEqual(ResumeProfile.createEmptyProfile().additional, {});
});

test('keeps a height and weight value free of units so numeric inputs accept it', () => {
  // The shipped template must not teach the unit-suffixed form; the form's own label already
  // says (cm) / (kg) and a numeric field rejects "178CM".
  const template = fs.readFileSync(path.join(__dirname, '..', '模板文件.txt'), 'utf8');
  const height = /^height=(.*)$/m.exec(template)[1].trim();
  const weight = /^weight=(.*)$/m.exec(template)[1].trim();
  assert.equal(/^\d+(\.\d+)?$/.test(height) || height === '', true, 'height should be numeric or left blank');
  assert.equal(/^\d+(\.\d+)?$/.test(weight) || weight === '', true, 'weight should be numeric or left blank');
  assert.equal(/[a-zA-Z]/.test(height), false, 'height must not carry a unit');
  assert.equal(/[a-zA-Z]/.test(weight), false, 'weight must not carry a unit');
  // The template is what a new user reads, so the unit rule has to be written there.
  const heightComment = /^# 身高：(.*)$/m.exec(template)[1];
  const weightComment = /^# 体重：(.*)$/m.exec(template)[1];
  assert.ok(/cm/.test(heightComment), 'the height comment should state the unit');
  assert.ok(/kg/.test(weightComment), 'the weight comment should state the unit');
  assert.ok(/只填数字/.test(heightComment) && /只填数字/.test(weightComment), 'and ask for digits only');
});
