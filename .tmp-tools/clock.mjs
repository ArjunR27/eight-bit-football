import { chromium } from 'playwright';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(700);
const click = async (x, y, w = 120) => { await page.mouse.click(x, y); await page.waitForTimeout(w); };
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
for (const [x, y] of [[480, 330], [126, 191], [570, 331], [720, 479], [720, 479], [720, 479], [775, 470]]) await click(x, y, 250);
for (let i = 0; i < 40; i++) { const s = await st(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(708, 460, 60); if ((await st()).draftReveal) await click(480, 406); }
await click(480, 325, 300); await click(195, 361, 300);
const waitPre = async () => { for (let i = 0; i < 300; i++) { const s = await st(); if (s.field?.phase === 'pre' && s.game.possession === 0) return s; await page.waitForTimeout(150); } };
for (let play = 0; play < 5; play++) {
  let s = await waitPre(); if (!s) break;
  const a = s.game.clock; await page.waitForTimeout(1500); s = await st();
  console.log(`before snap: ${a.toFixed(1)} -> ${s.game.clock.toFixed(1)} ${a !== s.game.clock ? 'TICKING' : 'stopped'} | down ${s.game.down}&${s.game.toGo}`);
  await click(146, 459, 200); // RUN
  await page.mouse.move(470, 250); await page.mouse.down(); await page.mouse.move(440, 250, { steps: 2 }); await page.mouse.up();
  for (let i = 0; i < 100; i++) { s = await st(); if (s.field?.phase === 'dead') break; await page.waitForTimeout(50); }
  await page.waitForTimeout(200); await page.screenshot({ path: `output/v5/run-${play}.png` });
  console.log(`  result: ${s.feedback || ''}`);
}
console.log('errors', errors); await b.close();
