(async function () {
  'use strict';
  var output = document.createElement('pre'); output.id = 'ehire-result'; document.body.appendChild(output);
  try {
    var submitAttempts = 0;
    document.addEventListener('submit', function (event) { event.preventDefault(); submitAttempts++; }, true);
    // Empty saved applicant data first; only synthetic values below are tested or reported.
    document.querySelectorAll('input:not([type=hidden]), textarea').forEach(function (el) {
      if (!/^(submit|button|file|checkbox|radio)$/.test(el.type || '')) el.value = '';
    });
    document.querySelectorAll('select').forEach(function (el) { el.selectedIndex = -1; });
    var profile = {
      education: [
        { level: '硕士', school: '北京大学', major: '人工智能', end_date: '2027-06', major_rank: '前5%', courses: ['算法', '控制'] },
        { level: '本科', school: '北京工业大学', major: '电子信息科学与技术', end_date: '2024-06', major_rank: '前20%', courses: ['电路', '信号'] }
      ],
      employment: [{ role: '算法工程师', end_date: '2023-07' }]
    };
    var expected = {
      cc_Degree_1_1: ['education.1.level', '7', ''], cc_GradDate_3_1: ['education.1.end_date', '2027-06', ''],
      cc_School_1_1: ['education.1.school', 'S_01004', '北京大学'], cc_Major_1_1: ['education.1.major', '0129', '人工智能'],
      cc_Score_1_1: ['education.1.major_rank', '1', ''], cc_Course_6_1: ['education.1.courses', '算法\n控制', ''],
      cc_CCA1_1_1: ['education.2.level', '6', ''], cc_CCC1_3_1: ['education.2.end_date', '2024-06', ''],
      cc_CCA2_1_1: ['education.2.school', 'S_01010', '北京工业大学'], cc_CCA4_1_1: ['education.2.major', '0107', '电子信息科学与技术'],
      cc_CCA14_1_1: ['education.2.major_rank', '2', ''], cc_CCF1_6_1: ['education.2.courses', '电路\n信号', '']
    };
    var candidates = ResumeContent.scan(profile);
    var resolved = Object.keys(expected).map(function (id) {
      var el = document.getElementById(id);
      var dd = el && el.closest('dd');
      var match = candidates.filter(function (c) { return c.selectorHint === '#' + id || (dd && ResumeContent.deriveLabel(el) === c.label); });
      return { id: id, key: match[0] ? match[0].profileKey : '', confidence: match[0] ? match[0].confidence : '', count: match.length };
    });
    var results = await ResumeContent.fill(candidates.filter(function (c) { return c.confidence === 'high' && !c.sensitive && !c.isNewField; }));
    // Give the page's change/blur handlers a turn to reject an uncommitted display string.
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
    var checks = Object.keys(expected).map(function (id) {
      var el = document.getElementById(id); var want = expected[id];
      var visible = el && el.parentElement.querySelector('.custom-combobox-input');
      var resolution = resolved.find(function (r) { return r.id === id; });
      return { id: id, key: resolution.key, confidence: resolution.confidence, candidates: resolution.count,
        correctKey: resolution.key === want[0], nativeOK: Boolean(el && el.value === want[1]),
        displayOK: !want[2] || Boolean(visible && visible.value === want[2]),
        eventOK: !window.selectCommits || !want[2] || window.selectCommits[id] === want[1] };
    });
    var withoutSecond = ResumeContent.scan({ education: [profile.education[0]], employment: profile.employment });
    var absentSecondNotReused = withoutSecond.filter(function (c) { return /2$/.test(c.label) || c.label === '其他学历'; }).every(function (c) { return !c.profileKey; });
    var missingThirdNotReused = candidates.filter(function (c) { return c.selectorHint === '#missing-third-record'; }).every(function (c) { return !c.profileKey; });
    var schoolRoleNotJob = candidates.filter(function (c) { return /^担任职务\d*$/.test(c.label); }).every(function (c) { return !c.profileKey || c.profileKey.indexOf('campus_roles.') === 0; });
    var inactiveOtherNotFilled = candidates.filter(function (c) { return /^其他(?:学校|专业)\d*$/.test(c.label); }).every(function (c) { return !c.profileKey; });
    // A school outside the dictionary must fail without putting a false display value on screen.
    var schoolCandidate = candidates.find(function (c) { return c.profileKey === 'education.1.school'; });
    var missingOptionSafe = false;
    if (schoolCandidate) {
      var school = document.getElementById('cc_School_1_1'); var input = school.parentElement.querySelector('.custom-combobox-input');
      var oldNative = school.value; var oldDisplay = input.value;
      var missing = await ResumeContent.fill([Object.assign({}, schoolCandidate, { proposedValue: '字典中不存在的测试学校' })]);
      missingOptionSafe = missing[0].status === 'failed' && school.value === oldNative && input.value === oldDisplay;
    }
    var otherChoiceFillsSameRecord = true;
    if (document.getElementById('other-school')) {
      var primary = document.getElementById('cc_School_1_1'); primary.value = 'other';
      var otherCandidates = ResumeContent.scan(profile);
      var other = otherCandidates.find(function (c) { return c.selectorHint === '#other-school'; });
      if (!other || other.confidence !== 'high' || other.profileKey !== 'education.1.school') otherChoiceFillsSameRecord = false;
      else {
        var otherResults = await ResumeContent.fill([other]);
        otherChoiceFillsSameRecord = otherResults[0].status === 'filled' && document.getElementById('other-school').value === profile.education[0].school;
      }
    }
    output.textContent = JSON.stringify({ candidateCount: candidates.length,
      high: candidates.filter(function (c) { return c.confidence === 'high'; }).length,
      labels: candidates.map(function (c) { return { label: c.label, key: c.profileKey || '', confidence: c.confidence }; }),
      checks: checks, correct: checks.filter(function (c) { return c.correctKey && c.nativeOK && c.displayOK && c.eventOK && c.candidates === 1; }).length,
      statuses: results.map(function (r) { return r.status; }), absentSecondNotReused: absentSecondNotReused,
      missingThirdNotReused: missingThirdNotReused, schoolRoleNotJob: schoolRoleNotJob, inactiveOtherNotFilled: inactiveOtherNotFilled,
      missingOptionSafe: missingOptionSafe, otherChoiceFillsSameRecord: otherChoiceFillsSameRecord, widgetLoaded: Boolean(window.jQuery && window.jQuery.fn.combobox), submitAttempts: submitAttempts });
  } catch (error) { output.textContent = JSON.stringify({ error: String(error && error.stack || error) }); }
}());
