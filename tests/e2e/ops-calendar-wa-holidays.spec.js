// Ops Dash calendar: WA public holidays worked out in code.
// Search <wa-public-holidays> in ops.html.
//
// Pure node spec: it READS ../../ops.html, extracts the code between
// `// <wa-public-holidays>` and `// </wa-public-holidays>` and runs the REAL
// WaHolidaysCore, so the rules are never re-declared here. The expected lists
// are the official WA lists (wa.gov.au "Public holidays in Western Australia"
// for 2026 and 2027, and the archived lists for 2021 to 2025), metropolitan
// King's Birthday. Nothing here compares against "today", so it cannot date-rot.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const OPS_HTML = resolve(__dirname, '../../ops.html');
const OPEN = '// <wa-public-holidays>';
const CLOSE = '// </wa-public-holidays>';

function extractCore() {
  const html = readFileSync(OPS_HTML, 'utf8');
  const a = html.indexOf(OPEN);
  const b = html.indexOf(CLOSE);
  if (a < 0 || b < 0 || b <= a) throw new Error(`wa-public-holidays sentinels not found in ${OPS_HTML}`);
  // eslint-disable-next-line no-new-func
  return new Function(html.slice(a + OPEN.length, b) + '\n;return WaHolidaysCore;')();
}

const C = extractCore();
const dates = (y) => C.forYear(y).map((h) => h.date);

const OFFICIAL = {
  2021: ['2021-01-01', '2021-01-26', '2021-03-01', '2021-04-02', '2021-04-05', '2021-04-25', '2021-04-26', '2021-06-07', '2021-09-27', '2021-12-25', '2021-12-26', '2021-12-27', '2021-12-28'],
  2022: ['2022-01-01', '2022-01-03', '2022-01-26', '2022-03-07', '2022-04-15', '2022-04-17', '2022-04-18', '2022-04-25', '2022-06-06', '2022-09-22', '2022-09-26', '2022-12-25', '2022-12-26', '2022-12-27'],
  2023: ['2023-01-01', '2023-01-02', '2023-01-26', '2023-03-06', '2023-04-07', '2023-04-09', '2023-04-10', '2023-04-25', '2023-06-05', '2023-09-25', '2023-12-25', '2023-12-26'],
  2024: ['2024-01-01', '2024-01-26', '2024-03-04', '2024-03-29', '2024-03-31', '2024-04-01', '2024-04-25', '2024-06-03', '2024-09-23', '2024-12-25', '2024-12-26'],
  2025: ['2025-01-01', '2025-01-27', '2025-03-03', '2025-04-18', '2025-04-20', '2025-04-21', '2025-04-25', '2025-06-02', '2025-09-29', '2025-12-25', '2025-12-26'],
  2026: ['2026-01-01', '2026-01-26', '2026-03-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-04-25', '2026-04-27', '2026-06-01', '2026-09-28', '2026-12-25', '2026-12-26', '2026-12-28'],
  2027: ['2027-01-01', '2027-01-26', '2027-03-01', '2027-03-26', '2027-03-28', '2027-03-29', '2027-04-25', '2027-04-26', '2027-06-07', '2027-09-27', '2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28'],
};

test.describe('WA public holidays (extracted from ops.html)', () => {
  for (const y of Object.keys(OFFICIAL)) {
    test(`${y} matches the official WA list`, () => {
      expect(dates(Number(y))).toEqual(OFFICIAL[y]);
    });
  }

  test('weekend days name the additional Monday or Tuesday', () => {
    const t = Object.fromEntries(C.forYear(2027).map((h) => [h.date, h.title]));
    expect(t['2027-04-26']).toBe('Anzac Day (additional day)');
    expect(t['2027-12-27']).toBe('Christmas Day (additional day)');
    expect(t['2027-12-28']).toBe('Boxing Day (additional day)');
    // Australia Day on a Sunday moves to the Monday; the Sunday is not a holiday
    const t25 = Object.fromEntries(C.forYear(2025).map((h) => [h.date, h.title]));
    expect(t25['2025-01-27']).toBe('Australia Day');
    expect(t25['2025-01-26']).toBeUndefined();
  });

  test('Easter Sunday only from 2022, and a later year still works out', () => {
    expect(C.forYear(2021).some((h) => h.title === 'Easter Sunday')).toBe(false);
    const y2030 = C.forYear(2030);
    expect(y2030.find((h) => h.title === 'Easter Sunday').date).toBe('2030-04-21');
    expect(y2030.find((h) => h.title === "King's Birthday").date).toBe('2030-09-30');
    expect(y2030.find((h) => h.title === 'Western Australia Day').date).toBe('2030-06-03');
  });

  test('a year it cannot read gives nothing rather than a guess', () => {
    expect(C.forYear('nope')).toEqual([]);
    expect(C.forYear(undefined)).toEqual([]);
  });
});
