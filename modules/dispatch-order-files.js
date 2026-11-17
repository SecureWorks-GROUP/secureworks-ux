/**
 * Dispatch v2: photos AND files on a supplier box (Shaun, 16 Nov 2026).
 *
 * A supplier box takes photos (JPEG, PNG, WebP; the screen shrinks them) and
 * files: PDF, Excel (.xlsx, .xls), CSV and Word (.docx, .doc). They go on the
 * supplier order email as attachments.
 *
 *   - 3 MB per file. A photo is shrunk first; a file is sent as it is, so a
 *     file over 3 MB is refused here, by name and size, before it uploads.
 *   - 10 photos and files per email, and 20 MB on one email at most.
 *   - 40 per job (the server counts).
 *   - The server reads the real kind from the bytes and has the last word.
 *     This screen only refuses early what the server would refuse anyway.
 *   - Saved to the job after the order is confirmed: photos for the crew,
 *     files office only (the server does that).
 *
 * The same limits are in the backend (dispatch_v2_emails.ts,
 * dispatchV2CheckAttachment and dispatchV2UnsentPhotoIds). Loaded before
 * modules/ops-dispatch.js as window.OpsDispatchOrderFiles (the file name
 * leaves out "ops-dispatch" so the v1/v2 switch's own file checks still see
 * one Dispatch module).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpsDispatchOrderFiles = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var MAX_BYTES = 3000000; // Outlook's limit per attachment
  var PER_EMAIL = 10; // photos and files together
  var EMAIL_BYTES = 20000000; // all the attachments on one email
  var PER_JOB = 40;

  // What the file picker offers. The server still reads the bytes.
  var ACCEPT = 'image/*,.pdf,.xlsx,.xls,.csv,.docx,.doc';

  // A file's kind by its name: the tag the screen shows beside it.
  var FILE_LABELS = { pdf: 'PDF', xlsx: 'Excel', xls: 'Excel', csv: 'CSV', docx: 'Word', doc: 'Word' };
  var LABEL_BY_TYPE = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.ms-excel': 'Excel',
    'text/csv': 'CSV',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/msword': 'Word'
  };
  var PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  var ALLOWED_WORDS = 'Only photos (JPEG, PNG, WebP), PDF, Excel (.xlsx, .xls), CSV and Word (.docx, .doc) files can go on an order.';

  function words(v) { return v == null ? '' : String(v).trim(); }
  function list(v) { return Array.isArray(v) ? v : []; }

  function extensionOf(name) {
    var m = /\.([A-Za-z0-9]+)$/.exec(words(name));
    return m ? m[1].toLowerCase() : '';
  }

  /** Megabytes in plain words, one decimal place, as the server says it. */
  function mb(bytes) {
    var n = (Number(bytes) || 0) / 1000000;
    return (n > 0 && n < 0.1 ? '0.1' : n.toFixed(1)) + ' MB';
  }

  /** What a picked or dropped file is, before it uploads:
   *   'file'  a PDF, Excel, CSV or Word file by its name: sent as it is;
   *   'photo' a picture the browser may open: shrunk to a JPEG first (an
   *           iPhone HEIC photo is tried too; when the browser cannot open
   *           it, it goes as it is and the server refuses it by name);
   *   'other' anything else: refused here, by name, and never uploaded. */
  function pickedKind(name, type) {
    if (FILE_LABELS[extensionOf(name)]) return 'file';
    var t = words(type).toLowerCase();
    if (t.indexOf('image/') === 0) return 'photo';
    if (LABEL_BY_TYPE[t]) return 'file';
    return 'other';
  }

  /** The refusal for a picked file, in the server's own words, or null when
   * it may go up. file: { name, type, size }. A photo's size is not checked
   * here: it is shrunk first. */
  function precheck(file) {
    var name = words(file && file.name) || 'This file';
    var kind = pickedKind(file && file.name, file && file.type);
    if (kind === 'other') return { code: 'file_type_not_allowed', text: name + ' cannot be attached. ' + ALLOWED_WORDS };
    if (kind === 'file' && Number(file && file.size) > MAX_BYTES) {
      return {
        code: 'file_too_large',
        text: name + ' is ' + mb(file.size) + '. Each photo or file must be under 3 MB to go with an Outlook email. Shrink it, or send that one from Outlook.'
      };
    }
    return null;
  }

  /** Is this row a file (not a photo)? row: a Photo row from the server.
   * The server says (kind); an older server does not, so the content type
   * decides. */
  function isFile(row) {
    if (!row) return false;
    if (row.kind === 'file') return true;
    if (row.kind === 'photo') return false;
    var t = words(row.content_type).toLowerCase();
    if (t) return PHOTO_TYPES.indexOf(t) < 0;
    return !!FILE_LABELS[extensionOf(row.file_name)];
  }

  /** The tag beside a file's name: PDF, Excel, CSV or Word (Photo for a photo). */
  function label(row) {
    if (!isFile(row)) return 'Photo';
    var given = words(row.file_label);
    if (given && given !== 'Photo') return given;
    return LABEL_BY_TYPE[words(row.content_type).toLowerCase()] || FILE_LABELS[extensionOf(row.file_name)] || 'File';
  }

  /** Is the thing being dragged over the page a file from the computer (not
   * a line being moved between boxes)? dataTransfer.types holds "Files". */
  function isFileDrag(dataTransfer) {
    var types = dataTransfer && dataTransfer.types;
    if (!types) return false;
    if (typeof types.indexOf === 'function') return types.indexOf('Files') >= 0;
    if (typeof types.contains === 'function') return types.contains('Files'); // an old browser's DOMStringList
    return false;
  }

  /** The photos and files a new email takes, as the server picks them: in
   * order, ten at most, and one that would take the email over 20 MB waits
   * for the next email. rows: the box's photos and files not yet sent. */
  function pickForEmail(rows) {
    var out = [];
    var total = 0;
    var all = list(rows);
    for (var i = 0; i < all.length && out.length < PER_EMAIL; i++) {
      var size = Number(all[i] && all[i].size_bytes) || 0;
      if (total + size > EMAIL_BYTES) break;
      total += size;
      out.push(all[i]);
    }
    return out;
  }

  /** On a held email: can this photo or file be ticked on too? chosenIds:
   * the ids ticked now; rows: the box's photos and files; id: the one. */
  function canTick(chosenIds, rows, id) {
    var chosen = list(chosenIds);
    if (chosen.indexOf(id) >= 0) return true;
    if (chosen.length >= PER_EMAIL) return false;
    var byId = {};
    list(rows).forEach(function (r) { if (r) byId[r.id] = r; });
    var total = chosen.reduce(function (s, x) { return s + (Number(byId[x] && byId[x].size_bytes) || 0); }, 0);
    return total + (Number(byId[id] && byId[id].size_bytes) || 0) <= EMAIL_BYTES;
  }

  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /** "1 photo", "2 files", "1 photo and 2 files". rows: Photo rows (an id
   * the screen does not know counts as a photo). */
  function attachWords(rows) {
    var files = list(rows).filter(isFile).length;
    var photos = list(rows).length - files;
    if (photos && files) return count(photos, 'photo', 'photos') + ' and ' + count(files, 'file', 'files');
    if (files) return count(files, 'file', 'files');
    return count(photos, 'photo', 'photos');
  }

  /** The line after a batch of picked or dropped files went up one by one.
   * results: [{ name, ok, text }] in the order they went; text is the
   * refusal (it names the file) or, for one that went, the added line.
   * Returns { bad, text, notes } for the box. */
  function batchMessage(results) {
    var all = list(results);
    var good = all.filter(function (r) { return r && r.ok; });
    var bad = all.filter(function (r) { return r && !r.ok; });
    if (all.length === 1) return { bad: bad.length === 1, text: words(all[0].text) };
    if (!bad.length) return { bad: false, text: 'Added ' + good.length + ': ' + good.map(function (r) { return r.name; }).join(', ') + '.' };
    return {
      bad: true,
      text: (good.length ? 'Added ' + good.length + ' of ' + all.length + '.' : 'None of the ' + all.length + ' were added.') + ' Not added:',
      notes: bad.map(function (r) { return words(r.text); })
    };
  }

  return {
    MAX_BYTES: MAX_BYTES,
    PER_EMAIL: PER_EMAIL,
    EMAIL_BYTES: EMAIL_BYTES,
    PER_JOB: PER_JOB,
    ACCEPT: ACCEPT,
    ALLOWED_WORDS: ALLOWED_WORDS,
    mb: mb,
    pickedKind: pickedKind,
    precheck: precheck,
    isFile: isFile,
    label: label,
    isFileDrag: isFileDrag,
    pickForEmail: pickForEmail,
    canTick: canTick,
    attachWords: attachWords,
    batchMessage: batchMessage
  };
});
