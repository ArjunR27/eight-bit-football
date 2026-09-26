import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y, wait = 120) => { await page.mouse.click(x, y); await page.waitForTimeout(wait); };
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
await click(480, 330); await click(126, 191); await click(570, 331, 600);
await click(720, 479); await click(720, 479); await click(720, 479); await click(775, 470);
for (let i = 0; i < 40; i++) { const s = await state(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(708, 460, 60); if ((await state()).draftReveal) await click(480, 406); }
await click(480, 325, 400);
// Trade two good players away so they land on the Hall of Fame ballot
await click(584, 32);
for (let side = 0; side < 1; side++) {}
await click(200, 298); await click(200, 323); await click(200, 348); await click(200, 373);
await click(660, 148); // their first asset (a pick)
let s = await state();
await click(860, 488, 300); s = await state(); console.log('trade', s.tradeMsg, s.season.alumni);
await page.screenshot({ path: `${out}/trade-accepted.png` });
await click(916, 32); await page.screenshot({ path: `${out}/hof-ballot.png` });
await click(884, 109, 200); s = await state(); console.log('after induct', s.season.hof, s.season.alumni);
await page.screenshot({ path: `${out}/hof-inducted.png` });
await click(418, 32); await page.screenshot({ path: `${out}/roster.png` });
await click(300, 141); await page.screenshot({ path: `${out}/player-card.png` });
console.log('errors', errors);
await browser.close();
