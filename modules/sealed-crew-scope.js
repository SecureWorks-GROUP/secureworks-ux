// The sealed crew scope of works of the ACCEPTED, released revision, as the trade view sends it.
// ---------------------------------------------------------------------------------------
// Director's ruling, 12 Nov 2026: the backend's trade view (ops-api trade_job_detail) returns the sealed crew
// scope of works of the accepted, released revision (the one the accepted quote document is bound to), never
// the latest saved scope, with no money field. The Trade App shows that page only. Where the accepted binding
// cannot be proved it says why and shows nothing.
//
// The trade view field this module reads (paired secureworks-backend crew scope PR), beside `job`:
//   crew_scope_of_works: {
//     status: 'accepted'      the page below is the accepted, released revision's crew scope of works
//           | 'not_proved',   the accepted binding could not be proved; `reason` says why
//     page: string,           the kept page as the seal kept it (Scope Engine documents['installer-sow'])
//     content_hash: string,   the seal's stamp for that page: sha256 hex of the page as a JSON string
//                             (scope-engine-v2 shared/hash.ts canonicalHash)
//     revision: { n, frozen_revision_id },
//     reason: string          plain words, status 'not_proved' only
//   }
// The field is there for every job whose scope was sealed by the new tool (Scope Engine patio or fence) and
// absent for older jobs. This module never reads the latest saved scope (`scope_json.sealed`, `revisionPacks`)
// for the page: a correctly stamped newer save is not the accepted one. It never makes the page again and never
// works out a size. Pure apart from hashing (crypto.subtle in the browser, node:crypto in tests). No DOM, no fetch.
(function (root) {
  'use strict';

  var FIELD = 'crew_scope_of_works';
  // The same policy the Scope Engine puts on a kept page (freeze.ts originalPage): kept pages are data, they run nothing.
  var POLICY = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">';

  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function parse(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'string') { try { return obj(JSON.parse(v)); } catch (e) { return null; } }
    return obj(v);
  }

  // Whether the scope on a job was saved by the Scope Engine patio tool. Only `tool` is read: the crew's copy of the
  // record has its numbers taken out on the way (ops-api redactTradeScopeQuote), and `tool` is a word.
  function isEnginePatio(scopeJson) {
    var s = parse(scopeJson);
    return !!s && s.tool === 'patio-scoper';
  }
  // Whether a fence job's scope carries revisions sealed in the Scope Engine fence tool (fence/index.html keeps
  // each sealed revision in job.revisionPacks). Only whether there are any is read, never what they say.
  function isEngineFence(scopeJson) {
    var s = parse(scopeJson);
    var job = s && obj(s.job);
    return !!job && Array.isArray(job.revisionPacks) && job.revisionPacks.length > 0;
  }

  // Whether the crew scope of works decides this job's Scope tab: the trade view sent the field, or the job's
  // scope is from the new tool. Then the old build spec and the 3D model, which read the latest saved scope,
  // are never shown.
  function applies(data) {
    var d = obj(data) || {};
    if (FIELD in d && d[FIELD] != null) return true;
    var job = obj(d.job) || {};
    return isEnginePatio(job.scope_json) || isEngineFence(job.scope_json);
  }

  // What the trade view sent.
  // problem: null when the accepted page and its stamp are both there; otherwise
  //   'not-sent'   the trade view sent no crew scope of works for a new-tool job (an older office system);
  //   'not-proved' the trade view could not prove which revision was accepted (`reason` says why);
  //   'no-page'    it said accepted but sent no page;
  //   'no-stamp'   the page is there but its stamp is not, so it cannot be checked.
  function read(data) {
    var d = obj(data) || {};
    var f = obj(d[FIELD]);
    var out = { n: null, frozenId: null, page: null, stamp: null, reason: null, problem: null };
    if (!f) { out.problem = 'not-sent'; return out; }
    var rev = obj(f.revision) || {};
    out.n = typeof rev.n === 'number' && isFinite(rev.n) ? rev.n : null;
    out.frozenId = str(rev.frozen_revision_id) || null;
    if (f.status !== 'accepted') { out.problem = 'not-proved'; out.reason = str(f.reason) || null; return out; }
    out.page = typeof f.page === 'string' && f.page.length ? f.page : null;
    if (!out.page) { out.problem = 'no-page'; return out; }
    out.stamp = /^[0-9a-f]{64}$/.test(str(f.content_hash)) ? str(f.content_hash) : null;
    if (!out.stamp) out.problem = 'no-stamp';
    return out;
  }

  // The text the seal hashed for a page: the page as a JSON string (shared/hash.ts canonical of a string).
  function stampedText(page) { return JSON.stringify(String(page)); }

  function hexOf(buf) {
    var b = new Uint8Array(buf), h = '';
    for (var i = 0; i < b.length; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return h;
  }
  // sha256 hex of a string, or null where this device cannot hash.
  function sha256Hex(text) {
    var c = root.crypto;
    if (c && c.subtle && typeof c.subtle.digest === 'function' && typeof TextEncoder !== 'undefined') {
      return c.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(hexOf, function () { return null; });
    }
    try {
      var nodeCrypto = typeof require === 'function' ? require('crypto') : null;
      if (nodeCrypto) return Promise.resolve(nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex'));
    } catch (e) { /* no hashing here */ }
    return Promise.resolve(null);
  }

  // 'matches' when the page is the one the seal stamped, 'differs' when it is not, 'unchecked' when this
  // device cannot hash or no stamp came. Only 'matches' is shown to the crew.
  function check(state, hasher) {
    if (!state || !state.page || !state.stamp || state.problem) return Promise.resolve('unchecked');
    return Promise.resolve((hasher || sha256Hex)(stampedText(state.page))).then(function (hex) {
      if (!hex) return 'unchecked';
      return hex === state.stamp ? 'matches' : 'differs';
    }, function () { return 'unchecked'; });
  }

  // The kept page as a frame shows it: the page unchanged, with the policy that it runs nothing.
  function framePage(page) {
    var html = String(page);
    return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, function (head) { return head + POLICY; })
      : '<!doctype html><html><head>' + POLICY + '</head><body>' + html + '</body></html>';
  }

  // The words for each state, so the Trade App and the check say the same thing.
  function heading(state) {
    return 'Crew scope of works' + (state && !state.problem && state.n != null ? ', Rev ' + state.n : '');
  }
  function words(state, status) {
    if (!state) return '';
    if (state.problem === 'not-sent') return 'The crew scope of works the customer accepted has not come through to this phone, so nothing is shown. Ask the office for it.';
    if (state.problem === 'not-proved') return (state.reason ? state.reason.replace(/\s*\.?\s*$/, '. ') : 'Which revision the customer accepted could not be confirmed. ') + 'So no crew scope of works is shown. Ask the office for it.';
    if (state.problem === 'no-page') return 'The accepted crew scope of works is not on this phone. Ask the office for it.';
    if (status === 'matches') return 'The revision the customer accepted, as sealed in the Scope Engine. The same page the office sees.';
    if (status === 'differs') return 'The crew scope of works on this phone is not the page that was sealed, so it is not shown. Ask the office for it.';
    return 'The crew scope of works could not be checked against its seal on this phone, so it is not shown. Ask the office for it.';
  }

  var api = {
    FIELD: FIELD, isEnginePatio: isEnginePatio, isEngineFence: isEngineFence, applies: applies, read: read,
    check: check, sha256Hex: sha256Hex, stampedText: stampedText, framePage: framePage, heading: heading, words: words
  };
  root.SealedCrewScope = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
