// A job saved from the Scope Engine patio tool, shaped exactly as its save writes it
// (scope-engine-v2 patio/scoper/src/jobsystem.ts: ScopeRecord into jobs.scope_json, PricingJson
// v2.0 into jobs.pricing_json). Made-up people and figures; dates from the given "now".
const JOB_ID = '5e0a0000-0000-4000-8000-000000000301';
const IDS = {
  rev3: '5e0a0000-0000-4000-8000-0000000003a3', rev2: '5e0a0000-0000-4000-8000-0000000003a2', rev1: '5e0a0000-0000-4000-8000-0000000003a1',
  frozen3: 'frz-sample-0003', frozen2: 'frz-sample-0002', frozen1: 'frz-sample-0001',
};

function iso(daysAgo, h, m, now) {
  const d = new Date((now || Date.now()) - daysAgo * 86400000);
  const ymd = new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  return new Date(`${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`).toISOString();
}

function reading(mm, source) { return { mm, source }; }

function draft() {
  return {
    site: {
      customer: '', mobile: '', email: '', address: '', addressFromJob: ['street', 'suburb'],
      storeys: 'single', houseRoof: 'tile', fascia: 'timber', windClass: 'N2',
      readings: {
        gutterTop: reading(2480, 'measured'), gutterDepth: reading(115, 'measured'), gutterOut: reading(140, 'measured'),
        fasciaTop: reading(2420, 'measured'), fasciaDepth: reading(190, 'sample'), eave: reading(450, 'measured'),
        wallPlate: reading(2400, 'sample'), groundFall: reading(40, 'measured'),
      },
    },
    design: {
      shape: 'gable-square', fixing: 'risers', widthMm: 7200, projectionMm: 4500, frontHeightMm: 2700, pitchDeg: 15,
      startAlongWallMm: 4000, gapToHouseMm: 1500, posts: 3, postsAuto: true, postSetbackMm: 0, rafters: null, purlinRows: 4,
      products: {
        covering: 'sheet:trimdek', beam: 'rhs:150x50x2.0:c450l0', post: 'shs:100x100x2.0:c450l0', riser: 'rhs:100x50x2.0:c450l0',
        rafter: 'rhs:150x50x2.0:c450l0', purlin: 'rhs:100x50x2.0:c450l0', gutter: 'gutter:metroll-patioline',
        downpipe: 'downpipe:rect:95x45', infill: 'infill:thermoclear-twinwall:10x1050',
      },
      colours: { frame: 'CB-MONUMENT', roof: 'CB-SURFMIST', ceiling: null, trim: 'CB-MONUMENT' },
      downpipes: 'both', returnMm: 6000, boxGutterMm: 300, useReadings: true, edits: [],
    },
    pricing: { rates: {}, materialsTotal: null, labour: 2900, marginPct: 38, commissionPct: null, commissionFrom: null },
  };
}

function lines() {
  return [
    { id: 'l-sheet', description: 'Trimdek roof sheet 4,600', quantity: 10, unit: 'sheet', colour: 'Surfmist' },
    { id: 'l-post', description: '100x100 SHS post 2,900', quantity: 3, unit: 'length', colour: 'Monument' },
    { id: 'l-beam', description: '150x50 RHS beam 7,400', quantity: 2, unit: 'length', colour: 'Monument' },
    { id: 'l-riser', description: '100x50 RHS riser 900', quantity: 6, unit: 'length', colour: 'Monument' },
    { id: 'l-gutter', description: 'Patioline gutter 7,400', quantity: 2, unit: 'length', colour: 'Surfmist' },
    { id: 'l-infill', description: 'Thermoclear twinwall 10 mm, 1,050 wide', quantity: 4, unit: 'sheet', colour: null },
  ];
}

function revision(n, id, parent, frozen, sealedAt) {
  return { n, scopeRevisionId: id, parentRevisionId: parent, frozenId: frozen, catalogueRevisionId: 'cat-2026-10-25', sealedAt, outputsAgree: true };
}

