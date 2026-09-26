import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(150); };
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const waitPre = async () => { for (let i = 0; i < 120; i++) { const s = await state(); if (s.field?.phase === 'pre' && s.game.possession === 0) return s; await page.waitForTimeout(250); } throw new Error('never got the ball'); };
await click(480, 330); await click(126, 191); await click(570, 331); await click(720, 479); await click(720, 479); await click(720, 479); await click(195, 361);
let s = await waitPre();
// 1) pass: drag back and hold briefly
await page.mouse.move(500, 250); await page.mouse.down(); await page.mouse.move(470, 255, { steps: 3 }); await page.waitForTimeout(300);
await page.mouse.move(400, 270, { steps: 4 }); await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/aiming.png` });
await page.mouse.up(); await page.waitForTimeout(250);
s = await state(); console.log('pass:', s.field?.ball, s.feedback);
await page.waitForTimeout(3000);
// 2) run play: pick a run in the tray if present
s = await waitPre();
console.log('choices situation', s.game.down, s.activePlay);
// choose each tray button until a run is active
for (const x of [106, 294, 482]) { await click(x, 488); s = await state(); if (s.activePlay.type === 'run') break; }
console.log('run play', s.activePlay);
if (s.activePlay.type === 'run') {
  await page.mouse.move(500, 250); await page.mouse.down(); await page.mouse.move(470, 250, { steps: 3 }); await page.mouse.up();
  for (let i = 0; i < 40; i++) { s = await state(); if (s.field?.carrier && s.field.carrier !== 'QB') break; await page.waitForTimeout(50); }
  await page.waitForTimeout(250);
  // hold and drag up to steer
  await page.mouse.move(600, 300); await page.mouse.down(); await page.mouse.move(600, 260, { steps: 4 }); await page.waitForTimeout(250);
  s = await state(); console.log('steer', s.field.steer, s.field.carrierVelocity);
  await page.screenshot({ path: `${out}/running.png` });
  await page.mouse.up();
  // flick down = juke
  await page.mouse.move(600, 250); await page.mouse.down(); await page.mouse.move(600, 290, { steps: 2 }); await page.mouse.up();
  s = await state(); console.log('juke', s.field.jukeRemaining, s.field.carrierVelocity, s.feedback);
  await page.waitForTimeout(120); await page.screenshot({ path: `${out}/juke.png` });
}
await page.waitForTimeout(3500);
// 3) punt
s = await waitPre();
await page.evaluate(() => window.setSituation(4, 35)); await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/fourth-down.png` });
await click(677, 474);
for (const t of [1000, 1500, 2000]) { await page.waitForTimeout(t); await page.screenshot({ path: `${out}/punt-${t}.png` }); }
s = await state(); console.log('punt', s.field?.phase, s.feedback, s.game);
await page.waitForTimeout(4000);
s = await state(); console.log('after punt', s.feedback, s.game);
console.log('errors', errors);
await browser.close();
