const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.ResumeProfile = require('../profile-parser.js');
const Shared = require('../shared.js');

// Minimal chrome.storage.local stand-in. Callbacks run synchronously (the real API is async,
// but nothing here awaits the callback itself) and lastError only exists while a callback is
// running, which is the shape shared.js has to cope with.
function installChrome(initial, options) {
  const settings = options || {};
  const data = Object.assign({}, initial);
  const writes = [];
  const chrome = {
    runtime: {},
    storage: {
      local: {
        get(defaults, callback) {
          const result = {};
          Object.keys(defaults).forEach((key) => {
            result[key] = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : defaults[key];
          });
          if (settings.getError) {
            chrome.runtime.lastError = { message: settings.getError };
            callback(result);
            delete chrome.runtime.lastError;
            return;
          }
          callback(result);
        },
        set(payload, callback) {
          if (settings.setError) {
            chrome.runtime.lastError = { message: settings.setError };
            callback();
            delete chrome.runtime.lastError;
            return;
          }
          Object.assign(data, payload);
          writes.push(payload);
          callback();
        }
      }
    }
  };
  global.chrome = chrome;
  return { data, writes };
}

test('loads an empty profile with the default accent', async () => {
  installChrome({});
  const loaded = await Shared.createStore().loadProfile();
  assert.equal(loaded.accent, Shared.DEFAULT_ACCENT);
  assert.equal(Shared.DEFAULT_ACCENT, '#0078d4');
  assert.deepEqual(loaded.profile.custom_fields, []);
  assert.ok(Array.isArray(loaded.profile.education));
});

test('keeps records another page stored since this page loaded', async () => {
  const env = installChrome({ resumeProfile: { custom_fields: [{ key: 'a', label: 'A' }] } });
  const store = Shared.createStore();
  const loaded = await store.loadProfile();
  // The applicant adds one here...
  loaded.profile.custom_fields.push({ key: 'b', label: 'B' });
  // ...while another page (popup or options) stores its own record.
  env.data.resumeProfile = {
    custom_fields: env.data.resumeProfile.custom_fields.concat([{ key: 'c', label: 'C' }])
  };

  await store.saveProfile(loaded.profile);
  const keys = env.data.resumeProfile.custom_fields.map((record) => record.key).sort();
  assert.deepEqual(keys, ['a', 'b', 'c'], 'the write must not drop the other page\'s record');
});

test('never resurrects a record deleted on this page', async () => {
  const env = installChrome({ resumeProfile: { custom_fields: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] } });
  const store = Shared.createStore();
  const loaded = await store.loadProfile();
  loaded.profile.custom_fields = loaded.profile.custom_fields.filter((record) => record.key !== 'b');

  await store.saveProfile(loaded.profile);
  assert.deepEqual(env.data.resumeProfile.custom_fields.map((record) => record.key), ['a']);
});

test('lets a page-recorded draft win over a stale editor copy', async () => {
  const draft = { site_key: 'https://example.com', fingerprint: 'f1', profile_key: 'basic.name', value: '编辑器里的旧值' };
  const env = installChrome({ resumeProfile: { site_drafts: [draft] } });
  const store = Shared.createStore();
  const loaded = await store.loadProfile();
  loaded.profile.site_drafts = [{ site_key: 'https://example.com', fingerprint: 'f1', profile_key: 'basic.name', value: '编辑器里的旧值' }];
  env.data.resumeProfile = {
    site_drafts: [{ site_key: 'https://example.com', fingerprint: 'f1', profile_key: 'basic.name', value: '页面刚记下的' }]
  };

  await store.saveProfile(loaded.profile);
  assert.equal(env.data.resumeProfile.site_drafts[0].value, '页面刚记下的');
});

test('surfaces storage failures instead of resolving silently', async () => {
  installChrome({}, { getError: 'QUOTA_BYTES quota exceeded' });
  await assert.rejects(() => Shared.createStore().loadProfile(), /quota exceeded/);

  installChrome({ resumeProfile: {} }, { setError: 'disk full' });
  await assert.rejects(() => Shared.createStore().saveProfile({}), /disk full/);
});

// The duplication this module removed is easy to reintroduce one copy-paste at a time, so the
// two pages are checked for it here rather than left to review.
test('the popup and the options page build on shared.js instead of their own merge code', () => {
  ['popup.js', 'options.js'].forEach((name) => {
    const source = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    assert.ok(source.includes('ResumeShared.createStore'), name + ' should get its store from shared.js');
    ['var MERGE_KEYS\\s*=', 'function mergeInto\\s*\\(', 'function captureBaseline\\s*\\(', 'function applyAccent\\s*\\('].forEach((pattern) => {
      assert.ok(!new RegExp(pattern).test(source), name + ' should not carry its own ' + pattern);
    });
  });
});

test('both pages load shared.js before their own script', () => {
  [['popup.html', 'popup.js'], ['options.html', 'options.js']].forEach((pair) => {
    const source = fs.readFileSync(path.join(__dirname, '..', pair[0]), 'utf8');
    const shared = source.indexOf('src="shared.js"');
    const own = source.indexOf('src="' + pair[1] + '"');
    assert.ok(shared >= 0, pair[0] + ' should load shared.js');
    assert.ok(own >= 0, pair[0] + ' should load ' + pair[1]);
    assert.ok(shared < own, pair[0] + ' should load shared.js before ' + pair[1]);
  });
});

// The key of a 自己起个名 record addresses it from site_mappings and site_drafts, so it has to be
// unique per column. Flattening the fingerprint to its ASCII letters turned every Chinese label into
// the same key ('text'), and a second freshly named column on one page then found the first one's
// record and wrote into it. customFieldKey is private to popup.js and popup.js runs on load, so the
// real function is lifted out of the source and exercised here rather than reimplemented.
test('the custom field key is a distinct, stable key per column', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  const body = /function fingerprintHash\(value\)\s*\{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(body, 'popup.js should declare fingerprintHash');
  assert.ok(/customFieldKey\(candidate\)/.test(source), 'the custom field record should be keyed by customFieldKey');
  assert.ok(
    !/fingerprint\.replace\(\/\[\^a-zA-Z0-9_\]/.test(source),
    'popup.js should not flatten the fingerprint down to its ASCII letters any more'
  );

  const hash = new Function('value', body[1]);
  const keyFor = (fingerprint) => 'cf_' + hash(fingerprint);
  // These are the fingerprints makeFingerprint produces for wording-only columns: the label is the
  // only stable part, and the old ASCII slug reduced all three of them to 'text'.
  const keys = ['text:活动名称', 'text:担任职务', 'text:获奖情况'].map(keyFor);
  assert.equal(new Set(keys).size, 3, 'three different columns produced ' + JSON.stringify(keys));
  assert.equal(keyFor('text:活动名称'), keys[0], 'the key has to be stable across calls');
});
