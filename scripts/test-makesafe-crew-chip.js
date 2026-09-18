#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ops = fs.readFileSync(path.join(__dirname, '..', 'ops.html'), 'utf8');

function has(pattern, message) {
  assert(pattern.test(ops), message);
}

has(/function isGhostAssignment\(a\)/, 'crew chip has an assignment-row ghost check');
has(/a\.is_ghost === true/, 'ghost rows are dropped by is_ghost, not by staff role');
has(/role === 'observer'/, 'observer assignment rows are dropped from the crew chip');
has(/Do not treat ops_manager as a ghost/, 'Hugo stays visible even when his staff role is ops_manager');
assert(
  !/u && u\.role === 'ops_manager'\) return true/.test(ops),
  'ops_manager staff role must not hide a real make-safe assignee',
);
has(/if \(isGhostAssignment\(a\)\) return;/, 'assignment-row names skip ghost/observer copies before the chip is built');

console.log('PASS MakeSafe crew chip keeps Hugo and drops observer copies');
