const fs = require('fs');
const vm = require('vm');
const ops = fs.readFileSync('ops.html', 'utf8');
const start = ops.indexOf('function _makesafeTextFromValue');
const end = ops.indexOf('function getMakesafeIntakeDate', start);
if (start < 0 || end < 0) throw new Error('family helper block not found');
const code = ops.slice(start, end);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const cases = [
  [{ metadata: { makesafe_job_family: 'roof_report' } }, 'Roof Report', 'canonical roof'],
  [{ metadata: { makesafe_job_family: 'assessment_report_quote' } }, 'Assessment / Quote Report', 'canonical assessment'],
  [{ metadata: { makesafe_job_family: 'temp_fence_makesafe' } }, 'Temporary Fence MakeSafe', 'canonical temp fence'],
  [{ metadata: { makesafe_job_family: 'general_makesafe' } }, 'MakeSafe', 'canonical general'],
  [{ notes: 'Roof report request - single storey roof report to identify point of water entry' }, 'Roof Report', 'infer roof report'],
  [{ notes: 'Contractor inspection and assessment for fence damage; quote required' }, 'Assessment / Quote Report', 'infer assessment'],
  [{ notes: 'Install temporary fencing, 7 panels, 3 month hire' }, 'Temporary Fence MakeSafe', 'infer temp fence'],
  [{ notes: 'Board up window and make safe ceiling collapse with prop and brace' }, 'MakeSafe', 'pseudo types collapse to general'],
  [{ notes: 'Make roof watertight, tarp roof tiles, water ingress over kitchen' }, 'MakeSafe', 'physical roof makesafe stays general'],
];
let failed = 0;
for (const [job, expected, name] of cases) {
  const got = ctx.getMakesafeTypeLabel(job);
  if (got !== expected) {
    console.error(`${name}: expected ${expected}, got ${got}`);
    failed++;
  }
}
for (const forbidden of ['Board up', 'Ceiling collapse', 'Structural make safe', 'Roof make safe']) {
  if (ops.includes(`return '${forbidden}'`) || ops.includes(`>${forbidden}<`)) {
    console.error(`forbidden taxonomy label still present: ${forbidden}`);
    failed++;
  }
}
if (failed) process.exit(1);
console.log(`makesafe family UI fixtures passed (${cases.length} cases)`);
