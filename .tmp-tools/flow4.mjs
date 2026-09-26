import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(150); };
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
await click(480, 330); await page.screenshot({ path: `${out}/team-pick.png` });
await click(126, 191); await click(570, 331); await click(720, 479); await click(720, 479); await click(720, 479);
await click(468, 32); await page.screenshot({ path: `${out}/roster.png` });
await click(300, 180); await page.screenshot({ path: `${out}/player-card.png` });
await click(570, 32); await page.screenshot({ path: `${out}/depth.png` });
await click(876, 32); await click(772, 32); await page.screenshot({ path: `${out}/schedule.png` });
await click(366, 32); await click(195, 361);
// juke: repeatedly try runs, flick right after handoff
let s;
for (let tries = 0; tries < 30; tries++) {
  for (let i = 0; i < 160; i++) { s = await state(); if (s.field?.phase === 'pre' && s.game.possession === 0) break; await page.waitForTimeout(250); }
  await page.evaluate(k => window.setSituation(1, 30 + k), tries); await page.waitForTimeout(80);
  let ok = false;
  for (const x of [106, 294, 482]) { await click(x, 488); s = await state(); if (s.activePlay.type === 'run' && s.activePlay.name.startsWith('HB') || /Zone|Dive|Iso|Power|Counter|Stretch|Toss|Sweep/.test(s.activePlay.name) && !/Read/.test(s.activePlay.name)) { ok = true; break; } }
  if (!ok) continue;
  await page.mouse.move(500, 250); await page.mouse.down(); await page.mouse.move(470, 250, { steps: 3 }); await page.mouse.up();
  for (let i = 0; i < 60; i++) { s = await state(); if (s.field?.carrier === 'RB') break; await page.waitForTimeout(20); }
  await page.waitForTimeout(150);
  s = await state(); const before = s.field?.carrierVelocity;
  await page.mouse.move(600, 250); await page.mouse.down(); await page.mouse.move(600, 285, { steps: 2 }); await page.mouse.up();
  s = await state();
  console.log('play', s.activePlay.name, 'phase', s.field?.phase, 'before', before, 'after', s.field?.carrierVelocity, 'juke', s.field?.jukeRemaining, s.feedback);
  if (s.field?.phase === 'live' && s.field.jukeRemaining > 0) { await page.waitForTimeout(80); await page.screenshot({ path: `${out}/juke.png` }); break; }
  await page.waitForTimeout(3000);
}
console.log('errors', errors);
await browser.close();
