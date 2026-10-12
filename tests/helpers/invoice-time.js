const { expect } = require('@playwright/test');
const { perthWeekMonday, addIsoDays } = require('./feed-stub');

// Trades say when they worked; hours are worked out and never typed
// (trade.html `// <trade-time-entry>`). Specs enter an N-hour day from 07:00.
// The date worked is typed too: nothing on a card is filled in for the trade.
// The fixture week's jobs sit on its Tuesday unless a spec passes `date`.
function fixtureJobDay() {
  return addIsoDays(perthWeekMonday(), 1);
}

function workedTimes(hours, start = '07:00') {
  const [h, m] = start.split(':').map(Number);
  const finish = h * 60 + m + Math.round(Number(hours) * 60);
  const pad = (n) => String(n).padStart(2, '0');
  return { start_time: start, finish_time: `${pad(Math.floor(finish / 60))}:${pad(finish % 60)}`, break_minutes: 0 };
}

function hoursText(hours) {
  const n = Number(hours);
  return `${String(Math.round(n * 100) / 100)} ${n === 1 ? 'hr' : 'hrs'}`;
}

// Fill one job card's date worked, start and finish (and break) so it bills `hours`.
async function fillCardTime(card, hours, opts = {}) {
  const t = workedTimes(hours, opts.start);
  await card.locator('[data-carddate]').fill(opts.date || fixtureJobDay());
  await card.locator('[data-cardstart]').fill(t.start_time);
  await card.locator('[data-cardfinish]').fill(t.finish_time);
  if (opts.breakMinutes != null) await card.locator('[data-cardbreak]').fill(String(opts.breakMinutes));
  await card.locator('[data-cardfinish]').blur();
  return t;
}

async function expectCardHours(card, hours) {
  await expect(card.locator('[data-cardhours]')).toHaveText(hoursText(hours));
}

module.exports = { workedTimes, hoursText, fixtureJobDay, fillCardTime, expectCardHours };
