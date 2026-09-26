import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 540 } });
await p.goto('http://localhost:5199/'); await p.waitForTimeout(700);
const st = async () => JSON.parse(await p.evaluate(() => window.render_game_to_text()));
for (const [x, y] of [[480, 330], [126, 191], [570, 331], [720, 479], [720, 479], [720, 479], [775, 470]]) { await p.mouse.click(x, y); await p.waitForTimeout(250); }
for (let i = 0; i < 40; i++) { const s = await st(); if (s.season.draftPick === null || s.season.draftPick >= 224) break; await p.mouse.click(708, 460); await p.waitForTimeout(60); if ((await st()).draftReveal) await p.mouse.click(480, 406); }
await p.mouse.click(480, 325); await p.waitForTimeout(300); await p.mouse.click(418, 32); await p.waitForTimeout(200);
let found = null;
outer: for (let pg = 0; pg < 6; pg++) {
  for (let r = 0; r < 13; r++) {
    await p.mouse.click(300, 141 + r * 26); await p.waitForTimeout(30);
    const s = await st();
    if (s.selectedPlayer && !s.selectedPlayer.devHidden && (s.selectedPlayer.dev === 'xfactor' || (s.selectedPlayer.dev === 'superstar' && !found))) { found = s.selectedPlayer; await p.screenshot({ path: 'output/v3/card-star.png' }); if (found.dev === 'xfactor') break outer; }
    await p.mouse.click(820, 105); await p.waitForTimeout(30);
  }
  await p.mouse.click(884, 208); await p.waitForTimeout(30); await p.mouse.click(884, 208); await p.waitForTimeout(30);
}
console.log(found && { name: found.name, dev: found.dev, abilities: found.abilities, xfactor: found.xfactor });
await b.close();
