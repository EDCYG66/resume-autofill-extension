"""Regenerates 测试/popup-fixture.html from the real popup.html.

The fixture has to mirror popup.html's markup, otherwise the popup smoke test keeps passing
against a stale page while the shipped one has moved on. Run this after editing popup.html.

Run:  python tools/make_popup_fixture.py
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'popup.html')
TARGET = os.path.join(ROOT, '测试', 'popup-fixture.html')

MOCK = """  <script>
    var CANDIDATES = [{
      label: '学习经历', profileKey: null, proposedValue: '', confidence: 'none',
      currentValue: '', selected: false, isNewField: true, sensitive: false,
      remember: false, customKey: '', customLabel: '学习经历', customCategory: '自己加的',
      fingerprint: 'text:studyexp', controlType: 'input', siteKey: 'https://example.com'
    }];
    window.__saved = null;
    window.__filled = null;
    window.chrome = {
      runtime: { lastError: null, getManifest: function () { return { version: '0.2.0' }; }, openOptionsPage: function () {} },
      storage: { local: {
        get: function (defaults, callback) { callback({ resumeProfile: { education: [{ school: '示例大学', major: '电子信息' }] }, resumeAccent: '#0078d4' }); },
        set: function (value, callback) { window.__saved = value; if (callback) callback(); }
      } },
      tabs: {
        query: function (query, callback) { callback([{ id: 1, url: 'https://example.com/apply' }]); },
        sendMessage: function (tabId, message, callback) {
          if (message.type === 'ping') return callback({ version: '0.2.0' });
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
            document.getElementById('smoke-result').textContent = JSON.stringify(steps);
          }, 150);
        }, 150);
      }, 80);
    }, 0);
  </script>
"""


def build():
    html = io.open(SOURCE, encoding='utf-8').read()
    html = html.replace('<title>简历填充助手</title>',
                        '<title>popup fixture (generated from popup.html)</title>')
    html = html.replace('href="tokens.css"', 'href="../tokens.css"')
    html = html.replace('href="popup.css"', 'href="../popup.css"')
    html = html.replace('  <script src="profile-parser.js"></script>', MOCK + '  <script src="../profile-parser.js"></script>')
    html = html.replace('  <script src="popup.js"></script>', '  <script src="../popup.js"></script>')
    html = html.replace('</body>', '  <pre id="smoke-result"></pre>\n' + DRIVER + '</body>')
    io.open(TARGET, 'w', encoding='utf-8', newline='').write(html)
    print('wrote 测试/popup-fixture.html from popup.html')


if __name__ == '__main__':
    build()
