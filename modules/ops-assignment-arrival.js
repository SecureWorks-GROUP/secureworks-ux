// Supplier readiness beside the install date. Read only; the office keeps control of scheduling.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.AssignmentArrivalWarning = factory(root);
})(typeof window !== 'undefined' ? window : globalThis, function (host) {
  'use strict';
  var generation = 0;
  function field(id) { return host.document.getElementById(id); }
  function value(id) { var el = field(id); return el ? el.value : ''; }
  function active() { var el = field('assignmentModal'); return !!(el && el.classList.contains('active')); }
  function paint(el, messages) {
    el.replaceChildren();
    el.hidden = messages.length === 0;
    if (!messages.length) return;
    var title = host.document.createElement('strong');
    title.textContent = 'Supplier readiness';
    el.appendChild(title);
    messages.forEach(function (message) {
      var line = host.document.createElement('p');
      line.textContent = message;
      el.appendChild(line);
    });
  }
  async function refresh() {
    var run = ++generation;
    var el = field('assignArrivalWarning');
    if (!el) return;
    var job = value('assignJobSelect'), day = value('assignDate'), kind = value('assignType');
    var current = function () {
      return run === generation && active() && job === value('assignJobSelect') && day === value('assignDate') && kind === value('assignType');
    };
    paint(el, []);
    if (!active() || !job || kind !== 'install') return;
    var selected = (host._poJobList || []).find(function (row) { return row.id === job; });
    if (selected && ['fencing', 'patio'].indexOf(selected.type) < 0) return;
    if (!day) { paint(el, ['Choose an install date to compare it with supplier dates in Dispatch.']); return; }
    paint(el, ['Checking the supplier dates recorded in Dispatch…']);
    try {
      var result = await host.opsFetch('dispatch_arrival', { job_id: job, proposed_install_date: day });
      if (!current()) return;
      if (!result || !Array.isArray(result.schedule_warnings)) throw new Error('read unavailable');
      var messages = result.schedule_warnings.map(function (warning) { return warning && warning.message; })
        .filter(function (message) { return typeof message === 'string' && message.trim(); });
      paint(el, messages);
    } catch (_error) {
      if (current()) paint(el, ['Supplier readiness could not be checked. Check Arrival in Dispatch before confirming the install.']);
    }
  }
  if (host.document.addEventListener) {
    host.document.addEventListener('change', function (event) {
      if (event.target.id === 'assignType') void refresh();
    });
  }
  return { refresh: refresh };
});
