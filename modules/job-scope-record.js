// One reader for what a scoping tool saved on a job (jobs.scope_json + jobs.pricing_json).
// ---------------------------------------------------------------------------------------
// Every job view (the Overview, Dispatch, the Money tab) used to read scope_json its own way,
// and each knew only the older tools' shapes. This module knows every saved shape and returns
// one plain object, so a new tool is taught here once:
//   - Scope Engine patio record: { tool: 'patio-scoper', version: '2.0', draft, lines, revision, earlier }
//     (scope-engine-v2 patio/scoper/src/jobsystem.ts ScopeRecord, pricing PricingJson v2.0);
//   - fence designer and Scope Engine fence: { job: { runs, gates, removal, ... } };
//   - the older patio page: { config: { length, projection, roofStyle, ... } } or the config at the root.
// Pure: no DOM, no fetch, no window. Money is a number or null; null means not known and is
// never shown as $0. Contract: docs/job-scope-record.md. Tests: modules/job-scope-record.test.cjs.
(function (root) {
  'use strict';

  var ENGINE_PATIO_URL = 'https://marninms98-dotcom.github.io/patio/scope-engine/';
  var OLD_PATIO_URL = 'https://marninms98-dotcom.github.io/patio/';
  var FENCE_URL = 'https://marninms98-dotcom.github.io/fence-designer/scope-engine/';

  var SHAPES = {
    'skillion': 'Skillion', 'gable-square': 'Gable, end to the yard', 'gable-parallel': 'Gable, ridge along the house',
    'hip': 'Hip', 'courtyard': 'Skillion in the courtyard', 'wrap-around': 'Wrap-around the corner',
    'reverse-skillion': 'Reverse skillion to a box gutter'
  };
  var FIXINGS = {
    risers: 'On risers over the gutter', fascia: 'To the fascia', wall: 'To the wall',
    freestanding: 'Freestanding', flyover: 'Flyover over the house roof'
  };
  var READING_KEYS = ['gutterTop', 'gutterDepth', 'gutterOut', 'fasciaTop', 'fasciaDepth', 'eave', 'wallPlate', 'groundFall'];
  // Documents the Scope Engine builds from one sealed revision, in the order the tool lists them.
  var ENGINE_DOCUMENTS = [
    { key: 'quote', name: 'Quote' }, { key: 'scope', name: 'Scope of works' }, { key: 'work_order', name: 'Work order' },
    { key: 'order', name: 'Material order' }, { key: 'guide', name: 'Crew guide' }
  ];

  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function parse(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'string') { try { return obj(JSON.parse(v)); } catch (e) { return null; } }
    return obj(v);
  }
  // A money or size figure as stored: a finite number, else null (not known). Never 0 for missing.
  function known(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function thousands(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function mm(v) { var n = known(v); return n == null ? '' : thousands(n) + ' mm'; }
  function cap(s) { s = str(s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Catalogue ids to words: 'panel:solarspan:75' -> 'Solarspan 75', 'shs:90x90x2.0:c450l0' -> '90x90 SHS',
  // 'gutter:metroll-patioline' -> 'Metroll patioline'. An id it cannot read is shown as stored.
  function productWords(id) {
    var s = str(id);
    if (!s) return '';
    var p = s.split(':');
    var kind = p[0].toLowerCase();
    if ((kind === 'shs' || kind === 'rhs' || kind === 'chs') && p[1]) return p[1].replace(/x[\d.]+$/i, '').replace(/x(?=[\d.]+$)/i, 'x') + ' ' + kind.toUpperCase();
    if (p.length >= 2) return cap(p.slice(1).filter(function (x) { return !/^c\d+l\d+$/i.test(x); }).join(' ').replace(/[-_]/g, ' '));
    return s;
  }
  // Colorbond codes to words: 'CB-SURFMIST' -> 'Surfmist', 'CB-PALE-EUCALYPT' -> 'Pale eucalypt'.
  function colourWords(c) {
    var s = str(c).replace(/^CB[-_ ]/i, '').replace(/[-_]/g, ' ').toLowerCase();
    return cap(s);
  }

  function kindOf(scope) {
    if (!scope || !Object.keys(scope).length) return 'none';
    if (scope.tool === 'patio-scoper' && obj(scope.draft) && obj(scope.revision)) return 'engine-patio';
    var j = obj(scope.job);
    if ((j && (Array.isArray(j.runs) || Array.isArray(j.gates))) || Array.isArray(scope.sections)) return 'fence';
    if (obj(scope.config) || Array.isArray(scope.patios) || scope.length != null || scope.projection != null || scope.roofStyle) return 'old-patio';
    return 'unknown';
  }

  function revisionOf(r) {
    var rv = obj(r && r.revision);
    if (!rv) return null;
    return {
      n: known(rv.n), sealedAt: str(rv.sealedAt) || null, frozenId: str(rv.frozenId) || null,
      catalogue: str(rv.catalogueRevisionId) || null, outputsAgree: rv.outputsAgree === true
    };
  }

  function enginePatio(scope, out) {
    var d = obj(scope.draft) || {};
    var site = obj(d.site) || {};
    var de = obj(d.design) || {};
    var pr = obj(de.products) || {};
    var co = obj(de.colours) || {};
    var shape = str(de.shape);
    out.tool = 'Scope Engine';
    out.trade = 'patio';
    out.family = str(scope.family) || null;
    out.supported = scope.supported !== false;
    var rev = revisionOf(scope);
    if (rev) {
      rev.earlier = arr(scope.earlier).map(revisionOf).filter(Boolean).map(function (e) { return { n: e.n, sealedAt: e.sealedAt }; });
      rev.savedAt = str(scope.savedAt) || null;
      rev.options = arr(scope.options).map(function (o) { return obj(o) ? { letter: str(o.letter), name: str(o.name) } : null; }).filter(Boolean);
    }
    out.revision = rev;

    var w = known(de.widthMm), p = known(de.projectionMm), pe = known(de.projectionEastMm);
    var size = '';
    if (w != null && p != null) {
      size = thousands(w) + ' x ' + thousands(p) + (pe != null && pe !== p ? ' to ' + thousands(pe) : '') + ' mm';
      var area = w * (pe != null ? (p + pe) / 2 : p) / 1e6;
      if (area > 0) size += ' (' + (Math.round(area * 10) / 10) + ' m²)';
    }
    var add = function (group, label, value) { if (str(value)) out.inputs.push({ group: group, label: label, value: str(value) }); };
    add('Design', 'Roof', SHAPES[shape] || cap(shape.replace(/-/g, ' ')));
    add('Design', 'Fixing', FIXINGS[str(de.fixing)] || cap(de.fixing));
    add('Design', 'Size', size);
    add('Design', 'Height under beam', mm(de.frontHeightMm));
    if (known(de.pitchDeg) != null) add('Design', 'Pitch', known(de.pitchDeg) + '°');
    if (known(de.posts) != null) add('Design', 'Posts', known(de.posts) + (pr.post ? ', ' + productWords(pr.post) : ''));
    add('Design', 'Roof sheet', productWords(pr.covering));
    if (/^gable|^hip/.test(shape)) add('Design', 'Gable infill', productWords(pr.infill));
    add('Design', 'Frame colour', colourWords(co.frame));
    add('Design', 'Roof colour', colourWords(co.roof));
    add('Design', 'Trim colour', colourWords(co.trim));
    if (co.ceiling) add('Design', 'Ceiling colour', colourWords(co.ceiling));
    if (de.downpipes) add('Design', 'Downpipes', de.downpipes === 'both' ? 'Both ends' : cap(de.downpipes) + ' end');
    if (known(de.purlinRows) != null) add('Design', 'Purlin rows', String(known(de.purlinRows)));
    if (known(de.rafters) != null) add('Design', 'Rafters', String(known(de.rafters)));
    if (str(de.fixing) === 'freestanding') add('Design', 'Gap to house', mm(de.gapToHouseMm));
    if (shape === 'wrap-around') add('Design', 'Return wing', mm(de.returnMm));
    if (shape === 'reverse-skillion') add('Design', 'Box gutter', mm(de.boxGutterMm));

    if (site.storeys) add('Site', 'House', site.storeys === 'double' ? 'Double storey' : 'Single storey');
    add('Site', 'House roof', cap(site.houseRoof));
    add('Site', 'Fascia', site.fascia === 'none' ? 'No fascia' : cap(site.fascia));
    if (site.windClass) add('Site', 'Wind class', str(site.windClass) + (site.windClassDefault ? ' (Perth default)' : ''));
    var readings = obj(site.readings);
    if (readings) {
      var measured = READING_KEYS.filter(function (k) { var r = obj(readings[k]); return r && r.source === 'measured'; }).length;
      add('Site', 'Heights', site.sampleHeights ? 'Sample house heights' : measured + ' of ' + READING_KEYS.length + ' measured');
    }

    out.lines = arr(scope.lines).map(function (l) {
      l = obj(l);
      if (!l || !str(l.description)) return null;
      return { description: str(l.description), quantity: known(l.quantity), unit: str(l.unit), colour: str(l.colour) || null };
    }).filter(Boolean);
    out.documents = ENGINE_DOCUMENTS.map(function (doc) { return { key: doc.key, name: doc.name, revision: rev ? rev.n : null }; });
    out.toolUrl = ENGINE_PATIO_URL;
  }

  function fence(scope, out) {
    var j = obj(scope.job) || {};
    var runs = arr(j.runs).length ? arr(j.runs) : arr(scope.sections);
    out.tool = 'Fence designer';
    out.trade = 'fencing';
    var add = function (label, value) { if (str(value)) out.inputs.push({ group: 'Fence', label: label, value: str(value) }); };
    if (runs.length) {
      var metres = runs.reduce(function (s, r) { return s + (known(r && r.length) || 0); }, 0);
      add('Total', (Math.round(metres * 10) / 10) + ' m across ' + runs.length + ' run' + (runs.length === 1 ? '' : 's'));
      var panels = runs.reduce(function (s, r) { return s + arr(r && r.panels).length; }, 0);
      if (panels) add('Panels', String(panels));
    }
    add('Colour', j.sheetColour || j.colour);
    add('Profile', j.profile);
    runs.forEach(function (r, i) {
      r = obj(r) || {};
      add(str(r.name) || 'Run ' + (i + 1), (known(r.length) != null ? known(r.length) : '?') + ' m, ' + (known(r.sheetHeight) || 1800) + ' mm high' + (r.retaining ? ', retaining' : ''));
    });
    var gates = arr(j.gates).length ? arr(j.gates) : arr(scope.gates);
    if (gates.length) add('Gates (' + gates.length + ')', gates.map(function (g) { g = obj(g) || {}; return (str(g.type) || 'pedestrian') + ' (' + (known(g.width) || 900) + ' mm)'; }).join(', '));
    var rm = obj(j.removal) || obj(scope.removal);
    var rmLen = rm ? (known(rm.totalMetres) || known(rm.length) || 0) : 0;
    if (rmLen > 0) add('Removal', rmLen + ' m old fence');
    var nf = [
      ['Site notes', j.siteNotes], ['Final notes', obj(j.checklist) && j.checklist.finalNotes],
      ['Removal notes', rm && rm.notes], ['Supplier notes', j.supplierNotes]
    ];
    nf.forEach(function (n) { if (str(n[1])) out.notes.push({ label: n[0], text: str(n[1]) }); });
    out.toolUrl = FENCE_URL;
  }

  function oldPatio(scope, out) {
    var c = obj(scope.config) || scope;
    out.tool = 'Patio page';
    out.trade = 'patio';
    var add = function (label, value) { if (str(value)) out.inputs.push({ group: 'Patio', label: label, value: str(value) }); };
    if (c.length || c.projection) {
      var a = known(c.length) * known(c.projection);
      add('Size', (str(c.length) || '?') + 'm x ' + (str(c.projection) || '?') + 'm' + (isFinite(a) && a > 0 ? ' (' + a.toFixed(1) + ' m²)' : ''));
    }
    add('Roof style', c.roofStyle);
    add('Roofing', c.roofing || c.panel_type);
    add('Connection', c.connection);
    add('Sheet colour', c.sheetColor);
    add('Steel colour', c.steelColor);
    var posts = c.posts;
    var count = str(c.post_count) || str(obj(posts) && posts.count) || (obj(posts) ? '' : str(posts));
    if (count) add('Posts', count + ' x ' + (str(c.post_size) || str(obj(posts) && posts.size) || '100x100 SHS'));
    var notes = scope.notes;
    if (typeof notes === 'string' && str(notes)) out.notes.push({ label: 'Notes', text: str(notes) });
    else if (obj(notes)) {
      [['Internal', 'noteInternal'], ['Material order', 'noteMaterialOrder'], ['Work order', 'noteWorkOrder'], ['Quote', 'noteQuote'], ['Pricing', 'pricingNotes']]
        .forEach(function (n) { if (str(notes[n[1]])) out.notes.push({ label: n[0], text: str(notes[n[1]]) }); });
    }
    out.toolUrl = OLD_PATIO_URL;
  }

  // The money the tool saved, under the names the job system reads (pricing_json). null = not known.
  function moneyOf(pj) {
    pj = pj || {};
    var totals = obj(pj.totals) || {};
    var dep = obj(pj.deposit);
    var inc = known(pj.totalIncGST != null ? pj.totalIncGST : (totals.total_inc_gst != null ? totals.total_inc_gst : totals.totalIncGst));
    var ex = known(pj.totalExGST != null ? pj.totalExGST : totals.total_ex_gst);
    var gst = known(pj.gst != null ? pj.gst : totals.gst);
    var m = {
      saleIncGst: inc, saleExGst: ex, gst: gst,
      materials: known(pj.materialCostEstimate), labour: known(pj.labourCostEstimate),
      commission: known(pj.commissionCostEstimate), cost: known(pj.totalCostEstimate),
      marginPct: known(pj.margin_pct), marginIsTarget: pj.margin_basis === 'selected_target',
      description: str(pj.job_description) || null,
      deposit: dep ? { percent: known(dep.percent), amount: known(dep.total_deposit_inc_gst), words: str(dep.description) || null } : null,
      complete: pj.pricing_complete === true || (pj.pricing_complete == null && inc != null),
      costsComplete: obj(pj.internal) ? pj.internal.costs_complete === true : null,
      toConfirm: arr(obj(pj.internal) && pj.internal.costs_to_confirm).concat(arr(pj.sell_to_confirm)).map(str).filter(Boolean)
    };
    // A cost total with a part missing is a cost so far, never the whole cost.
    m.costIsPartial = m.cost != null && (m.materials == null || m.labour == null || m.commission == null);
    return m;
  }

  // The one read. `job` is a job_detail job row (scope_json and pricing_json as stored, string or object).
  function read(job) {
    job = obj(job) || {};
    var scope = parse(job.scope_json);
    var out = {
      kind: kindOf(scope), tool: null, trade: str(job.type) || null, family: null, supported: true,
      revision: null, inputs: [], notes: [], lines: [], documents: [], toolUrl: null
    };
    if (out.kind === 'engine-patio') enginePatio(scope, out);
    else if (out.kind === 'fence') fence(scope, out);
    else if (out.kind === 'old-patio') oldPatio(scope, out);
    if (!out.toolUrl) out.toolUrl = toolUrlFor(job);
    out.money = moneyOf(parse(job.pricing_json));
    return out;
  }

  // The scoping tool a job opens in. The older tools are retired (T43): every fence job opens the
  // Scope Engine fence page, which reads the fence designer's saved shape, and every patio job opens the
  // Scope Engine patio page. The one exception is a patio job already scoped in the older patio page:
  // the Scope Engine never writes over a scope it did not make, so that job carries on where it started.
  function toolUrlFor(job, scope) {
    job = obj(job) || {};
    if (str(job.type) === 'fencing') return FENCE_URL;
    var s = scope !== undefined ? obj(scope) : parse(job.scope_json);
    if (kindOf(s) === 'old-patio') return OLD_PATIO_URL;
    if (s) return ENGINE_PATIO_URL;
    // A job list row carries no scope_json, only the pricing's tool (ops-api pipeline pj_tool). Pricing
    // from another tool means the older patio page scoped it.
    var pj = parse(job.pricing_json);
    var priced = job.pj_tool || (pj && Object.keys(pj).length);
    if (priced && job.pj_tool !== 'patio-scoper' && !(pj && pj.tool === 'patio-scoper')) return OLD_PATIO_URL;
    return ENGINE_PATIO_URL;
  }
  function openUrl(job) {
    job = obj(job) || {};
    return toolUrlFor(job) + (job.id ? '?jobId=' + encodeURIComponent(job.id) : '');
  }

  // ── Words ──
  function esc(v) {
    return str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function dollars(n) {
    if (n == null) return '';
    var neg = n < 0, v = Math.abs(Math.round(n * 100) / 100);
    var whole = Math.floor(v), cents = Math.round((v - whole) * 100);
    return (neg ? '-$' : '$') + thousands(whole) + '.' + (cents < 10 ? '0' : '') + cents;
  }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Perth time (UTC+8 all year) whatever zone the browser is in: 'Sat 25 Oct, 2:41pm'.
  function perthWords(iso, dateOnly) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return '';
    var d = new Date(t + 8 * 3600000);
    var h = d.getUTCHours(), mi = d.getUTCMinutes();
    var day = DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
    return dateOnly ? day : day + ', ' + (h % 12 || 12) + ':' + (mi < 10 ? '0' : '') + mi + (h < 12 ? 'am' : 'pm');
  }
  function perthClock(iso) { var w = perthWords(iso); return w.slice(w.indexOf(', ') + 2); }

  // One line for a job card or summary: 'Gable, end to the yard, 7,200 x 4,500 mm (32.4 m2), Trimdek'.
  function summaryLine(rec) {
    if (!rec || rec.kind === 'none' || rec.kind === 'unknown') return '';
    var pick = function (label) { var f = rec.inputs.filter(function (i) { return i.label === label; })[0]; return f ? f.value : ''; };
    if (rec.kind === 'engine-patio') return [pick('Roof'), pick('Size'), pick('Roof sheet')].filter(Boolean).join(', ');
    if (rec.kind === 'fence') return [pick('Total'), pick('Profile'), pick('Colour')].filter(Boolean).join(', ');
    return [pick('Size'), pick('Roof style'), pick('Roofing')].filter(Boolean).join(', ');
  }
  // 'Rev 3 sealed Sat 25 Oct, 2:41pm, saved to this job 2:44pm. 2 earlier revisions kept.'
  // bare: the same without 'Rev 3' in front, for a line that already shows the number.
  function revisionWords(rec, bare) {
    var r = rec && rec.revision;
    if (!r || r.n == null) return '';
    var s = (bare ? 'Sealed ' : 'Rev ' + r.n + ' sealed ') + perthWords(r.sealedAt);
    if (r.savedAt) s += ', saved to this job ' + (perthWords(r.savedAt, true) === perthWords(r.sealedAt, true) ? perthClock(r.savedAt) : perthWords(r.savedAt));
    s += '.';
    var e = arr(r.earlier).length;
    if (e) s += ' ' + e + ' earlier revision' + (e === 1 ? '' : 's') + ' kept.';
    return s;
  }

  // ── SecureSuite blocks (ops.html styles: --sw-* tokens, square cards, uppercase section labels) ──
  var LABEL = 'font-size:11px;font-weight:700;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.5px;';
  var CARD = 'background:var(--sw-card);padding:14px;margin-bottom:12px;box-shadow:var(--sw-shadow);';
  var CHIP = 'display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:var(--sw-radius-pill,100px);';
  var LINK = 'font-size:11px;color:var(--sw-mid);font-weight:600;text-decoration:none;';

  function openLinkHtml(rec, jobId, words) {
    var u = (rec && rec.toolUrl) || OLD_PATIO_URL;
    return '<a href="' + esc(u + (jobId ? '?jobId=' + encodeURIComponent(jobId) : '')) + '" target="_blank" rel="noopener" style="' + LINK + '">' +
      esc(words || ('Open in ' + ((rec && rec.tool) || 'Scope Tool'))) + ' &#8599;</a>';
  }
  function factsHtml(inputs) {
    if (!inputs.length) return '';
    var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px;">';
    inputs.forEach(function (f) {
      h += '<div style="background:var(--sw-light);padding:6px 9px;min-width:0;"><div style="font-size:10px;color:var(--sw-text-sec);">' + esc(f.label) +
        '</div><div style="font-size:12px;font-weight:600;color:var(--sw-dark);overflow-wrap:anywhere;">' + esc(f.value) + '</div></div>';
    });
    return h + '</div>';
  }
  function groupedFactsHtml(rec) {
    var groups = [];
    rec.inputs.forEach(function (f) { if (groups.indexOf(f.group) < 0) groups.push(f.group); });
    return groups.map(function (g, i) {
      return '<div style="' + LABEL + 'font-size:10px;margin:' + (i ? '10px' : '0') + ' 0 4px;">' + esc(g) + '</div>' +
        factsHtml(rec.inputs.filter(function (f) { return f.group === g; }));
    }).join('');
  }
  function notesHtml(rec) {
    if (!rec.notes.length) return '';
    return '<div style="margin-top:10px;font-size:12px;line-height:1.6;">' + rec.notes.map(function (n) {
      return '<div><strong style="color:var(--sw-dark);">' + esc(n.label) + ':</strong> ' + esc(n.text).replace(/\n/g, '<br>') + '</div>';
    }).join('') + '</div>';
  }
  function revisionStripHtml(rec) {
    var r = rec.revision;
    if (!r || r.n == null) return '';
    var h = '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:8px 10px;background:var(--sw-light);margin-bottom:10px;">';
    h += '<span style="font-size:18px;font-weight:700;color:var(--sw-dark);font-family:var(--sw-font-num);">Rev ' + esc(r.n) + '</span>';
    h += '<span style="font-size:12px;color:var(--sw-text);flex:1;min-width:180px;">' + esc(revisionWords(rec, true)) + '</span>';
    h += r.outputsAgree ? '<span style="' + CHIP + 'background:var(--sw-green);color:#fff;">Documents agree</span>'
      : '<span style="' + CHIP + 'background:var(--sw-yellow);color:#fff;">Documents not checked</span>';
    if (arr(r.options).length > 1) h += '<span style="' + CHIP + 'background:var(--sw-card);color:var(--sw-dark);border:1px solid var(--sw-border);">Options ' + esc(r.options.map(function (o) { return o.letter; }).join(', ')) + '</span>';
    return h + '</div>';
  }
  function documentsHtml(rec, jobId) {
    if (!rec.documents.length) return '';
    var url = rec.toolUrl + (jobId ? '?jobId=' + encodeURIComponent(jobId) : '');
    var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;">';
    rec.documents.forEach(function (d) {
      h += '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--sw-border);background:var(--sw-card);text-decoration:none;color:var(--sw-dark);min-width:0;">' +
        '<span style="flex:none;width:24px;height:30px;display:grid;place-items:center;background:var(--sw-orange-tint);color:var(--sw-orange);font-size:8px;font-weight:700;">PDF</span>' +
        '<span style="min-width:0;"><span style="display:block;font-size:12px;font-weight:700;">' + esc(d.name) + '</span>' +
        '<span style="display:block;font-size:10px;color:var(--sw-text-sec);">Rev ' + esc(d.revision) + ', opens in the Scope Engine</span></span></a>';
    });
    return h + '</div>';
  }
  function linesHtml(rec, max) {
    if (!rec.lines.length) return '';
    var shown = max ? rec.lines.slice(0, max) : rec.lines;
    var h = '<div style="overflow-x:auto;"><table class="data-table" style="font-size:12px;width:100%;"><thead><tr><th>Line</th><th style="text-align:right">Qty</th><th>Unit</th><th>Colour</th></tr></thead><tbody>';
    shown.forEach(function (l) {
      h += '<tr><td>' + esc(l.description) + '</td><td style="text-align:right;font-family:var(--sw-font-num);">' + (l.quantity == null ? 'Not known' : esc(l.quantity)) + '</td><td>' + esc(l.unit) + '</td><td>' + esc(l.colour || '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (shown.length < rec.lines.length) h += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:4px;">and ' + (rec.lines.length - shown.length) + ' more lines in the Build tab</div>';
    return h;
  }
  // The Overview's Scope card: revision, what was scoped, notes, the documents of that revision.
  function scopeCardHtml(rec, jobId) {
    if (!rec || rec.kind !== 'engine-patio') return '';
    var h = '<div style="' + CARD + '" data-scope-card="engine">';
    h += '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:8px;"><span style="' + LABEL + '">Scope</span>' +
      '<span style="font-size:11px;color:var(--sw-text-sec);flex:1;">from the Scope Engine, as sealed</span>' + openLinkHtml(rec, jobId) + '</div>';
    h += revisionStripHtml(rec) + groupedFactsHtml(rec) + notesHtml(rec);
    if (!rec.supported) h += '<div style="margin-top:10px;padding:8px 10px;background:var(--sw-orange-tint);font-size:12px;color:var(--sw-dark);">This roof family is not quoted by the Scope Engine yet, so it carries no price.</div>';
    h += '<div style="' + LABEL + 'margin:12px 0 6px;">Documents</div>' + documentsHtml(rec, jobId);
    return h + '</div>';
  }
  // The money the scope tool sealed, for the Money tab's Costs column. Unknown is said, never $0.
  function costsCardHtml(rec) {
    var m = rec && rec.money;
    if (!m || (m.materials == null && m.labour == null && m.cost == null && m.saleExGst == null)) return '';
    var row = function (label, v, note) {
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:12px;"><span style="color:var(--sw-text-sec);">' + esc(label) + '</span>' +
        (v == null ? '<strong style="color:var(--sw-yellow);">' + esc(note || 'Not known yet') + '</strong>' : '<strong style="font-family:var(--sw-font-num);">' + esc(dollars(v)) + '</strong>') + '</div>';
    };
    var title = rec.revision && rec.revision.n != null ? 'Estimated costs, Rev ' + rec.revision.n : 'Estimated costs';
    var h = '<div class="jd-money-card" data-scope-costs="1"><div class="jd-money-card-head"><span>' + esc(title) + '</span><strong style="color:var(--sw-text-sec)">' +
      esc(m.cost == null ? 'Not known yet' : dollars(m.cost) + (m.costIsPartial ? ' so far' : '')) + '</strong></div>';
    h += '<div style="margin-top:6px;">' + row('Materials', m.materials) + row('Labour', m.labour) + row('Sales commission', m.commission);
    if (m.marginPct != null) h += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;"><span style="color:var(--sw-text-sec);">' + (m.marginIsTarget ? 'Margin target (scoper)' : 'Margin') + '</span><strong>' + esc(m.marginPct) + '%</strong></div>';
    if (m.deposit && m.deposit.percent != null) h += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;"><span style="color:var(--sw-text-sec);">Deposit</span><strong style="font-family:var(--sw-font-num);">' + esc(m.deposit.percent + '%' + (m.deposit.amount != null ? ', ' + dollars(m.deposit.amount) : '')) + '</strong></div>';
    h += '</div>';
    if (m.toConfirm.length) h += '<div class="jd-money-card-sub" style="color:var(--sw-yellow);">Still to price: ' + esc(m.toConfirm.join(', ')) + '</div>';
    return h + '</div>';
  }
  // The margin the sealed costs give, ex GST: { pct, words } or null when the sale or the costs are not known.
  function estimatedMargin(rec) {
    var m = rec && rec.money;
    if (!m || m.saleExGst == null || !(m.saleExGst > 0) || m.cost == null) return null;
    var pct = Math.round((m.saleExGst - m.cost) / m.saleExGst * 1000) / 10;
    return { pct: pct, words: 'Estimated margin ' + pct + '%' + (m.costIsPartial ? ' before ' + [m.materials == null ? 'materials' : '', m.labour == null ? 'labour' : '', m.commission == null ? 'commission' : ''].filter(Boolean).join(', ') : '') };
  }

  var api = {
    read: read, kindOf: function (v) { return kindOf(parse(v)); }, moneyOf: function (v) { return moneyOf(parse(v)); },
    summaryLine: summaryLine, revisionWords: revisionWords, perthWords: perthWords, dollars: dollars,
    scopeCardHtml: scopeCardHtml, costsCardHtml: costsCardHtml, documentsHtml: documentsHtml, linesHtml: linesHtml,
    groupedFactsHtml: groupedFactsHtml, revisionStripHtml: revisionStripHtml, notesHtml: notesHtml, openLinkHtml: openLinkHtml,
    estimatedMargin: estimatedMargin,
    toolUrlFor: toolUrlFor, openUrl: openUrl, productWords: productWords, colourWords: colourWords,
    ENGINE_PATIO_URL: ENGINE_PATIO_URL, OLD_PATIO_URL: OLD_PATIO_URL, FENCE_URL: FENCE_URL
  };
  root.JobScopeRecord = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
