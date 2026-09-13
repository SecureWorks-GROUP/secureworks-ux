/* Shared Workflow Refresh control. UI may start and read a durable run.
   Operators cannot claim or finish. Unregistered drivers stay unavailable.
   A source-hash reread is not completed Refresh. */
(function (root) {
  'use strict';
  const VERSION = 'ops-workflow-refresh/v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const state = { runs: Object.create(null) };

  function label(run) {
    if (!run) return 'Workflow Refresh has not been requested.';
    if (run.capability === 'pending') return run.reason || 'Shared Refresh door is not on this host yet. Evidence re-read remains a separate control.';
    if (run.outcome === 'unavailable' || run.capability === 'unavailable') {
      return `Workflow Refresh unavailable: ${esc(run.reason || 'driver_not_registered')}. Pending until the domain driver is registered and produces ${esc(run.declared_output || 'its declared output')}.`;
    }
    const status = run.status || run.outcome || 'unread';
    const cutoff = run.source_cutoff ? ` · source cutoff ${esc(run.source_cutoff)}` : '';
    return `Workflow Refresh ${esc(status)}${cutoff}.`;
  }

  function html(workflow, run) {
    const current = run || state.runs[workflow];
    const pending = !current || current.capability === 'pending' || current.outcome === 'unavailable' || current.capability === 'unavailable';
    return `<div class="ops-workflow-refresh" data-workflow-refresh="${esc(workflow)}" data-capability="${esc((current && current.capability) || (pending ? 'pending' : 'connected'))}">
      <button type="button" data-action="workflow-refresh" data-workflow="${esc(workflow)}">Workflow Refresh</button>
      <p class="dp-small" role="status">${label(current)}</p>
    </div>`;
  }

  async function start(workflow, scope) {
    if (typeof root.opsPost !== 'function') {
      const run = { capability: 'pending', reason: 'Authenticated Ops write is not available.', workflow };
      state.runs[workflow] = run;
      return run;
    }
    try {
      const result = await root.opsPost('workflow_refresh', { op: 'start', workflow, scope: scope || {} });
      if (result && result.lease_token) throw new Error('Refresh readback exposed a lease token.');
      const run = {
        capability: result && result.outcome === 'unavailable' ? 'unavailable' : 'connected',
        ...result,
        workflow
      };
      state.runs[workflow] = run;
      if (run.id && run.outcome !== 'unavailable') await readback(workflow, run.id);
      return state.runs[workflow];
    } catch (error) {
      const pending = error && (error.status === 404 || /unknown|not connected|Unknown Dispatch/i.test(String(error.message)));
      const run = {
        capability: pending ? 'pending' : 'failed',
        reason: error && error.message || 'Workflow Refresh unread.',
        workflow
      };
      state.runs[workflow] = run;
      return run;
    }
  }

  async function readback(workflow, id) {
    if (typeof root.opsPost !== 'function' || !id) return state.runs[workflow];
    const result = await root.opsPost('workflow_refresh', { op: 'readback', id, workflow });
    if (result && result.lease_token) throw new Error('Refresh readback exposed a lease token.');
    state.runs[workflow] = { capability: 'connected', ...result, workflow };
    return state.runs[workflow];
  }

  root.OpsWorkflowRefresh = {
    version: VERSION,
    html,
    label,
    start,
    readback,
    state: () => state.runs
  };
})(typeof window !== 'undefined' ? window : globalThis);
