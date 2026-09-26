import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5199/'); await page.waitForTimeout(800);
const click = async (x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(150); };
const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
await click(480, 330); // new franchise
await page.screenshot({ path: `${out}/team-pick.png` });
await click(126, 191); await click(570, 331); await click(720, 479); await click(720, 479); await click(720, 479);
await page.screenshot({ path: `${out}/hub.png` });
await click(90, 32 + 0); // nothing
await click(195, 361); // play game
for (let i = 0; i < 80; i++) { const s = await state(); if (s.field?.phase === 'pre') break; await page.waitForTimeout(250); }
let s = await state(); console.log('pre', s.game, s.activePlay);
await page.screenshot({ path: `${out}/presnap.png` });
// drag back from the QB: find QB screen pos roughly: press mid-field and pull back (left) and hold
const qb = s.field.players.find(p => p.role === 'QB');
await page.mouse.move(480, 250); await page.mouse.down(); await page.mouse.move(440, 260, { steps: 5 }); await page.waitForTimeout(400);
s = await state(); console.log('after drag', s.field.phase, s.activePlay);
await page.mouse.move(380, 280, { steps: 5 }); await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/aiming.png` });
await page.mouse.up(); await page.waitForTimeout(300);
s = await state(); console.log('after release', s.field?.phase, s.field?.ball, s.feedback);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/after-throw.png` });
s = await state(); console.log('later', s.field?.phase, s.field?.ball, s.feedback);
console.log('errors', errors);
await browser.close();
