/* Shared Dispatch data custody. No provider actions or sample-data fallback. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DispatchCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const uuid = () => globalThis.crypto.randomUUID();
  function create(options) {
    const state = { jobs: [], coverage: null, selectedId: null, jobsLoading: false, error: null,
      supply: { lots: [], coverage: {}, errors: {} }, executions: new Map(), records: new Map(), editors: new Map(), pending: new Map(), errors: new Map(),
      calendar: { events: [], undated: [], coverage: null }, calendarRange: null, layers: { staff: true, materials: true, logistics: true } };
    const listeners = new Set();
    let listGeneration = 0, calendarGeneration = 0;
    const recordGeneration = new Map();
    const executionGeneration = new Map();
    const emit = () => listeners.forEach(listener => listener(state));
    function accept(record, id) {
      if (!record || record.job?.id !== id || !Number.isInteger(record.version)) throw new Error('Invalid Dispatch response; work remains unchanged.');
      const current = state.records.get(id);
      if (!current || record.version >= current.version) state.records.set(id, record);
      return record;
    }
    async function list() {
      const generation = ++listGeneration;
      state.jobsLoading = true; state.error = null; emit();
      const jobs = new Map(), cursors = new Set();
      let cursor, coverage;
      try {
        do {
          const result = await options.get('dispatch_list', { limit: 100, ...(cursor ? { cursor } : {}) });
          if (generation !== listGeneration) return;
          if (!Array.isArray(result.jobs)) throw new Error('Dispatch population is unavailable.');
          result.jobs.forEach(job => jobs.set(job.id, job));
          coverage = result.coverage;
          cursor = result.next_cursor;
          if (cursor && cursors.has(cursor)) throw new Error('Repeated population cursor; coverage is incomplete.');
          if (cursor) cursors.add(cursor);
          state.jobs = [...jobs.values()]; state.coverage = { ...coverage, complete: !cursor && coverage?.complete === true, has_more: !!cursor }; emit();
        } while (cursor);
      } catch (error) {
        if (generation === listGeneration) { state.error = error.message; state.coverage = { ...coverage, complete: false }; }
      } finally {
        if (generation === listGeneration) { state.jobsLoading = false; emit(); }
      }
      if (!state.selectedId && state.jobs.length) await select(state.jobs[0].id);
    }
    async function load(id) {
      const generation = (recordGeneration.get(id) || 0) + 1;
      recordGeneration.set(id, generation); state.errors.delete(id); emit();
      try {
        const record = await options.get('dispatch_job', { job_id: id });
        if (generation === recordGeneration.get(id)) accept(record, id);
        return record;
      } catch (error) { if (generation === recordGeneration.get(id)) state.errors.set(id, error.message); throw error; }
      finally { emit(); }
    }
    async function select(id) {
      state.selectedId = id; emit();
      try { return await load(id); } catch (_) { return null; }
    }
    function edit(id, key, value) {
      if (!state.editors.has(id)) state.editors.set(id, new Map());
      state.editors.get(id).set(key, copy(value));
    }
    function editor(id, key) { return state.editors.get(id)?.get(key); }
    function clearEditor(id, key, expected) {
      const current = editor(id, key);
      if (expected === undefined || JSON.stringify(current) === JSON.stringify(expected)) state.editors.get(id)?.delete(key);
    }
    async function execute(id, envelope, action) {
      const pending = state.pending.get(id);
      if (pending?.running) throw new Error('A Dispatch change is still being checked.');
      state.pending.set(id, { envelope, action, running: true }); state.errors.delete(id); emit();
      try {
        const result = await options.post(action, envelope);
        // A committed command is followed by a fresh server read. A failed read keeps the
        // exact request identity for safe retry; it never repeats a new command blindly.
        const record = result?.job ? result : await options.get('dispatch_job', { job_id: id });
        accept(record, id); state.pending.delete(id); emit(); return record;
      } catch (error) {
        const conflict = error.status === 409 || error.code === 'version_conflict';
        // A definite validation/authority refusal did not commit. Let the operator
        // correct the retained editor instead of trapping an invalid request in retry.
        if ([400, 401, 403, 404, 422].includes(error.status)) state.pending.delete(id);
        else state.pending.set(id, { envelope, action, running: false, conflict });
        state.errors.set(id, error.message); emit(); throw error;
      }
    }
    async function command(id, commandName, payload, action = 'dispatch_command') {
      if (state.pending.has(id)) throw new Error('Resolve the previous change before making another one.');
      const record = state.records.get(id);
      if (!record) throw new Error('Read this job before changing its plan.');
      return execute(id, { job_id: id, expected_version: record.version, source_version: record.source_version,
        request_id: (options.id || uuid)(), command: commandName, payload: copy(payload) }, action);
    }
    async function retry(id) {
      const pending = state.pending.get(id);
      if (!pending || pending.conflict) throw new Error('Reload and review the changed sources before preparing a new change.');
      return execute(id, pending.envelope, pending.action);
    }
    async function resolveConflict(id) {
      const pending = state.pending.get(id);
      if (!pending?.conflict) throw new Error('An uncertain write must be retried with its original identity.');
      await load(id); state.pending.delete(id); emit();
    }
    async function calendar(from, to) {
      const generation = ++calendarGeneration;
      state.calendarRange = { from, to };
      try {
        const result = await options.get('dispatch_calendar', { from, to });
        if (generation === calendarGeneration) state.calendar = { ...result, error: null };
      } catch (error) {
        if (generation === calendarGeneration) state.calendar = { ...state.calendar, error: error.message, coverage: { complete: false } };
      }
      emit();
    }
    async function supply(kind) {
      const lots = new Map(); let cursor; const seen = new Set();
      state.supply.errors[kind] = null;
      try {
        do {
          const result = await options.get('dispatch_supply', { kind, ...(cursor ? { cursor } : {}) });
          if (!Array.isArray(result.supply_lots)) throw new Error('Supply records unavailable.');
          result.supply_lots.forEach(lot => lots.set(lot.id, { ...lot, supply_kind: kind }));
          cursor = result.next_cursor;
          if (cursor && seen.has(cursor)) throw new Error('Repeated supply cursor; coverage incomplete.');
          if (cursor) seen.add(cursor);
          state.supply.lots = state.supply.lots.filter(lot => lot.supply_kind !== kind).concat([...lots.values()]);
          state.supply.coverage[kind] = !cursor && result.coverage?.complete === true; emit();
        } while (cursor);
      } catch (error) { state.supply.errors[kind] = error.message; state.supply.coverage[kind] = false; emit(); }
    }
    async function execution(id) {
      const generation = (executionGeneration.get(id) || 0) + 1;
      executionGeneration.set(id, generation);
      let current = false;
      try {
        const result = await options.get('dispatch_execution', { job_id: id });
        current = generation === executionGeneration.get(id);
        if (!current) return result;
        const previous = state.executions.get(id) || {};
        state.executions.set(id, { ...result,
          submitting: previous.submitting === true,
          uncertain: previous.uncertain === true || result.actions?.some(action => action.status === 'outcome_unknown') === true });
        return result;
      }
      catch (error) {
        current = generation === executionGeneration.get(id);
        if (current) {
          const previous = state.executions.get(id) || {};
          state.executions.set(id, { ...previous,
            actions: previous.actions || [],
            capabilities: { ...(previous.capabilities || {}), enabled: false, approval_enabled: false, release_hold: true },
            coverage: { ...(previous.coverage || {}), complete: false },
            submitting: previous.submitting === true,
            uncertain: previous.uncertain === true,
            error: error.message });
        }
        return null;
      }
      finally {
        if (current) emit();
      }
    }
    return { state, list, load, select, edit, editor, clearEditor, command, retry, resolveConflict, calendar, supply, execution,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      setLayer(layer, enabled) { if (Object.hasOwn(state.layers, layer)) { state.layers[layer] = enabled; emit(); } },
      approveDraft(id, payload) { return command(id, 'approve_draft', payload, 'dispatch_draft_approve'); },
      async executeDraft(id, draftId, approvalId) {
        const previous = state.executions.get(id) || {};
        if (previous.submitting || previous.uncertain) throw new Error('Read back the previous action before any recovery.');
        state.executions.set(id, { ...previous, submitting: true }); emit();
        try {
          const result = await options.post('dispatch_execute', { job_id: id, draft_id: draftId, approval_id: approvalId });
          const status = await execution(id);
          const current = state.executions.get(id) || {};
          state.executions.set(id, { ...current, submitting: false, uncertain: status ? current.uncertain === true : true,
            ...(status ? {} : { error: 'Execution outcome uncertain. Refresh action status and read back the provider receipt.' }) });
          emit();
          return result;
        }
        catch (error) { await execution(id); state.executions.set(id, { ...state.executions.get(id), submitting: false, uncertain: true, error: 'Execution outcome uncertain. Refresh action status and read back the provider receipt.' }); emit(); throw error; }
      },
      async readbackExecution(id, approvalId) { const result = await options.post('dispatch_execution_readback', { approval_id: approvalId }); await execution(id); return result; },
      communications(params) { return options.get('dispatch_communications', params); },
      assess(id) { return command(id, 'assess', {}, 'dispatch_assess'); }, uuid: options.id || uuid };
  }
  function week(date = new Date()) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const day = new Date(local + 'T12:00:00Z');
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, offset) => { const next = new Date(day); next.setUTCDate(day.getUTCDate() + offset); return next.toISOString().slice(0, 10); });
  }
  function filteredJobs(jobs, { query = '', trade = 'all', workflow = 'all' } = {}) {
    const needle = query.trim().toLowerCase();
    return jobs.filter(job => (trade === 'all' || String(job.work_type || '').toLowerCase().includes(trade)) &&
      (workflow === 'all' || job.next_action === workflow) &&
      (!needle || [job.job_number, job.client_name, job.site_address, job.work_type].join(' ').toLowerCase().includes(needle)));
  }
  return { create, week, filteredJobs };
});
