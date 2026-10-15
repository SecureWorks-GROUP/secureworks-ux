// Sample data for the agentation note toolbar (dev/annotate/README.md). Every
// name, number and street here is invented. A note carries the text of what was
// clicked and the agentation server keeps notes on disk, so while the toolbar is
// on, the page shows only this and never a real job.
(function () {
  'use strict';

  function perthDay(offset) {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() + (offset || 0));
    return d.toISOString().slice(0, 10);
  }

  var JOBS = [
    { id: 'sample-job-1', job_number: 'SWF-90001', type: 'fencing', status: 'quoted', client_name: 'Sample Client A', site_suburb: 'Sampleton', value: 4200, days_in_stage: 3 },
    { id: 'sample-job-2', job_number: 'SWF-90002', type: 'fencing', status: 'accepted', client_name: 'Sample Client B', site_suburb: 'Demoville', value: 6800, deposit_paid: true, days_in_stage: 1 },
    { id: 'sample-job-3', job_number: 'SWF-90003', type: 'fencing', status: 'scheduled', client_name: 'Sample Client C', site_suburb: 'Testbury', value: 3900, next_scheduled_date: perthDay(2), assignment_count: 1, days_in_stage: 0 },
    { id: 'sample-job-4', job_number: 'SWF-90004', type: 'fencing', status: 'in_progress', client_name: 'Sample Client D', site_suburb: 'Exampleford', value: 5100, last_scheduled_date: perthDay(0), assignment_count: 2, days_in_stage: 0 },
    { id: 'sample-job-5', job_number: 'SWF-90005', type: 'fencing', status: 'complete', client_name: 'Sample Client E', site_suburb: 'Mockham', value: 2750, last_scheduled_date: perthDay(-3), days_in_stage: 2 },
    { id: 'sample-job-6', job_number: 'SWP-90006', type: 'patio', status: 'quoted', client_name: 'Sample Client F', site_suburb: 'Sampleton', value: 18400, days_in_stage: 5 },
    { id: 'sample-job-7', job_number: 'SWP-90007', type: 'patio', status: 'scheduled', client_name: 'Sample Client G', site_suburb: 'Demoville', value: 22100, next_scheduled_date: perthDay(4), assignment_count: 1, days_in_stage: 1 },
  ];

  function pipeline(params) {
    var columns = {};
    JOBS.forEach(function (j) {
      if (params.type && params.type !== j.type) return;
      if (params.search && (j.client_name + ' ' + j.job_number + ' ' + j.site_suburb).toLowerCase().indexOf(String(params.search).toLowerCase()) === -1) return;
      (columns[j.status] = columns[j.status] || []).push(j);
    });
    return { columns: columns };
  }

  function calendar() {
    var events = JOBS.filter(function (j) { return j.next_scheduled_date || j.last_scheduled_date; }).map(function (j, i) {
      var day = j.next_scheduled_date || j.last_scheduled_date;
      return {
        job_id: j.id, assignment_id: 'sample-assignment-' + (i + 1), job_number: j.job_number,
        client_name: j.client_name, job_type: j.type, job_status: j.status,
        assignment_type: 'install', confirmation_status: 'confirmed',
        scheduled_date: day, scheduled_end: day, start_time: null, end_time: null,
        site_suburb: j.site_suburb, site_address: '1 Sample St, ' + j.site_suburb,
        user_id: null, crew_name: 'Sample Crew', assigned_to: 'Sample Crew', label: null,
      };
    });
    return { events: events, deliveries: [], readiness: {}, orgEvents: [] };
  }

  function jobDetail(params) {
    var j = JOBS.filter(function (x) { return x.id === params.jobId || x.id === params.job_id; })[0];
    if (!j) return {};
    return {
      job: Object.assign({}, j, {
        site_address: '1 Sample St, ' + j.site_suburb, client_phone: '0400 000 000', client_email: 'sample@example.test',
      }),
      assignments: [], notes: [], documents: [], invoices: [], quotes: [], purchase_orders: [],
    };
  }

  // ops-api reads the sample answers. Any other read answers {} (an empty screen),
  // which is what the Playwright suite feeds the page too.
  window.__SW_ANNOTATE_SAMPLE = {
    reads: {
      pipeline: pipeline,
      calendar: calendar,
      job_detail: jobDetail,
    },
  };
})();
