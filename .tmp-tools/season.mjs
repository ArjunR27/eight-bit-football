import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y, wait = 120) => { await page.mouse.click(x, y); await page.waitForTimeout(wait); };
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const shot = n => page.screenshot({ path: `${out}/${n}.png` });
await click(480, 330); await click(126, 191); await click(570, 331, 600);
await click(720, 479); await click(720, 479); await click(720, 479); await click(775, 470);
// Auto-draft everything
for (let i = 0; i < 40; i++) { const s = await state(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(708, 460, 60); if ((await state()).draftReveal) await click(480, 406); }
await click(480, 325, 400);
let s = await state(); console.log('season start', s.mode, s.season.phase);
// Play the week-1 game with a simple bot
await click(195, 361, 300);
let shotTaken = false, t0 = Date.now();
while (Date.now() - t0 < 360000) {
  s = await state();
  if (s.mode === 'results') break;
  if (s.kick) { await click(480, 250, 200); continue; }
  if (s.field?.phase === 'pre' && s.game.possession === 0) {
    if (!shotTaken) { await shot('presnap-energy'); }
    await page.mouse.move(470, 250); await page.mouse.down(); await page.mouse.move(440, 252, { steps: 2 });
    await page.waitForTimeout(700); await page.mouse.move(380, 262, { steps: 3 });
    if (!shotTaken) { await shot('in-play'); shotTaken = true; }
    await page.mouse.up(); await page.waitForTimeout(200); continue;
  }
  await page.waitForTimeout(250);
}
s = await state(); console.log('after game', s.mode, s.game?.score, s.feedback);
await shot('postgame');
await click(220, 435, 300);
// Sim the rest of the season
for (let i = 0; i < 40; i++) {
  s = await state();
  if (s.season.phase === 'offseason') break;
  const btn = s.season.phase === 'regular' || s.season.phase === 'playoffs';
  // PLAY GAME / SIM BYE / SIM ROUND occupy the left button; use SIM WEEK on the right panel
  await click(564, 338, 80);
}
s = await state(); console.log('end of season', s.season);
await shot('offseason-hub');
await click(195, 361, 800); s = await state(); console.log('offseason screen', s.mode, s.season);
await shot('offseason');
await click(755, 470, 200); s = await state(); console.log('->', s.mode); await shot('rundown-2');
await click(775, 470, 200); s = await state(); console.log('->', s.mode, s.season); await shot('draft-2');
await click(916, 32, 200); await shot('hof');
console.log('errors', errors);
await browser.close();
