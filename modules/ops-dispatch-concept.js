/* <ops-dispatch-concept>
 * Dispatch tab (Captain 2026-10-06): a clickable concept of the earlier
 * SecureWorks Dispatch workbench (accepted-work queue, material requirements
 * per job, linked purchase orders, supplier messages and a week of deliveries).
 * It replaced the Materials tab in the Ops nav.
 *
 * CONCEPT ONLY. Every job, item, PO and message below is invented sample data
 * held in this file. The module makes no network call, reads no live job,
 * saves nothing, orders nothing and sends nothing; its action buttons only say
 * what the live system would do. Keep it that way until a real Dispatch
 * back end is approved: the earlier build's contract is in the safekeep branch
 * safekeep/2026-09-23/rayleigh/dispatch-ui-20260912 (docs/dispatch-workbench.md).
 */
(function (global) {
  'use strict';

  var TYPES = [
    { key: 'all', label: 'All' },
    { key: 'fencing', label: 'Fencing' },
    { key: 'patio', label: 'Patio' },
    { key: 'decking', label: 'Decking' }
  ];

  // Day offsets are from Monday of the current week, so the sample always
  // lands in the week on screen.
  var JOBS = [
    {
      id: 'demo-1', number: 'DEMO-F101', type: 'fencing', suburb: 'Baldivis',
      summary: '42 m Colorbond boundary fence, 1 gate', installDay: 3, crew: 'Fencing crew A',
      next: 'Order steel',
      groups: [
        { name: 'Steel and sheets', items: [
          { item: 'Colorbond sheet 2.1 m (Monument)', qty: '18', unit: 'sheets', supplier: 'Steel supplier', status: 'needed' },
          { item: 'Steel post 65x65 2.4 m', qty: '16', unit: 'posts', supplier: 'Steel supplier', status: 'needed' },
          { item: 'Top and bottom rail 2.4 m', qty: '36', unit: 'rails', supplier: 'Steel supplier', status: 'needed' }
        ] },
        { name: 'Gate and hardware', items: [
          { item: 'Single swing gate kit 900 mm', qty: '1', unit: 'kit', supplier: 'Hardware store', status: 'in_stock' },
          { item: 'Concrete 20 kg bags', qty: '20', unit: 'bags', supplier: 'Hardware store', status: 'in_stock' }
        ] }
      ],
      pos: [],
      sources: [
        { label: 'Signed quote', detail: 'Accepted on the sample quote, 42 m run and one gate' },
        { label: 'Scoper notes', detail: 'Old fence removal included. Side access is narrow, small truck only.' }
      ],
      messages: []
    },
    {
      id: 'demo-2', number: 'DEMO-P204', type: 'patio', suburb: 'Ellenbrook',
      summary: '6 x 4 m flat patio, insulated roof', installDay: 4, crew: 'Patio crew B',
      next: 'Confirm delivery',
      groups: [
        { name: 'Frame', items: [
          { item: 'Post 90x90 SHS 3.0 m', qty: '4', unit: 'posts', supplier: 'Patio supplier', status: 'ordered' },
          { item: 'Beam 150 C-section 6.0 m', qty: '2', unit: 'beams', supplier: 'Patio supplier', status: 'ordered' }
        ] },
        { name: 'Roof', items: [
          { item: 'Insulated roof panel 75 mm 4.0 m', qty: '6', unit: 'panels', supplier: 'Patio supplier', status: 'ordered' },
          { item: 'Flashing and gutter set', qty: '1', unit: 'set', supplier: 'Patio supplier', status: 'ordered' }
        ] }
      ],
      pos: [
        { number: 'PO-DEMO-0311', supplier: 'Patio supplier', total: '$4,860.00', status: 'Confirmed', delivery: 2 }
      ],
      sources: [
        { label: 'Signed quote', detail: '6 x 4 m, colour Surfmist, 75 mm panel' },
        { label: 'Council', detail: 'Approval received, copy on the job' }
      ],
      messages: [
        { from: 'Patio supplier', subject: 'PO-DEMO-0311 confirmed', body: 'Order confirmed. Delivery booked for the morning run, site contact to be on hand.' }
      ]
    },
    {
      id: 'demo-3', number: 'DEMO-F118', type: 'fencing', suburb: 'Joondalup',
      summary: '18 m pool fence, glass panels', installDay: 1, crew: 'Fencing crew A',
      next: 'Check delivery',
      groups: [
        { name: 'Glass', items: [
          { item: 'Frameless glass panel 1200 mm', qty: '14', unit: 'panels', supplier: 'Glass supplier', status: 'delivered' },
          { item: 'Glass gate panel with hinge set', qty: '1', unit: 'set', supplier: 'Glass supplier', status: 'delivered' },
          { item: 'Spigot, core drilled', qty: '30', unit: 'spigots', supplier: 'Glass supplier', status: 'delivered' }
        ] }
      ],
      pos: [
        { number: 'PO-DEMO-0298', supplier: 'Glass supplier', total: '$6,120.00', status: 'Delivered', delivery: 0 }
      ],
      sources: [
        { label: 'Signed quote', detail: '18 m frameless glass, one self-closing gate' }
      ],
      messages: [
        { from: 'Glass supplier', subject: 'Delivered to site', body: 'All panels delivered and signed for. Photo of the stack is on the docket.' }
      ]
    },
    {
      id: 'demo-4', number: 'DEMO-D057', type: 'decking', suburb: 'Mandurah',
      summary: '24 m2 merbau deck on steel subframe', installDay: 8, crew: 'Decking crew C',
      next: 'Review list',
      groups: [
        { name: 'Boards', items: [
          { item: 'Merbau decking 140x19, random lengths', qty: '180', unit: 'lin m', supplier: 'Timber yard', status: 'review' },
          { item: 'Deck screws, stainless, box of 500', qty: '2', unit: 'boxes', supplier: 'Timber yard', status: 'review' }
        ] },
        { name: 'Subframe', items: [
          { item: 'Steel joist 100 mm 5.0 m', qty: '9', unit: 'joists', supplier: 'Steel supplier', status: 'review' }
        ] }
      ],
      pos: [],
      sources: [
        { label: 'Scope', detail: 'Measured on site. Two steps down to the lawn.' }
      ],
      messages: []
    },
    {
      id: 'demo-5', number: 'DEMO-P221', type: 'patio', suburb: 'Canning Vale',
      summary: 'Gable patio 7 x 5 m, colour matched', installDay: 9, crew: 'Patio crew B',
      next: 'Order frame',
      groups: [
        { name: 'Frame and roof', items: [
          { item: 'Gable truss kit 7 m span', qty: '4', unit: 'trusses', supplier: 'Patio supplier', status: 'needed' },
          { item: 'Roof sheet trimdek 5.2 m', qty: '14', unit: 'sheets', supplier: 'Patio supplier', status: 'needed' }
        ] }
      ],
      pos: [],
      sources: [
        { label: 'Signed quote', detail: 'Gable 7 x 5 m, colour matched to the house roof' }
      ],
      messages: []
    }
  ];

  // Extra logistics on the week strip that are not deliveries against a PO.
  var LOGISTICS = [
    { day: 0, label: 'Yard pickup', detail: 'Offcuts back to the yard, Baldivis run' },
    { day: 3, label: 'Skip bin swap', detail: 'Old fence removal, DEMO-F101' }
  ];

  var STATUS = {
    review: { label: 'Not reviewed', tone: 'muted' },
    needed: { label: 'To order', tone: 'warn' },
    in_stock: { label: 'In stock', tone: 'ok' },
    ordered: { label: 'On PO', tone: 'info' },
    delivered: { label: 'Delivered', tone: 'ok' }
  };

  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var state = { type: 'all', search: '', jobId: JOBS[0].id, tab: 'sources', layers: { deliveries: true, installs: true, logistics: true }, note: '' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function weekMonday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    return d;
  }

  function dayLabel(offset) {
    var d = weekMonday();
    d.setDate(d.getDate() + offset);
    return DAY_NAMES[(d.getDay() + 6) % 7] + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
  }

  function selectedJob() {
    for (var i = 0; i < JOBS.length; i++) if (JOBS[i].id === state.jobId) return JOBS[i];
    return JOBS[0];
  }

  function visibleJobs() {
    var q = state.search.trim().toLowerCase();
    return JOBS.filter(function (j) {
      if (state.type !== 'all' && j.type !== state.type) return false;
      if (!q) return true;
      return (j.number + ' ' + j.suburb + ' ' + j.summary).toLowerCase().indexOf(q) >= 0;
    });
  }

  function itemCounts(job) {
    var total = 0, ready = 0;
    job.groups.forEach(function (g) {
      g.items.forEach(function (it) {
        total++;
        if (it.status === 'delivered' || it.status === 'in_stock') ready++;
      });
    });
    return { total: total, ready: ready };
  }

  function renderQueue() {
    var html = '<aside class="dpc-panel dpc-queue" aria-label="Accepted work">';
    html += '<div class="dpc-pad"><h3>Accepted work</h3>';
    html += '<div class="dpc-chips" role="group" aria-label="Work type">';
    TYPES.forEach(function (t) {
      html += '<button type="button" data-dpc-type="' + t.key + '" aria-pressed="' + (state.type === t.key) + '">' + esc(t.label) + '</button>';
    });
    html += '</div>';
    html += '<input type="search" class="dpc-search" data-dpc-search placeholder="Search sample jobs" value="' + esc(state.search) + '" aria-label="Search sample jobs">';
    html += '</div><div class="dpc-job-list">';
    var jobs = visibleJobs();
    if (!jobs.length) html += '<div class="dpc-empty">No sample jobs match.</div>';
    jobs.forEach(function (j) {
      var c = itemCounts(j);
      html += '<button type="button" class="dpc-job" data-dpc-job="' + esc(j.id) + '" aria-pressed="' + (j.id === state.jobId) + '">';
      html += '<span class="dpc-job-top"><span class="dpc-type dpc-type-' + esc(j.type) + '">' + esc(j.type) + '</span><span class="dpc-next">' + esc(j.next) + '</span></span>';
      html += '<strong>' + esc(j.number) + ' &middot; ' + esc(j.suburb) + '</strong>';
      html += '<span>' + esc(j.summary) + '</span>';
      html += '<span class="dpc-muted">' + c.ready + ' of ' + c.total + ' items ready &middot; install ' + esc(dayLabel(j.installDay)) + '</span>';
      html += '</button>';
    });
    html += '</div><div class="dpc-foot">Sample queue. Live Dispatch would list accepted jobs that still need materials.</div>';
    return html + '</aside>';
  }

  function renderWorkspace(job) {
    var c = itemCounts(job);
    var html = '<section class="dpc-panel dpc-workspace" aria-label="Job materials">';
    html += '<div class="dpc-workhead"><div class="dpc-row"><h2 class="dpc-grow">' + esc(job.number) + ' &middot; ' + esc(job.suburb) + '</h2>';
    html += '<span class="dpc-type dpc-type-' + esc(job.type) + '">' + esc(job.type) + '</span></div>';
    html += '<p>' + esc(job.summary) + '</p>';
    html += '<p class="dpc-muted">Install ' + esc(dayLabel(job.installDay)) + ' &middot; ' + esc(job.crew) + ' &middot; ' + c.ready + ' of ' + c.total + ' items ready</p></div>';
    html += '<div class="dpc-pad">';
    job.groups.forEach(function (g) {
      html += '<h3 class="dpc-group-name">' + esc(g.name) + '</h3>';
      html += '<div class="dpc-tablewrap"><table class="dpc-table"><thead><tr><th>Item</th><th>Qty</th><th>Supplier</th><th>Status</th></tr></thead><tbody>';
      g.items.forEach(function (it) {
        var s = STATUS[it.status] || { label: it.status, tone: 'muted' };
        html += '<tr><td>' + esc(it.item) + '</td><td>' + esc(it.qty) + ' <small>' + esc(it.unit) + '</small></td><td>' + esc(it.supplier) + '</td>';
        html += '<td><span class="dpc-status dpc-tone-' + s.tone + '">' + esc(s.label) + '</span></td></tr>';
      });
      html += '</tbody></table></div>';
    });
    html += '<div class="dpc-actions">';
    html += '<button type="button" class="dpc-primary" data-dpc-act="po">Prepare purchase order</button>';
    html += '<button type="button" data-dpc-act="email">Draft supplier email</button>';
    html += '<button type="button" data-dpc-act="receive">Mark delivered</button>';
    html += '</div>';
    if (state.note) html += '<div class="dpc-note" role="status">' + esc(state.note) + '</div>';
    html += '</div></section>';
    return html;
  }

  function renderContext(job) {
    var tabs = [
      { key: 'sources', label: 'Sources' },
      { key: 'pos', label: 'Purchase orders (' + job.pos.length + ')' },
      { key: 'messages', label: 'Messages (' + job.messages.length + ')' }
    ];
    var html = '<aside class="dpc-panel dpc-context" aria-label="Job context"><div class="dpc-tabs" role="tablist">';
    tabs.forEach(function (t) {
      html += '<button type="button" role="tab" data-dpc-tab="' + t.key + '" aria-selected="' + (state.tab === t.key) + '">' + esc(t.label) + '</button>';
    });
    html += '</div><div class="dpc-pad" role="tabpanel">';
    if (state.tab === 'sources') {
      job.sources.forEach(function (s) {
        html += '<div class="dpc-source"><strong>' + esc(s.label) + '</strong><p>' + esc(s.detail) + '</p></div>';
      });
    } else if (state.tab === 'pos') {
      if (!job.pos.length) html += '<div class="dpc-empty">No purchase order yet. Prepare one from the materials list.</div>';
      job.pos.forEach(function (po) {
        html += '<div class="dpc-po"><strong>' + esc(po.number) + '</strong><span>' + esc(po.supplier) + ' &middot; ' + esc(po.total) + '</span>';
        html += '<span>' + esc(po.status) + ' &middot; delivery ' + esc(dayLabel(po.delivery)) + '</span></div>';
      });
    } else {
      if (!job.messages.length) html += '<div class="dpc-empty">No supplier messages on this sample job.</div>';
      job.messages.forEach(function (m) {
        html += '<div class="dpc-source"><strong>' + esc(m.subject) + '</strong><p class="dpc-muted">From ' + esc(m.from) + '</p><p>' + esc(m.body) + '</p></div>';
      });
    }
    html += '</div></aside>';
    return html;
  }

  function weekEvents() {
    var ev = [];
    JOBS.forEach(function (j) {
      if (state.layers.installs && j.installDay < 7) ev.push({ day: j.installDay, layer: 'installs', label: 'Install ' + j.number, detail: j.crew, jobId: j.id });
      if (state.layers.deliveries) {
        j.pos.forEach(function (po) {
          if (po.delivery < 7) ev.push({ day: po.delivery, layer: 'deliveries', label: 'Delivery ' + po.number, detail: po.supplier + ' to ' + j.suburb, jobId: j.id });
        });
      }
    });
    if (state.layers.logistics) LOGISTICS.forEach(function (l) { ev.push({ day: l.day, layer: 'logistics', label: l.label, detail: l.detail }); });
    return ev;
  }

  function renderWeek() {
    var layers = [
      { key: 'deliveries', label: 'Deliveries' },
      { key: 'installs', label: 'Installs' },
      { key: 'logistics', label: 'Pickups and bins' }
    ];
    var html = '<section class="dpc-panel dpc-week" aria-label="This week"><div class="dpc-pad"><div class="dpc-row dpc-wrap"><h3 class="dpc-grow">This week</h3>';
    layers.forEach(function (l) {
      html += '<label class="dpc-layer dpc-layer-' + l.key + '"><input type="checkbox" data-dpc-layer="' + l.key + '"' + (state.layers[l.key] ? ' checked' : '') + '> ' + esc(l.label) + '</label>';
    });
    html += '</div><div class="dpc-days">';
    var ev = weekEvents();
    for (var d = 0; d < 7; d++) {
      html += '<div class="dpc-day"><div class="dpc-day-head">' + esc(dayLabel(d)) + '</div><div class="dpc-events">';
      ev.filter(function (e) { return e.day === d; }).forEach(function (e) {
        var sel = e.jobId && e.jobId === state.jobId ? ' dpc-selected' : '';
        var attr = e.jobId ? ' data-dpc-job="' + esc(e.jobId) + '"' : ' disabled';
        html += '<button type="button" class="dpc-event dpc-layer-' + e.layer + sel + '"' + attr + '><strong>' + esc(e.label) + '</strong><span>' + esc(e.detail) + '</span></button>';
      });
      html += '</div></div>';
    }
    html += '</div></div></section>';
    return html;
  }

  var ACTION_NOTES = {
    po: 'Concept only. Live Dispatch would save a purchase order draft from the items marked To order, for you to check before anything goes to the supplier. Nothing was saved.',
    email: 'Concept only. Live Dispatch would draft the supplier email with the PO attached, for you to read and approve before it sends. Nothing was sent.',
    receive: 'Concept only. Live Dispatch would record who received the delivery and when, against the PO. Nothing was recorded.'
  };

  function render() {
    var root = document.getElementById('dispatchConceptRoot');
    if (!root) return;
    var job = selectedJob();
    var html = '<div class="dpc">';
    html += '<div class="dpc-banner" role="note"><strong>Concept preview.</strong> Sample jobs only. This concept section does not read live jobs and cannot order, save or send anything. The Purchase orders board below it is live.</div>';
    html += '<div class="dpc-header"><h1>Dispatch</h1><p>Accepted work, what each job needs, and how the materials get to site.</p></div>';
    html += '<div class="dpc-layout">' + renderQueue() + renderWorkspace(job) + renderContext(job) + '</div>';
    html += renderWeek();
    html += '</div>';
    root.innerHTML = html;
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-dpc-type],[data-dpc-job],[data-dpc-tab],[data-dpc-act]') : null;
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-dpc-type')) { state.type = t.getAttribute('data-dpc-type'); }
    else if (t.hasAttribute('data-dpc-job')) { state.jobId = t.getAttribute('data-dpc-job'); state.note = ''; }
    else if (t.hasAttribute('data-dpc-tab')) { state.tab = t.getAttribute('data-dpc-tab'); }
    else if (t.hasAttribute('data-dpc-act')) { state.note = ACTION_NOTES[t.getAttribute('data-dpc-act')] || ''; }
    render();
  }

  function onInput(e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-dpc-search')) {
      state.search = t.value || '';
      render();
      var again = document.querySelector('#dispatchConceptRoot [data-dpc-search]');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-dpc-layer')) {
      state.layers[t.getAttribute('data-dpc-layer')] = !!t.checked;
      render();
    }
  }

  var wired = false;
  function show() {
    var root = document.getElementById('dispatchConceptRoot');
    if (!root) return;
    if (!wired) {
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onChange);
      wired = true;
    }
    render();
  }

  global.OpsDispatchConcept = { show: show, sampleJobs: JOBS };
})(window);
