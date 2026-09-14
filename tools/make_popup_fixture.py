"""Regenerates the popup fixtures from the real popup.html.

The fixtures have to mirror popup.html's markup, otherwise the popup smoke test keeps passing
against a stale page while the shipped one has moved on. Run this after editing popup.html.

Two pages are produced:
- 测试/popup-fixture.html          drives the scan -> assign -> save -> fill flow.
- 测试/popup-restore-fixture.html  ships a stored scan for the active tab, so the smoke test can
  check that reopening the popup brings the review list back instead of starting from nothing.

Run:  python tools/make_popup_fixture.py
"""
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'popup.html')
TARGET = os.path.join(ROOT, '测试', 'popup-fixture.html')
RESTORE_TARGET = os.path.join(ROOT, '测试', 'popup-restore-fixture.html')
MANIFEST = os.path.join(ROOT, 'manifest.json')

MOCK = """  <script>
    var CANDIDATES = [{
      label: '学习经历', profileKey: null, proposedValue: '', confidence: 'none',
      currentValue: '', selected: false, isNewField: true, sensitive: false,
      remember: false, customKey: '', customLabel: '学习经历', customCategory: '自己加的',
      fingerprint: 'text:studyexp', controlType: 'input', siteKey: 'https://example.com'
    }, {
      // Scans as an ordinary high-confidence match, but it is sensitive, so it must not be
      // ticked for the applicant.
      label: '身份证号', profileKey: 'basic.id_number', proposedValue: '210000200001010000',
      confidence: 'high', currentValue: '', selected: false, isNewField: false,
      sensitive: true, remember: false, fingerprint: 'text:idnumber',
      controlType: 'input', siteKey: 'https://example.com'
    }];
    window.__saved = null;
    window.__lastScan = null;
    window.__filled = null;
    window.chrome = {
      runtime: { lastError: null, getManifest: function () { return { version: '__VERSION__' }; }, openOptionsPage: function () {} },
      storage: { local: {
        get: function (defaults, callback) { callback({ resumeProfile: { basic: { name: '示例姓名', id_number: '210000200001010000' }, education: [{ school: '示例大学', major: '电子信息', courses: ['电路原理'] }], additional: { specialty: '长跑', hobbies: '摄影' } }, resumeAccent: '#0078d4', resumeLastScan: __LASTSCAN__ }); },
        set: function (value, callback) { if (value.resumeLastScan) window.__lastScan = value.resumeLastScan; else window.__saved = value; if (callback) callback(); }
      } },
      tabs: {
        query: function (query, callback) { callback([{ id: 1, url: 'https://example.com/apply' }]); },
        sendMessage: function (tabId, message, callback) {
          if (message.type === 'ping') return callback({ version: '__VERSION__' });
          if (message.type === 'scan') return callback({ candidates: CANDIDATES });
          if (message.type === 'fill') { window.__filled = message.fields; return callback({ results: [{ id: 'x', status: 'filled' }] }); }
          callback({ results: [] });
        }
      },
      scripting: { executeScript: function (options, callback) { if (callback) callback(); } }
    };
  </script>
"""

