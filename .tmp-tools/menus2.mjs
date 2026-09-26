import { chromium } from 'playwright';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y, w = 150) => { await page.mouse.click(x, y); await page.waitForTimeout(w); };
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const shot = n => page.screenshot({ path: `output/v8/${n}.png` });
await click(480, 325); await click(136, 208); await click(690, 409, 700);
await click(730, 485); await click(730, 485); await click(730, 485); await click(760, 469);
await shot('draft');
await click(300, 206); await click(789, 376, 600); // sim to my pick
await click(300, 176); await click(789, 376, 300); await shot('draft-reveal'); await click(480, 417);
for (let i = 0; i < 40; i++) { const s = await st(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(716, 434, 60); if ((await st()).draftReveal) await click(480, 417); }
await click(480, 330, 400);
const tab = i => 292 + i * 83.5 + 40;
for (const [n, i] of [['depth', 2], ['trade', 3], ['standings', 4], ['schedule', 5], ['hof', 7]]) { await click(tab(i), 33); await shot(n); }
await click(tab(0), 33); await click(195, 370, 400);
for (let i = 0; i < 200; i++) { const s = await st(); if (s.field?.phase === 'pre' && s.game.possession === 0) break; await page.waitForTimeout(150); }
await shot('tray');
console.log('errors', errors); await b.close();
