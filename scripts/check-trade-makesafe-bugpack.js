#!/usr/bin/env node
const fs = require('fs');

const trade = fs.readFileSync('trade.html', 'utf8');
const ops = fs.readFileSync('ops.html', 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${message}`);
  }
}

const msrInput = trade.match(/<input type="file" id="msrPhotoInput"[^>]+>/);
assert(Boolean(msrInput), 'MakeSafe report has a dedicated photo input');
assert(msrInput && /multiple/.test(msrInput[0]), 'MakeSafe photo input supports multi-file selection');
assert(msrInput && !/\bcapture=/.test(msrInput[0]), 'MakeSafe multi-file picker does not force camera capture');
assert(!/id="msrPhotoPhase"/.test(trade), 'MakeSafe report no longer requires a photo category picker');

assert(/data-full-url/.test(trade) && /getAttribute\('data-full-url'\)/.test(trade), 'trade lightbox uses full-size URLs for gallery navigation');
assert(/submit_makesafe_report/.test(trade), 'trade report submits via submit_makesafe_report');
assert(/job_type_detail:\s*jobTypeDetail/.test(trade) && /makesafe_type_detail:\s*jobTypeDetail/.test(trade), 'MakeSafe report payload preserves detailed type labels');
assert(/\(photoCounts\.total \|\| 0\) < 5/.test(trade), 'MakeSafe report keeps 5-photo gate client-side');
assert(/visibility:\s*'internal_only'/.test(trade) && /sync_to_ghl:\s*false/.test(trade), 'Note for admin stays internal-only and does not sync to GHL');
assert(/function linkifyTradeBodyText/.test(trade) && /target="_blank" rel="noopener"/.test(trade), 'MakeSafe source email body links are safely linkified');
assert(/function getMakesafeSourceReceivedAt/.test(trade) && /<strong>Received:<\/strong>/.test(trade), 'MakeSafe source email received timestamp is rendered when present');
assert(/makesafe_job_family/.test(trade) && /<strong>Family:<\/strong>/.test(trade), 'MakeSafe canonical job family is visible in trade detail/report');
assert(/mergeTradeExternalLinks/.test(trade) && /source_email_links/.test(trade), 'MakeSafe source email links are included in trade link pills');

assert(!/openLightbox\(\[\{storage_url/.test(ops), 'ops MakeSafe preview no longer calls missing trade lightbox signature');
assert(/openOpsLightbox\(this\.getAttribute\(\\'data-full-url\\'\) \|\| this\.src\)/.test(ops), 'ops MakeSafe preview opens with ops lightbox');

if (process.exitCode) process.exit(process.exitCode);