DRIVER = """  <script>
    function snapshot(stage) {
      var rows = Array.prototype.slice.call(document.querySelectorAll('.candidate')).map(function (card) {
        return {
          badge: (card.querySelector('.confidence') || {}).textContent,
          box: card.querySelector('input[type=checkbox]') ? card.querySelector('input[type=checkbox]').checked : null,
          boxDisabled: card.querySelector('input[type=checkbox]') ? card.querySelector('input[type=checkbox]').disabled : null,
          value: (card.querySelector('input[type=text]') || {}).value
        };
      });
      return {
        stage: stage, rows: rows,
        fillDisabled: document.getElementById('fillConfirmed').disabled,
        saveDisabled: document.getElementById('saveNewFields').disabled,
        saveLabel: document.getElementById('saveNewFields').textContent
      };
    }
    var steps = [];
    setTimeout(function () {
      document.getElementById('scanPage').click();
      setTimeout(function () {
        steps.push(snapshot('after scan'));
        steps.push({
          stage: 'stored scan',
          present: Boolean(window.__lastScan),
          candidateCount: window.__lastScan && window.__lastScan.candidates ? window.__lastScan.candidates.length : 0
        });
        // The sensitive row must arrive unticked but still tickable.
        var sensitiveRow = document.querySelectorAll('.candidate')[1];
        var sensitiveBox = sensitiveRow ? sensitiveRow.querySelector('input[type=checkbox]') : null;
        steps.push({
          stage: 'sensitive row after scan',
          badge: sensitiveRow ? sensitiveRow.querySelector('.confidence').textContent : null,
          checked: sensitiveBox ? sensitiveBox.checked : null,
          disabled: sensitiveBox ? sensitiveBox.disabled : null
        });
        if (sensitiveBox) {
          sensitiveBox.checked = true;
          sensitiveBox.dispatchEvent(new Event('change', { bubbles: true }));
        }
        steps.push(snapshot('after ticking the sensitive row'));
        var box = document.querySelector('.candidate input[type=checkbox]');
        box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
        steps.push(snapshot('after ticking the box'));
        var assign = document.querySelector('.assign-select');
        assign.value = 'education.1.school'; assign.dispatchEvent(new Event('change', { bubbles: true }));
        steps.push(snapshot('after assigning'));
        document.getElementById('saveNewFields').click();
        setTimeout(function () {
          steps.push(snapshot('after saving the assignment'));
          document.getElementById('fillConfirmed').click();
          setTimeout(function () {
            steps.push({ stage: 'fill payload', fields: (window.__filled || []).map(function (f) { return { label: f.label, profileKey: f.profileKey, value: f.proposedValue }; }) });
            steps.push({ stage: 'stored label_mappings', mappings: ((window.__saved || {}).resumeProfile || {}).label_mappings });
            document.getElementById('tabNavQuickCopy').click();
            setTimeout(function () {
              var cards = Array.prototype.slice.call(document.querySelectorAll('#quickCopyList .copy-card-title'));
              var titles = cards.map(function (el) { return el.textContent; });
              steps.push({
                stage: 'quick copy',
                count: cards.length,
                coversAdditional: titles.some(function (t) { return t.indexOf('特长') >= 0; }),
                coversIdNumber: titles.some(function (t) { return t.indexOf('身份证号') >= 0; }),
                coversCourses: titles.some(function (t) { return t.indexOf('所学课程') >= 0; })
              });
              document.getElementById('smoke-result').textContent = JSON.stringify(steps);
            }, 60);
          }, 150);
        }, 150);
      }, 80);
    }, 0);
  </script>
"""

# Reopening the popup: no scan is clicked, the stored copy has to bring the list back.
RESTORE_DRIVER = """  <script>
    setTimeout(function () {
      var review = document.getElementById('review');
      var rows = Array.prototype.slice.call(document.querySelectorAll('.candidate'));
      document.getElementById('smoke-result').textContent = JSON.stringify({
        restored: Boolean(review) && !review.hidden,
        rows: rows.length,
        badges: rows.map(function (card) { return (card.querySelector('.confidence') || {}).textContent; }),
        status: document.getElementById('profileStatus').textContent
      });
    }, 150);
  </script>
"""

STORED_SCAN = ("{ url: 'https://example.com/apply', siteKey: 'https://example.com', "
               "activeFilter: 'all', candidates: CANDIDATES }")


def assemble(last_scan_json, driver):
    html = io.open(SOURCE, encoding='utf-8').read()
    version = json.load(io.open(MANIFEST, encoding='utf-8'))['version']
    html = html.replace('<title>简历填充助手</title>',
                        '<title>popup fixture (generated from popup.html)</title>')
    html = html.replace('href="tokens.css"', 'href="../tokens.css"')
    html = html.replace('href="popup.css"', 'href="../popup.css"')
    mock = MOCK.replace('__VERSION__', version).replace('__LASTSCAN__', last_scan_json)
    html = html.replace('  <script src="profile-parser.js"></script>', mock + '  <script src="../profile-parser.js"></script>')
    html = html.replace('  <script src="shared.js"></script>', '  <script src="../shared.js"></script>')
    html = html.replace('  <script src="popup.js"></script>', '  <script src="../popup.js"></script>')
    html = html.replace('</body>', '  <pre id="smoke-result"></pre>\n' + driver + '</body>')
    return html


def build():
    io.open(TARGET, 'w', encoding='utf-8', newline='').write(assemble('null', DRIVER))
    print('wrote 测试/popup-fixture.html from popup.html')
    io.open(RESTORE_TARGET, 'w', encoding='utf-8', newline='').write(assemble(STORED_SCAN, RESTORE_DRIVER))
    print('wrote 测试/popup-restore-fixture.html from popup.html')


if __name__ == '__main__':
    build()
