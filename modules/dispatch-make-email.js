/* <dispatch-make-email>
 * Dispatch v2, a supplier box's Make email button: can it make an email, and
 * what the hint under it says. Pure functions only (no page, no reads, no
 * writes), so they are tested on their own
 * (tests/unit/dispatch-make-email.test.cjs).
 *
 * Tweak 5 (Shaun, 5 Nov 2026): an order can be just a photo (a drawing, a
 * handwritten list). A box needs a line OR a photo to make an email:
 *
 *   1. Lines that count: not In stock, not already sent, and with words in
 *      them (an empty, untyped row is not a line).
 *   2. Photos that count: the box's photos that have not gone out on a sent
 *      email. The server attaches only these (three at most), so a photo is
 *      never sent to the supplier twice.
 *   3. No line and at least one photo is a photo-only email. Its Materials
 *      Needed part says "Please see attached for materials needed." and the
 *      fencing standing lines are not added (the server builds it; this file
 *      only words the hint).
 *   4. No line and no photo: the button stays off, and the hint says to add
 *      a line or a photo.
 *
 * The same rules are in the backend (dispatch_v2_emails.ts,
 * dispatchV2OrderableLines and dispatchV2UnsentPhotoIds). Loaded before
 * modules/ops-dispatch.js as window.OpsDispatchMakeEmail (the file name
 * leaves out "ops-dispatch" so the v1/v2 switch's own file checks still see
 * one Dispatch module).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpsDispatchMakeEmail = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // The hint for a photo-only box, word for word as Shaun approved it.
  var PHOTO_ONLY_HINT = 'Photos only: the email will say Please see attached for materials needed.';
  var NOTHING_HINT = 'Add a line or a photo to make an email.';
  var ALL_GONE_HINT = 'Everything here has gone. Add a line or a photo to order more.';

  function words(v) { return v == null ? '' : String(v).trim(); }
  function list(v) { return Array.isArray(v) ? v : []; }

  /** The box's lines a Make email takes: not sent (locked), not In stock,
   * and with words in them. box.lines: the saved lines of one supplier box. */
  function orderableLines(box) {
    return list(box && box.lines).filter(function (l) {
      return l && !l.locked && l.status !== 'in_stock' && words(l.description) !== '';
    });
  }

  /** The box's photos that have not gone out on a sent email, in the box's
   * order. box.photos: the box's photos; box.sent: its sent emails, each
   * with photo_ids. */
  function unsentPhotos(box) {
    var gone = {};
    list(box && box.sent).forEach(function (m) {
      list(m && m.photo_ids).forEach(function (id) { gone[id] = true; });
    });
    return list(box && box.photos).filter(function (p) { return p && !gone[p.id]; });
  }

  /** What the Make email part of a box shows, when no email is held.
   * Returns { lines, photos, photoOnly, can, hint }:
   *   lines, photos: how many count (rules 1 and 2 above)
   *   photoOnly: no line and at least one photo
   *   can: Make email is on (it is still off while the box is blocked or busy)
   *   hint: the sentence under the button, or '' when the caller words it
   *         (a box with lines keeps its own "N lines to order" sentence). */
  function makeState(box) {
    var lines = orderableLines(box).length;
    var photos = unsentPhotos(box).length;
    var photoOnly = lines === 0 && photos > 0;
    var hint = '';
    if (box && box.blocked) hint = '';
    else if (photoOnly) hint = PHOTO_ONLY_HINT;
    else if (!lines) hint = list(box && box.sent).length ? ALL_GONE_HINT : NOTHING_HINT;
    return { lines: lines, photos: photos, photoOnly: photoOnly, can: lines > 0 || photos > 0, hint: hint };
  }

  /** A held email with no line and no photo ticked cannot be sent (the
   * server refuses it with nothing_to_order). lineCount: the email's
   * line_count; photoIds: the photos ticked on it. */
  function heldEmailIsEmpty(lineCount, photoIds) {
    return !(Number(lineCount) > 0) && list(photoIds).length === 0;
  }

  return {
    PHOTO_ONLY_HINT: PHOTO_ONLY_HINT,
    NOTHING_HINT: NOTHING_HINT,
    ALL_GONE_HINT: ALL_GONE_HINT,
    orderableLines: orderableLines,
    unsentPhotos: unsentPhotos,
    makeState: makeState,
    heldEmailIsEmpty: heldEmailIsEmpty,
  };
});
