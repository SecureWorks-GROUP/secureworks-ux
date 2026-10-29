// Own group shares in the normal weekly invoice. Server owns prices and gates.
(function () {
  'use strict';
  var api, changed, owner = '', state = 'idle', groups = [], jobIds = [], selected = {}, busy = '', generation = 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(n) { return Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function use(transport, onChange, userId) {
    api = transport; changed = onChange;
    if (owner !== String(userId || '')) { owner = String(userId || ''); reset(); }
  }
  function reset() { generation++; state = 'idle'; groups = []; jobIds = []; selected = {}; busy = ''; }
  function load(force) {
    if (!api || state === 'loading' || (!force && state !== 'idle')) return;
    var seq = ++generation; state = 'loading';
    api('my_group_work_orders').then(function(res) {
      if (seq !== generation) return;
      if (!res || !Array.isArray(res.groups)) throw new Error('Group work orders could not be checked.');
      groups = res.groups; jobIds = res.group_job_ids || groups.map(function(g) { return g.job_id; }); state = 'ready';
      Object.keys(selected).forEach(function(id) { if (!groups.some(function(g) { return g.group_id === id && g.awaiting === 'frozen' && g.client_signed === true; })) delete selected[id]; });
      changed();
    }).catch(function() { if (seq === generation) { state = 'error'; changed(); } });
  }
  function isGroupJob(id) { return jobIds.some(function(jobId) { return String(jobId) === String(id); }); }
  function items() { return groups.filter(function(g) { return selected[g.group_id] && g.awaiting === 'frozen' && g.client_signed === true && Number(g.my_share) > 0; }).map(function(g) {
    return { type: 'group share', group_id: g.group_id, job_id: g.job_id, job_number: g.job_number, quantity: 1, rate: Number(g.my_share) };
  }); }
  function selectedIds() { return Object.keys(selected).filter(function(id) { return selected[id]; }); }
  function restore(ids) { selected = {}; (ids || []).forEach(function(id) { selected[String(id)] = true; }); }
  function total() { return Math.round(items().reduce(function(n,g) { return n + g.rate; },0) * 100) / 100; }
  function html() {
    var h = '<section data-invoice-groups style="margin:16px 0"><div class="inv-section-label">Group work orders</div>';
    if (state === 'idle' || state === 'loading') return h + '<p>Checking your group work orders…</p></section>';
    if (state === 'error') return h + '<p role="alert">Your group work orders could not be checked. Retry before submitting.</p><button type="button" class="btn btn-secondary" onclick="GroupWorkOrderInvoice.retry()">Retry group work orders</button></section>';
    if (!groups.length) return '';
    h += '<p style="font-size:12px;color:var(--sw-text-sec)">Your uninvoiced group work, including earlier weeks. Select a finalised share to include it in this invoice.</p>';
    groups.forEach(function(g) {
      var id = esc(g.group_id), frozen = g.awaiting === 'frozen' && g.client_signed === true && Number(g.my_share) > 0;
      h += '<div data-invoice-group="'+id+'" style="padding:12px;margin:8px 0;border:1px solid var(--sw-border);border-radius:10px;background:var(--sw-card)"><strong>'+esc(g.job_number)+' · '+esc(g.client_name)+'</strong>';
      h += '<div style="font-size:12px;margin-top:4px">Group work order · '+esc(g.site_suburb)+'</div>';
      if (g.pot_total != null) h += '<div>Approved labour pool: $'+money(g.pot_total)+' ex GST</div>';
      h += '<div data-group-acceptance>'+ (g.client_signed === true ? 'Sign-off accepted' : 'Waiting for client sign-off · invoicing blocked') +'</div>';
      if (frozen) {
        h += '<label style="display:flex;align-items:center;gap:8px;min-height:44px"><input type="checkbox" data-invoice-group-select="'+id+'" '+(selected[g.group_id] ? 'checked ' : '')+'onchange="GroupWorkOrderInvoice.select(this.getAttribute(\'data-invoice-group-select\'),this.checked)">Include my share: $'+money(g.my_share)+' ex GST</label>';
      } else if (g.awaiting === 'ready' && g.client_signed === true) {
        if (g.projected_my_share != null) h += '<div>Your estimated share: $'+money(g.projected_my_share)+' ex GST</div>';
        h += '<p style="font-size:12px">Hours and sign-off are ready. Finalising locks the crew hours, agreed rates and shares.</p><button type="button" class="btn btn-secondary" data-invoice-group-finalise="'+id+'" '+(busy ? 'disabled ' : '')+'onclick="GroupWorkOrderInvoice.finalise(this.getAttribute(\'data-invoice-group-finalise\'))">'+(busy === g.group_id ? 'Finalising…' : 'Finalise group shares')+'</button>';
      } else {
        var messages = {needs_hours:'Add your hours before your share can be calculated.', awaiting_others:'Waiting for the rest of the crew’s hours.', awaiting_rate:'The office needs to confirm a crew pay rate.', awaiting_signoff:'Current sign-off is required before shares can be finalised or invoiced.'};
        h += '<p style="font-size:12px">'+esc(messages[g.awaiting] || 'This group is not ready to invoice.')+'</p>';
      }
      h += '<button type="button" class="btn btn-secondary btn-small" style="margin-top:8px" data-invoice-group-job="'+esc(g.job_id)+'" onclick="openJob(this.getAttribute(\'data-invoice-group-job\'))">View job and group hours</button>';
      h += '</div>';
    });
    return h + '<p style="font-size:12px;color:var(--sw-text-sec)">Group shares go to the office for review. Travel and other extras stay outside the group pool.</p></section>';
  }
  window.GroupWorkOrderInvoice = { use: use, load: load, html: html, isGroupJob: isGroupJob, items: items, total: total,
    selectedIds: selectedIds, restore: restore, ready: function() { return state === 'ready' && !busy; }, reset: reset,
    retry: function() { load(true); changed(); },
    select: function(id,on) { selected[id] = !!on; changed(); },
    finalise: function(id) {
      var g = groups.find(function(row) { return row.group_id === id; });
      if (busy || !g || g.awaiting !== 'ready' || g.client_signed !== true) return;
      if (!window.confirm('Finalise group shares for '+g.job_number+'? This locks the crew hours, rates and shares.')) return;
      busy = id; changed();
      api('freeze_group_work_order', null, {group_id:id}).then(function(res) {
        if (!res || res.awaiting !== 'frozen') throw new Error('Finalisation was not confirmed. Refresh before continuing.');
        selected[id] = true; busy = ''; load(true);
      }).catch(function(err) { busy = ''; window.toast(err.message || 'Could not finalise the shares.',true); changed(); });
    }
  };
})();
