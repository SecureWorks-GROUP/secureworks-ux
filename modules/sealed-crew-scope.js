// The sealed crew scope of works of a Scope Engine patio job, as its seal kept it.
// ---------------------------------------------------------------------------------------
// A patio sealed in the Scope Engine (scope-engine-v2) saves one record on the job (jobs.scope_json,
// patio/scoper/src/jobsystem.ts ScopeRecord). From 3 Nov 2026 that record carries the newest revision's
// seal (ScopeRecord.sealed, keptSeal), and from 13 Nov 2026 the seal keeps its pages as stamped
// (patio/scoper/src/freeze.ts Seal.documents): the crew scope of works is documents['installer-sow'],
// the page the Scope Engine's Documents shows the office as "Crew scope of works" (freeze.ts sealedPage).
// Each page carries a stamp, seal.stamps[kind].contentHash: sha256 of the page as a JSON string
// (shared/hash.ts canonicalHash; shared/identity/frozen.ts stampOutput).
//
// This module reads that page and checks it against its stamp. It never makes the page again and never
// works out a size: the Trade App shows the page as kept, or says plainly why it cannot.
// A job sold on a revision keeps that revision on top of the record (jobsystem.ts soldRefusal), so on a
// sold job the record's revision is the accepted one.
// Pure apart from hashing (crypto.subtle in the browser, node:crypto in tests). No DOM, no fetch.
(function (root) {
  'use strict';

  var KIND = 'installer-sow';
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

  // What the record holds of the sealed crew scope of works.
  // problem: null when the page and its stamp are both there; otherwise
  //   'no-seal'   the record kept no seal (saved before 3 Nov 2026), or its seal is not the record's own revision;
  //   'no-page'   the seal kept no crew page (sealed before pages were kept), or it did not reach this device;
  //   'no-stamp'  the page is there but its stamp is not, so it cannot be checked.
  function read(scopeJson) {
    var s = parse(scopeJson);
    var out = { enginePatio: !!s && s.tool === 'patio-scoper', n: null, sealedAt: null, page: null, stamp: null, problem: null };
    if (!out.enginePatio) return out;
    var rev = obj(s.revision) || {};
    out.n = typeof rev.n === 'number' && isFinite(rev.n) ? rev.n : null;
    out.sealedAt = str(rev.sealedAt) || null;
    var kept = obj(s.sealed);
    var seal = kept && obj(kept.seal);
    var frozen = seal && obj(seal.frozen);
    var frozenId = frozen ? str(frozen.id) : '';
    if (!seal || !frozenId || (str(rev.frozenId) && str(rev.frozenId) !== frozenId)) { out.problem = 'no-seal'; return out; }
    var docs = obj(seal.documents);
    var page = docs && typeof docs[KIND] === 'string' && docs[KIND].length ? docs[KIND] : null;
    if (!page) { out.problem = 'no-page'; return out; }
    out.page = page;
    var stamps = Array.isArray(seal.stamps) ? seal.stamps : [];
    var stamp = stamps.filter(function (x) { return obj(x) && x.kind === KIND && str(x.frozenRevisionId) === frozenId; })[0];
    out.stamp = stamp && /^[0-9a-f]{64}$/.test(str(stamp.contentHash)) ? str(stamp.contentHash) : null;
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
  // device cannot hash or the record carries no stamp. Only 'matches' is shown to the crew.
  function check(state, hasher) {
    if (!state || !state.page) return Promise.resolve('unchecked');
    if (!state.stamp) return Promise.resolve('unchecked');
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
    return 'Crew scope of works' + (state && state.n != null ? ', Rev ' + state.n : '');
  }
  function words(state, status) {
    if (!state || !state.enginePatio) return '';
    if (state.problem === 'no-seal') return 'This job\'s scope was saved without its seal, so its crew scope of works is not on this job. Ask the office for it.';
    if (state.problem === 'no-page') return 'The sealed crew scope of works is not on this phone. Ask the office for it.';
    if (status === 'matches') return 'As sealed in the Scope Engine. The same page the office sees.';
    if (status === 'differs') return 'The crew scope of works on this phone is not the page that was sealed, so it is not shown. Ask the office for it.';
    return 'The crew scope of works could not be checked against its seal on this phone, so it is not shown. Ask the office for it.';
  }

  var api = {
    KIND: KIND, isEnginePatio: isEnginePatio, read: read, check: check, sha256Hex: sha256Hex,
    stampedText: stampedText, framePage: framePage, heading: heading, words: words
  };
  root.SealedCrewScope = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
