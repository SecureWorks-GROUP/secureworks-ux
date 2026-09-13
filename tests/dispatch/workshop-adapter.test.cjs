const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace } = require('./workspace-harness.cjs');

test('selecting a job reads dispatch_job_workshop without requiring an AI assessor', async () => {
  const reads = [];
  const ui = await workspace({
    get: async (action, params) => {
      reads.push({ action, params });
      if (action === 'dispatch_job_workshop') {
        return {
          job_id: params.job_id,
          job: { id: params.job_id, job_number: 'CIO-WORKSHOP-1', status: 'accepted' },
          grounding: {
            plan_version: 1,
            groups: [{ id: 'g1', label: 'posts' }, { id: 'g2', label: 'rails' }],
            requirements: [{ id: 'r1', group_id: 'g1', qty: 12 }, { id: 'r2', group_id: 'g2', qty: 8 }],
            notes: [{ id: 'n1', text: 'Need extra rails' }],
            order_drafts: []
          },
          documents: [{ id: 'd1', type: 'supplier_quote', file_name: 'accepted-quote.pdf' }],
          communications: { messages: [{ event_id: 'ev-a' }, { event_id: 'ev-b' }] },
          source_revision: 'src-1',
          ai_assessor_required: false,
          source_reload_is_not_assessment: true
        };
      }
    }
  });
  await ui.click('select', 'a');
  assert.ok(reads.some(r => r.action === 'dispatch_job_workshop' && r.params.job_id === 'a'));
  const record = ui.core.state.records.get('a');
  assert.equal(record.ai_assessor_required, false);
  assert.equal(record.source_reload_is_not_assessment, true);
  assert.equal(record.groups.length, 2);
  assert.equal(record.notes[0].text, 'Need extra rails');
  assert.equal(record.documents.length, 1);
  assert.equal(record.communications.length, 2);
  assert.match(ui.host.innerHTML, /Need extra rails|Job grounding|optional-ai/);
});

test('optional PO filter is forwarded on workshop read', async () => {
  const reads = [];
  const ui = await workspace({
    get: async (action, params) => {
      reads.push({ action, params });
      if (action === 'dispatch_job_workshop') {
        return {
          job: { id: params.job_id, job_number: 'CIO-WORKSHOP-1', status: 'accepted' },
          grounding: { plan_version: 1, groups: [{ id: 'g1' }], requirements: [], notes: [] },
          communications: { messages: params.po_id ? [{ event_id: 'ev-a' }] : [{ event_id: 'ev-a' }, { event_id: 'ev-b' }] },
          ai_assessor_required: false,
          source_reload_is_not_assessment: true
        };
      }
    }
  });
  ui.core.loadWorkshop = ui.core.load;
  await ui.core.select('a');
  const workshopReads = reads.filter(r => r.action === 'dispatch_job_workshop');
  assert.ok(workshopReads.length >= 1);
  assert.equal(workshopReads[0].params.po_id, undefined);
});
