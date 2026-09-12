const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const DispatchCore = require('../../modules/ops-dispatch-core.js');

const clone = value => JSON.parse(JSON.stringify(value));
const record = id => ({
  job: { id, job_number: `FIX-${id}`, work_type: 'fencing', eligibility: { state: 'accepted' } },
  version: 0, source_version: 'source-1', groups: [], requirements: [], drafts: [], notes: [],
  allocations: [], receipts: [], purchase_orders: [], movements: [], media: [], communications: []
});
class FormValues {
  constructor(form) { this.entries = Object.entries(form.values); }
  get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
  getAll(name) { return this.entries.filter(([key]) => key === name).flatMap(([, value]) => value); }
  has(name) { return this.entries.some(([key]) => key === name); }
  [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
}
async function workspace(options = {}) {
  const listeners = new Map(), records = { a: record('a'), b: record('b') }, commands = [], reads = [], lots = [];
  const timers = new Map(), windowListeners = new Map(), documentListeners = new Map(), forms = new Map();
  const document = { activeElement: null, visibilityState: 'visible',
    addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) };
  let detailNodes = [], markup = '';
  let focusNodes = [], count = 0, timerId = 0, pendingSave;
  const host = {
    get innerHTML() { return markup; },
    set innerHTML(value) {
      markup = value;
      detailNodes = [...value.matchAll(/<details\b([^>]*)>/g)].flatMap(([, attrs]) => {
        const key = attrs.match(/data-disclosure="([^"]*)"/)?.[1];
        return key ? [{ dataset: { disclosure: key }, open: /(?:^|\s)open(?:\s|$)/.test(attrs) }] : [];
      });
    }, isConnected: true, classList: { add() {} }, contains: node => !!node,
    querySelectorAll: selector => selector === 'details[data-disclosure]' ? detailNodes : focusNodes,
    querySelector: selector => forms.get(selector.match(/^\[data-form="([^"]+)"\]$/)?.[1]) || null,
    addEventListener: (type, listener) => listeners.set(type, listener)
  };
  const core = DispatchCore.create({
    id: options.id || (() => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`),
    get: async (action, params) => {
      reads.push({ action, params: clone(params) });
      if (options.get) { const result = await options.get(action, params); if (result !== undefined) return result; }
      if (action === 'dispatch_list') return { jobs: Object.values(records).map(r => r.job), coverage: { complete: true } };
      if (action === 'dispatch_job') return clone(records[params.job_id]);
      if (action === 'dispatch_calendar') return { events: [], undated: [], coverage: { complete: true } };
      if (action === 'dispatch_execution') return { actions: [], capabilities: { release_hold: true, approval_enabled: true }, coverage: { complete: true } };
      if (action === 'dispatch_supply') return { supply_lots: lots.filter(lot => lot.supply_kind === params.kind), coverage: { complete: true } };
      if (action === 'dispatch_communications') return { records: clone(records[params.job_id].communications), coverage: { complete: true } };
      throw new Error(`Unexpected fixture read: ${action}`);
    },
    post: async (action, envelope) => {
      commands.push(clone({ action, ...envelope }));
      if (pendingSave) await pendingSave;
      if (options.post) return options.post(action, envelope);
      const current = records[envelope.job_id], payload = envelope.payload;
      const upsert = (rows, value) => { const index = rows.findIndex(item => item.id === value.id); if (index < 0) rows.push(value); else rows[index] = value; };
      if (envelope.command === 'group_upsert') upsert(current.groups, clone(payload));
      if (envelope.command === 'draft_upsert') upsert(current.drafts, { ...clone(payload), status: 'draft', content_hash: JSON.stringify(payload) });
      if (envelope.command === 'draft_review') {
        const draft = current.drafts.find(item => item.id === payload.id);
        draft.review = { content_hash: draft.content_hash, source_version: current.source_version };
      }
      current.version++;
      return clone(current);
    }
  });
  const context = vm.createContext({ DispatchCore, document, FormData: FormValues, URL, innerWidth: 1200,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id),
    addEventListener: (name, fn) => windowListeners.set(name, fn), removeEventListener: name => windowListeners.delete(name),
    ...options.globals });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../modules/ops-dispatch.js'), 'utf8'), context);
  const app = context.DispatchOps.mount(host, { core, now: new Date('2026-09-14T04:00:00Z') });
  await app.load();
  return {
    app, core, host, records, commands, reads, lots, timers, document, context,
    hold() { let release; pendingSave = new Promise(resolve => { release = resolve; }); return () => { pendingSave = null; release(); }; },
    detail(key) { return detailNodes.find(node => node.dataset.disclosure === key); },
    blur() { const target = document.activeElement; listeners.get('focusout')?.({ target }); document.activeElement = null; },
    click(action, id) {
      const target = { dataset: { action, id }, closest: selector => selector === '[data-action]' ? target : null };
      return listeners.get('click')({ target, preventDefault() {} });
    },
    input(kind, values, editor) {
      const form = { dataset: { form: kind }, values, reportValidity: () => true };
      forms.set(kind, form);
      const target = { dataset: editor ? { editor } : {}, value: editor === 'note' ? values.text : undefined, form, closest: () => form };
      return listeners.get('input')({ target });
    },
    submit(kind, values) {
      return listeners.get('submit')({ target: { dataset: { form: kind }, values }, preventDefault() {} });
    },
    filter(filter, value) { return listeners.get('change')({ target: { dataset: { filter }, value } }); },
    focusControl(kind, name, start = 1, end = 3) {
      const prior = { name, dataset: {}, form: { dataset: { form: kind } }, type: 'text', value: 'typed', selectionStart: start, selectionEnd: end };
      const next = { ...prior, focused: false, focus() { this.focused = true; document.activeElement = this; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
      document.activeElement = prior; focusNodes = [next]; return next;
    },
    emit(name) { return (windowListeners.get(name) || documentListeners.get(name))?.(); },
    async visibility(visible) { document.visibilityState = visible ? 'visible' : 'hidden'; await documentListeners.get('visibilitychange')?.(); },
    async tick() { const entry = timers.entries().next().value; if (entry) { timers.delete(entry[0]); await entry[1].fn(); } }
  };
}
module.exports = { workspace, clone, record };
