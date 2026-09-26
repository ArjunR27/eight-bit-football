import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y, wait = 150) => { await page.mouse.click(x, y); await page.waitForTimeout(wait); };
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const shot = n => page.screenshot({ path: `${out}/${n}.png` });
await click(480, 330); await click(126, 191); await click(570, 331, 600);
await click(720, 479); await click(720, 479); await click(720, 479);
let s = await state(); console.log('after tutorial', s.mode, s.season);
await shot('rundown');
await click(775, 470); s = await state(); console.log('after rundown', s.mode);
await shot('draft-board');
await click(300, 164); await shot('draft-selected');
// sim to my pick
await click(780, 412, 400); s = await state(); console.log('clock', s.season.onClock, 'pick#', s.season.draftPick);
await click(300, 164); await click(780, 412, 300);
s = await state(); console.log('reveal', s.draftReveal, s.season.draftPick);
await shot('draft-reveal');
await click(480, 406);
// trade from draft
await click(852, 460); await shot('trade-empty');
// select my first two rows and their first row
await click(200, 148); await click(660, 148); await shot('trade-selected');
await click(860, 488); s = await state(); console.log('trade msg', s.tradeMsg);
await shot('trade-result');
await click(265, 488); // back to draft
// auto draft the rest
for (let i = 0; i < 12; i++) { s = await state(); if (s.mode !== 'draft' || s.season.phase !== 'draft') break; if (s.season.draftPick >= 224) break; await click(708, 460, 200); if ((await state()).draftReveal) await click(480, 406); }
s = await state(); console.log('draft pick idx', s.season.draftPick);
await shot('draft-late');
for (let i = 0; i < 20; i++) { s = await state(); if (s.season.draftPick >= 224) break; await click(708, 460, 150); }
await shot('draft-done');
await click(480, 325, 500); s = await state(); console.log('after finish', s.mode, s.season, s.team);
await shot('hub');
await click(378, 32); await shot('roster');
await click(300, 140); await shot('player-card');
await click(876, 32); await shot('hof');
await click(794, 32); await shot('news');
await click(711, 32); await shot('schedule');
console.log('errors', errors);
await browser.close();
