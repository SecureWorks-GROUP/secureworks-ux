const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const OPS = fs.readFileSync(path.join(__dirname, '..', '..', 'ops.html'), 'utf8');
const RETIRED_STAGE_HELPER = ['getMakesafe', 'Stage'].join('');

function extractFunction(signature) {
  const start = OPS.indexOf(signature);
  if (start < 0) throw new Error(`function not found: ${signature}`);
  const open = OPS.indexOf('{', start + signature.length);
  let depth = 0;
  for (let i = open; i < OPS.length; i += 1) {
    if (OPS[i] === '{') depth += 1;
    if (OPS[i] === '}') {
      depth -= 1;
      if (depth === 0) return OPS.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced function: ${signature}`);
}

test('the retired stage helper is gone and every map/planner stage read is canonical', () => {
  expect(OPS).not.toContain(RETIRED_STAGE_HELPER);
  expect(OPS).toContain("decision_required: 'Captain Decision'");
  expect(OPS).toContain("'decision_required', 'completed'");

  const mapLoader = extractFunction('async function loadMakesafeMapData(filter)');
  expect(mapLoader).toContain("opsFetch('makesafe_board'");

  const plannerLoader = extractFunction('async function loadMakesafeCrewDay(dateStr)');
  expect(plannerLoader).toContain("opsFetch('makesafe_board'");
  expect(plannerLoader).not.toContain("opsFetch('makesafe_pipeline'");

  const plannerRender = extractFunction('function renderMakesafeCrewWeek(cache)');
  expect(plannerRender).toContain('j.canonical_stage');
  expect(plannerRender).toContain("j.substatus === 'pending_allocation'");
});

test('canonical decision stage is shown, while missing stage is explicitly unknown', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate(() => {
    const board = {
      columns: {
        decision_required: [{ id: 'job-decision', canonical_stage: 'decision_required' }],
      },
    };
    const map = makesafeMapWithCanonicalStages({
      jobs: [
        { id: 'job-decision', status: 'cancelled', substatus: 'pending_allocation' },
        { id: 'job-missing', status: 'cancelled', substatus: 'pending_allocation' },
      ],
    }, board);
    const decision = getMakesafeMapVisual(map.jobs[0]);
    const missing = getMakesafeMapVisual(map.jobs[1]);
    const missingPill = renderMakesafeCrewJobPill({
      id: 'job-missing',
      type: 'makesafe',
      status: 'cancelled',
      substatus: 'pending_allocation',
      site_suburb: 'Test suburb',
    }, 'Canonical feed test');
    return {
      decisionStage: decision.stage,
      decisionLabel: makesafeUiStageLabel(decision.stage),
      missingStage: missing.stage,
      missingLabel: makesafeUiStageLabel(missing.stage),
      missingPillSaysUnknown: missingPill.includes('Stage not confirmed'),
    };
  });

  expect(result).toEqual({
    decisionStage: 'decision_required',
    decisionLabel: 'Captain Decision',
    missingStage: '',
    missingLabel: 'Stage not confirmed',
    missingPillSaysUnknown: true,
  });
});

test('canonical board mapping preserves all eight server stage keys', async ({ page }) => {
  await page.goto('/ops.html');
  const stages = ['new', 'allocated', 'trade_report_in', 'report_ready', 'decision_required', 'completed', 'archive', 'cancelled'];
  const result = await page.evaluate((stageKeys) => {
    const payload = { columns: {} };
    stageKeys.forEach((stage) => {
      payload.columns[stage] = [{ id: `job-${stage}`, canonical_stage: stage, canonical_stage_label: stage }];
    });
    const mapped = buildMakesafeBoardColumns(payload, {});
    return stageKeys.map((stage) => ({
      stage,
      count: mapped[stage].length,
      canonical: mapped[stage][0] && mapped[stage][0].canonical_stage,
    }));
  }, stages);

  expect(result).toEqual(stages.map((stage) => ({ stage, count: 1, canonical: stage })));
});
