#!/usr/bin/env node
// 2026-09-23 — rates are office only (captain ruling; trade app audit finding 7).
// The trade app must never write a trade's hourly rate: no set_trade_rate call
// from any screen, and no editable rate on Profile or on an assigned job card.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
let passed = 0;
function check(name, cond) { assert(cond, name); passed += 1; }

check('trade.html makes no set_trade_rate call', html.indexOf('set_trade_rate') === -1);
check('Profile has no rate input', html.indexOf('inputTradeRate') === -1);
check('Profile has no rate Update action', html.indexOf('updateTradeRate') === -1);
check('hours view has no rate input to save from', html.indexOf('hoursRateInput') === -1);
check('no prompt sends the trade to Profile to set a rate', !/Go to Profile/.test(html));
check('Profile rate is labelled as set by the office', /id="profileRateValue"/.test(html) && /Set by the office/.test(html));
check('assigned job card rate renders read-only', /data-cardrate-readonly=/.test(html));
check('setJobCardRate refuses assigned (non-searched-in) cards', /window\.setJobCardRate = function\(idx, val\) \{\s*var c = _jobCards\[idx\]; if \(!c \|\| !c\.manually_added\) return;/.test(html));

console.log('trade-rate-office-only: ' + passed + ' checks passed');
