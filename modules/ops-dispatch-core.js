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
    const initialTasks = () => ({ items: [], sourceFailures: [], status: null, loading: false, loaded: false, error: null,
      offset: 0, nextOffset: 0, hasMore: false, sourceFailuresOffset: 0, sourceFailuresNextOffset: 0, sourceFailuresHasMore: false,
      read: { items: { loading: false, loaded: false, error: null, complete: false }, sourceFailures: { loading: false, loaded: false, error: null, complete: false } } });
    const state = { jobs: [], coverage: null, selectedId: null, jobsLoading: false, error: null,
      supply: { lots: [], coverage: {}, errors: {} }, executions: new Map(), records: new Map(), editors: new Map(), pending: new Map(), errors: new Map(),
      tasks: initialTasks(),
      taskRetries: new Map(),
      evidence: new Map(), calendar: { events: [], undated: [], coverage: null, loading: false, loadedRange: null }, calendarRange: null, layers: { staff: true, materials: true, logistics: true } };
    const listeners = new Set();
    let disposed = false;
    let listGeneration = 0, calendarGeneration = 0, tasksGeneration = 0;
    const recordGeneration = new Map();
    const recordLoads = new Map();
    const executionGeneration = new Map();
    const taskLoads = new Map();
    const emit = () => listeners.forEach(listener => listener(state));
    const inactive = () => new Error('Dispatch core disposed.');
    const ensureActive = () => { if (disposed) throw inactive(); };
    const apiGet = async (action, params) => { ensureActive(); const result = await options.get(action, params); ensureActive(); return result; };
    const apiPost = async (action, body) => { ensureActive(); const result = await options.post(action, body); ensureActive(); return result; };
    const now = () => Date.now();
    const jobEvidence = id => {
      if (!state.evidence.has(id)) state.evidence.set(id, { loading: false, lastSuccessAt: null, error: null, verified: false });
      return state.evidence.get(id);
    };
    const setEvidence = (id, patch) => state.evidence.set(id, { ...jobEvidence(id), ...patch });
    const nextRecordGeneration = id => {
      const generation = (recordGeneration.get(id) || 0) + 1;
      recordGeneration.set(id, generation);
      return generation;
    };
    function accept(record, id) {
      if (!record || record.job?.id !== id || !Number.isInteger(record.version)) throw new Error('Invalid Dispatch response; work remains unchanged.');
      const current = state.records.get(id);
      if (current && record.version < current.version) return false;
      state.records.set(id, record);
      return true;
    }
    function workshopUnavailable(error) {
      return error && (error.status === 404 || /unknown|Unexpected fixture|Unknown Dispatch/i.test(String(error.message || error)));
    }
    function normalizeWorkshop(raw, id) {
      if (!raw) return raw;
      if (raw.job && Number.isInteger(raw.version) && Array.isArray(raw.groups)) return raw;
      const grounding = raw.grounding || {};
      const job = { ...(raw.job || {}), id: (raw.job && (raw.job.id || raw.job.job_id)) || raw.job_id || id };
      if (!job.eligibility) job.eligibility = { state: job.status === 'accepted' || job.accepted_at ? 'accepted' : 'unresolved' };
      const version = Number.isInteger(grounding.plan_version) ? grounding.plan_version
        : (Number.isInteger(raw.version) ? raw.version : 0);
      const comms = raw.communications && Array.isArray(raw.communications.messages)
        ? raw.communications.messages : (raw.communications || []);
      return {
        job,
        version,
        source_version: raw.source_revision || raw.source_version || null,
        groups: grounding.groups || raw.groups || [],
        requirements: grounding.requirements || raw.requirements || [],
        notes: grounding.notes || raw.notes || [],
        drafts: grounding.order_drafts || raw.drafts || [],
        documents: raw.documents || [],
        communications: comms,
        purchase_orders: raw.purchase_orders || [],
        movements: raw.movements || [],
        media: raw.media || [],
        allocations: raw.allocations || [],
        receipts: raw.receipts || [],
        ai_assessor_required: raw.ai_assessor_required === true,
        source_reload_is_not_assessment: raw.source_reload_is_not_assessment !== false,
        workshop: true
      };
    }
    async function loadWorkshop(id, poId) {
      try {
        const params = { job_id: id };
        if (poId) params.po_id = poId;
        return normalizeWorkshop(await apiGet('dispatch_job_workshop', params), id);
      } catch (error) {
        if (!workshopUnavailable(error)) throw error;
        return apiGet('dispatch_job', { job_id: id });
      }
    }
    function acceptAuthoritative(record, id) {
      if (!accept(record, id)) {
        setEvidence(id, { loading: false, error: 'Stale Dispatch response; refresh this job.', verified: false });
        return record;
      }
      state.errors.delete(id);
      setEvidence(id, { loading: false, lastSuccessAt: now(), error: null, verified: true });
      return record;
    }
    async function list() {
      ensureActive();
      const generation = ++listGeneration;
      state.jobsLoading = true; state.error = null; emit();
      const jobs = new Map(), cursors = new Set();
      let cursor, coverage;
      try {
        do {
          const result = await apiGet('dispatch_list', { limit: 100, ...(cursor ? { cursor } : {}) });
          ensureActive();
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
        if (disposed) throw error;
        if (generation === listGeneration) { state.error = error.message; state.coverage = { ...coverage, complete: false }; }
      } finally {
        if (!disposed && generation === listGeneration) { state.jobsLoading = false; emit(); }
      }
      if (!disposed && !state.selectedId && state.jobs.length) await select(state.jobs[0].id);
    }
    async function load(id) {
      ensureActive();
      if (recordLoads.has(id)) return recordLoads.get(id);
      const generation = nextRecordGeneration(id);
      const readStartedDuringWrite = state.pending.get(id)?.running === true;
      setEvidence(id, { loading: true }); emit();
      let promise;
      promise = (async () => {
        let current = false;
        try {
          const record = await loadWorkshop(id);
          ensureActive();
          current = generation === recordGeneration.get(id);
          if (current) {
            if (!readStartedDuringWrite) acceptAuthoritative(record, id);
            else setEvidence(id, { loading: false });
          }
          return record;
        } catch (error) {
          if (disposed) throw error;
          current = generation === recordGeneration.get(id);
          if (current) {
            state.errors.set(id, error.message);
            setEvidence(id, { loading: false, error: error.message, verified: false });
          }
          throw error;
        } finally {
          if (recordLoads.get(id) === promise) recordLoads.delete(id);
          if (!disposed && current) emit();
        }
      })();
      recordLoads.set(id, promise);
      return promise;
    }
    async function select(id) {
      ensureActive();
      state.selectedId = id; emit();
      try { return await load(id); } catch (error) { if (disposed) throw error; return null; }
    }
    function edit(id, key, value) {
      ensureActive();
      if (!state.editors.has(id)) state.editors.set(id, new Map());
      state.editors.get(id).set(key, copy(value));
    }
    function editor(id, key) { return state.editors.get(id)?.get(key); }
    function baseline(id) {
      const record = state.records.get(id);
      return record ? { version: record.version, source_version: record.source_version } : null;
    }
    function clearEditor(id, key, expected) {
      ensureActive();
      const current = editor(id, key);
      if (expected === undefined || JSON.stringify(current) === JSON.stringify(expected)) state.editors.get(id)?.delete(key);
    }
    async function execute(id, envelope, action) {
      ensureActive();
      const pending = state.pending.get(id);
      if (pending?.running) throw new Error('A Dispatch change is still being checked.');
      state.pending.set(id, { envelope, action, running: true }); recordLoads.delete(id); nextRecordGeneration(id); state.errors.delete(id); emit();
      try {
        const result = await apiPost(action, envelope);
        ensureActive();
        // A committed command is followed by a fresh server read. A failed read keeps the
        // exact request identity for safe retry; it never repeats a new command blindly.
        const record = result?.job && Number.isInteger(result.version) ? result : await loadWorkshop(id);
        ensureActive();
        acceptAuthoritative(record, id); nextRecordGeneration(id); state.pending.delete(id); emit(); return record;
      } catch (error) {
        if (disposed) throw error;
        const conflict = error.status === 409 || error.code === 'version_conflict';
        const definiteRefusal = [400, 401, 403, 404, 422].includes(error.status);
        // A definite validation/authority refusal did not commit. Let the operator
        // correct the retained editor instead of trapping an invalid request in retry.
        if (definiteRefusal) state.pending.delete(id);
        else state.pending.set(id, { envelope, action, running: false, conflict });
        setEvidence(id, definiteRefusal ? { loading: false } : { loading: false, error: error.message, verified: false });
        state.errors.set(id, error.message); emit(); throw error;
      }
    }
    async function command(id, commandName, payload, action = 'dispatch_command', reviewBaseline) {
      ensureActive();
      if (state.pending.has(id)) throw new Error('Resolve the previous change before making another one.');
      const record = state.records.get(id);
      if (!record) throw new Error('Read this job before changing its plan.');
      if (state.evidence.get(id)?.verified !== true) throw new Error('Refresh this job before changing its plan.');
      const version = reviewBaseline ? reviewBaseline.version : record.version;
      const sourceVersion = reviewBaseline ? reviewBaseline.source_version : record.source_version;
      if (reviewBaseline && (record.version !== version || record.source_version !== sourceVersion)) throw new Error('Dispatch review changed; reconcile this editor before saving.');
      return execute(id, { job_id: id, expected_version: version, source_version: sourceVersion,
        request_id: (options.id || uuid)(), command: commandName, payload: copy(payload) }, action);
    }
    async function retry(id) {
      ensureActive();
      const pending = state.pending.get(id);
      if (!pending || pending.conflict) throw new Error('Reload and review the changed sources before preparing a new change.');
      return execute(id, pending.envelope, pending.action);
    }
    async function resolveConflict(id) {
      ensureActive();
      const pending = state.pending.get(id);
      if (!pending?.conflict) throw new Error('An uncertain write must be retried with its original identity.');
      await load(id);
      if (state.evidence.get(id)?.verified !== true) throw new Error('Current evidence could not be verified. The conflict remains unresolved.');
      state.pending.delete(id); emit();
    }
    async function calendar(from, to) {
      ensureActive();
      const generation = ++calendarGeneration;
      state.calendarRange = { from, to };
      state.calendar = { ...state.calendar, loading: true, coverage: { ...(state.calendar.coverage || {}), complete: false } };
      emit();
      try {
        const result = await apiGet('dispatch_calendar', { from, to });
        ensureActive();
        if (generation === calendarGeneration) state.calendar = { ...result, error: null, loading: false, loadedRange: { from, to } };
      } catch (error) {
        if (disposed) throw error;
        if (generation === calendarGeneration) state.calendar = { ...state.calendar, loading: false, error: error.message, coverage: { ...(state.calendar.coverage || {}), complete: false } };
      }
      if (!disposed) emit();
    }
    async function supply(kind) {
      ensureActive();
      const lots = new Map(); let cursor; const seen = new Set();
      state.supply.errors[kind] = null;
      try {
        do {
          const result = await apiGet('dispatch_supply', { kind, ...(cursor ? { cursor } : {}) });
          ensureActive();
          if (!Array.isArray(result.supply_lots)) throw new Error('Supply records unavailable.');
          result.supply_lots.forEach(lot => lots.set(lot.id, { ...lot, supply_kind: kind }));
          cursor = result.next_cursor;
          if (cursor && seen.has(cursor)) throw new Error('Repeated supply cursor; coverage incomplete.');
          if (cursor) seen.add(cursor);
          state.supply.lots = state.supply.lots.filter(lot => lot.supply_kind !== kind).concat([...lots.values()]);
          state.supply.coverage[kind] = !cursor && result.coverage?.complete === true; emit();
        } while (cursor);
      } catch (error) { if (disposed) throw error; state.supply.errors[kind] = error.message; state.supply.coverage[kind] = false; emit(); }
    }
    const readState = (patch = {}) => ({ loading: false, loaded: false, error: null, complete: false, ...patch });
    const taskIdentity = task => `task:${task?.job_id}:${task?.source_version}:${task?.plan_version}`;
    const sourceFailureIdentity = failure => `source_failure:${failure?.job_id}`;
    const mergeBy = (existing, incoming, identity) => {
      const rows = new Map(existing.map(row => [identity(row), row]));
      incoming.forEach(row => rows.set(identity(row), row));
      return [...rows.values()];
    };
    const activeTaskOffsets = () => {
      const offsets = [];
      if (state.tasks.hasMore) offsets.push(state.tasks.nextOffset);
      if (state.tasks.sourceFailuresHasMore) offsets.push(state.tasks.sourceFailuresNextOffset);
      return offsets.filter(offset => Number.isSafeInteger(offset) && offset >= 0);
    };
    function validateTaskPage(result, offset) {
      if (!Array.isArray(result?.items) || !Array.isArray(result?.source_failures) ||
        typeof result.has_more !== 'boolean' || typeof result.source_failures_has_more !== 'boolean') {
        throw new Error('Dispatch task status response is incomplete.');
      }
      if (result.has_more === true && (!Number.isSafeInteger(result.next_offset) || result.next_offset <= offset)) {
        throw new Error('Dispatch task cursor did not advance.');
      }
      if (result.source_failures_has_more === true &&
        (!Number.isSafeInteger(result.source_failures_next_offset) || result.source_failures_next_offset <= offset)) {
        throw new Error('Dispatch source-failure cursor did not advance.');
      }
    }
    function applyTaskPage(result, status, offset, replace, loading) {
      const items = result.items;
      const sourceFailures = result.source_failures;
      state.tasks = {
        ...state.tasks,
        items: replace ? items : mergeBy(state.tasks.items, items, taskIdentity),
        sourceFailures: replace ? sourceFailures : mergeBy(state.tasks.sourceFailures, sourceFailures, sourceFailureIdentity),
        status,
        loading,
        loaded: true,
        error: null,
        offset,
        nextOffset: result.next_offset,
        hasMore: result.has_more === true,
        sourceFailuresOffset: offset,
        sourceFailuresNextOffset: result.source_failures_next_offset,
        sourceFailuresHasMore: result.source_failures_has_more === true,
        read: {
          items: readState({ loading, loaded: true, complete: result.has_more !== true }),
          sourceFailures: readState({ loading, loaded: true, complete: result.source_failures_has_more !== true })
        }
      };
    }
    async function tasks({ more = false } = {}) {
      ensureActive();
      const reset = !more;
      const firstOffset = reset ? 0 : Math.min(...activeTaskOffsets());
      const offset = Number.isFinite(firstOffset) ? firstOffset : 0;
      const key = 'unfiltered';
      if (taskLoads.has(key)) return taskLoads.get(key);
      const generation = ++tasksGeneration;
      state.tasks = { ...state.tasks, status: null, loading: true, error: null,
        read: { items: readState({ ...state.tasks.read.items, loading: true, error: null }), sourceFailures: readState({ ...state.tasks.read.sourceFailures, loading: true, error: null }) } };
      emit();
      const promise = (async () => {
        let current = false;
        try {
          let pageOffset = offset;
          let result;
          const seenOffsets = new Set();
          do {
            if (seenOffsets.has(pageOffset)) throw new Error('Repeated Dispatch task cursor; coverage is incomplete.');
            seenOffsets.add(pageOffset);
            result = await apiGet('dispatch_tasks', { limit: 25, offset: pageOffset });
            ensureActive();
            current = generation === tasksGeneration;
            if (!current) return null;
            validateTaskPage(result, pageOffset);
            const nextOffsets = [];
            if (result.has_more) nextOffsets.push(result.next_offset);
            if (result.source_failures_has_more) nextOffsets.push(result.source_failures_next_offset);
            applyTaskPage(result, null, pageOffset, reset && pageOffset === 0, more && nextOffsets.length > 0);
            emit();
            pageOffset = nextOffsets.length ? Math.min(...nextOffsets) : 0;
          } while (more && pageOffset > 0);
          return state.tasks;
        } catch (error) {
          if (disposed) throw error;
          current = generation === tasksGeneration;
          if (current) {
            state.tasks = { ...state.tasks, loading: false, loaded: false, error: error.message,
              read: { items: readState({ ...state.tasks.read.items, loading: false, loaded: false, error: error.message, complete: false }),
                sourceFailures: readState({ ...state.tasks.read.sourceFailures, loading: false, loaded: false, error: error.message, complete: false }) } };
            emit();
          }
          throw error;
        } finally {
          if (taskLoads.get(key) === promise) taskLoads.delete(key);
        }
      })();
      taskLoads.set(key, promise);
      return promise;
    }
    const taskKey = (task, sourceFailure = false) => sourceFailure ? sourceFailureIdentity(task) : taskIdentity(task);
    const definiteTaskRetryRefusal = error => [400, 401, 403, 404, 409, 422].includes(error?.status);
    async function postTaskRetry(key, envelope) {
      ensureActive();
      const previous = state.taskRetries.get(key) || {};
      state.taskRetries.set(key, { ...previous, key, envelope, reason: envelope.reason, running: true, error: null }); emit();
      try {
        const result = await apiPost('dispatch_retry_task', envelope);
        ensureActive();
        state.taskRetries.set(key, { key, envelope, reason: envelope.reason, running: false, error: null, uncertain: false, refusal: false, result }); emit();
        return result;
      } catch (error) {
        if (disposed) throw error;
        const refusal = definiteTaskRetryRefusal(error);
        state.taskRetries.set(key, { key, envelope, reason: envelope.reason, running: false, error: error.message, uncertain: !refusal, refusal, result: null }); emit();
        throw error;
      }
    }
    async function retryTask(task, reason, { sourceFailure = false } = {}) {
      ensureActive();
      const text = String(reason || '').trim();
      if (!text) throw new Error('Retry reason is required.');
      if (!task?.job_id) throw new Error('Task job is required.');
      const key = taskKey(task, sourceFailure);
      const existing = state.taskRetries.get(key);
      if (existing?.running) throw new Error('This task retry is already pending.');
      if (existing?.uncertain) throw new Error('Retry the uncertain task request before starting a new retry.');
      const envelope = { job_id: task.job_id, request_id: (options.id || uuid)(), reason: text };
      if (!sourceFailure) {
        if (task.source_version == null || task.plan_version == null) throw new Error('Task retry requires source and plan versions.');
        envelope.source_version = task.source_version;
        envelope.plan_version = task.plan_version;
      }
      state.taskRetries.set(key, { key, envelope, reason: envelope.reason, running: true, error: null, uncertain: false, refusal: false, result: null }); emit();
      if (!sourceFailure) {
        await load(task.job_id).catch(() => null);
        ensureActive();
        const record = state.records.get(task.job_id);
        const verified = state.evidence.get(task.job_id)?.verified === true;
        if (!verified || record?.source_version !== task.source_version || record?.version !== task.plan_version) {
          const error = 'Assessment sources changed; refresh status before retrying this task.';
          state.taskRetries.set(key, { key, envelope, reason: envelope.reason, running: false, error, uncertain: false, refusal: true, result: null }); emit();
          throw new Error(error);
        }
      }
      return postTaskRetry(key, envelope);
    }
    async function retryTaskRequest(key) {
      ensureActive();
      const retry = state.taskRetries.get(key);
      if (!retry?.envelope || retry.uncertain !== true) throw new Error('Only an uncertain task retry can be replayed.');
      if (retry.running) throw new Error('This task retry is already pending.');
      return postTaskRetry(key, retry.envelope);
    }
    const executionActions = source => {
      if (Array.isArray(source?.actions)) return source.actions;
      return [];
    };
    const approvalOf = action => action?.approval_id || null;
    const executionIds = (previous, result) => {
      const uncertain = new Set(previous.uncertainApprovals || []);
      const completed = new Set(previous.completedApprovals || []);
      let unknownWithoutApproval = previous.unknownWithoutApproval === true;
      executionActions(result).forEach(action => {
        const approvalId = approvalOf(action);
        if (action.status === 'outcome_unknown') {
          if (approvalId) uncertain.add(approvalId);
          else unknownWithoutApproval = true;
        }
      });
      return { uncertain, completed, unknownWithoutApproval };
    };
    const setExecutionIds = (entry, uncertain, completed, unknownWithoutApproval = entry.unknownWithoutApproval === true) => ({ ...entry, uncertain: uncertain.size > 0 || unknownWithoutApproval,
      uncertainApprovals: [...uncertain], completedApprovals: [...completed], unknownWithoutApproval });
    async function execution(id) {
      ensureActive();
      const generation = (executionGeneration.get(id) || 0) + 1;
      executionGeneration.set(id, generation);
      let current = false;
      try {
        const result = await apiGet('dispatch_execution', { job_id: id });
        ensureActive();
        current = generation === executionGeneration.get(id);
        if (!current) return null;
        const previous = state.executions.get(id) || {};
        const ids = executionIds(previous, result);
        state.executions.set(id, { ...result,
          submitting: previous.submitting === true,
          uncertain: previous.uncertain === true || ids.uncertain.size > 0 || ids.unknownWithoutApproval,
          uncertainApprovals: [...ids.uncertain],
          completedApprovals: [...ids.completed],
          unknownWithoutApproval: ids.unknownWithoutApproval });
        return result;
      }
      catch (error) {
        if (disposed) throw error;
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
        if (!disposed && current) emit();
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      listGeneration++; calendarGeneration++; tasksGeneration++;
      recordGeneration.clear(); recordLoads.clear(); executionGeneration.clear(); taskLoads.clear();
      state.jobs = []; state.coverage = null; state.selectedId = null; state.jobsLoading = false; state.error = null;
      state.supply = { lots: [], coverage: {}, errors: {} };
      state.executions.clear(); state.records.clear(); state.editors.clear(); state.pending.clear(); state.errors.clear(); state.evidence.clear();
      state.calendar = { events: [], undated: [], coverage: null, loading: false, loadedRange: null }; state.calendarRange = null;
      state.tasks = initialTasks(); state.taskRetries.clear();
      emit(); listeners.clear();
    }
    return { state, list, load, select, edit, editor, baseline, clearEditor, command, retry, resolveConflict, calendar, supply, tasks, taskKey, retryTask, retryTaskRequest, execution, dispose,
      subscribe(listener) { ensureActive(); listeners.add(listener); return () => listeners.delete(listener); },
      setLayer(layer, enabled) { ensureActive(); if (Object.hasOwn(state.layers, layer)) { state.layers[layer] = enabled; emit(); } },
      approveDraft(id, payload) { return command(id, 'approve_draft', payload, 'dispatch_draft_approve'); },
      async executeDraft(id, draftId, approvalId) {
        ensureActive();
        const previous = state.executions.get(id) || {};
        if (previous.submitting || previous.uncertain) throw new Error('Read back the previous action before any recovery.');
        if ((previous.completedApprovals || []).includes(approvalId)) throw new Error('This approved action already has an execution receipt.');
        state.executions.set(id, { ...previous, submitting: true }); emit();
        try {
          const result = await apiPost('dispatch_execute', { job_id: id, draft_id: draftId, approval_id: approvalId });
          ensureActive();
          const status = await execution(id);
          ensureActive();
          const current = state.executions.get(id) || {};
          const uncertain = new Set(current.uncertainApprovals || []);
          const completed = new Set(current.completedApprovals || []);
          if (status) completed.add(approvalId); else uncertain.add(approvalId);
          state.executions.set(id, setExecutionIds({ ...current, submitting: false,
            ...(status ? {} : { error: 'Execution outcome uncertain. Refresh action status and read back the provider receipt.' }) }, uncertain, completed));
          emit();
          return result;
        }
        catch (error) { if (disposed) throw error; await execution(id); const current = state.executions.get(id) || {}; const uncertain = new Set(current.uncertainApprovals || []); uncertain.add(approvalId); state.executions.set(id, setExecutionIds({ ...current, submitting: false, error: 'Execution outcome uncertain. Refresh action status and read back the provider receipt.' }, uncertain, new Set(current.completedApprovals || []))); emit(); throw error; }
      },
      async readbackExecution(id, approvalId) {
        ensureActive();
        const result = await apiPost('dispatch_execution_readback', { approval_id: approvalId });
        ensureActive();
        const status = await execution(id);
        ensureActive();
        const action = result?.action || null;
        const readbackMatch = action?.id && action.approval_id === approvalId && action.status === 'accepted_not_delivered' &&
          result.retry_safe === false && result.readback_required === false && result.readback_recorded === true;
        const freshMatch = executionActions(status).some(fresh => fresh.id === action?.id && fresh.approval_id === approvalId && fresh.status === 'accepted_not_delivered');
        if (readbackMatch && freshMatch) {
          const current = state.executions.get(id) || {};
          const uncertain = new Set(current.uncertainApprovals || []);
          const completed = new Set(current.completedApprovals || []);
          uncertain.delete(approvalId); completed.add(approvalId);
          state.executions.set(id, setExecutionIds(current, uncertain, completed)); emit();
        }
        return result;
      },
      communications(params) { return apiGet('dispatch_communications', params); },
      assess(id) { return command(id, 'assess', {}, 'dispatch_assess'); }, uuid: options.id || uuid };
  }
  const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  function week(date = new Date()) {
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const day = new Date(local + 'T12:00:00Z');
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, offset) => { const next = new Date(day); next.setUTCDate(day.getUTCDate() + offset); return next.toISOString().slice(0, 10); });
  }
  function filteredJobs(jobs, { query = '', trade = 'all', workflow = 'all' } = {}) {
    const needle = query.trim().toLowerCase();
    const selectedTrade = normalize(trade);
    return jobs.filter(job => (selectedTrade === 'all' || normalize(job.work_type) === selectedTrade) &&
      (workflow === 'all' || job.next_action === workflow) &&
      (!needle || [job.job_number, job.client_name, job.site_address, job.work_type].join(' ').toLowerCase().includes(needle)));
  }
  return { create, week, filteredJobs };
});
