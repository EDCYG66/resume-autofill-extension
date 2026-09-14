// Storage plumbing shared by the popup and the options page.
//
// Both pages keep the same profile in chrome.storage.local and both can learn something new
// (a label mapping, a site memory, a draft) while the other one sits open. The three-way merge
// that keeps those writes from overwriting each other has to be one implementation, otherwise
// the two pages drift apart and the interleaving starts losing records. The accent lives here
// for the same reason: it is one stored value that two pages render.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ResumeShared = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Keys that exist in two contexts at once, each with the fields that identify a record.
  var MERGE_KEYS = {
    custom_fields: ['key'],
    site_mappings: ['site_key', 'fingerprint', 'profile_key'],
    site_drafts: ['site_key', 'fingerprint', 'profile_key'],
    label_mappings: ['label', 'profile_key']
  };
  // A draft is what the page actually recorded, so it outranks a stale editor copy.
  var STORED_WINS = { site_drafts: true };
  // Mirrors --accent in tokens.css. CSS cannot read a JS constant, so the two are kept in step
  // by eye; this is the only place the value is written in JavaScript.
  var DEFAULT_ACCENT = '#0078d4';

  // chrome.storage reports failures through lastError instead of rejecting, and every callback
  // has to read it before anything else runs, so funnel all of it through one pair of helpers.
  function readLastError() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        return chrome.runtime.lastError;
      }
    } catch (_) {}
    return null;
  }
  function storageGet(defaults) {
    return new Promise(function (resolve, reject) {
      var error = readLastError();
      if (error) { reject(new Error(error.message || 'storage read failed')); return; }
      try {
        chrome.storage.local.get(defaults, function (data) {
          var failure = readLastError();
          if (failure) { reject(new Error(failure.message || 'storage read failed')); return; }
          resolve(data);
        });
      } catch (thrown) { reject(thrown); }
    });
  }
  function storageSet(payload) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.storage.local.set(payload, function () {
          var failure = readLastError();
          if (failure) { reject(new Error(failure.message || 'storage write failed')); return; }
          resolve();
        });
      } catch (thrown) { reject(thrown); }
    });
  }
  function applyAccent(color) {
    if (!color || typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--accent', String(color));
  }

  // The baseline is what this page loaded. Everything written from here is merged against it,
  // so records another page stored in the meantime survive and everything deleted here stays
  // deleted. One store per page, created after ResumeProfile is on the page.
  function createStore() {
    var baseline = {};

    function captureBaseline(profile) {
      baseline = {};
      Object.keys(MERGE_KEYS).forEach(function (key) {
        baseline[key] = (profile && profile[key] || []).map(function (record) { return Object.assign({}, record); });
      });
    }
    function mergeInto(target, stored) {
      Object.keys(MERGE_KEYS).forEach(function (key) {
        var current = Array.isArray(target[key]) ? target[key] : [];
        var merged = ResumeProfile.mergeRecords(baseline[key] || [], current, stored[key] || [], MERGE_KEYS[key], Boolean(STORED_WINS[key]));
        // Merged in place so controls already bound to the array keep working.
        target[key] = ResumeProfile.replaceRecords(current, merged);
      });
    }
    function loadProfile() {
      return storageGet({ resumeProfile: ResumeProfile.createEmptyProfile(), resumeAccent: DEFAULT_ACCENT })
        .then(function (data) {
          var profile = ResumeProfile.normalize(data.resumeProfile);
          captureBaseline(profile);
          return { profile: profile, accent: data.resumeAccent || DEFAULT_ACCENT };
        });
    }
    function saveProfile(profile) {
      var next = ResumeProfile.normalize(profile);
      return storageGet({ resumeProfile: ResumeProfile.createEmptyProfile() })
        .then(function (data) {
          mergeInto(next, ResumeProfile.normalize(data.resumeProfile));
          return storageSet({ resumeProfile: next });
        })
        .then(function () {
          captureBaseline(next);
          return next;
        });
    }

    return {
      mergeInto: mergeInto,
      captureBaseline: captureBaseline,
      loadProfile: loadProfile,
      saveProfile: saveProfile
    };
  }

  return {
    MERGE_KEYS: MERGE_KEYS,
    STORED_WINS: STORED_WINS,
    DEFAULT_ACCENT: DEFAULT_ACCENT,
    createStore: createStore,
    storageGet: storageGet,
    storageSet: storageSet,
    applyAccent: applyAccent
  };
}));
