import { chromium } from 'playwright';
const out = 'output/v5';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(700);
const click = async (x, y, w = 120) => { await page.mouse.click(x, y); await page.waitForTimeout(w); };
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
for (const [x, y] of [[480, 330], [126, 191], [570, 331], [720, 479], [720, 479], [720, 479], [775, 470]]) await click(x, y, 250);
for (let i = 0; i < 40; i++) { const s = await st(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await click(708, 460, 60); if ((await st()).draftReveal) await click(480, 406); }
await click(480, 325, 300); await click(195, 361, 300);
const waitPre = async () => { for (let i = 0; i < 200; i++) { const s = await st(); if (s.field?.phase === 'pre' && s.game.possession === 0) return s; await page.waitForTimeout(150); } };
let shots = 0, plays = 0;
while (plays < 10) {
  let s = await waitPre(); if (!s) break;
  const c0 = s.game.clock; await page.waitForTimeout(1000); s = await st();
  console.log(`pre-snap clock ${c0.toFixed(1)} -> ${s.game.clock.toFixed(1)} (running between plays: ${c0 !== s.game.clock})`);
  const cSnap = s.game.clock;
  await page.mouse.move(470, 250); await page.mouse.down(); await page.mouse.move(440, 252, { steps: 2 }); await page.waitForTimeout(800);
  await page.mouse.move(250 - plays * 15, 262 + (plays % 3 - 1) * 40, { steps: 3 }); await page.waitForTimeout(80);
  if (plays === 0) await page.screenshot({ path: `${out}/aim.png` });
  await page.mouse.up();
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(90); const t = await st(); if (t.field?.ball.inAir && t.field.ball.z > 2) { await page.screenshot({ path: `${out}/arc-${plays}.png` }); break; } }
  for (let i = 0; i < 80; i++) { s = await st(); if (s.field?.phase === 'dead') break; await page.waitForTimeout(60); }
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/result-${plays}.png` });
  s = await st(); console.log(`play ${plays}: ${s.field?.ball ? '' : ''}clock at snap ${cSnap.toFixed(1)} now ${s.game.clock.toFixed(1)} • ${s.feedback}`);
  plays++;
}
console.log('errors', errors);
await b.close();
