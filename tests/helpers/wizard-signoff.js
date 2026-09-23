// Completion wizard "Client Sign-Off" step: rate, type the client's name and
// draw a signature with trusted pointer input. The step's Next stays disabled
// until all three are present (trade.html wizSignoffMissing).
const { expect } = require('@playwright/test');

async function drawSignature(page) {
  // The pad is wired a tick after the step renders; draw only once it listens.
  const pad = page.locator('#wizSigPad[data-sig-ready]');
  await expect(pad).toBeVisible();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 90, { steps: 5 });
  await page.mouse.move(box.x + 140, box.y + 50, { steps: 5 });
  await page.mouse.up();
}

async function signOff(page, { name = 'Fixture Homeowner', stars = 5 } = {}) {
  await page.locator('#wizBody button').filter({ hasText: '☆' }).nth(stars - 1).click();
  await page.locator('#wizSigNameInput').fill(name);
  await drawSignature(page);
  await expect(page.locator('#wizSignoffNext')).toBeEnabled();
}

module.exports = { drawSignature, signOff };
