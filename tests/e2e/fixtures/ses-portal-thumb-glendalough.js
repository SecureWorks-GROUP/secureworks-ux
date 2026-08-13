/**
 * The Glendalough SWMS-261171 roof-report card, for the LIVE PORTAL READER
 * thumbnail + honest chip on the make-safe board (<makesafe-portal-live-thumb>).
 *
 * Grounded on the live record (read-only lookup, 2026-08-13): job SWMS-261171,
 * suburb Glendalough, a Prime/PrimeEco roof-report share whose latest reader
 * capture is `done` — "form locked/submitted (form-locked banner), 22 of 24
 * answered", captured 2026-08-13 04:28 UTC. That is the board truth the card must
 * show as Locked while the pipeline still reads `waiting_on_trade_report`.
 *
 * REDACTION, same covenant as the census scripts and the roof-capture fixture:
 *   - no client name, street, phone or email — suburb + job/builder ref only;
 *   - the screenshot is a DRAWN FACSIMILE of a locked Prime form, never the real
 *     capture (the live shot carries client detail and never enters this repo);
 *   - the Prime share URL is a zero UUID, and it is NOT carried on portal_capture
 *     at all — this surface only ever holds the STORED screenshot URL.
 */

const JOB_ID = '8ff84983-2a86-46ea-9f3c-dc169162b571';

/**
 * A drawn stand-in for the locked Prime roof-report form: a "form locked"
 * banner and a 22-of-24 answered body, with obviously invented answers and a
 * SAMPLE banner. It exists so a screenshot can prove the thumb renders a real
 * image at card size without the live capture ever being committed.
 */
function lockedFormFacsimile() {
  const rows = [
    ['Roof type', 'Colorbond'],
    ['Storey', 'Single'],
    ['Damage', 'Storm — sheeting lifted, ridge open'],
    ['Sheets displaced', '9'],
    ['Water ingress', 'Yes — one room'],
    ['Temporary cover', 'Yes — shrink-wrap, weighted'],
    ['Area made safe', '22 m2'],
    ['Safe to leave', 'Yes'],
  ];
  const line = (label, value, i) =>
    `<text x="40" y="${232 + i * 40}" font-family="Helvetica,Arial" font-size="16" fill="#4C6A7C">${label}</text>` +
    `<text x="360" y="${232 + i * 40}" font-family="Helvetica,Arial" font-size="16" fill="#1A272E" font-weight="600">${value}</text>` +
    `<line x1="40" y1="${246 + i * 40}" x2="760" y2="${246 + i * 40}" stroke="#EDF1F4" stroke-width="1"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640" viewBox="0 0 800 640">` +
    `<rect width="800" height="640" fill="#ffffff"/>` +
    `<rect x="0" y="0" width="800" height="8" fill="#293C46"/>` +
    `<text x="40" y="60" font-family="Helvetica,Arial" font-size="26" font-weight="700" fill="#1A272E">Roof Report</text>` +
    `<text x="40" y="86" font-family="Helvetica,Arial" font-size="14" fill="#4C6A7C">Prime portal submission &#183; SWMS-261171 &#183; Glendalough</text>` +
    // form-locked banner — the truth the reader detected
    `<rect x="40" y="104" width="720" height="40" rx="6" fill="#E8F5EC" stroke="#9AD3AE"/>` +
    `<text x="52" y="130" font-family="Helvetica,Arial" font-size="14" font-weight="700" fill="#1E7A45">` +
    `&#128274; This form has been locked &#8212; submitted, 22 of 24 answered.</text>` +
    // SAMPLE strip
    `<rect x="40" y="152" width="720" height="30" rx="6" fill="#FDF2EE" stroke="#F4C7B5"/>` +
    `<text x="52" y="172" font-family="Helvetica,Arial" font-size="12" font-weight="700" fill="#B4441C">` +
    `SAMPLE FACSIMILE &#8212; drawn for this repo&#8217;s screenshots. Not the real capture, not client data.</text>` +
    rows.map((r, i) => line(r[0], r[1], i)).join('') +
    `<text x="40" y="612" font-family="Helvetica,Arial" font-size="13" fill="#7C8898">` +
    `Form submitted and locked &#8212; no longer available for editing.</text>` +
    `</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const SHOT_URL = lockedFormFacsimile();

// The canonical `makesafe-board.v1` row, in the shape mapCanonicalMakesafeRow
// reads. `portal_capture` is the ONLY new block — everything else is the ordinary
// board card shape. The pipeline still calls it waiting; the capture says Locked.
function glendaloughRow(over) {
  return Object.assign({
    contract_version: 'makesafe-board.v1',
    id: JOB_ID,
    job_number: 'SWMS-261171',
    type: 'makesafe',
    ses_family: 'ordinary_roof_portal',
    ses_family_label: 'Roof Report',
    ses_recipe_state: null,
    job_state: 'accepted',
    substatus: 'waiting_on_trade_report',
    declared_stage: 'trade_report_in',
    canonical_stage: 'trade_report_in',
    canonical_stage_label: 'Trade Report In',
    status_application: null,
    makesafe_type: 'Roof Report',
    builder: { name: 'Prime', external_ref: 'PRIME-261171' },
    contact: { client_name: null, phone: null, address: 'Glendalough WA 6016' },
    site_suburb: 'Glendalough',
    assignments: [],
    report: { state: 'not_started', submitted_at: null, photo_count: 0, cycle_number: 1 },
    pack: {
      state: 'not_started', sent: false, sent_at: null, drafted: false,
      docket_revision_id: null, pre_xero_docs_ready: false,
      closeout_documents: { report: false, invoice: false, swms: false },
    },
    // The live portal reader capture — latest shot is `done` (locked), 22 of 24.
    portal_capture: {
      role: 'roof_report',
      screenshot_url: SHOT_URL,
      shown_result: 'done',
      shown_captured_at: '2026-08-13T04:28:26+00:00',
      shown_signal: 'form locked/submitted (form-locked banner), 22 of 24 answered',
      latest_result: 'done',
      latest_captured_at: '2026-08-13T04:28:26+00:00',
      answered: 22,
      total: 24,
    },
    notes: null,
    lineage: {},
    age: { age_days: 2, age_hours: 48 },
    blockers: {},
    cancelled: null,
  }, over || {});
}

module.exports = { JOB_ID, SHOT_URL, glendaloughRow, lockedFormFacsimile };
