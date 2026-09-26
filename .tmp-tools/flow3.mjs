import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(150); };
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const waitPre = async () => { for (let i = 0; i < 160; i++) { const s = await state(); if (s.field?.phase === 'pre' && s.game.possession === 0) return s; await page.waitForTimeout(250); } throw new Error('never got the ball'); };
await click(480, 330); await click(126, 191); await click(570, 331); await click(720, 479); await click(720, 479); await click(720, 479);
await click(420, 32); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/roster.png` });
await click(300, 140); await page.screenshot({ path: `${out}/player-card.png` });
await click(20, 20);
await page.evaluate(() => {}); 
await click(318, 32); await click(195, 361);
let s = await waitPre();
// RB run: re-roll situations until an RB run is in the tray
let found = false;
for (let k = 0; k < 12 && !found; k++) {
  await page.evaluate(k => window.setSituation(1 + (k % 3), 40 + k), k); await page.waitForTimeout(100);
  for (const x of [106, 294, 482]) { await click(x, 488); s = await state(); if (s.activePlay.type === 'run' && !/QB|Zone Read/.test(s.activePlay.name)) { found = true; break; } }
}
console.log('run play', s.activePlay);
await page.mouse.move(500, 250); await page.mouse.down(); await page.mouse.move(470, 250, { steps: 3 }); await page.mouse.up();
for (let i = 0; i < 40; i++) { s = await state(); if (s.field?.carrier === 'RB') break; await page.waitForTimeout(40); }
await page.waitForTimeout(200);
await page.mouse.move(600, 300); await page.mouse.down(); await page.mouse.move(600, 255, { steps: 4 }); await page.waitForTimeout(200);
s = await state(); console.log('steer', s.field.phase, s.field.steer, s.field.carrierVelocity);
await page.screenshot({ path: `${out}/running.png` });
await page.mouse.up(); await page.waitForTimeout(100);
s = await state(); console.log('released', s.field.steer, s.field.carrierVelocity);
await page.mouse.move(600, 250); await page.mouse.down(); await page.mouse.move(600, 290, { steps: 2 }); await page.mouse.up();
s = await state(); console.log('juke', s.field.phase, s.field.jukeRemaining, s.field.carrierVelocity, s.feedback);
await page.waitForTimeout(60); await page.screenshot({ path: `${out}/juke.png` });
await page.waitForTimeout(4000);
// Field goal
s = await waitPre();
await page.evaluate(() => window.setSituation(4, 75)); await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/fg-available.png` });
await click(858, 474);
await page.waitForTimeout(300); await page.screenshot({ path: `${out}/fg-power.png` });
for (let i = 0; i < 200; i++) { s = await state(); if (s.kick.meter > 0.84 && s.kick.meter < 0.88) break; await page.waitForTimeout(8); }
await click(480, 250); s = await state(); console.log('locked', s.kick);
for (let i = 0; i < 300; i++) { s = await state(); if (Math.abs(s.kick.aim) < 0.01) break; await page.waitForTimeout(8); }
await page.screenshot({ path: `${out}/fg-aim.png` });
await click(480, 250);
await page.waitForTimeout(900); await page.screenshot({ path: `${out}/fg-flight.png` });
await page.waitForTimeout(900); await page.screenshot({ path: `${out}/fg-result.png` });
s = await state(); console.log('kick', s.kick);
await page.waitForTimeout(2000); s = await state(); console.log('after fg', s.game, s.feedback);
console.log('errors', errors);
await browser.close();
