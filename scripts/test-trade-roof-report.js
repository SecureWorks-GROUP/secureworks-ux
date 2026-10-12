#!/usr/bin/env node
// 2026-09-08 — SecureWorks roof report in the trade app + the "Hours for this
// job" row (date, start and finish since 2026-10-12; hours are worked out).
// Extracts the shipped // <trade-roof-report> block from trade.html so the
// assertions run against the real RoofReportCore, not a copy.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
const startMark = '// <trade-roof-report>';
const endMark = '// </trade-roof-report>';
const start = html.indexOf(startMark);
const end = html.indexOf(endMark, start + startMark.length);
assert(start !== -1 && end !== -1 && end > start, 'trade-roof-report sentinels exist');
const block = html.slice(start, end + endMark.length);

const context = {};
vm.createContext(context);
vm.runInContext(block, context);
const R = context.RoofReportCore;
assert(R, 'RoofReportCore is exported from the shipped block');

let passed = 0;
function check(name, cond) { assert(cond, name); passed += 1; }

// The server template shape (projectRoofReportTemplate, allocated tier: no fee).
const TPL = {
  template: {
    version: 1,
    pack_kind: 'roof',
    sections: [
      { key: 'inspection', title: 'Inspection Details' },
      { key: 'property', title: 'Property Details' },
      { key: 'findings', title: 'Roof Findings' },
      { key: 'photos', title: 'Photo Evidence' },
    ],
    fields: [
      { key: 'inspection_date', label: 'Date of inspection', type: 'date', section: 'inspection', required: true },
      { key: 'inspected_by', label: 'Inspected by', type: 'text', section: 'inspection', required: true, placeholder: 'Trade / inspector name' },
      { key: 'weather', label: 'Weather at time of inspection', type: 'select', section: 'inspection', options: ['Sunny / Fine', 'Overcast'] },
      { key: 'storeys', label: 'Number of storeys', type: 'select', section: 'property', required: true, options: ['Single Storey', 'Double Storey'], help: 'Single Storey or Double Storey as observed on site.' },
      { key: 'water_leak', label: 'Water leak through the roof', type: 'toggle', section: 'findings' },
      { key: 'overall_findings', label: 'Roof condition and findings', type: 'textarea', section: 'findings' },
      { key: 'photos', label: 'Photo evidence', type: 'photos', section: 'photos' },
    ],
    pricing: { storey_field: 'storeys' },
  },
  job: { id: 'j1', job_number: 'SWMS-261386' },
  draft: null,
};

// ── state ──
check('no draft -> none', R.stateOf(TPL).status === 'none');
check('draft -> draft with fields', R.stateOf({ draft: { status: 'draft', fields_json: { storeys: 'Single Storey' } } }).fields.storeys === 'Single Storey');
const sub = R.stateOf({ draft: { status: 'submitted', report_doc_id: 'doc-9', submitted_at: '2026-09-08T01:00:00Z' } });
check('submitted -> submitted + doc id', sub.status === 'submitted' && sub.docId === 'doc-9');

// ── form ──
const form = R.formHTML(TPL, { inspected_by: 'Hugo <b>', water_leak: true }, { photoCount: 4, savedLabel: 'Draft restored' });
check('form renders every section kicker', /Inspection Details/.test(form) && /Roof Findings/.test(form) && /Photo Evidence/.test(form));
check('required fields are starred', /Date of inspection <span class="rr-req">\*<\/span>/.test(form));
check('text value is escaped', form.indexOf('value="Hugo &lt;b&gt;"') !== -1);
check('select carries the server options', form.indexOf('<option value="Double Storey">Double Storey</option>') !== -1);
check('toggle restores a boolean as Yes', /data-rr-field="water_leak"[^>]*data-value="yes"/.test(form));
check('photos type is a count + Add photos, not an input', form.indexOf('id="rrPhotoCount">4<') !== -1 && form.indexOf('data-rr-field="photos"') === -1);
check('no fee or dollar sign reaches the trade form', form.indexOf('$') === -1);
check('brand is SecureWorks Group, never WA', form.indexOf('SecureWorks Group') !== -1 && form.indexOf('SecureWorks WA') === -1);
check('no em dash in trade copy', form.indexOf('—') === -1);
check('saved label shown', form.indexOf('Draft restored') !== -1);
check('form says the words go onto the PDF verbatim', /data-rr-verbatim/.test(form) && /Word for word/.test(form));

// ── collect (fake DOM) ──
function fakeRoot(entries) {
  return {
    querySelectorAll: function () {
      return entries.map(function (e) {
        return {
          value: e.value,
          getAttribute: function (a) {
            if (a === 'data-rr-field') return e.key;
            if (a === 'data-rr-type') return e.toggle ? 'toggle' : null;
            if (a === 'data-value') return e.value;
            return null;
          },
        };
      });
    },
  };
}
const got = R.collect(fakeRoot([
  { key: 'inspected_by', value: '  Hugo  ' },
  { key: 'weather', value: '' },
  { key: 'water_leak', value: 'no', toggle: true },
  { key: 'storm_openings', value: '', toggle: true },
  { key: 'storeys', value: 'Single Storey' },
]));
check('collect trims text', got.inspected_by === 'Hugo');
check('collect omits blanks', !('weather' in got) && !('storm_openings' in got));
check('collect turns toggles into booleans', got.water_leak === false);
check('collect on null root is empty', Object.keys(R.collect(null)).length === 0);

