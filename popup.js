(function () {
  'use strict';
  // Shared with the options page: the three-way merge, the stored accent and the storage round
  // trips live in shared.js, so the two pages cannot drift apart.
  var store = ResumeShared.createStore();
  var state = {
    profile: ResumeProfile.createEmptyProfile(),
    candidates: [],
    activeFilter: 'all',
    activeTab: 'fill',
    lastScanTab: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var status = $('profileStatus');

  function setStatus(message, error) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(error));
  }
  function profileIsEmpty(profile) {
    if (!profile) return true;
    if (ResumeProfile.readAssignedValue(profile, 'basic.name')) return false;
    if (ResumeProfile.readAssignedValue(profile, 'basic.phone')) return false;
    if (ResumeProfile.readAssignedValue(profile, 'basic.email')) return false;
    if (String(profile.self_evaluation || '').trim()) return false;
    if ((profile.education || []).length) return false;
    return true;
  }
  function readProfile() {
    return store.loadProfile().then(function (loaded) {
      state.profile = loaded.profile;
      ResumeShared.applyAccent(loaded.accent);
      return state.profile;
    });
  }
  function extensionVersion() {
    try { return chrome.runtime.getManifest().version || ''; } catch (_) { return ''; }
  }
  // The shared store owns the merge; this only mirrors the result back into the page state the
  // rest of the popup renders from.
  function saveProfile(profile) {
    return store.saveProfile(profile).then(function (saved) {
      state.profile = saved;
      return saved;
    });
  }
  // 证件号码这类列在扫描时和别的列一样从资料里匹配出来，如果连值一起写进扫描缓存，同一串敏感
  // 数字就会在 storage 里出现两处。缓存里只留「哪个字段」，值等恢复显示时再从资料读回来。
  // 申请人自己在那一行敲进去的值不在此列：那是他的输入，重开弹窗丢掉才是 bug。网页当前显示的值
  // 一并丢掉——那是同一个数据的网站副本，而且它本来就还在页面上，恢复后重新扫描即可。
  function stripSensitiveValues(candidates) {
    return candidates.map(function (candidate) {
      if (!candidate.sensitive) return candidate;
      var fromProfile = candidate.profileKey ? ResumeProfile.readAssignedValue(state.profile, candidate.profileKey) : '';
      var copy = Object.assign({}, candidate);
      copy.currentValue = '';
      var value = String(candidate.proposedValue == null ? '' : candidate.proposedValue);
      if (!fromProfile || value === String(fromProfile)) copy.proposedValue = '';
      return copy;
    });
  }
  function rehydrateSensitiveValues(candidates) {
    candidates.forEach(function (candidate) {
      if (candidate.sensitive && candidate.profileKey && !candidate.proposedValue) {
        candidate.proposedValue = ResumeProfile.readAssignedValue(state.profile, candidate.profileKey);
      }
    });
    return candidates;
  }
  function persistLastScan() {
    if (!state.lastScanTab || !state.candidates.length || !chrome.storage || !chrome.storage.local) return;
    var candidates;
    try { candidates = JSON.parse(JSON.stringify(stripSensitiveValues(state.candidates))); } catch (_) { return; }
    chrome.storage.local.set({
      resumeLastScan: {
        url: state.lastScanTab.url,
        siteKey: state.siteKey || '',
        activeFilter: state.activeFilter || 'all',
        candidates: candidates,
        savedAt: new Date().toISOString()
      }
    }, function () {});
  }
  // Every tick and edit flows through updateActionState, and the popup dies the moment the
  // applicant clicks the page, so the writes are coalesced and the close is caught as well.
  var persistTimer = null;
  function schedulePersistLastScan() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function () { persistTimer = null; persistLastScan(); }, 250);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') persistLastScan();
  });
  function restoreLastScan(tab) {
    if (!tab || !chrome.storage || !chrome.storage.local) return Promise.resolve(false);
    return new Promise(function (resolve) {
      chrome.storage.local.get({ resumeLastScan: null }, function (data) {
        var saved = data && data.resumeLastScan;
        if (!saved || saved.url !== tab.url || !Array.isArray(saved.candidates) || !saved.candidates.length) return resolve(false);
        state.lastScanTab = { id: tab.id, url: tab.url };
        state.siteKey = saved.siteKey || '';
        state.activeFilter = saved.activeFilter || 'all';
        state.candidates = rehydrateSensitiveValues(saved.candidates);
        $('review').hidden = false;
        renderCandidates();
        resolve(true);
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

  function candidateMatchesFilter(candidate, filter) {
    if (filter === 'all') return true;
    if (filter === 'matched') {
      return (candidate.confidence === 'high') || (candidate.isNewField && Boolean(candidate.assignedKey));
    }
    if (filter === 'confirm') {
      return candidate.confidence === 'medium';
    }
    if (filter === 'missing') {
      return candidate.confidence === 'none' || (candidate.isNewField && !candidate.assignedKey && !candidate.sensitive);
    }
    return true;
  }

  function updateFilterCounts() {
    var total = state.candidates.length;
    var matched = state.candidates.filter(function (c) { return candidateMatchesFilter(c, 'matched'); }).length;
    var confirm = state.candidates.filter(function (c) { return candidateMatchesFilter(c, 'confirm'); }).length;
    var missing = state.candidates.filter(function (c) { return candidateMatchesFilter(c, 'missing'); }).length;

    var pills = document.querySelectorAll('.filter-pill');
    pills.forEach(function (pill) {
      var f = pill.dataset.filter;
      if (f === 'all') pill.textContent = '全部 (' + total + ')';
      else if (f === 'matched') pill.textContent = '已对上 (' + matched + ')';
      else if (f === 'confirm') pill.textContent = '待确认 (' + confirm + ')';
      else if (f === 'missing') pill.textContent = '未匹配 (' + missing + ')';
      pill.classList.toggle('active', f === state.activeFilter);
    });
  }

  function updateActionState() {
    var selectedCandidates = state.candidates.filter(function (item) {
      return item.selected && item.proposedValue && (!item.isNewField || item.assignedKey);
    });
    var fillBtn = $('fillConfirmed');
    if (fillBtn) {
      fillBtn.disabled = selectedCandidates.length === 0;
      fillBtn.textContent = selectedCandidates.length > 0 ? ('帮我填上 (' + selectedCandidates.length + ' 处)') : '帮我填上';
    }

    var saveBtn = $('saveNewFields');
    if (saveBtn) {
      saveBtn.disabled = !state.candidates.some(function (item) {
        return item.isNewField && !item.sensitive && (item.assignedKey || (item.remember && (item.customKey || item.customLabel)));
      });
    }

    refreshFillLabel();

    // 更新批量选择行数字
    var visibleCandidates = state.candidates.filter(function (c) { return candidateMatchesFilter(c, state.activeFilter); });
    var visibleSelected = visibleCandidates.filter(function (c) { return c.selected; }).length;
    var countEl = $('visibleSelectedCount');
    var totalEl = $('visibleTotalCount');
    var selectAllBox = $('selectAllCandidates');
    if (countEl) countEl.textContent = visibleSelected;
    if (totalEl) totalEl.textContent = visibleCandidates.length;
    if (selectAllBox) {
      selectAllBox.checked = visibleCandidates.length > 0 && visibleSelected === visibleCandidates.length;
      selectAllBox.indeterminate = visibleSelected > 0 && visibleSelected < visibleCandidates.length;
    }

    // Keep the stored copy in step with what is on screen, so reopening the popup shows the
    // same ticks and edited values the applicant just set.
    schedulePersistLastScan();
  }

  function refreshFillLabel() {
    var pending = state.candidates.filter(function (item) {
      return item.isNewField && !item.sensitive && (item.assignedKey || (item.remember && item.customKey));
    });
    var saveBtn = $('saveNewFields');
    if (saveBtn) {
      saveBtn.textContent = pending.length > 1 ? '记住这几项' : '记住这一项';
    }
  }

  function highlightCandidate(candidate) {
    activeTab().then(function (tab) {
      messageTab(tab.id, { type: 'highlight', field: candidate }).catch(function () {});
    }).catch(function () {});
  }

  function renderCandidates() {
    var list = $('candidateList');
    list.textContent = '';
    $('candidateCount').textContent = state.candidates.length + ' 处';
    updateFilterCounts();
    updateActionState();

    if (!state.candidates.length) {
      list.innerHTML = '<div class="empty">这一页没有找到要填的地方。</div>';
      return;
    }

    var visibleCandidates = state.candidates.filter(function (item) {
      return candidateMatchesFilter(item, state.activeFilter);
    });

    if (!visibleCandidates.length) {
      list.innerHTML = '<div class="empty">该筛选分类下没有字段。</div>';
      return;
    }

    visibleCandidates.forEach(function (candidate) {
      var wrapper = document.createElement('div');
      wrapper.className = 'candidate' + (!candidate.selected ? ' is-excluded' : '');

      // 鼠标悬停时高亮网页中的对应元素
      wrapper.addEventListener('mouseenter', function () {
        highlightCandidate(candidate);
      });

      var top = document.createElement('div');
      top.className = 'candidate-top';

      var check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = candidate.selected;
      check.disabled = candidate.confidence === 'none' || !candidate.proposedValue;
      check.addEventListener('change', function () {
        candidate.selected = check.checked;
        wrapper.classList.toggle('is-excluded', !candidate.selected);
        updateActionState();
      });

      var label = document.createElement('label');
      label.textContent = candidate.label || '没有名称的一栏';
      label.addEventListener('click', function () {
        if (!check.disabled) {
          check.checked = !check.checked;
          candidate.selected = check.checked;
          wrapper.classList.toggle('is-excluded', !candidate.selected);
          updateActionState();
        }
      });

      // 定位按钮
      var locateBtn = document.createElement('button');
      locateBtn.type = 'button';
      locateBtn.className = 'locate-btn';
      locateBtn.title = '在网页中定位高亮此项';
      locateBtn.setAttribute('aria-label', '定位');
      locateBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>';
      locateBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        highlightCandidate(candidate);
      });

      var confidence = document.createElement('span');
      confidence.className = 'confidence';
      if (candidate.sensitive) {
        confidence.textContent = '需自己勾选';
        confidence.dataset.tone = 'danger';
      } else if (candidate.isNewField) {
        confidence.textContent = candidate.assignedKey ? '已对上' : '资料里没有';
        confidence.dataset.tone = candidate.assignedKey ? 'success' : 'neutral';
      }
      else if (candidate.confidence === 'high') {
        confidence.textContent = '已对上';
        confidence.dataset.tone = 'success';
      }
      else if (candidate.confidence === 'medium') {
        confidence.textContent = '请确认';
        confidence.dataset.tone = 'warning';
      }
      else {
        confidence.textContent = '没认出来';
        confidence.dataset.tone = 'neutral';
      }

      top.append(check, label, locateBtn, confidence);
      wrapper.appendChild(top);

      if (candidate.assignedKey && !candidate.proposedValue) {
        candidate.proposedValue = ResumeProfile.readAssignedValue(state.profile, candidate.assignedKey);
      }

      var input = document.createElement('input');
      input.type = 'text';
      input.value = candidate.proposedValue || '';
      input.placeholder = candidate.profileKey ? '要填进去的内容' : '网页上现在的内容';
      input.disabled = !candidate.profileKey && !candidate.isNewField;
      input.addEventListener('input', function () {
        candidate.proposedValue = input.value;
        if (!candidate.isNewField) candidate.selected = Boolean(input.value);
        wrapper.classList.toggle('is-excluded', !candidate.selected);
        check.checked = candidate.selected;
        updateActionState();
      });
      wrapper.appendChild(input);

      if (candidate.isNewField && candidate.assignedKey) {
        var summary = document.createElement('div');
        summary.className = 'assign-summary';
        var target = findAssignableField(candidate.assignedKey);
        var summaryText = document.createElement('span');
        summaryText.textContent = '会当作「' + (target ? target.label : candidate.assignedKey) + '」来填';
        var back = document.createElement('button');
        back.type = 'button';
        back.className = 'assign-clear';
        back.textContent = '换成别的';
        back.addEventListener('click', function () {
          candidate.assignedKey = '';
          candidate.confidence = 'none';
          candidate.proposedValue = '';
          candidate.selected = false;
          renderCandidates();
        });
        summary.append(summaryText, back);
        wrapper.appendChild(summary);
      }

      if (candidate.isNewField && !candidate.assignedKey && !candidate.sensitive) {
        var assign = document.createElement('select');
        assign.className = 'assign-select';
        var assignNone = document.createElement('option');
        assignNone.value = '';
        assignNone.textContent = '它其实是…（选一个）';
        assign.appendChild(assignNone);
        ResumeProfile.ASSIGNABLE_FIELDS.forEach(function (group) {
          var optGroup = document.createElement('optgroup');
          optGroup.label = group.label;
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

        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'link-button';
        more.textContent = candidate.showCustomEditor ? '收起' : '都不是，我自己起个名';
        more.addEventListener('click', function () {
          candidate.showCustomEditor = !candidate.showCustomEditor;
          renderCandidates();
        });
        wrapper.appendChild(more);

        if (candidate.showCustomEditor) {
          if (!candidate.customLabel) candidate.customLabel = candidate.label || '';
          var custom = document.createElement('div');
          custom.className = 'custom-field';
          var customCaption = document.createElement('small');
          customCaption.className = 'custom-field-caption';
          customCaption.textContent = '以后在资料里显示成';
          var labelInput = document.createElement('input');
          labelInput.type = 'text';
          labelInput.placeholder = '给它起个名字';
          labelInput.value = candidate.customLabel;
          labelInput.addEventListener('input', function () {
            candidate.customLabel = labelInput.value.trim();
            updateActionState();
          });
          custom.append(customCaption, labelInput);
          wrapper.appendChild(custom);
          var remember = document.createElement('label');
          remember.className = 'toggle-switch';
          var rememberBox = document.createElement('input');
          rememberBox.type = 'checkbox';
          rememberBox.checked = Boolean(candidate.remember);
          rememberBox.addEventListener('change', function () {
            candidate.remember = rememberBox.checked;
            updateActionState();
          });
          remember.append(rememberBox, document.createTextNode('以后自动记住我在这里填的'));
          wrapper.appendChild(remember);
        }
      }

      if (candidate.sensitive) {
        var sensitiveNote = document.createElement('div');
        sensitiveNote.className = 'new-field-note';
        sensitiveNote.textContent = candidate.isNewField
          ? '这里像是密码或验证码：不会保存，也不会自动勾选。'
          : '敏感信息：不会自动勾选，也不会被记住。要填请自己勾上。';
        wrapper.appendChild(sensitiveNote);
      } else if (candidate.isNewField) {
        var note = document.createElement('div');
        note.className = 'new-field-note';
        note.textContent = candidate.assignedKey ? '记住这一次，以后所有网站都能认出来。'
          : '你的资料里没有这一项。选一个它对应的内容，或者自己起个名。';
        wrapper.appendChild(note);
      }

      var current = document.createElement('small');
      current.textContent = candidate.currentValue ? '网页上现在写着：' + candidate.currentValue : '网页上现在是空的';
      wrapper.appendChild(current);
      list.appendChild(wrapper);
    });
  }

  // 快捷批量选择
  function setupBatchActions() {
    var selectAllBox = $('selectAllCandidates');
    if (selectAllBox) {
      selectAllBox.addEventListener('change', function () {
        var shouldSelect = selectAllBox.checked;
        var visible = state.candidates.filter(function (c) { return candidateMatchesFilter(c, state.activeFilter); });
        visible.forEach(function (c) {
          // Un-ticking everything is safe, so it applies to sensitive rows too; adding one back
          // is not, and that stays a manual decision.
          if (shouldSelect && c.sensitive) return;
          if (c.confidence !== 'none' && c.proposedValue) {
            c.selected = shouldSelect;
          }
        });
        renderCandidates();
      });
    }

    var selectHighBtn = $('selectHighOnly');
    if (selectHighBtn) {
      selectHighBtn.addEventListener('click', function () {
        state.candidates.forEach(function (c) {
          if (c.confidence === 'high' && c.proposedValue && !c.sensitive) {
            c.selected = true;
          } else {
            c.selected = false;
          }
        });
        renderCandidates();
      });
    }

    var clearAllBtn = $('clearAllSelected');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        var visible = state.candidates.filter(function (c) { return candidateMatchesFilter(c, state.activeFilter); });
        visible.forEach(function (c) { c.selected = false; });
        renderCandidates();
      });
    }

    // 筛选 Pill 切换
    var pills = document.querySelectorAll('.filter-pill');
    pills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        state.activeFilter = pill.dataset.filter || 'all';
        renderCandidates();
      });
    });

    // 高亮提示页面中的所有字段
    var locateAllBtn = $('quickLocateAll');
    if (locateAllBtn) {
      locateAllBtn.addEventListener('click', function () {
        var target = state.candidates.find(function (c) { return c.selected; }) || state.candidates[0];
        if (target) highlightCandidate(target);
      });
    }
  }

  // 资料速查面板逻辑
  // Built from the same catalog the assignment picker uses, so a field renamed in the schema
  // cannot drift out of sync here. Only entries that combine several fields, or that come from
  // list-shaped fields the catalog does not carry, are spelled out.
  function collectSearchableEntries(profile) {
    var entries = [];
    if (!profile) return entries;

    function push(category, title, value) {
      if (value === undefined || value === null) return;
      var text = Array.isArray(value) ? value.filter(Boolean).join('\n') : String(value).trim();
      if (text) entries.push({ category: category, title: title, value: text });
    }

    ResumeProfile.ASSIGNABLE_FIELDS.forEach(function (group) {
      if (group.single) {
        push('个人综述', group.fields[0][1], profile[group.section]);
        return;
      }
      if (group.scalar) {
        group.fields.forEach(function (meta) {
          push(group.label, meta[1], (profile[group.section] || {})[meta[0]]);
        });
        return;
      }
      (profile[group.section] || []).forEach(function (record, index) {
        var category = group.label + ' ' + (index + 1);
        group.fields.forEach(function (meta) { push(category, meta[1], record[meta[0]]); });
      });
    });

    // List-shaped fields, and the one column that is really two dates.
    (profile.education || []).forEach(function (edu, index) {
      var category = '教育经历 ' + (index + 1);
      if (edu.start_date || edu.end_date) {
        push(category, '在校起止时间', (edu.start_date || '') + ' 至 ' + (edu.end_date || ''));
      }
      push(category, '所学课程', edu.courses);
    });
    (profile.employment || []).forEach(function (emp, index) {
      push('工作/实习 ' + (index + 1), '工作内容', emp.duties);
    });
    (profile.projects || []).forEach(function (proj, index) {
      push('项目经历 ' + (index + 1), '项目职责', proj.duties);
    });
    (profile.campus_roles || []).forEach(function (role, index) {
      push('校内职务 ' + (index + 1), '工作内容', role.duties);
    });
    (profile.skills || []).forEach(function (skill, index) {
      push('技能 ' + (index + 1), '相关技能', skill.skills);
    });

    (profile.application_answers || []).forEach(function (qa) {
      if (qa.question && qa.answer) {
        entries.push({ category: '网申问答', title: qa.question, value: qa.answer });
      }
    });
    (profile.custom_fields || []).forEach(function (field) {
      if (field.label && field.value) {
        entries.push({ category: field.category || '我加的项', title: field.label, value: field.value });
      }
    });

    return entries;
  }

  function renderQuickCopy(filterQuery) {
    var container = $('quickCopyList');
    if (!container) return;
    container.textContent = '';

    var allEntries = collectSearchableEntries(state.profile);
    var q = String(filterQuery || '').trim().toLowerCase();
    var filtered = q ? allEntries.filter(function (e) {
      return e.title.toLowerCase().indexOf(q) >= 0 || e.value.toLowerCase().indexOf(q) >= 0 || e.category.toLowerCase().indexOf(q) >= 0;
    }) : allEntries;

    if (!filtered.length) {
      container.innerHTML = '<div class="empty">' + (allEntries.length === 0 ? '资料库中尚无内容，请先导入资料。' : '未找到匹配的资料。') + '</div>';
      return;
    }

    filtered.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'copy-card';

      var info = document.createElement('div');
      info.className = 'copy-card-info';

      var titleRow = document.createElement('div');
      titleRow.className = 'copy-card-title';
      var cat = document.createElement('span');
      cat.className = 'copy-category-tag';
      cat.textContent = item.category;
      var title = document.createElement('span');
      title.textContent = item.title;
      titleRow.append(cat, title);

      var val = document.createElement('div');
      val.className = 'copy-card-val';
      val.textContent = item.value;
      val.title = item.value;

      info.append(titleRow, val);

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-action-btn';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(item.value).then(function () {
          copyBtn.textContent = '✓ 已复制';
          copyBtn.classList.add('copied');
          setTimeout(function () {
            copyBtn.textContent = '复制';
            copyBtn.classList.remove('copied');
          }, 1400);
        });
      });

      card.append(info, copyBtn);
      container.appendChild(card);
    });
  }

  function setupQuickCopyEvents() {
    var searchInput = $('quickSearchInput');
    var clearBtn = $('quickSearchClear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var val = searchInput.value;
        if (clearBtn) clearBtn.hidden = !val;
        renderQuickCopy(val);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        clearBtn.hidden = true;
        renderQuickCopy('');
      });
    }

    // 标签页切换
    var tabFill = $('tabNavFill');
    var tabQuickCopy = $('tabNavQuickCopy');
    var fillPanel = $('tabFillPanel');
    var quickCopyPanel = $('tabQuickCopyPanel');

    if (tabFill && tabQuickCopy) {
      tabFill.addEventListener('click', function () {
        tabFill.classList.add('active');
        tabFill.setAttribute('aria-selected', 'true');
        tabQuickCopy.classList.remove('active');
        tabQuickCopy.setAttribute('aria-selected', 'false');
        if (fillPanel) fillPanel.classList.add('active');
        if (quickCopyPanel) {
          quickCopyPanel.classList.remove('active');
          quickCopyPanel.hidden = true;
        }
      });

      tabQuickCopy.addEventListener('click', function () {
        tabQuickCopy.classList.add('active');
        tabQuickCopy.setAttribute('aria-selected', 'true');
        tabFill.classList.remove('active');
        tabFill.setAttribute('aria-selected', 'false');
        if (quickCopyPanel) {
          quickCopyPanel.classList.add('active');
          quickCopyPanel.hidden = false;
        }
        if (fillPanel) fillPanel.classList.remove('active');
        renderQuickCopy(searchInput ? searchInput.value : '');
      });
    }
  }

  // 扫描按钮
  $('scanPage').addEventListener('click', function () {
    $('scanPage').disabled = true;
    setStatus('正在分析当前页面表单…');
    activeTab().then(function (tab) {
      try { state.siteKey = new URL(tab.url).origin; } catch (_) { state.siteKey = ''; }
      return ensureLatestContent(tab.id).then(function () {
        return messageTab(tab.id, {
          type: 'scan',
          profile: state.profile,
          context: { siteKey: state.siteKey, mappings: state.profile.site_mappings || [] }
        });
      }).then(function (response) { return { tab: tab, response: response }; });
    }).then(function (result) {
      var tab = result.tab;
      var response = result.response;
      state.lastScanTab = { id: tab.id, url: tab.url };
      state.candidates = (response.candidates || []).map(function (candidate) {
        candidate.selected = !candidate.sensitive && !candidate.isNewField && candidate.confidence === 'high' && Boolean(candidate.proposedValue);
        return candidate;
      });
      $('review').hidden = false;
      renderCandidates();
      persistLastScan();
      var remembered = state.candidates.filter(function (item) { return item.remember && !item.isNewField && !item.sensitive; });
      if (remembered.length) messageTab(tab.id, { type: 'remember', fields: remembered, siteKey: state.siteKey || '' }).catch(function () {});

      var matchedCount = state.candidates.filter(function (c) { return candidateMatchesFilter(c, 'matched'); }).length;
      if (profileIsEmpty(state.profile)) {
        setStatus('扫描完成。你的简历资料目前为空，请点击右上角“导入资料”或打开资料编辑器填写。', true);
      } else {
        setStatus('扫描完成！找到 ' + state.candidates.length + ' 处表单，已自动对上 ' + matchedCount + ' 处。确认无误后点击“帮我填上”。');
      }
    }).catch(function (error) {
      setStatus(error.message, true);
    }).finally(function () {
      $('scanPage').disabled = false;
    });
  });

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
    activeTab().then(function (tab) {
      return rememberConfirmedLabels().then(function () { return tab; });
    }).then(function (tab) {
      return ensureLatestContent(tab.id).then(function () {
        return messageTab(tab.id, {
          type: 'fill',
          fields: state.candidates.filter(function (item) { return item.selected && (!item.isNewField || item.assignedKey); })
        });
      });
    }).then(function (response) {
      var results = response.results || [];
      var filled = results.filter(function (item) { return item.status === 'filled'; }).length;
      var skipped = results.filter(function (item) { return item.status === 'skipped'; }).length;
      var failed = results.filter(function (item) { return item.status === 'failed'; }).length;
      $('result').textContent = '✅ 已填好 ' + filled + ' 项' + (skipped ? '，跳过 ' + skipped + ' 项' : '') + (failed ? '，' + failed + ' 项未填上' : '') + '。请在网页上仔细检查后手动保存/提交！';
    }).catch(function (error) {
      $('result').textContent = error.message;
    });
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
        setStatus('已记住映射关系。有 ' + filled + ' 项可以直接填充，确认后点击“帮我填上”。');
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
      if (!record) {
        state.profile.custom_fields.push({
          key: key, label: label, category: candidate.customCategory || '其他',
          value: candidate.proposedValue || '', aliases: [label],
          field_type: candidate.controlType, enabled: 'true'
        });
        record = state.profile.custom_fields[state.profile.custom_fields.length - 1];
      }
      else if (!record.value && candidate.proposedValue) record.value = candidate.proposedValue;
      var index = state.profile.custom_fields.indexOf(record);
      var mapping = state.profile.site_mappings.find(function (item) {
        return item.site_key === siteKey && item.fingerprint === candidate.fingerprint && item.profile_key === 'custom_fields.' + (index + 1);
      });
      if (!mapping) {
        state.profile.site_mappings.push({
          site_key: siteKey, fingerprint: candidate.fingerprint, selector_hint: candidate.selectorHint || '',
          label: label, profile_key: 'custom_fields.' + (index + 1), field_type: candidate.controlType, confirmed: 'true'
        });
      }
      candidate.profileKey = 'custom_fields.' + (index + 1);
      candidate.label = label;
      candidate.customLabel = label;
      candidate.isNewField = false;
      candidate.confidence = 'high';
      candidate.remember = true;
      candidate.selected = false;
      if (candidate.proposedValue) {
        state.profile.site_drafts.push({
          site_key: siteKey, fingerprint: candidate.fingerprint,
          profile_key: candidate.profileKey, value: candidate.proposedValue, updated_at: new Date().toISOString()
        });
      }
    });
    saveProfile(state.profile).then(function () {
      return activeTab();
    }).then(function (tab) {
      return messageTab(tab.id, {
        type: 'remember',
        fields: state.candidates.filter(function (item) { return item.remember && !item.isNewField; }),
        siteKey: siteKey
      });
    }).then(function () {
      renderCandidates();
      setStatus('已记住新字段。以后你在该网站填写的此项内容会自动保存。');
    }).catch(function (error) {
      setStatus('保存失败：' + error.message, true);
    });
  });

  $('importProfile').addEventListener('click', function () { $('fileInput').click(); });
  $('fileInput').addEventListener('change', function () {
    var file = $('fileInput').files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var profile = ResumeProfile.parse(reader.result);
        saveProfile(profile).then(function () {
          setStatus('简历资料导入成功，已就绪！');
          renderQuickCopy('');
        }).catch(function (error) {
          setStatus('资料保存失败：' + (error && error.message ? error.message : '未知错误'), true);
        });
      }
      catch (error) { setStatus('导入失败：' + error.message, true); }
    };
    reader.readAsText(file, 'utf-8');
  });

  $('exportProfile').addEventListener('click', function () {
    try {
      var blob = new Blob([ResumeProfile.stringify(state.profile)], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = '简历资料导出.txt';
      link.click();
      URL.revokeObjectURL(url);
      setStatus('简历资料已导出到本地。');
    } catch (error) {
      setStatus('导出失败：' + (error && error.message ? error.message : '未知错误'), true);
    }
  });

  $('openOptions').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });

  // 初始化
  setupBatchActions();
  setupQuickCopyEvents();

  readProfile().then(function () {
    var readyMessage = profileIsEmpty(state.profile) ?
      '资料库尚为空白。请先点击右上角“导入资料”，或打开设置填写你的简历。' :
      '资料已就绪。打开招聘网页后，点击下方“看看这页要填什么”即可开始。';
    setStatus(readyMessage);
    // Chrome closes the panel as soon as the applicant clicks the page, and reopening used to
    // start from nothing. Bring the previous scan back when the page is still the same one.
    return activeTab().then(function (tab) { return restoreLastScan(tab); }).then(function (restored) {
      if (restored) setStatus('已恢复上次的扫描结果（共 ' + state.candidates.length + ' 处）。确认后可直接点“帮我填上”。');
    }).catch(function () {});
  }).catch(function (error) {
    setStatus('本地资料读取失败：' + (error && error.message ? error.message : '未知错误'), true);
  });
}());
