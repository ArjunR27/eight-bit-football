import { chromium } from 'playwright';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y, w = 150) => { await page.mouse.click(x, y); await page.waitForTimeout(w); };
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
await click(480, 325); await click(136, 208); await click(690, 409, 700);
await click(730, 485); await click(730, 485); await click(730, 485); await click(760, 469);
for (let i = 0; i < 40; i++) { const s = await st(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(716, 434, 60); if ((await st()).draftReveal) await click(480, 417); }
await click(480, 330, 400);
for (let w = 0; w < 5; w++) await click(555, 325, 300); // SIM WEEK x5
await page.screenshot({ path: 'output/v8/hub-needs.png' }); await click(833 + 40, 33); await page.screenshot({ path: 'output/v8/news-needs.png' });

console.log('errors', errors); await b.close();