function scopeRecord(now) {
  const base = { family: 'gable', supported: true, lines: lines(), expected: { materials: 6120, labour: 2900, sale: 14500 }, draft: draft() };
  return Object.assign({ tool: 'patio-scoper', version: '2.0' }, base, {
    revision: revision(3, IDS.rev3, IDS.rev2, IDS.frozen3, iso(1, 14, 41, now)),
    earlier: [
      Object.assign({}, base, { revision: revision(1, IDS.rev1, null, IDS.frozen1, iso(1, 13, 40, now)) }),
      Object.assign({}, base, { revision: revision(2, IDS.rev2, IDS.rev1, IDS.frozen2, iso(1, 14, 5, now)) }),
    ],
    savedAt: iso(1, 14, 44, now),
  });
}

function pricingJson() {
  return {
    tool: 'patio-scoper', version: '2.0',
    revision: { n: 3, scopeRevisionId: IDS.rev3, frozenId: IDS.frozen3, sealed: true },
    supported: true, pricing_complete: true, sell_to_confirm: [],
    totalExGST: 14500, gst: 1450, totalIncGST: 15950,
    margin_pct: 38, margin_basis: 'selected_target',
    internal: { costs_complete: true, costs_to_confirm: [], materials: 6120, labour: 2900, cost: 9020, commission: null, commission_basis: 'not_set' },
    job_description: 'Patio (gable)',
    materialCostEstimate: 6120, labourCostEstimate: 2900, commissionCostEstimate: null, totalCostEstimate: 9020,
    deposit: { percent: 20, fixed_amount: null, council_fees: 0, description: '20% deposit', total_deposit_inc_gst: 3190, to_confirm: true },
  };
}

function buildEnginePatioDetail(opts = {}) {
  const now = opts.now || Date.now();
  return {
    job: {
      id: JOB_ID, job_number: 'SWP-990301', type: 'patio', status: 'quoted', legacy: false,
      client_name: 'Casey Morgan', client_phone: '0400 000 301', client_email: 'casey@example.test',
      site_address: '7 Example Court, Testville WA 6000', site_suburb: 'Testville',
      ghl_contact_id: 'ghl-contact-e2e-301', ghl_opportunity_id: 'ghl-opp-e2e-301',
      created_at: iso(5, 9, 14, now), updated_at: iso(1, 14, 44, now),
      scope_json: scopeRecord(now), pricing_json: pricingJson(),
    },
    assignments: [], documents: [], purchase_orders: [], work_orders: [], xero_project: null, invoices: [],
    job_contacts: [], business_events: [], service_reports: [], chase_logs: [], readiness: null,
    events: [
      { id: 'ev-saved', job_id: JOB_ID, event_type: 'scope_saved', created_at: iso(1, 14, 44, now), detail_json: { tool: 'patio-scoper' } },
    ],
    media: Array.from({ length: 9 }, (_, i) => ({ id: `se-media-${i + 1}`, job_id: JOB_ID, phase: 'scope', type: 'photo', storage_url: `https://example.test/se/${i + 1}.jpg`, created_at: iso(1, 13, 10 + i, now) }))
      .concat([{ id: 'se-video-1', job_id: JOB_ID, phase: 'scope', type: 'video', storage_url: 'https://example.test/se/walkthrough.mp4', created_at: iso(1, 13, 30, now) }]),
  };
}

function buildScopeRevisions(opts = {}) {
  const now = opts.now || Date.now();
  const row = (n, id, frozen, status, at) => ({ id, job_id: JOB_ID, status, tool_kind: 'patio', tool_version: 'patio-scoper/2.0', frozen_at: at, created_at: at, scope_hash: `sha256:${frozen}`, pricing_hash: `sha256:p-${frozen}`, artifacts: [] });
  return [
    row(3, IDS.rev3, IDS.frozen3, 'frozen', iso(1, 14, 44, now)),
  ];
}

module.exports = { JOB_ID, IDS, buildEnginePatioDetail, buildScopeRevisions, scopeRecord, pricingJson };
