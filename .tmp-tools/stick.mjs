import { chromium } from 'playwright';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(700);
const click = async (x, y, w = 120) => { await page.mouse.click(x, y); await page.waitForTimeout(w); };
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
for (const [x, y] of [[480, 330], [126, 191], [570, 331], [720, 479], [720, 479], [720, 479], [775, 470]]) await click(x, y, 250);
for (let i = 0; i < 40; i++) { const s = await st(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(708, 460, 60); if ((await st()).draftReveal) await click(480, 406); }
await click(480, 325, 300); await click(195, 361, 300);
const waitPre = async () => { for (let i = 0; i < 300; i++) { const s = await st(); if (s.field?.phase === 'pre' && s.game.possession === 0) return s; await page.waitForTimeout(150); } };
let jukeShot = false;
for (let play = 0; play < 6; play++) {
  let s = await waitPre(); if (!s) break;
  await click(146, 459, 200);
  await page.mouse.move(470, 250); await page.mouse.down(); await page.mouse.move(440, 250, { steps: 2 }); await page.mouse.up();
  for (let i = 0; i < 60; i++) { s = await st(); if (s.field?.carrier && s.field.carrier !== 'QB') break; await page.waitForTimeout(30); }
  // Joystick: push up-right and hold.
  await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(740, 260, { steps: 4 }); await page.waitForTimeout(300);
  s = await st(); console.log(`play ${play} stick`, s.field?.stick, 'vel', s.field?.carrierVelocity);
  if (play === 0) await page.screenshot({ path: 'output/v6/joystick.png' });
  await page.mouse.up(); await page.waitForTimeout(100);
  // Flick down to juke.
  await page.mouse.move(700, 250); await page.mouse.down(); await page.mouse.move(700, 290, { steps: 2 }); await page.mouse.up();
  s = await st(); console.log(`   juke ${s.field?.jukeRemaining} vel`, s.field?.carrierVelocity);
  await page.waitForTimeout(150);
  const t = await st();
  if (!jukeShot) { await page.screenshot({ path: `output/v6/juke-${play}.png` }); }
  for (let i = 0; i < 80; i++) { s = await st(); if (s.field?.phase !== 'live') break; await page.waitForTimeout(60); }
}
console.log('errors', errors); await b.close();