// ── validate ──
check('validate lists every missing required field', R.validate(TPL, { inspected_by: 'Hugo' }).join('|') === 'Date of inspection is required|Number of storeys is required');
check('validate passes a full fill', R.validate(TPL, { inspection_date: '2026-09-08', inspected_by: 'Hugo', storeys: 'Single Storey' }).length === 0);

// ── option card ──
const start1 = R.optionHTML({ status: 'none' }, 'j1', {});
check('start card offers Start roof report', start1.indexOf('Start roof report') !== -1 && start1.indexOf("rrOpen('j1')") !== -1);
check('draft card offers Continue', R.optionHTML({ status: 'draft' }, 'j1', {}).indexOf('Continue roof report') !== -1);
const done1 = R.optionHTML({ status: 'submitted' }, 'j1', { when: '2 min ago', docUrl: 'https://x/roof.pdf' });
check('submitted card shows the PDF link', done1.indexOf('Roof report submitted') !== -1 && done1.indexOf('href="https://x/roof.pdf"') !== -1);
check('submitted card without a doc explains where it lands', R.optionHTML({ status: 'submitted' }, 'j1', {}).indexOf('Files') !== -1);
check('submitted card offers Rebuild PDF with the photo count', /data-rr-rebuild/.test(done1) && R.optionHTML({ status: 'submitted' }, 'j1', { photoCount: 137 }).indexOf('(137)') !== -1);
check('option copy escapes', R.optionHTML({ status: 'none' }, "j'1", { title: '<x>' }).indexOf('&lt;x&gt;') !== -1);

// ── hours ──
// Hours are never typed: the row asks for the date worked, start and finish.
const hrs = R.hoursHTML('j1', null, { entry: { work_date: '2026-09-08', start_time: '07:00', finish_time: '', break_minutes: 0 }, maxDate: '2026-09-08' });
check('hours row asks for date, start, finish and break', ['rrHoursDate', 'rrHoursStart', 'rrHoursFinish', 'rrHoursBreak'].every(function (id) { return hrs.indexOf('id="' + id + '"') !== -1; }));
check('hours row has no typed hours field and no hour chips', hrs.indexOf('rrHoursInput') === -1 && hrs.indexOf('data-rr-hour=') === -1);
const blank = R.hoursHTML('j1', null, { maxDate: '2026-09-08' });
check('hours row opens with no date, start or finish, capped at today', blank.indexOf('type="date" id="rrHoursDate" value="" max="2026-09-08"') !== -1 && blank.indexOf('id="rrHoursStart" value=""') !== -1 && blank.indexOf('id="rrHoursFinish" value=""') !== -1);
check('an empty hours row says the times are recorded against the job and the invoice still asks', blank.indexOf('They are recorded against this job. Your Weekly Invoice will still ask for the times you worked.') !== -1 && blank.indexOf('invoice.') === -1 && />Save times<\/button>/.test(blank));
check('hours row shows the entry it is given, capped at today', hrs.indexOf('type="date" id="rrHoursDate" value="2026-09-08" max="2026-09-08"') !== -1 && hrs.indexOf('id="rrHoursStart" value="07:00"') !== -1);
check('hours are shown read-only and saved through rrLogHours', /id="rrHoursCalc"[^>]*>0 hrs</.test(hrs) && hrs.indexOf("rrLogHours('j1')") !== -1);
const hrs2 = R.hoursHTML('j1', 2, { week: 'w/e Sun 13 Sep', when: 'Tue 8 Sep, 07:00 to 09:00', hoursText: '2 hrs', entry: { work_date: '2026-09-08', start_time: '07:00', finish_time: '09:00', break_minutes: 0 } });
check('logged hours are recorded against the job, name the week and when, and do not promise the invoice', hrs2.indexOf('data-rr-hours-current="2"') !== -1 && hrs2.indexOf('<strong>2 hrs</strong> recorded against this job (w/e Sun 13 Sep). Tue 8 Sep, 07:00 to 09:00. Change the times and save to change it. Your Weekly Invoice will still ask for the times you worked.') !== -1 && hrs2.indexOf('on your week') === -1);
check('logged hours with no times to show say how to change them', R.hoursHTML('j1', 2.5, {}).indexOf('<strong>2.5 hrs</strong> recorded against this job. Save new times to change it. Your Weekly Invoice will still ask for the times you worked.') !== -1);
check('hoursLabel singular/plural', R.hoursLabel(1) === '1 hr' && R.hoursLabel(2) === '2 hrs' && R.hoursLabel(1.25) === '1.25 hrs');
check('weekLabel names the Sunday', /^w\/e Sun/.test(R.weekLabel('2026-09-13')) && R.weekLabel('nope') === '');

// ── response shapes ──
check('isOk accepts ok/success/submitted', R.isOk({ ok: true }) && R.isOk({ status: 'submitted' }) && !R.isOk({}) && !R.isOk(null));

console.log('trade-roof-report: ' + passed + ' checks passed');
