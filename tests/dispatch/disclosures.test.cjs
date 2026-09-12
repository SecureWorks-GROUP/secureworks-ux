const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace } = require('./workspace-harness.cjs');

test('open History search survives refresh with its text and focus', async () => {
  const ui = await workspace();
  await ui.click('tab', 'email');
  await ui.click('new-draft');
  ui.detail('history').open = true;
  ui.input('mail-search', { scope: 'all', search: 'Original supplier evidence' });
  const focus = ui.focusControl('mail-search', 'search', 3, 9);
  await ui.tick();
  assert.equal(ui.detail('history').open, true);
  assert.equal(focus.focused, true);
  assert.equal(focus.selectionStart, 3);
  assert.equal(focus.selectionEnd, 9);
  assert.match(ui.host.innerHTML, /value="Original supplier evidence"/);
});

test('disclosures retain separate job state through navigation and refresh', async () => {
  const ui = await workspace();
  ui.records.a.job.scope_json = { runs: { length: 12 } };
  ui.records.b.job.scope_json = { runs: { length: 3 } };
  await ui.core.load('a');
  ui.detail('scope').open = false;
  ui.detail('context').open = true;
  await ui.click('select', 'b');
  assert.equal(ui.detail('scope').open, true);
  assert.equal(ui.detail('context').open, false);
  await ui.click('select', 'a');
  assert.equal(ui.detail('scope').open, false);
  assert.equal(ui.detail('context').open, true);
  await ui.tick();
  assert.equal(ui.detail('context').open, true);
  await ui.click('tab', 'email');
  ui.detail('history').open = false;
  await ui.click('tab', 'scope');
  assert.equal(ui.detail('context').open, true);
  await ui.click('tab', 'email');
  assert.equal(ui.detail('history').open, false);
});
