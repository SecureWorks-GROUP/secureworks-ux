// The year pay summary PDF on My pay (#/pay/history). One press reads ops-api
// `my_pay_year_summary_pdf?fy=<year ending 30 June>` (secureworks-backend #1617,
// "Not yet processed" rows from #1630) and saves the file in the browser, from
// a Blob, inside the app. The server takes the trade from the sign-in and
// refuses any other person, so the app sends only the year. Every figure is
// the server's, inside the PDF; a refusal or failed read is said in words and
// nothing is saved.
import { html, useState } from '../lib/h.js';
import { apiBlob, previewing } from '../lib/api.js';
import { todayISO } from '../lib/dates.js';
import { useStore } from '../lib/store.js';
import { Section, Button, buzz } from './kit.js';

/** The financial year (named by the year it ends) a Perth day falls in. */
export function fyEnding(iso) {
  const y = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 7 ? y + 1 : y;
}

export function fyWords(fy) { return `1 July ${fy - 1} to 30 June ${fy}`; }

/**
 * The financial years the picker offers: the years in my_pay_history's
 * `years` rows (label "FY 2026/27", named here by the year it ends), newest
 * first. A label that does not read cleanly is left out; with none left, the
 * current financial year is offered.
 */
export function fyChoices(rows, today) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const m = /^FY (\d{4})\/(\d{2})$/.exec(String((r && r.fy_label) || '').trim());
    if (!m) return;
    const end = Number(m[1]) + 1;
    if (String(end).slice(2) !== m[2] || out.includes(end)) return;
    out.push(end);
  });
  if (!out.length) out.push(fyEnding(today));
  return out.sort((a, b) => b - a);
}

/** Words for a press that did not end in a file. */
export function yearPdfError(err) {
  if (!err) return 'Could not make your pay summary. Try again.';
  if (err.offline) return 'No signal. Check your connection and try again.';
  if (err.name === 'AbortError') return 'That took too long. Try again.';
  if (err.code === 'no_invoices_that_year') return 'No invoices in that year.';
  if (err.code === 'own_pay_only' || err.code === 'preview_read_only') return 'Only the trade can get their own pay summary.';
  return 'Could not make your pay summary. Try again.';
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function YearPdf({ years: rows }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [picked, setPicked] = useState(null);
  const user = useStore((s) => s.user);
  // Office has no trade pay of its own; the owner's view-as-a-trade cannot fetch a file.
  if (previewing() || (user && user.office)) return null;
  const years = fyChoices(rows, todayISO());
  const fy = years.includes(picked) ? picked : years[0];

  const get = async () => {
    if (busy) return;
    setBusy(true); setMsg(null); buzz(5);
    try {
      const blob = await apiBlob('my_pay_year_summary_pdf', { fy });
      saveBlob(blob, `pay-summary-${fy}.pdf`);
      setMsg({ ok: true, text: 'Saved. Look in your downloads.' });
    } catch (err) {
      setMsg({ ok: false, text: yearPdfError(err) });
    } finally {
      setBusy(false);
    }
  };

  return html`<${Section} label="Year summary for your accountant">
    <div class="block card pad pay-ypdf">
      <label class="pay-yrow">
        <span class="t-small">Financial year</span>
        <select class="pay-ysel" aria-label="Financial year" disabled=${busy}
          onChange=${(e) => { setPicked(Number(e.currentTarget.value)); setMsg(null); }}>
          ${years.map((y) => html`<option key=${y} value=${y} selected=${y === fy}>${fyWords(y)}</option>`)}
        </select>
      </label>
      <${Button} kind="line" block small busy=${busy} onClick=${get}>Year summary (PDF)<//>
      ${msg ? html`<p class=${msg.ok ? 't-small pay-note' : 't-small pay-note pay-ybad'} role=${msg.ok ? 'status' : 'alert'}>${msg.text}</p>` : null}
      <p class="t-small pay-note">Built from your invoices. An invoice the office has not processed yet is listed in the PDF but left out of its totals.</p>
    </div>
  <//>`;
}
