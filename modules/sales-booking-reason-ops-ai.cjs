'use strict';

var assess = require('./sales-booking-assess.cjs');

function extractJson(text) {
  if (!text) return null;
  var start = String(text).indexOf('{');
  var end = String(text).lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(String(text).slice(start, end + 1)); } catch (e) { return null; }
}

async function opsAiReason(prompt, fetchImpl, url, headers) {
  if (typeof fetchImpl !== 'function' || !url) return null;
  var body = {
    messages: [{
      role: 'user',
      content: 'Assess this sales booking conversation. Return JSON only with keys reply_kind, exact_acceptance, accepted_offer, customer_windows, review_reasons, source_message_ids, interpreter. Customer constraints inbound-only. Exact acceptance must cite preceding sent offer id and slot_revision. Ambiguity is review. Do not invent dates.\n' + JSON.stringify(prompt)
    }],
    view: 'ops',
    booking_assessment: true
  };
  var resp = await fetchImpl(url, {
    method: 'POST',
    headers: headers || { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) return null;
  var data = await resp.json();
  var text = data.reply || data.content || data.message || '';
  var parsed = extractJson(text);
  if (!parsed) return null;
  parsed.interpreter = 'ops-ai-structured';
  parsed.intelligent_automation = true;
  return parsed;
}

async function assessViaOpsAi(input, opts) {
  opts = opts || {};
  return assess.assessWithReason(Object.assign({}, input, {
    reasonAsync: function (prompt) {
      return opsAiReason(prompt, opts.fetch, opts.url, opts.headers);
    }
  }));
}

module.exports = { opsAiReason: opsAiReason, assessViaOpsAi: assessViaOpsAi };
