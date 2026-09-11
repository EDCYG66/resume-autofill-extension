(function () {
  'use strict';
  var MERGE_KEYS = {
    custom_fields: ['key'],
    site_mappings: ['site_key', 'fingerprint', 'profile_key'],
    site_drafts: ['site_key', 'fingerprint', 'profile_key'],
    label_mappings: ['label', 'profile_key']
  };
  var STORED_WINS = { site_drafts: true };
  var DEFAULT_ACCENT = '#0078d4';
  var state = { profile: ResumeProfile.createEmptyProfile(), baseline: {}, candidates: [] };

  function mergeInto(target, stored) {
    Object.keys(MERGE_KEYS).forEach(function (key) {
      var current = Array.isArray(target[key]) ? target[key] : [];
      var merged = ResumeProfile.mergeRecords(state.baseline[key] || [], current, stored[key] || [], MERGE_KEYS[key], Boolean(STORED_WINS[key]));
      target[key] = ResumeProfile.replaceRecords(current, merged);
    });
  }
  var $ = function (id) { return document.getElementById(id); };
  var status = $('profileStatus');

  function setStatus(message, error) {
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(error));
  }
  function captureBaseline(profile) {
    state.baseline = {};
    Object.keys(MERGE_KEYS).forEach(function (key) {
      state.baseline[key] = (profile[key] || []).map(function (record) { return Object.assign({}, record); });
    });
  }
  // A brand new install has no data at all. Say so plainly instead of reporting "资料已就绪",
  // which reads as "everything is fine" while every field on the page would come back unmatched.
  function profileIsEmpty(profile) {
    if (!profile) return true;
    if (ResumeProfile.readAssignedValue(profile, 'basic.name')) return false;
    if (ResumeProfile.readAssignedValue(profile, 'basic.phone')) return false;
    if (ResumeProfile.readAssignedValue(profile, 'basic.email')) return false;
    if (String(profile.self_evaluation || '').trim()) return false;
    if ((profile.education || []).length) return false;
    return true;
  }
  // The accent is a single value; the hover and pressed steps derive from it in CSS.
  function applyAccent(color) {
    if (!color) return;
    document.documentElement.style.setProperty('--accent', String(color));
  }
  function readProfile() {
    return new Promise(function (resolve) {
      chrome.storage.local.get({ resumeProfile: ResumeProfile.createEmptyProfile(), resumeAccent: DEFAULT_ACCENT }, function (data) {
        state.profile = ResumeProfile.normalize(data.resumeProfile);
        captureBaseline(state.profile);
        applyAccent(data.resumeAccent);
        resolve(state.profile);
      });
    });
  }
  function extensionVersion() {
    try { return chrome.runtime.getManifest().version || ''; } catch (_) { return ''; }
  }
  function saveProfile(profile) {
    state.profile = ResumeProfile.normalize(profile);
    return new Promise(function (resolve) {
      chrome.storage.local.get({ resumeProfile: ResumeProfile.createEmptyProfile() }, function (data) {
        mergeInto(state.profile, ResumeProfile.normalize(data.resumeProfile));
        chrome.storage.local.set({ resumeProfile: state.profile }, function () {
          captureBaseline(state.profile);
          resolve();
        });
      });
    });
  }
  function activeTab() {
    return new Promise(function (resolve, reject) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError || !tabs[0]) reject(new Error('没找到当前页面')); else resolve(tabs[0]);
      });
    });
  }
  function messageTab(tabId, message) {
    return new Promise(function (resolve, reject) {
      chrome.tabs.sendMessage(tabId, message, function (response) {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }, function () {
            if (chrome.runtime.lastError) return reject(new Error('这个页面不允许插件读取'));
            chrome.tabs.sendMessage(tabId, message, function (retry) {
              if (chrome.runtime.lastError) reject(new Error('读取这一页失败')); else resolve(retry || {});
            });
          });
        } else resolve(response || {});
      });
    });
  }
  function ensureLatestContent(tabId) {
    var expected = extensionVersion();
    return messageTab(tabId, { type: 'ping' }).then(function (response) {
      if (expected && response && response.version === expected) return response;
      return new Promise(function (resolve, reject) {
        chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }, function () {
          if (chrome.runtime.lastError) reject(new Error('这个页面不允许插件读取')); else resolve({ version: expected });
        });
      });
    });
  }
  // Resolves a profile key back to its human label for the assignment summary.
  function findAssignableField(profileKey) {
    var parts = String(profileKey || '').split('.');
    var section = parts[0];
    var key = parts[parts.length - 1];
    var found = null;
    ResumeProfile.ASSIGNABLE_FIELDS.forEach(function (group) {
      if (group.section !== section) return;
      group.fields.forEach(function (meta) { if (meta[0] === key) found = { group: group.label, label: meta[1] }; });
    });
    return found;
  }
  function renderCandidates() {
    var list = $('candidateList');
    list.textContent = '';
    $('candidateCount').textContent = state.candidates.length + ' 处';
    $('saveNewFields').disabled = !state.candidates.some(function (item) { return item.isNewField && !item.sensitive && (item.assignedKey || item.remember); });
    refreshFillLabel();
    $('fillConfirmed').disabled = !state.candidates.some(function (item) { return item.selected && item.proposedValue && (!item.isNewField || item.assignedKey); });
    if (!state.candidates.length) { list.innerHTML = '<div class="empty">这一页没有找到要填的地方。</div>'; return; }
    state.candidates.forEach(function (candidate, index) {
      var wrapper = document.createElement('div'); wrapper.className = 'candidate';
      var top = document.createElement('div'); top.className = 'candidate-top';
      var check = document.createElement('input'); check.type = 'checkbox'; check.checked = candidate.selected; check.disabled = candidate.confidence === 'none' || !candidate.proposedValue;
      check.addEventListener('change', function () { candidate.selected = check.checked; updateActionState(); });
      var label = document.createElement('label'); label.textContent = candidate.label || '没有名称的一栏';
      var confidence = document.createElement('span'); confidence.className = 'confidence';
      if (candidate.isNewField) {
        confidence.textContent = candidate.sensitive ? '不会保存' : candidate.assignedKey ? '已对上' : '资料里没有';
        confidence.dataset.tone = candidate.sensitive ? 'danger' : candidate.assignedKey ? 'success' : 'neutral';
      }
      else if (candidate.confidence === 'high') { confidence.textContent = '已对上'; confidence.dataset.tone = 'success'; }
      else if (candidate.confidence === 'medium') { confidence.textContent = '请确认'; confidence.dataset.tone = 'warning'; }
      else { confidence.textContent = '没认出来'; confidence.dataset.tone = 'neutral'; }
      top.append(check, label, confidence); wrapper.appendChild(top);
      if (candidate.assignedKey && !candidate.proposedValue) candidate.proposedValue = ResumeProfile.readAssignedValue(state.profile, candidate.assignedKey);
      var input = document.createElement('input'); input.type = 'text'; input.value = candidate.proposedValue || ''; input.placeholder = candidate.profileKey ? '要填进去的内容' : '网页上现在的内容'; input.disabled = !candidate.profileKey && !candidate.isNewField;
      input.addEventListener('input', function () { candidate.proposedValue = input.value; if (!candidate.isNewField) candidate.selected = Boolean(input.value); updateActionState(); });
      wrapper.appendChild(input);

      if (candidate.isNewField && candidate.assignedKey) {
        var summary = document.createElement('div'); summary.className = 'assign-summary';
        var target = findAssignableField(candidate.assignedKey);
        var summaryText = document.createElement('span');
        summaryText.textContent = '会当作「' + (target ? target.label : candidate.assignedKey) + '」来填';
        var back = document.createElement('button'); back.type = 'button'; back.className = 'assign-clear'; back.textContent = '换成别的';
        back.addEventListener('click', function () {
          candidate.assignedKey = ''; candidate.confidence = 'none'; candidate.proposedValue = ''; candidate.selected = false;
          renderCandidates();
        });
        summary.append(summaryText, back);
        wrapper.appendChild(summary);
      }

      if (candidate.isNewField && !candidate.assignedKey && !candidate.sensitive) {
        // Most of the time the answer is "it is one of these", so the picker comes first and
        // the do-it-yourself form only appears when that is not the case.
        var assign = document.createElement('select'); assign.className = 'assign-select';
        var assignNone = document.createElement('option'); assignNone.value = ''; assignNone.textContent = '它其实是…（选一个）'; assign.appendChild(assignNone);
        ResumeProfile.ASSIGNABLE_FIELDS.forEach(function (group) {
          var optGroup = document.createElement('optgroup'); optGroup.label = group.label;
          group.fields.forEach(function (meta) {
            var option = document.createElement('option');
            option.value = group.single ? meta[0] : group.scalar ? group.section + '.' + meta[0] : group.section + '.1.' + meta[0];
            option.textContent = meta[1];
            optGroup.appendChild(option);
          });
          assign.appendChild(optGroup);
        });
        assign.addEventListener('change', function () {
          candidate.assignedKey = assign.value;
          candidate.confidence = assign.value ? 'high' : 'none';
          if (assign.value) candidate.remember = false;
          renderCandidates();
        });
        wrapper.appendChild(assign);

        var more = document.createElement('button'); more.type = 'button'; more.className = 'link-button';
        more.textContent = candidate.showCustomEditor ? '收起' : '都不是，我自己起个名';
        more.addEventListener('click', function () { candidate.showCustomEditor = !candidate.showCustomEditor; renderCandidates(); });
        wrapper.appendChild(more);

        if (candidate.showCustomEditor) {
          // Prefill from the page label so the field is already valid without any typing.
          if (!candidate.customLabel) candidate.customLabel = candidate.label || '';
          var custom = document.createElement('div'); custom.className = 'custom-field';
          var customCaption = document.createElement('small'); customCaption.className = 'custom-field-caption';
          customCaption.textContent = '以后在资料里显示成';
          var labelInput = document.createElement('input'); labelInput.type = 'text'; labelInput.placeholder = '给它起个名字'; labelInput.value = candidate.customLabel;
          labelInput.addEventListener('input', function () { candidate.customLabel = labelInput.value.trim(); updateActionState(); });
          custom.append(customCaption, labelInput); wrapper.appendChild(custom);
          var remember = document.createElement('label'); remember.className = 'toggle-switch';
          var rememberBox = document.createElement('input'); rememberBox.type = 'checkbox'; rememberBox.checked = Boolean(candidate.remember);
          rememberBox.addEventListener('change', function () { candidate.remember = rememberBox.checked; updateActionState(); });
          remember.append(rememberBox, document.createTextNode('以后自动记住我在这里填的'));
          wrapper.appendChild(remember);
        }
      }

      if (candidate.isNewField) {
        var note = document.createElement('div'); note.className = 'new-field-note';
        note.textContent = candidate.sensitive ? '这里像是密码或验证码，不会保存。'
          : candidate.assignedKey ? '记住这一次，以后所有网站都能认出来。'
          : '你的资料里没有这一项。选一个它对应的内容，或者自己起个名。';
        wrapper.appendChild(note);
      }

      var current = document.createElement('small'); current.textContent = candidate.currentValue ? '网页上现在写着：' + candidate.currentValue : '网页上现在是空的'; wrapper.appendChild(current);
      list.appendChild(wrapper);
    });
  }
  function refreshFillLabel() {
    var pending = state.candidates.filter(function (item) {
      return item.isNewField && !item.sensitive && (item.assignedKey || (item.remember && item.customKey));
    });
    $('saveNewFields').textContent = pending.length > 1 ? '记住这几项' : '记住这一项';
  }
  function updateActionState() {
    $('fillConfirmed').disabled = !state.candidates.some(function (item) { return item.selected && item.proposedValue && (!item.isNewField || item.assignedKey); });
    $('saveNewFields').disabled = !state.candidates.some(function (item) { return item.isNewField && !item.sensitive && (item.assignedKey || (item.remember && (item.customKey || item.customLabel))); });
    refreshFillLabel();
  }
  $('scanPage').addEventListener('click', function () {
    $('scanPage').disabled = true; setStatus('正在看这一页…');
    activeTab().then(function (tab) {
      try { state.siteKey = new URL(tab.url).origin; } catch (_) { state.siteKey = ''; }
      return ensureLatestContent(tab.id).then(function () { return messageTab(tab.id, { type: 'scan', profile: state.profile, context: { siteKey: state.siteKey, mappings: state.profile.site_mappings || [] } }); }).then(function (response) { return { tab: tab, response: response }; });
    }).then(function (result) {
      var tab = result.tab; var response = result.response;
      state.candidates = (response.candidates || []).map(function (candidate) { candidate.selected = !candidate.isNewField && candidate.confidence === 'high' && Boolean(candidate.proposedValue); return candidate; });
      $('review').hidden = false; renderCandidates();
      var remembered = state.candidates.filter(function (item) { return item.remember && !item.isNewField && !item.sensitive; });
      if (remembered.length) messageTab(tab.id, { type: 'remember', fields: remembered, siteKey: state.siteKey || '' }).catch(function () {});
      setStatus(profileIsEmpty(state.profile) ? '读完了。你的资料还是空的，所以这些栏目都显示“资料里没有”——先点上面的“导入资料”填好资料，再回来扫描一次。' : '读完了。确认没问题，就点下面的“帮我填上”。');
    }).catch(function (error) { setStatus(error.message, true); }).finally(function () { $('scanPage').disabled = false; });
  });
  // A confirmed fuzzy match is a synonym the alias table did not know. Record it so the
  // same wording is recognised as high confidence on every site from now on.
  function rememberConfirmedLabels() {
    var confirmed = state.candidates.filter(function (item) {
      return item.selected && !item.isNewField && item.profileKey && item.confidence === 'medium';
    });
    if (!confirmed.length) return Promise.resolve();
    state.profile.label_mappings = state.profile.label_mappings || [];
    confirmed.forEach(function (item) {
      var label = String(item.label || '').trim();
      if (!label) return;
      ResumeProfile.upsertLabelMapping(state.profile, label, item.profileKey);
    });
    return saveProfile(state.profile);
  }
  $('fillConfirmed').addEventListener('click', function () {
    activeTab().then(function (tab) { return rememberConfirmedLabels().then(function () { return tab; }); }).then(function (tab) { return ensureLatestContent(tab.id).then(function () { return messageTab(tab.id, { type: 'fill', fields: state.candidates.filter(function (item) { return item.selected && (!item.isNewField || item.assignedKey); }) }); }); }).then(function (response) {
      var results = response.results || []; var filled = results.filter(function (item) { return item.status === 'filled'; }).length; var skipped = results.filter(function (item) { return item.status === 'skipped'; }).length; var failed = results.filter(function (item) { return item.status === 'failed'; }).length;
      $('result').textContent = '填好了 ' + filled + ' 项，跳过 ' + skipped + ' 项，' + failed + ' 项没能填上。没有点提交。';
    }).catch(function (error) { $('result').textContent = error.message; });
  });
  $('saveNewFields').addEventListener('click', function () {
    var assigned = state.candidates.filter(function (item) { return item.isNewField && !item.sensitive && item.assignedKey; });
    var newCandidates = state.candidates.filter(function (item) { return item.isNewField && item.remember && !item.sensitive; });
    if (!assigned.length && !newCandidates.length) return;
    var learned = 0;
    assigned.forEach(function (candidate) {
      if (ResumeProfile.upsertLabelMapping(state.profile, candidate.label, candidate.assignedKey)) learned += 1;
      candidate.profileKey = candidate.assignedKey;
      if (!candidate.proposedValue) candidate.proposedValue = ResumeProfile.readAssignedValue(state.profile, candidate.assignedKey);
      candidate.confidence = 'high';
      candidate.selected = Boolean(candidate.proposedValue);
    });
    if (assigned.length) {
      saveProfile(state.profile).then(function () {
        renderCandidates();
        var filled = assigned.filter(function (item) { return item.selected; }).length;
        setStatus('记住了。有 ' + filled + ' 项可以填，确认后点下面的“帮我填上”。');
      }).catch(function (error) { setStatus('保存失败：' + error.message, true); });
      if (!newCandidates.length) return;
    }
    state.profile.custom_fields = state.profile.custom_fields || [];
    state.profile.site_mappings = state.profile.site_mappings || [];
    state.profile.site_drafts = state.profile.site_drafts || [];
    var siteKey = newCandidates[0].siteKey || '';
    newCandidates.forEach(function (candidate) {
      var key = (candidate.customKey || candidate.fingerprint.replace(/[^a-zA-Z0-9_]+/g, '_')).replace(/^_+|_+$/g, '').toLowerCase() || 'custom_field_' + Date.now();
      var label = candidate.customLabel || candidate.label || key;
      var record = state.profile.custom_fields.find(function (item) { return item.key === key; });
      if (!record) { state.profile.custom_fields.push({ key: key, label: label, category: candidate.customCategory || '其他', value: candidate.proposedValue || '', aliases: [label], field_type: candidate.controlType, enabled: 'true' }); record = state.profile.custom_fields[state.profile.custom_fields.length - 1]; }
      else if (!record.value && candidate.proposedValue) record.value = candidate.proposedValue;
      var index = state.profile.custom_fields.indexOf(record);
      var mapping = state.profile.site_mappings.find(function (item) { return item.site_key === siteKey && item.fingerprint === candidate.fingerprint && item.profile_key === 'custom_fields.' + (index + 1); });
      if (!mapping) state.profile.site_mappings.push({ site_key: siteKey, fingerprint: candidate.fingerprint, selector_hint: candidate.selectorHint || '', label: label, profile_key: 'custom_fields.' + (index + 1), field_type: candidate.controlType, confirmed: 'true' });
      candidate.profileKey = 'custom_fields.' + (index + 1); candidate.label = label; candidate.customLabel = label; candidate.isNewField = false; candidate.confidence = 'high'; candidate.remember = true; candidate.selected = false;
      if (candidate.proposedValue) state.profile.site_drafts.push({ site_key: siteKey, fingerprint: candidate.fingerprint, profile_key: candidate.profileKey, value: candidate.proposedValue, updated_at: new Date().toISOString() });
    });
    saveProfile(state.profile).then(function () { return activeTab(); }).then(function (tab) { return messageTab(tab.id, { type: 'remember', fields: state.candidates.filter(function (item) { return item.remember && !item.isNewField; }), siteKey: siteKey }); }).then(function () { renderCandidates(); setStatus('记住了。以后你在这里填的内容会自动存下来。'); }).catch(function (error) { setStatus('保存失败：' + error.message, true); });
  });
  $('importProfile').addEventListener('click', function () { $('fileInput').click(); });
  $('fileInput').addEventListener('change', function () {
    var file = $('fileInput').files[0]; if (!file) return;
    var reader = new FileReader(); reader.onload = function () {
      try { var profile = ResumeProfile.parse(reader.result); saveProfile(profile).then(function () { setStatus('资料导入成功，重复的教育经历已合并。'); }); }
      catch (error) { setStatus('导入失败：' + error.message, true); }
    }; reader.readAsText(file, 'utf-8');
  });
  $('exportProfile').addEventListener('click', function () {
    var blob = new Blob([ResumeProfile.stringify(state.profile)], { type: 'text/plain;charset=utf-8' }); var url = URL.createObjectURL(blob); var link = document.createElement('a'); link.href = url; link.download = '简历资料导出.txt'; link.click(); URL.revokeObjectURL(url); setStatus('资料已导出。');
  });
  $('openOptions').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
  readProfile().then(function () { setStatus(profileIsEmpty(state.profile) ? '资料还是空的。请先点上面的“导入资料”导入模板，或点右上角的按钮打开资料编辑器填写。' : '资料已就绪。'); });
}());
