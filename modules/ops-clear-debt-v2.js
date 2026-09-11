// ════════════════════════════════════════════════════════════
// CLEAR DEBT v2: the debt picture, three levels, one way down.
// Design accepted by Marnin 11 Sep 2026:
//   secureworks-wiki lanes/DEBT_COLLECTION/DESIGN-clear-debt-2026-09-11.md
// Reads: ops-api list_debt_picture (classification rows), debt_context_coverage
//   (picture flags), invoice_context (one record), debt_notes (thread).
// Writes: add_debt_note and debt_proposal_save (pending only). Marnin approves in the terminal.
// Never voids, never touches Xero, never tags GHL. Every field's origin is in the design page.
// ════════════════════════════════════════════════════════════

var CD = {
  rows: [], totals: {}, coverage: {}, asOf: null, pictureAsOf: null,
  seg: null, open: null, selectedInvoice: null, ctx: {}, notes: {}, noteErrors: {}, recordRequest: 0, loading: false,
  ACTIONS: { note: 'add_debt_note', proposal: 'debt_proposal_save' },
};
var CD_KINDS = [
  { key: 'chase',    label: 'Chase now',                  color: '#F15A29' },
  { key: 'due',      label: 'Not yet due',                color: '#8FA4B2' },
  { key: 'paid',     label: 'Paid, awaiting allocation',  color: '#4F7F60' },
  { key: 'blocked',  label: 'Blocked by us',              color: '#E08A2E' },
  { key: 'dispute',  label: 'In dispute',                 color: '#8E44AD' },
  { key: 'notowed',  label: 'Not owed',                   color: '#C9C1B8' },
  { key: 'bad',      label: 'Bad debt',                   color: '#B93A2C' },
  { key: 'unclass',  label: 'Unclassified',               color: '#6B7C88' },
];
var CD_TYPE = { deposit: ['Deposits', 'Deposit invoices, work not started or just booked'], final_balance: ['Final balances', 'Balance invoices after completion'], progress_claim: ['Progress claims', 'Staged claims on larger jobs'], variation: ['Variations', 'Extras agreed during the job'], plan_fee: ['Plan and design fees', 'Drawings and approvals'], work_order: ['Make-safe and repair work orders', 'Builder or insurer PO, paid on their statement run'], job_invoice: ['Job invoices', 'Single invoice for the whole job'], no_reference: ['No reference on the invoice', 'Reference missing, job to confirm'] };
var CD_BLOCKER = { rectification: ['Rectification not done', 'OPERATIONS'], no_job_linked: ['No job linked to the invoice', 'BOOKKEEPING'], job_link_ambiguous: ['More than one job matches', 'BOOKKEEPING'], invoice_wrong: ['Invoice or contact wrong', ''], pack_missing: ['Report or PO pack missing', 'INSURANCE'], paid_unallocated: ['In the bank, awaiting Xero allocation', 'BOOKKEEPING'], payment_claimed: ['Client says paid, bank check pending', 'BOOKKEEPING'], context_pending: ['Context pending from the door', 'CIO'] };
var CD_CLASS_LABEL = { genuine_debt: 'Genuine debt', blocked_by_us: 'Blocked by us', in_dispute: 'In dispute', bad_debt: 'Bad debt', not_owed: 'Not owed', unclassified: 'Unclassified' };
var CD_IC = { msg: '<svg class="cd-i" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg>', mail: '<svg class="cd-i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3 7 9 6 9-6"/></svg>', phone: '<svg class="cd-i" viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>', file: '<svg class="cd-i" viewBox="0 0 24 24"><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></svg>', bank: '<svg class="cd-i" viewBox="0 0 24 24"><path d="M3 10 12 4l9 6"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9M3 19h18"/></svg>', note: '<svg class="cd-i" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="m12 8 4 4"/></svg>', chev: '<svg class="cd-i" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>' };

function cdEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function cdMoney(n) { return '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function cdMoney0(n) { return '$' + Math.round(Number(n || 0)).toLocaleString('en-AU'); }
function cdWhen(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleString('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function cdAge(days) { var c = days <= 0 ? 'ok' : days <= 30 ? 'n' : days <= 60 ? 'w' : 'b'; return '<span class="cd-pill ' + c + '">' + (days > 0 ? days + ' days' : 'not due') + '</span>'; }
function cdKindOf(r) {
  var c = r.debt_classification || 'unclassified';
  if (c === 'blocked_by_us') return (r.debt_blocker === 'paid_unallocated' || r.debt_blocker === 'payment_claimed') ? 'paid' : 'blocked';
  if (c === 'genuine_debt') return r.days_overdue > 0 ? 'chase' : 'due';
  if (c === 'in_dispute') return 'dispute';
  if (c === 'not_owed') return 'notowed';
  if (c === 'bad_debt') return 'bad';
  return 'unclass';
}
function cdSubOf(r, kind) {
  if (kind === 'chase' || kind === 'due') { var t = CD_TYPE[r.debt_type] || CD_TYPE.job_invoice; return { key: r.debt_type || 'job_invoice', label: t[0], desc: t[1], owner: r.debt_owner || 'DEBT' }; }
  if (kind === 'paid' || kind === 'blocked') { var b = CD_BLOCKER[r.debt_blocker] || ['Blocked', '']; return { key: r.debt_blocker || 'other', label: b[0], desc: '', owner: r.debt_owner || b[1] }; }
  if (kind === 'notowed') return r.debt_void_proposed ? { key: 'void', label: 'Void proposed', desc: 'test record or cancelled job, Marnin yes/no', owner: 'MARNIN' } : { key: 'other', label: 'Nothing owed', desc: 'residual cents or cancellation to confirm', owner: r.debt_owner || 'BOOKKEEPING' };
  if (kind === 'dispute') return { key: 'dispute', label: 'Client contests the invoice', desc: '', owner: r.debt_owner || 'INSURANCE' };
  if (kind === 'bad') return { key: 'bad', label: 'No provable obligation', desc: 'Marnin decides write-off', owner: 'MARNIN' };
  return { key: 'unclass', label: 'Not yet classified', desc: 'the refresh has not placed this invoice', owner: r.debt_owner || 'CIO' };
}

function cdCss() {
  if (document.getElementById('cd-css')) return;
  var s = document.createElement('style'); s.id = 'cd-css';
  s.textContent = '\
#subCleardebt{--cdbg:#F5F2EE;--cdcard:#fff;--cdline:#E3E0DA;--cdline2:#EEEBE6;--cddark:#293C46;--cddeep:#1A272E;--cdmid:#5B7385;--cdmidl:#93A4B1;--cdlight:#F1EFEB;--cdor:#F15A29;--cdord:#C4481F;--cdort:#FDF1EC;--cdorl:#F9D3C5;--cdsage:#4F7F60;--cdsaget:#E6F0E8;--cdred:#B93A2C;--cdamber:#B8741C;color:var(--cddeep);font-size:14.5px;line-height:1.5}\
#subCleardebt *{box-sizing:border-box;min-width:0}#subCleardebt .cd-num{font-variant-numeric:tabular-nums}#subCleardebt button{font:inherit;cursor:pointer;color:inherit}#subCleardebt :focus-visible{outline:2px solid var(--cdor);outline-offset:3px}.cd-invoice-select{display:flex;gap:12px;align-items:center;margin-bottom:16px}.cd-invoice-select select{font:inherit;padding:8px;max-width:100%}.cd-last-client{grid-column:1/-1;overflow-wrap:anywhere}.cd-last-client p{margin:6px 0}.cd-card,.cd-pend,.cd-note{overflow-wrap:anywhere}\
.cd-i{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vertical-align:-2px;flex:none}\
.cd-k{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--cdmidl);font-weight:600}\
.cd-crumbs{font-size:13px;color:var(--cdmid);margin-bottom:12px;min-height:18px;display:flex;gap:8px;align-items:center}.cd-crumbs button{background:none;border:0;padding:0;color:var(--cdmid)}.cd-crumbs b{color:var(--cddeep);font-weight:600}\
.cd-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap}.cd-h1{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--cdmid);margin:0 0 8px;font-weight:600}\
.cd-big{font-size:48px;font-weight:700;letter-spacing:-.03em;line-height:.95}.cd-big small{font-size:15px;font-weight:400;letter-spacing:0;color:var(--cdmid);margin-left:12px}\
.cd-meta{display:flex;gap:22px;font-size:12.5px;color:var(--cdmid)}.cd-meta div b{display:block;font-size:14px;color:var(--cddeep);font-weight:600}\
.cd-bar{display:flex;height:40px;margin-top:20px;background:#E9E5DF;overflow:hidden}.cd-bar button{border:0;padding:0;min-width:5px;position:relative;transition:filter .2s}.cd-bar button:hover,.cd-bar button.on{filter:brightness(.9)}.cd-bar button.on::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(0,0,0,.25)}\
.cd-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--cdline2);border:1px solid var(--cdline2);margin-top:14px}.cd-legend button{background:var(--cdcard);border:0;text-align:left;padding:12px 12px 12px 14px;position:relative}.cd-legend button::before{content:"";position:absolute;left:0;top:0;bottom:0;width:0;background:var(--sw);transition:width .15s}.cd-legend button:hover::before,.cd-legend button.on::before{width:3px}\
.cd-legend .l{font-size:12.5px;color:var(--cdmid);display:flex;gap:7px;min-height:34px;align-items:flex-start}.cd-legend .l i{width:9px;height:9px;background:var(--sw);flex:none;margin-top:5px}.cd-legend .v{font-size:19px;font-weight:700;letter-spacing:-.02em;margin-top:2px}.cd-legend .c{font-size:12px;color:var(--cdmidl)}\
.cd-hint{margin:18px 0 0;color:var(--cdmid);font-size:14px}\
.cd-panel{margin-top:18px;background:var(--cdcard);border:1px solid var(--cdline);box-shadow:0 1px 2px rgba(41,60,70,.05),0 8px 24px -12px rgba(41,60,70,.18)}\
.cd-ph{display:flex;justify-content:space-between;align-items:baseline;padding:16px 20px;border-bottom:1px solid var(--cdline)}.cd-ph h2{font-size:18px;margin:0;font-weight:700}.cd-ph span{color:var(--cdmid);font-size:13.5px}\
.cd-grp{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 20px;background:color-mix(in srgb,var(--sw) 8%,#fff);border-top:1px solid color-mix(in srgb,var(--sw) 22%,#fff);border-bottom:1px solid color-mix(in srgb,var(--sw) 22%,#fff);margin-top:8px}.cd-grp .lab{display:flex;align-items:center;gap:10px}.cd-grp .lab i{width:9px;height:9px;background:var(--sw)}.cd-grp b{font-size:14px;font-weight:600}.cd-grp .o{font-size:12.5px;color:var(--cdmid);margin-left:8px}.cd-grp .t{font-size:13px;font-weight:600;white-space:nowrap}.cd-grp .t small{color:var(--cdmid);font-weight:400;margin-left:6px}\
.cd-row{display:grid;grid-template-columns:minmax(200px,2fr) 120px 100px minmax(140px,2fr) 20px;gap:14px;align-items:center;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--cdline2);padding:12px 20px}.cd-row:hover{background:#FBF9F6}.cd-row.on{background:#fff;border-top-color:var(--cdline)}\
.cd-row .nm{font-weight:600;font-size:14.5px}.cd-row .sub{font-size:12px;color:var(--cdmidl)}.cd-row .amt{text-align:right;font-weight:600}.cd-row .old{text-align:right}.cd-row .nx{color:var(--cdmid);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cd-row .nx .pp{display:inline-block;font-size:11px;padding:1px 7px;background:var(--cdort);color:var(--cdord);border-radius:100px;margin-right:6px;font-weight:600}.cd-row .car{color:var(--cdmidl);transition:transform .18s;display:flex;justify-content:center}.cd-row.on .car{transform:rotate(90deg);color:var(--cdor)}\
.cd-pill{display:inline-block;padding:2px 9px;border-radius:100px;font-size:12px;font-weight:600;white-space:nowrap}.cd-pill.ok{background:var(--cdsaget);color:var(--cdsage)}.cd-pill.n{background:var(--cdlight);color:var(--cdmid)}.cd-pill.w{background:#FBEEDB;color:var(--cdamber)}.cd-pill.b{background:#FBE6E2;color:var(--cdred)}\
.cd-rec{background:#FBFAF8;border-top:3px solid var(--sw);border-bottom:1px solid var(--cdline);padding:22px 20px 24px}\
.cd-rh{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:18px;flex-wrap:wrap}.cd-rh h2{margin:0;font-size:24px;font-weight:700;letter-spacing:-.02em}.cd-chips{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}.cd-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:100px;font-size:12px;font-weight:600;background:var(--cdlight);color:var(--cdmid)}.cd-chip.d{background:var(--cddark);color:#fff}\
.cd-rh .amt{font-size:30px;font-weight:700;letter-spacing:-.03em;color:var(--cdor);text-align:right}.cd-rh .amt small{display:block;font-size:12px;color:var(--cdmid);font-weight:400;letter-spacing:0}\
.cd-story{display:grid;grid-template-columns:1.6fr 1fr;gap:16px}.cd-card{background:var(--cdcard);border:1px solid var(--cdline);padding:16px 18px}\
.cd-brief dl{margin:0;display:grid;grid-template-columns:96px 1fr;gap:9px 14px;font-size:14px}.cd-brief dt{color:var(--cdmid);font-weight:600;font-size:12.5px;padding-top:2px}.cd-brief dd{margin:0}\
.cd-ev{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid var(--cdline2)}.cd-ev a{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:4px 10px;border:1px solid var(--cdline);background:#fff;text-decoration:none;color:var(--cddark)}\
.cd-next{background:var(--cddark);color:#fff;padding:18px 20px;display:flex;flex-direction:column;gap:12px}.cd-next .cd-k{color:#9FB3C0}.cd-next .big2{font-size:17px;font-weight:600;line-height:1.35}.cd-next .when{display:inline-block;padding:3px 10px;background:var(--cdor);color:#fff;border-radius:100px;font-size:12.5px;font-weight:600;align-self:flex-start}.cd-next .rowk{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;color:#DCE4EA;padding-top:10px;border-top:1px solid rgba(255,255,255,.14)}.cd-next .rowk b{display:block;color:#fff;font-weight:600}\
.cd-reach{display:grid;grid-template-columns:1.1fr 1.1fr .75fr 1.25fr;gap:14px;margin-top:16px}.cd-rc{background:var(--cdcard);border:1px solid var(--cdline);padding:14px 16px;display:flex;flex-direction:column;gap:8px}.cd-rc .cd-k{display:flex;align-items:center;gap:7px}\
.cd-rc textarea{width:100%;border:1px solid var(--cdline);padding:9px 11px;font:inherit;font-size:14px;background:#FBFAF8;resize:vertical;line-height:1.45}.cd-rc textarea:focus{background:#fff;border-color:var(--cdor);outline:0}\
.cd-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cd-acts .st{font-size:12.5px;color:var(--cdmid)}\
.cd-btn{border:1px solid var(--cddark);background:var(--cddark);color:#fff;padding:8px 14px;font-size:13.5px;font-weight:600;display:inline-flex;align-items:center;gap:7px}.cd-btn.o{background:var(--cdor);border-color:var(--cdor)}.cd-btn.l{background:#fff;color:var(--cddark)}#subCleardebt .cd-btn{color:#fff}#subCleardebt .cd-btn.l{color:var(--cddark)}.cd-btn:disabled{opacity:.55;cursor:default}\
.cd-tel{font-size:18px;font-weight:700;margin:2px 0}.cd-tel a{color:inherit;text-decoration:none}.cd-via{font-size:12px;color:var(--cdmidl)}\
.cd-tags{display:flex;gap:4px;flex-wrap:wrap}.cd-tags button{border:1px solid var(--cdline);background:#fff;font-size:12px;padding:4px 9px;border-radius:100px;color:var(--cdmid)}.cd-tags button.on{border-color:var(--cdor);color:var(--cdord);background:var(--cdort)}\
.cd-nthread{max-height:220px;overflow-y:auto;margin-top:6px;border-top:1px solid var(--cdline2)}.cd-note{padding:8px 0;border-bottom:1px solid var(--cdline2);font-size:13px;line-height:1.4}.cd-note .who{color:var(--cdmid);font-size:12.5px}.cd-note .tag{font-size:11px;padding:1px 8px;border-radius:100px;background:var(--cdlight);color:var(--cdmid);white-space:nowrap;font-weight:600}\
.cd-three{display:grid;grid-template-columns:1fr 1fr 1.25fr;gap:16px;margin-top:16px}.cd-three h3{display:flex;align-items:center;gap:7px;margin:0 0 10px}.cd-three h3 em{font-style:normal;color:var(--cdmidl);font-weight:400;text-transform:none;letter-spacing:0;margin-left:auto;font-size:12px}\
.cd-il div.r{display:grid;grid-template-columns:1fr auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--cdline2);font-size:14px;align-items:center}.cd-lnk{font-weight:600;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--cdline);color:inherit}.cd-lnk:hover{color:var(--cdord)}\
.cd-peek{border:0;background:none;font-size:11.5px;color:var(--cdmidl);text-decoration:underline;text-underline-offset:2px;padding:0 4px}.cd-peek:hover{color:var(--cdord)}\
.cd-prev{margin:4px 0 8px}.cd-prev iframe{width:100%;height:520px;border:1px solid var(--cdline);background:#fff}\
.cd-led div{display:grid;grid-template-columns:52px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--cdline2);font-size:13.5px}.cd-led .d{color:var(--cdmid);font-size:12.5px}.cd-led .st{color:var(--cdsage);font-size:12.5px}\
.cd-kv{display:grid;grid-template-columns:64px 1fr;gap:6px 10px;font-size:14px;margin:0}.cd-kv dt{color:var(--cdmid);font-size:12.5px;padding-top:2px}.cd-kv dd{margin:0}\
.cd-docs{margin-top:10px;border-top:1px solid var(--cdline2)}.cd-docs div{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--cdline2);font-size:13.5px;align-items:baseline}.cd-docs .sub{color:var(--cdmidl);font-size:12px;text-align:right}\
.cd-thread{max-height:360px;overflow-y:auto;padding-right:6px;display:flex;flex-direction:column;gap:6px}.cd-msg{padding:9px 12px;font-size:13.5px;line-height:1.45;max-width:92%}.cd-msg.outbound,.cd-msg.internal{background:var(--cdlight);align-self:flex-end}.cd-msg.inbound{background:var(--cdort);align-self:flex-start}.cd-msg .w{font-size:11.5px;color:var(--cdmid);margin-bottom:2px}.cd-msg.inbound .w{color:var(--cdord)}\
.cd-facts{margin-top:12px;padding-top:10px;border-top:1px solid var(--cdline2)}.cd-fact{padding:6px 0;font-size:13.5px}.cd-fact b{display:block;font-size:12px;color:var(--cdmid);font-weight:600}\
.cd-quiet{color:var(--cdmidl);font-size:13px}.cd-pend{padding:12px 14px;background:var(--cdlight);color:var(--cdmid);font-size:13.5px}.cd-pend b{color:var(--cddeep)}.cd-err{padding:14px;background:#FBE6E2;color:var(--cdred)}\
.cd-rc input{font:inherit;width:100%;padding:8px;border:1px solid var(--cdline)}.cd-invoice-select{flex-wrap:wrap}@media(max-width:900px){.cd-rc textarea,.cd-rc input{font-size:16px}.cd-big{font-size:36px}.cd-row{grid-template-columns:1fr 96px 20px}.cd-row .old,.cd-row .nx{display:none}.cd-story,.cd-reach,.cd-three{grid-template-columns:1fr}.cd-rh .amt{text-align:left}}';
  document.head.appendChild(s);
}

// ── Load ──
async function loadClearDebt() {
  cdCss();
  var stats = document.getElementById('clearDebtStats'), filt = document.getElementById('clearDebtFilters'), cards = document.getElementById('clearDebtCards');
  if (!stats) return;
  CD.recordRequest++; CD.ctx = {}; CD.noteErrors = {};
  cards.innerHTML = ''; filt.innerHTML = '';
  stats.style.display = 'block'; filt.style.display = 'block';
  stats.innerHTML = '<div class="cd-quiet">Loading the debt picture…</div>';
  try {
    var pic = await opsFetch('list_debt_picture');
    CD.rows = pic.rows || []; CD.totals = pic.totals || {}; CD.asOf = pic.as_of; CD.pictureAsOf = pic.picture_as_of; CD.pictureWarnings = pic.warnings || [];
  } catch (e) {
    stats.innerHTML = '<div class="cd-err">The debt picture could not be read: ' + cdEsc(e.message) + '. If this is the first day, the backend action list_debt_picture has not deployed yet.</div>';
    return;
  }
  try {
    var cov = await opsFetch('debt_context_coverage', { population: 'open' });
    CD.coverage = {}; (cov.rows || []).forEach(function (r) { CD.coverage[r.xero_invoice_id] = r; });
    CD.coverageAsOf = cov.as_of; CD.coverageTotals = cov.totals || {}; CD.coverageWarnings = cov.warnings || [];
  } catch (e) { CD.coverage = {}; CD.coverageAsOf = null; CD.coverageWarnings = [e.message]; }
  cdRender();
}

function cdGroups() {
  var kinds = {}; CD_KINDS.forEach(function (k) { kinds[k.key] = { key: k.key, label: k.label, color: k.color, amount: 0, n: 0, subs: {} }; });
  CD.rows.forEach(function (r) {
    var kind = cdKindOf(r), K = kinds[kind]; K.amount += Number(r.amount_due || 0); K.n += 1;
    var sub = cdSubOf(r, kind), S = K.subs[sub.key] || (K.subs[sub.key] = { key: sub.key, label: sub.label, desc: sub.desc, owner: sub.owner, amount: 0, n: 0, payers: {} });
    S.amount += Number(r.amount_due || 0); S.n += 1;
    var pk = r.xero_contact_id || r.contact_name || 'unknown';
    var P = S.payers[pk] || (S.payers[pk] = { key: pk, name: r.contact_name || 'Unknown', xero_contact_id: r.xero_contact_id, amount: 0, n: 0, oldest: 0, owner: r.debt_owner || sub.owner, next: '', proposal: false, invoices: [] });
    P.amount += Number(r.amount_due || 0); P.n += 1; P.oldest = Math.max(P.oldest, r.days_overdue || 0); P.invoices.push(r);
    if (!P.next && r.debt_next_action) P.next = r.debt_next_action;
    if (r.debt_proposal_status === 'pending') P.proposal = true;
  });
  Object.keys(kinds).forEach(function (k) {
    var K = kinds[k]; K.subs = Object.keys(K.subs).map(function (s) { var S = K.subs[s]; S.payers = Object.keys(S.payers).map(function (p) { return S.payers[p]; }).sort(function (a, b) { return b.amount - a.amount; }); return S; }).sort(function (a, b) { return b.amount - a.amount; });
  });
  return kinds;
}

function cdRender() {
  var kinds = cdGroups(), total = 0, count = 0, overdue = 0, overdueN = 0;
  CD.rows.forEach(function (r) { total += Number(r.amount_due || 0); count += 1; if (r.days_overdue > 0) { overdue += Number(r.amount_due || 0); overdueN += 1; } });
  var proposals = CD.rows.filter(function (r) { return r.debt_proposal_status === 'pending'; }).length;
  var incomplete = CD.rows.filter(function (r) { var c = CD.coverage[r.xero_invoice_id]; return !c || (c.blockers || []).length > 0 || (c.complete !== true && !(c.complete === undefined && Array.isArray(c.blockers) && c.blockers.length === 0)); }).length;
  var bar = '', leg = '';
  CD_KINDS.forEach(function (k) {
    var K = kinds[k.key]; if (!K.n && k.key === 'unclass') return;
    var w = total ? (K.amount / total * 100).toFixed(2) : 0; var np = K.subs.reduce(function (a, s) { return a + s.payers.length; }, 0);
    bar += '<button class="' + (CD.seg === k.key ? 'on' : '') + '" style="width:' + w + '%;background:' + k.color + '" onclick="cdGo(\'' + k.key + '\')" aria-label="' + k.label + '" title="' + k.label + ': ' + cdMoney0(K.amount) + '"></button>';
    leg += '<button class="' + (CD.seg === k.key ? 'on' : '') + '" style="--sw:' + k.color + '" onclick="cdGo(\'' + k.key + '\')"><div class="l"><i></i>' + k.label + '</div><div class="v cd-num">' + cdMoney0(K.amount) + '</div><div class="c cd-num">' + K.n + ' invoice' + (K.n === 1 ? '' : 's') + ' · ' + np + ' payer' + (np === 1 ? '' : 's') + '</div></button>';
  });
  document.getElementById('clearDebtStats').innerHTML =
    '<div class="cd-crumbs">' + (CD.seg ? '<button onclick="cdGo(null)">Outstanding ' + cdMoney0(total) + '</button>' + CD_IC.chev + '<b>' + kinds[CD.seg].label + '</b>' : '') + '</div>' +
    '<div class="cd-head"><div><div class="cd-h1">Clear Debt</div><div class="cd-big cd-num">' + cdMoney0(total) + '<small>' + count + ' invoices · ' + overdueN + ' overdue for ' + cdMoney0(overdue) + '</small></div></div>' +
    '<div class="cd-meta"><div>Picture refreshed<b>' + (CD.pictureAsOf ? cdWhen(CD.pictureAsOf) : 'never') + '</b></div><div>Picture incomplete<b>' + (CD.coverageAsOf ? incomplete + ' of ' + count : 'door unavailable') + '</b></div><div>Proposals waiting for Marnin<b id="cd-proposal-count">' + proposals + '</b></div></div></div>' +
    '<div class="cd-bar" role="group" aria-label="Outstanding by kind">' + bar + '</div><div class="cd-legend">' + leg + '</div>' + (CD.seg ? '' : '<p class="cd-hint">Pick a piece of the bar to see who owes it, grouped by the type of debt.</p>');
  document.getElementById('clearDebtFilters').innerHTML = (CD.pictureWarnings || []).concat(CD.coverageWarnings || []).map(function (w) { return '<div class="cd-pend">Picture warning: ' + cdEsc(w) + '</div>'; }).join('');
  var cards = document.getElementById('clearDebtCards');
  if (!CD.seg) { cards.innerHTML = ''; return; }
  var K = kinds[CD.seg], h = '';
  K.subs.forEach(function (S) {
    h += '<div class="cd-grp" style="--sw:' + K.color + '"><span class="lab"><i></i><b>' + cdEsc(S.label) + '</b><span class="o">' + cdEsc(S.desc || S.owner) + '</span></span><span class="t cd-num">' + cdMoney0(S.amount) + '<small>' + S.n + ' invoice' + (S.n === 1 ? '' : 's') + '</small></span></div>';
    S.payers.forEach(function (P) {
      var key = S.key + '|' + P.key, on = CD.open === key;
      h += '<button class="cd-row ' + (on ? 'on' : '') + '" onclick="cdToggle(\'' + cdEsc(key).replace(/'/g, "\\'") + '\')" aria-expanded="' + on + '"><span><div class="nm">' + cdEsc(P.name) + '</div><div class="sub">' + P.n + ' invoice' + (P.n === 1 ? '' : 's') + '</div></span><span class="amt cd-num">' + cdMoney(P.amount) + '</span><span class="old">' + cdAge(P.oldest) + '</span><span class="nx">' + (P.proposal ? '<span class="pp">proposal</span>' : '') + cdEsc(P.next.length > 48 ? P.next.slice(0, 46) + '…' : P.next) + '</span><span class="car">' + CD_IC.chev + '</span></button>';
      if (on) h += '<div class="cd-rec" id="cd-rec" style="--sw:' + K.color + '">' + cdRecordShell(P, S, K) + '</div>';
    });
  });
  cards.innerHTML = '<div class="cd-panel"><div class="cd-ph"><h2>' + K.label + '</h2><span class="cd-num">' + cdMoney0(K.amount) + ' · ' + K.n + ' invoices</span></div>' + h + '</div>';
  if (CD.open) cdLoadRecord();
}
function cdGo(seg) { CD.seg = seg; CD.open = null; CD.selectedInvoice = null; CD.recordRequest++; cdRender(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function cdToggle(key) { CD.selectedInvoice = null; CD.recordRequest++; CD.open = CD.open === key ? null : key; cdRender(); }

// ── Record ──
function cdOpenPayer() {
  var kinds = cdGroups(); var K = kinds[CD.seg]; if (!K || !CD.open) return null;
  var parts = CD.open.split('|'); for (var i = 0; i < K.subs.length; i++) { var S = K.subs[i]; if (S.key !== parts[0]) continue; for (var j = 0; j < S.payers.length; j++) if (S.payers[j].key === parts[1]) return { P: S.payers[j], S: S, K: K }; }
  return null;
}
function cdLead(P) { return P.invoices.find(function (r) { return r.xero_invoice_id === CD.selectedInvoice; }) || P.invoices[0]; }
function cdSelectInvoice(xid) { var o = cdOpenPayer(); if (!o || !o.P.invoices.some(function (r) { return r.xero_invoice_id === xid; })) return; CD.selectedInvoice = xid; cdRender(); }
function cdInvoicePicker(P) {
  var lead = cdLead(P);
  return '<label class="cd-invoice-select">Invoice context <select aria-label="Invoice context" onchange="cdSelectInvoice(this.value)">' + P.invoices.map(function (r) { return '<option value="' + cdEsc(r.xero_invoice_id) + '"' + (r === lead ? ' selected' : '') + '>' + cdEsc(r.invoice_number) + ' · ' + cdMoney(r.amount_due) + '</option>'; }).join('') + '</select></label>';
}
function cdRecordShell(P, S, K) {
  var lead = cdLead(P);
  return '<div class="cd-rh"><div><h2>' + cdEsc(P.name) + '</h2><div class="cd-chips"><span class="cd-chip d">' + cdEsc(lead.debt_owner || P.owner) + '</span><span class="cd-chip">' + cdEsc(CD_CLASS_LABEL[lead.debt_classification] || 'Unclassified') + (lead.debt_blocker ? ' · ' + cdEsc((CD_BLOCKER[lead.debt_blocker] || [lead.debt_blocker])[0]) : '') + '</span>' + cdAge(P.oldest) + '</div></div><div class="amt cd-num">' + cdMoney(P.amount) + '<small>' + P.n + ' invoice' + (P.n === 1 ? '' : 's') + ' · picture refreshed ' + (lead.debt_as_of ? cdWhen(lead.debt_as_of) : 'never') + '</small></div></div>' +
    cdInvoicePicker(P) + '<div id="cd-rec-body"><div class="cd-quiet">Reading the record…</div></div>';
}
async function cdLoadRecord() {
  var o = cdOpenPayer(); if (!o) return; var P = o.P, lead = cdLead(P), body = document.getElementById('cd-rec-body'); if (!body) return;
  var request = ++CD.recordRequest; var ctx = null, notes = null, err = null;
  try { ctx = CD.ctx[lead.xero_invoice_id] || await opsFetch('invoice_context', { xero_invoice_id: lead.xero_invoice_id, mode: 'card' }); if (request === CD.recordRequest) CD.ctx[lead.xero_invoice_id] = ctx; } catch (e) { err = e.message; }
  try { notes = await opsFetch('debt_notes', { xero_invoice_id: lead.xero_invoice_id }); CD.notes[lead.xero_invoice_id] = notes.thread || []; delete CD.noteErrors[lead.xero_invoice_id]; } catch (e) { CD.noteErrors[lead.xero_invoice_id] = e.message; }
  if (request !== CD.recordRequest || !document.getElementById('cd-rec-body')) return;
  document.getElementById('cd-rec-body').innerHTML = cdRecordHtml(P, o.S, o.K, ctx, err);
}
function cdBriefHtml(lead, ctx) {
  var b = lead.debt_brief; var last = ctx && ctx.conversation && ctx.conversation.last_client_message;
  var lastHtml = '<div class="cd-last-client"><b>Last client words</b><p>' + (last ? cdEsc(last.preview) + '</p><small>' + cdEsc(cdWhen(last.at)) + ' · ' + cdEsc(last.channel) + '</small>' : (ctx && ctx.sources && ctx.sources.conversation && ctx.sources.conversation.ok === true ? 'No client message in the stored conversation.</p>' : 'Client conversation unavailable from the door.</p>')) + '</div>';
  if (b && b.promised) {
    var refs = (b.sources || []).map(function (r) { return '<span title="' + cdEsc(r.source_ref || '') + '">' + cdEsc(r.label || r.source) + ' · ' + cdEsc(r.source_ref || '') + '</span>'; }).join('');
    var review = (b.review_required ? '<div class="cd-pend">This brief needs desk review before a client proposal.</div>' : '') + (b.context_blockers || []).map(function (r) { return '<div class="cd-pend"><b>' + cdEsc(r.owner) + ': ' + cdEsc(r.code) + '</b> ' + cdEsc(r.detail) + '</div>'; }).join('');
    var ev = (b.evidence || []).filter(function (e) { return /^https?:\/\//i.test(e.href || ''); }).map(function (e) { return '<a href="' + cdEsc(e.href || '#') + '" onclick="event.stopPropagation()">' + (CD_IC[e.kind] || CD_IC.file) + cdEsc(e.label) + '</a>'; }).join('');
    return lastHtml + '<div class="cd-card cd-brief"><div class="cd-k" style="margin-bottom:10px">Where this stands</div><dl><dt>Promised</dt><dd>' + cdEsc(b.promised) + '</dd><dt>Delivered</dt><dd>' + cdEsc(b.delivered) + '</dd><dt>Client says</dt><dd>' + cdEsc(b.client_says) + '</dd><dt>Our side</dt><dd>' + cdEsc(b.our_side) + '</dd></dl>' + review + (ev || refs ? '<div class="cd-ev">' + ev + refs + '</div>' : '') + '</div>';
  }
  var blockers = ctx && ctx.blockers ? ctx.blockers.map(function (x) { return '<div class="cd-pend"><b>' + cdEsc(x.code.replace(/_/g, ' ')) + ', ' + cdEsc(x.owner) + '.</b> ' + cdEsc(x.detail) + '</div>'; }).join('') : '';
  return lastHtml + '<div class="cd-card cd-brief"><div class="cd-k" style="margin-bottom:10px">Where this stands</div><dl><dt>Why unpaid</dt><dd>' + cdEsc(lead.debt_classification_reason || 'not yet written by the refresh') + '</dd></dl><div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">' + (blockers || '<div class="cd-quiet">The four-line brief is written by the refresh once the door has facts for this job.</div>') + '</div></div>';
}
function cdRecordHtml(P, S, K, ctx, err) {
  var lead = cdLead(P), job = ctx && ctx.job, conv = ctx && ctx.conversation, inv = ctx && ctx.invoice;
  var next = '<div class="cd-next"><span class="cd-k">What happens from here</span><div class="big2">' + cdEsc(lead.debt_next_action || 'No next step recorded') + '</div>' + (lead.debt_next_action_at ? '<span class="when">' + cdEsc(lead.debt_next_action_at) + '</span>' : '') + '<div class="rowk"><div>Whose move<b>' + cdEsc(lead.debt_owner || P.owner) + '</b></div><div>Kind<b>' + cdEsc(CD_CLASS_LABEL[lead.debt_classification] || 'Unclassified') + (lead.debt_blocker ? ', ' + cdEsc((CD_BLOCKER[lead.debt_blocker] || [lead.debt_blocker])[0]) : '') + '</b></div></div></div>';
  var phone = (job && job.client_phone) || '', email = (job && job.client_email) || '';
  var draft = lead.debt_proposal_status === 'pending' && lead.debt_proposal_kind === 'sms' ? lead.debt_proposal_text : '';
  var thread = CD.noteErrors[lead.xero_invoice_id] ? '<div class="cd-pend">Notes unavailable: ' + cdEsc(CD.noteErrors[lead.xero_invoice_id]) + '. Refresh to retry.</div>' : (CD.notes[lead.xero_invoice_id] || []).map(function (n) { return '<div class="cd-note"><div class="who">' + cdEsc(cdWhen(n.at)) + ' · ' + cdEsc(n.who || n.source) + (n.tag ? ' <span class="tag">' + cdEsc(n.tag) + '</span>' : '') + '</div><div>' + cdEsc(n.text) + '</div></div>'; }).join('') || '<div class="cd-quiet">No notes yet.</div>';
  var reach = '<div class="cd-reach">' +
    '<div class="cd-rc"><div class="cd-k">' + CD_IC.msg + 'Text proposal</div><textarea aria-label="Text proposal" id="cd-sms" rows="4" placeholder="Draft a text for Marnin">' + cdEsc(draft) + '</textarea><span class="st">Marnin approves each client message individually in the terminal.</span>' + cdProposalControls(lead, 'sms', phone) + '</div>' +
    '<div class="cd-rc"><div class="cd-k">' + CD_IC.mail + 'Email proposal</div><textarea aria-label="Email proposal" id="cd-email" rows="4" placeholder="Draft the complete email for Marnin">' + cdEsc(lead.debt_proposal_kind === 'email' && lead.debt_proposal_status === 'pending' ? lead.debt_proposal_text : '') + '</textarea><span class="st">Include the subject and full message. Marnin approves in the terminal.</span>' + cdProposalControls(lead, 'email', email) + '</div>' +
    '<div class="cd-rc"><div class="cd-k">' + CD_IC.phone + 'Call context</div><div class="cd-tel">' + cdEsc(phone || 'No phone available from the door') + '</div><span class="cd-via">Any client contact is proposed to Marnin first.</span></div>' +
    '<div class="cd-rc"><div class="cd-k">' + CD_IC.note + 'Note</div><textarea id="cd-note" aria-label="Internal note" rows="2" placeholder="For whoever opens this next…"></textarea><div class="cd-tags" id="cd-tags">' + ['promised', 'call back', 'waiting on client', 'park until', 'propose void', 'dispute'].map(function (t) { return '<button onclick="cdTag(this)">' + t + '</button>'; }).join('') + '</div><div class="cd-acts"><button class="cd-btn" onclick="cdAddNote(\'' + lead.xero_invoice_id + '\')">' + CD_IC.note + 'Add note</button></div><div class="cd-nthread" id="cd-nthread">' + thread + '</div></div></div>';
  var invs = P.invoices.map(function (i) { return '<div class="r"><span><a class="cd-lnk" target="_blank" rel="noopener" href="https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + cdEsc(i.xero_invoice_id) + '" onclick="event.stopPropagation()" title="Open in Xero">' + cdEsc(i.invoice_number) + '</a> ' + cdAge(i.days_overdue) + ' <button class="cd-peek" onclick="event.stopPropagation();cdPreview(\'' + cdEsc(i.xero_invoice_id) + '\',this)">preview</button></span><span class="cd-num">' + cdMoney(i.amount_due) + '</span></div><div class="cd-prev" id="cd-prev-' + cdEsc(i.xero_invoice_id) + '" hidden></div>'; }).join('');
  var pays = ctx && ctx.bank && ctx.bank.xero_payments && ctx.bank.xero_payments.length ? '<div class="cd-led" style="margin-top:8px">' + ctx.bank.xero_payments.map(function (m) { return '<div><span class="d">' + cdEsc(m.date) + '</span><span>' + cdMoney(m.amount) + (m.reference ? ' · ' + cdEsc(m.reference) : '') + '<br><span class="st">Allocated in Xero</span></span></div>'; }).join('') + '</div>' : '<div class="cd-quiet" style="margin-top:10px">' + (ctx && ctx.sources && ctx.sources.invoice && ctx.sources.invoice.ok === true && ctx.bank && Array.isArray(ctx.bank.xero_payments) ? 'No payments allocated in the stored Xero record for ' + cdEsc(lead.invoice_number) + '.' : 'Payment information unavailable from the door.') + '</div>';
  var jobHtml = job ? '<dl class="cd-kv"><dt>Job</dt><dd><a class="cd-lnk" href="#" onclick="event.preventDefault();event.stopPropagation();openJobDetail(\'' + cdEsc(job.id) + '\')">' + cdEsc(job.job_number) + '</a> ' + cdEsc(job.type || '') + '</dd><dt>Site</dt><dd>' + cdEsc(job.site_address || job.site_suburb || '') + '</dd><dt>Status</dt><dd>' + cdEsc(job.status || '') + '</dd><dt>Value</dt><dd>' + (job.promised && job.promised.quote_total ? cdMoney(job.promised.quote_total) : '<span class="cd-quiet">no quote total on the job</span>') + '</dd></dl>' +
    '<div class="cd-docs">' + (inv ? '<div><a class="cd-lnk" target="_blank" rel="noopener" href="https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + cdEsc(inv.xero_invoice_id) + '">' + CD_IC.file + ' ' + cdEsc(inv.invoice_number) + '</a><span class="sub">' + cdEsc(inv.reference || '') + '</span></div>' : '') + ((job.other_open_invoices || []).map(function (x) { return '<div><span>' + CD_IC.file + ' ' + cdEsc(x.invoice_number) + '</span><span class="sub">' + cdMoney(x.amount_due) + ' due ' + cdEsc(x.due_date) + '</span></div>'; }).join('')) + ((job.promised && job.promised.work_orders || []).map(function (w) { return '<div><span>' + CD_IC.file + ' WO ' + cdEsc(w.wo_number) + '</span><span class="sub">' + cdEsc(w.trade || '') + ' · ' + cdEsc(w.status || '') + '</span></div>'; }).join('')) + '</div>'
    : '<div class="cd-pend"><b>' + (!ctx || (ctx.sources && ctx.sources.job && ctx.sources.job.ok === false) ? 'Job information unavailable from the door.' : ctx.link && ctx.link.status === 'ambiguous' ? 'More than one job matches this contact.' : ctx.link && ctx.link.status === 'none' ? 'No job linked to this invoice.' : 'Job context pending.') + '</b> ' + (ctx && ctx.blockers && ctx.blockers.length ? cdEsc(ctx.blockers[0].detail) : '') + '</div>';
  var chat = conv && conv.messages && conv.messages.length ? '<div class="cd-thread">' + conv.messages.slice().reverse().map(function (m) { return '<div class="cd-msg ' + cdEsc(m.direction || 'internal') + '"><div class="w">' + cdEsc(cdWhen(m.at)) + ' · ' + cdEsc(m.author || m.channel) + ' · ' + cdEsc(m.channel) + '</div>' + cdEsc(m.preview || '') + '</div>'; }).join('') + '</div>' : '<div class="cd-pend"><b>' + (ctx && ctx.sources && ctx.sources.conversation && ctx.sources.conversation.ok === true ? 'No stored messages.' : 'Conversation unavailable from the door.') + '</b> ' + (ctx && ctx.blockers ? cdEsc((ctx.blockers.filter(function (b) { return /conversation|ghl/.test(b.code); })[0] || {}).detail || '') : '') + '</div>';
  var facts = ctx && ctx.facts && ctx.facts.length ? '<div class="cd-facts"><div class="cd-k" style="margin-bottom:4px">Facts pulled by Luna</div>' + ctx.facts.map(function (f) { return '<div class="cd-fact"><b>' + cdEsc(f.kind) + '</b>' + cdEsc(typeof f.value === 'string' ? f.value : (f.value && (f.value.text || JSON.stringify(f.value)))) + '</div>'; }).join('') + '</div>' : '';
  var errHtml = err ? '<div class="cd-err" style="margin-bottom:12px">The door did not answer for this invoice: ' + cdEsc(err) + '</div>' : '';
  var honesty = ctx ? (ctx.blockers || []).map(function (b) { return '<div class="cd-pend"><b>' + cdEsc(b.owner) + ': ' + cdEsc(b.code) + '</b> ' + cdEsc(b.detail) + '</div>'; }).join('') + (ctx.warnings || []).map(function (w) { return '<div class="cd-pend">' + cdEsc(w) + '</div>'; }).join('') : '';
  var handoff = lead.debt_handoff_ref ? '<p>Handoff: ' + cdEsc(lead.debt_handoff_ref) + ' · ' + cdEsc(cdWhen(lead.debt_handoff_at)) + '</p>' : '';
  return errHtml + honesty + '<p>Context and notes for <b>' + cdEsc(lead.invoice_number) + '</b>: ' + cdEsc(lead.debt_classification_reason || 'Reason unavailable; desk review needed') + '</p>' + handoff + '<div class="cd-story">' + cdBriefHtml(lead, ctx) + next + '</div>' + reach +
    '<div class="cd-three"><div class="cd-card"><h3 class="cd-k">' + CD_IC.bank + 'Money<em>Xero</em></h3><div class="cd-il">' + invs + '</div>' + pays + '</div><div class="cd-card"><h3 class="cd-k">' + CD_IC.file + 'Job and files<em>job record</em></h3>' + jobHtml + '</div><div class="cd-card"><h3 class="cd-k">' + CD_IC.msg + 'Conversation<em>' + (conv && conv.sources ? Object.keys(conv.sources).filter(function (k) { return conv.sources[k]; }).length + ' sources' : 'door') + ' · newest first</em></h3>' + chat + facts + '</div></div>';
}

// ── Invoice preview: the real PDF from Xero, rendered in line ──
async function cdPreview(xid, btn) {
  var box = document.getElementById('cd-prev-' + xid); if (!box) return;
  if (!box.hidden) { box.hidden = true; btn.textContent = 'preview'; return; }
  box.hidden = false; box.innerHTML = '<div class="cd-quiet">Fetching the invoice PDF from Xero…</div>'; btn.textContent = 'hide';
  try {
    var res = await opsFetch('get_invoice_pdf', { xero_invoice_id: xid });
    var bin = atob(res.pdf_base64), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
    box.innerHTML = '<iframe src="' + url + '#toolbar=0" title="' + cdEsc(res.filename || 'invoice') + '"></iframe>';
  } catch (e) { box.innerHTML = '<div class="cd-err">The PDF could not be fetched: ' + cdEsc(e.message) + '</div>'; }
}

// ── Actions (every one logs on the client's record; nothing sends by itself) ──
function cdTag(btn) { var was = btn.classList.contains('on'); btn.parentNode.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); }); if (!was) btn.classList.add('on'); }
async function cdAddNote(xid) {
  var ta = document.getElementById('cd-note'), tagEl = document.querySelector('#cd-tags button.on'); var note = ta && ta.value.trim(); if (!note) { showToast('Write the note first', 'warning'); return; }
  try { var res = await opsPost(CD.ACTIONS.note, { xero_invoice_id: xid, note: note, tag: tagEl ? tagEl.textContent : null }); CD.notes[xid] = res.thread || []; ta.value = ''; showToast('Note added', 'success'); cdRender(); } catch (e) { showToast('Note failed: ' + e.message, 'warning'); }
}

function cdProposalControls(lead, kind, fallbackTo) {
  var to = lead.debt_proposal_kind === kind ? lead.debt_proposal_to : fallbackTo;
  return '<label>Proposed recipient<input id="cd-' + kind + '-to" aria-label="' + kind + ' proposal recipient" value="' + cdEsc(to || '') + '"></label><button class="cd-btn" onclick="cdSaveProposal(\'' + lead.xero_invoice_id + '\',\'' + kind + '\',this)">Save proposal for Marnin</button><span class="cd-quiet">One pending proposal per invoice. Saving replaces its previous proposal and requires fresh approval.</span>';
}
async function cdSaveProposal(xid, kind, button) {
  if (CD.savingProposal) return;
  var text = document.getElementById(kind === 'sms' ? 'cd-sms' : 'cd-email').value.trim();
  var to = document.getElementById('cd-' + kind + '-to').value.trim();
  if (!text || !to) { showToast('Write the full proposal and proposed recipient first', 'warning'); return; }
  CD.savingProposal = true; if (button) button.disabled = true;
  try {
    var res = await opsPost(CD.ACTIONS.proposal, { xero_invoice_id: xid, kind: kind, text: text, to: to });
    if (!res || res.status !== 'pending') throw new Error('Pending proposal was not confirmed. Refresh before retrying.');
    var row = CD.rows.find(function (r) { return r.xero_invoice_id === xid; });
    if (row) Object.assign(row, { debt_proposal_kind: kind, debt_proposal_text: text, debt_proposal_to: to, debt_proposal_status: 'pending' });
    var count = document.getElementById('cd-proposal-count'); if (count) count.textContent = CD.rows.filter(function (r) { return r.debt_proposal_status === 'pending'; }).length;
    showToast(res.audit_warning || 'Proposal saved for Marnin. Nothing sent.', res.audit_warning ? 'warning' : 'success');
  } catch (e) { showToast('Proposal save failed: ' + e.message, 'warning'); }
  finally { CD.savingProposal = false; if (button) button.disabled = false; }
}
