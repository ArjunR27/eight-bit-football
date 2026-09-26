import { chromium } from 'playwright';
const out = 'output/v4';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(700);
const click = async (x, y, w = 120) => { await page.mouse.click(x, y); await page.waitForTimeout(w); };
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
for (const [x, y] of [[480, 330], [126, 191], [570, 331], [720, 479], [720, 479], [720, 479], [775, 470]]) await click(x, y, 250);
for (let i = 0; i < 40; i++) { const s = await st(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(708, 460, 60); if ((await st()).draftReveal) await click(480, 406); }
await click(480, 325, 300);
// Depth chart: QB1 is row 0, QB2 row 1. Select QB2, then MAKE STARTER.
await click(501, 32);
await click(300, 167); await page.screenshot({ path: `${out}/depth-selected.png` });
await click(415, 480); await page.screenshot({ path: `${out}/depth-starter.png` });
// swap: select QB1 then tap QB2
await click(300, 141); await click(300, 167); await page.screenshot({ path: `${out}/depth-swapped.png` });
await click(335, 32); await click(195, 361, 300);
for (let i = 0; i < 160; i++) { const s = await st(); if (s.field?.phase === 'pre' && s.game.possession === 0) break; await page.waitForTimeout(250); }
await page.screenshot({ path: `${out}/tray-pass.png` });
await click(146, 459); let s = await st(); console.log('run toggle ->', s.activePlay);
await page.screenshot({ path: `${out}/tray-run.png` });
const names = new Set();
for (let i = 0; i < 4; i++) { await click(550, 493); s = await st(); names.add(s.activePlay.name); }
console.log('MORE cycled', [...names]);
await click(58, 459); s = await st(); console.log('pass toggle ->', s.activePlay);
// Aim preview
await page.mouse.move(470, 250); await page.mouse.down(); await page.mouse.move(440, 252, { steps: 2 }); await page.waitForTimeout(700);
await page.mouse.move(330, 265, { steps: 3 }); await page.waitForTimeout(100);
await page.screenshot({ path: `${out}/aim-preview.png` });
await page.mouse.up(); await page.waitForTimeout(3500);
console.log('errors', errors);
await b.close();
