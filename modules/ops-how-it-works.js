/* Shared How it works overlay for Dispatch, Debt, SES, Booking and Performance. */
(function (root) {
  'use strict';
  const VERSION = 'ops-how-it-works/v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let openWorkflow = null, lastFocus = null, host = null, runtime = null, runtimeError = null, loading = false, requestGeneration = 0, loadedContract = root.OPS_HOW_IT_WORKS_CONTRACT || null;

  function contract() {
    return loadedContract || { definition_version: VERSION, workflows: {} };
  }
  function definition(id) {
    return contract().workflows[id] || { title: id, definition_status: 'unknown', business: [], technical: {} };
  }
  function iconSvg() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9a2.5 2.5 0 1 1 3.9 2.1c-.8.5-1.4 1.1-1.4 2.1V14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>';
  }
  function iconButton(id) {
    const title = definition(id).title || id;
    return `<button type="button" class="ops-how-it-works-icon" data-how-it-works="${esc(id)}" aria-haspopup="dialog" aria-expanded="${openWorkflow === id ? 'true' : 'false'}" aria-label="How ${esc(title)} works">${iconSvg()}</button>`;
  }
  function mismatch(def, live) {
    if (!live) return def.definition_status === 'reviewed_local' ? 'Runtime unread' : 'Domain definition pending';
    if (live.worker && live.worker.mismatch) return 'Intended worker enablement disagrees with observed runtime';
    if (live.definition_version && def.skill_version && live.definition_version !== def.skill_version) {
      return `Definition ${def.skill_version} describes code ${live.definition_version}`;
    }
    return null;
  }
  function render() {
    if (!host) return;
    if (!openWorkflow) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    const def = definition(openWorkflow);
    const live = runtime;
    const notice = runtimeError || mismatch(def, live);
    const tech = def.technical || {};
    const worker = live && live.worker || {};
    host.hidden = false;
    host.innerHTML = `<div class="ops-how-it-works-scrim" data-how-it-works-close="1"></div>
      <div class="ops-how-it-works-panel" role="dialog" aria-modal="true" aria-labelledby="opsHowItWorksTitle" tabindex="-1">
        <div class="ops-how-it-works-head">
          <div>
            <h2 id="opsHowItWorksTitle">How ${esc(def.title)} works</h2>
            <p>${esc(contract().definition_version)} · ${esc(def.definition_status.replaceAll('_', ' '))}</p>
          </div>
          <button type="button" class="ops-how-it-works-close" data-how-it-works-close="1">Close</button>
        </div>
        ${notice ? `<p class="ops-how-it-works-notice" role="status">${esc(notice)}</p>` : ''}
        <div class="ops-how-it-works-grid">
          <section aria-labelledby="opsHowItWorksBusiness">
            <h3 id="opsHowItWorksBusiness">Business process</h3>
            <ol>${(def.business || []).map(step => `<li>${esc(step)}</li>`).join('') || '<li>Domain definition pending.</li>'}</ol>
          </section>
          <section aria-labelledby="opsHowItWorksTechnical">
            <h3 id="opsHowItWorksTechnical">Technical implementation</h3>
            <dl>
              <dt>Skill</dt><dd>${esc(def.skill_path || 'No dedicated skill yet')}</dd>
              <dt>Page</dt><dd>${esc(tech.page || 'Unspecified')}</dd>
              <dt>Manual command</dt><dd><code>${esc(tech.manual_command || worker.manual_command || 'Unavailable')}</code></dd>
              <dt>Runtime owner</dt><dd>${esc(def.owner || 'Unspecified')}</dd>
              <dt>Cloud / trigger</dt><dd>${esc(tech.cloud || 'Unread')}</dd>
              <dt>Enabled</dt><dd>${esc((def.runtime_receipt && def.runtime_receipt.enabled) || (live ? (worker.intended_enabled ? 'enabled' : 'disabled') : 'unread'))}</dd>
              <dt>Deployed</dt><dd>${esc((def.runtime_receipt && def.runtime_receipt.deployed) || 'unread')}</dd>
              <dt>Observed successful</dt><dd>${esc((def.runtime_receipt && def.runtime_receipt.observed_successful) || (live && live.latest_task && live.latest_task.status === 'done' ? 'Last captured task is done' : 'No successful worker result captured'))}</dd>
              <dt>Worker intended</dt><dd>${live ? (worker.intended_enabled ? 'enabled' : 'disabled') : 'unread'}</dd>
              <dt>Worker observed</dt><dd>${live ? (worker.observed_enabled ? 'enabled' : 'disabled') : 'unread'}${worker.schedule_installed === false ? ' · no scheduler installed' : ''}</dd>
              <dt>Latest attempt</dt><dd>${live && live.latest_task ? esc(`${live.latest_task.status || 'unknown'} · job ${live.latest_task.job_id || 'unspecified'}`) : 'None captured / unread'}</dd>
              <dt>Coverage</dt><dd>${live && live.coverage ? `tasks ${live.coverage.tasks_complete ? 'complete' : 'partial'}; source failures ${live.coverage.source_failures_complete ? 'complete' : 'partial'}` : 'Unread'}</dd>
            </dl>
          </section>
        </div>
      </div>`;
    host.querySelector('.ops-how-it-works-panel')?.focus();
  }
  function ensureHost() {
    if (host && host.isConnected !== false) return host;
    host = document.getElementById('opsHowItWorks');
    if (!host) {
      host = document.createElement('div');
      host.id = 'opsHowItWorks';
      host.className = 'ops-how-it-works';
      host.hidden = true;
      (document.body || document.documentElement).appendChild(host);
    }
    if (!host.dataset.bound) {
      host.addEventListener('click', event => {
        if (event.target.closest('[data-how-it-works-close]')) close();
      });
      host.dataset.bound = '1';
    }
    return host;
  }
  async function ensureContract() {
    if (loadedContract) return;
    if (typeof root.fetch !== 'function') return;
    try {
      loadedContract = await (await root.fetch('modules/ops-how-it-works-contract.json')).json();
    } catch (_) {
      loadedContract = { definition_version: VERSION, workflows: {} };
    }
  }
  async function loadRuntime(id, generation) {
    await ensureContract();
    if (generation !== requestGeneration || openWorkflow !== id) return;
    if (id !== 'dispatch' || typeof root.opsFetch !== 'function') {
      if (id !== 'dispatch') runtimeError = 'Domain runtime adapter pending. Intended behaviour is shown; live status is unread.';
      loading = false; render(); return;
    }
    try {
      const nextRuntime = await root.opsFetch('dispatch_workflow', {});
      if (generation !== requestGeneration || openWorkflow !== id) return;
      runtime = nextRuntime;
      if (root.SW_AUTH_GATE?.identity && !root.SW_AUTH_GATE.identity()) throw new Error('Dispatch identity changed. Sign in and read the current workspace.');
    } catch (error) {
      if (generation !== requestGeneration || openWorkflow !== id) return;
      runtime = null;
      runtimeError = error.message || 'Dispatch runtime unread';
    }
    loading = false;
    render();
  }
  function open(id) {
    ensureHost();
    lastFocus = document.activeElement;
    openWorkflow = id;
    const generation = ++requestGeneration;
    runtime = null;
    runtimeError = null;
    loading = true;
    render();
    return loadRuntime(id, generation);
  }
  function close() {
    requestGeneration++;
    openWorkflow = null;
    runtime = null;
    runtimeError = null;
    render();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }
  function onDocumentClick(event) {
    const button = event.target.closest('[data-how-it-works]');
    if (!button) return;
    event.preventDefault();
    open(button.dataset.howItWorks);
  }
  function onKey(event) {
    if (event.key === 'Escape' && openWorkflow) {
      event.stopPropagation();
      close();
    }
  }
  function onIdentity() {
    if (openWorkflow) close();
  }
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKey, true);
  root.addEventListener?.('sw:auth-identity', onIdentity);
  root.addEventListener?.('sw:auth-locked', onIdentity);

  root.OpsHowItWorks = {
    version: VERSION,
    iconButton,
    open,
    close,
    isOpen: () => openWorkflow,
    definition,
    attach(element, id) {
      if (!element || element.querySelector(`[data-how-it-works="${id}"]`)) return;
      element.insertAdjacentHTML('beforeend', iconButton(id));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
