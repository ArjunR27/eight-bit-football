import { chromium } from 'playwright';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y, w = 150) => { await page.mouse.click(x, y); await page.waitForTimeout(w); };
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const shot = n => page.screenshot({ path: `output/v8/${n}.png` });
await shot('title');
await click(480, 325); await shot('team');
await click(136, 208); await shot('coach');
await click(566, 313); await shot('coach-allstar');
await click(690, 409, 700); await shot('tutorial');
await click(730, 485); await click(730, 485); await click(730, 485); await shot('rundown');
await click(760, 469); await shot('draft');
await click(300, 176); await shot('draft-sel');
for (let i = 0; i < 40; i++) { const s = await st(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(716, 434, 60); if ((await st()).draftReveal) { if (i < 3) await shot('draft-reveal'); await click(480, 417); } }
await click(480, 330, 400); await shot('hub');
const tabs = { roster: 332, depth: 415, trade: 499, standings: 582, schedule: 666, news: 749, hof: 833 };
for (const [n, x] of Object.entries(tabs)) { await click(x + 40, 33); await shot(n); }
await click(415 + 40, 33); await click(300, 144); await click(300, 144); await shot('player-card');
await click(292 + 40, 33); await click(778, 325); await shot('leaders');
await click(292 + 40, 33); await click(708, 385); const s = await st(); console.log('difficulty after cycle via hub button?', s);
await shot('hub-diff');
console.log('errors', errors); await b.close();
