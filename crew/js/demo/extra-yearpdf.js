// Demo answer for ops-api my_pay_year_summary_pdf (secureworks-backend #1617,
// #1630): the signed-in trade's own invoices for one financial year as a small
// text PDF Blob. An invoice with no Xero bill is "Not yet processed" and adds
// nothing to a total. `db.yearPdfRefuse = { status, code }` makes the next
// answers refuse, for the bad-path checks. Made-up figures only.
// Super is never said to have reached the fund: a row says the office marked it
// paid (its Perth day when the demo holds the office's stamp), or that it is to
// be paid, as My pay does (secureworks-backend #1639).
import { registerDemo, fail } from './server.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// db.paidSuperRuns: a Set of run ids, or a Map of run id to the office's stamp (ISO).
function superState(paidRuns, runId) {
  const runs = paidRuns || new Set();
  if (!runId || !runs.has(runId)) return 'To be paid to your fund';
  const ms = runs instanceof Map ? Date.parse(runs.get(runId)) : NaN;
  if (!Number.isFinite(ms)) return 'Marked paid by the office';
  const d = new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  return `Marked paid by the office on ${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

function pdfBlob(lines) {
  const esc = (s) => String(s).replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '?');
  const ops = ['BT /F1 11 Tf 14 TL 40 800 Td'];
  lines.forEach((l) => ops.push(`(${esc(l)}) '`));
  ops.push('ET');
  const stream = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + at.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
}

registerDemo((db, h) => ({
  my_pay_year_summary_pdf(p) {
    const me = db.me;
    if (!me || !me.id) fail(401, { code: 'login_required' });
    if (db.yearPdfRefuse) fail(db.yearPdfRefuse.status, { code: db.yearPdfRefuse.code });
    if (!['crew', 'installer', 'lead_installer'].includes(me.role) || p.user_id || p.trade_id) fail(403, { code: 'own_pay_only' });
    const fy = String(p.fy || '');
    if (!/^[1-9]\d{3}$/.test(fy)) fail(400, { code: 'fy_invalid' });
    const start = `${Number(fy) - 1}-07-01`; const end = `${fy}-06-30`;
    const rows = db.invoices.filter((r) => r.user_id === me.id && !['draft', 'ops-reject', 'failed'].includes(r.status) &&
      !['VOIDED', 'DELETED'].includes(String(r.xero_bill_status || '').toUpperCase()))
      .filter((r) => { const d = r.week_end || String(r.created_at || '').slice(0, 10); return d >= start && d <= end; })
      .sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
    if (!rows.length) fail(404, { code: 'no_invoices_that_year' });
    const m = (n) => '$' + Number(n).toFixed(2);
    let total = 0; let sup = 0; let you = 0; let pending = 0;
    const table = rows.map((r) => {
      if (!r.xero_bill_id) { pending += 1; return `${r.invoice_number}  ${r.week_start}  Not yet processed`; }
      const v = r.pay_view || h.money(r.gross_earned, { gstOn: r.gst_on }).pay_view;
      total += Number(v.total_inc_super); sup += Number(v.paid_to_super); you += Number(v.paid_to_you);
      return `${r.invoice_number}  ${r.week_start}  ${m(v.total_inc_super)}  ${m(v.paid_to_super)}  ${m(v.paid_to_you)}  ${superState(db.paidSuperRuns, r.pay_run_id)}`;
    });
    return pdfBlob([
      `Pay summary, 1 July ${Number(fy) - 1} to 30 June ${fy}`, me.name || 'Trade', '',
      `Total (includes super)  ${m(total)}`, `Super on your pay  ${m(sup)}`, `Your pay  ${m(you)}`,
      ...(pending ? [`${pending} invoice${pending === 1 ? '' : 's'} not yet processed`] : []), '',
      'Invoice number  Week starting  Total  Super  Your pay  Super state', ...table, '',
      'Built from your SecureWorks invoices. A summary, not tax advice. Give it to your accountant.'
    ]);
  }
}));
