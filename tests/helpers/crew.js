// Helpers for the SecureWorks Crew specs. The app runs on its own in-browser
// demo server (?demo), so these specs make no network calls at all.
const NOW = '2026-11-13T09:00:00+08:00'; // a Friday, so the demo week has past days in it

function crewUrl(hash = '#/today', persona = 'crew') {
  return `/crew/?demo=${persona}&now=${encodeURIComponent(NOW)}${hash}`;
}

/** Fail the test on any console error or uncaught page error. */
function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e && e.message)));
  return errors;
}

/** Drag the slide-to-confirm knob across. */
async function slide(page) {
  const track = page.locator('.slide').first();
  await track.waitFor();
  const box = await track.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };

module.exports = { crewUrl, watchErrors, slide, PHONE, NOW };
