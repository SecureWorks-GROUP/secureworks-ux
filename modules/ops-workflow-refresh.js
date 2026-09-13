/* Shared Workflow Refresh control. UI may start and read a durable run.
   Operators cannot claim or finish. Unregistered drivers stay unavailable.
   A source-hash reread is not completed Refresh. */
(function (root) {
  'use strict';
  const VERSION = 'ops-workflow-refresh/v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function label(run) {
    if (!run) return 'Workflow Refresh has not been requested.';
    if (run.capability === 'pending') return esc(run.reason || 'Shared Refresh door is not on this host yet. Evidence re-read remains a separate control.');
    if (run.capability === 'failed') return `Workflow Refresh failed: ${esc(run.reason || 'Workflow Refresh unread.')}.`;
    if (run.outcome === 'unavailable' || run.capability === 'unavailable') {
      return `Workflow Refresh unavailable: ${esc(run.reason || 'driver_not_registered')}. Pending until the domain driver is registered and produces ${esc(run.declared_output || 'its declared output')}.`;
    }
    const status = run.status || run.outcome || 'unread';
    const cutoff = run.source_cutoff ? ` · source cutoff ${esc(run.source_cutoff)}` : '';
    return `Workflow Refresh ${esc(status)}${cutoff}.`;
  }

  function html(workflow, current) {
    const pending = !current || current.capability === 'pending' || current.outcome === 'unavailable' || current.capability === 'unavailable';
    return `<div class="ops-workflow-refresh" data-workflow-refresh="${esc(workflow)}" data-capability="${esc((current && current.capability) || (pending ? 'pending' : 'connected'))}">
      <button type="button" data-action="workflow-refresh" data-workflow="${esc(workflow)}">Workflow Refresh</button>
      <p class="dp-small" role="status">${label(current)}</p>
    </div>`;
  }

  async function start(workflow, scope, { assertIdentity }) {
    assertIdentity();
    if (workflow === 'debt') {
      return {
        capability: 'unavailable',
        outcome: 'unavailable',
        reason: 'debt_cannot_register; start(debt) unavailable until CIO debt_source_v1. Picture GET only. JWT must not call record_workflow_refresh_receipt. ea0beae5 is not completion-safe Refresh.',
        declared_output: 'debt_source_v1',
        workflow
      };
    }
    if (typeof root.opsPost !== 'function') {
      return { capability: 'pending', reason: 'Authenticated Ops write is not available.', workflow };
    }
    try {
      const result = await root.opsPost('workflow_refresh', { op: 'start', workflow, scope }, { assertIdentity });
      if (result && (result.op === 'record_workflow_refresh_receipt' || result.called === 'record_workflow_refresh_receipt')) {
        throw new Error('JWT must not call record_workflow_refresh_receipt.');
      }
      assertIdentity();
      if (result && result.lease_token) throw new Error('Refresh readback exposed a lease token.');
      let run = {
        capability: result && result.outcome === 'unavailable' ? 'unavailable' : 'connected',
        ...result,
        workflow
      };
      if (run.id && run.outcome !== 'unavailable') {
        const result = await root.opsPost('workflow_refresh', { op: 'readback', id: run.id, workflow }, { assertIdentity });
        assertIdentity();
        if (result && result.lease_token) throw new Error('Refresh readback exposed a lease token.');
        run = { capability: 'connected', ...result, workflow };
      }
      return run;
    } catch (error) {
      assertIdentity();
      const pending = error && (error.status === 404 || /unknown|not connected|Unknown Dispatch/i.test(String(error.message)));
      const run = {
        capability: pending ? 'pending' : 'failed',
        reason: error && error.message || 'Workflow Refresh unread.',
        workflow
      };
      return run;
    }
  }

  root.OpsWorkflowRefresh = {
    version: VERSION,
    html,
    label,
    start
  };
})(typeof window !== 'undefined' ? window : globalThis);
