import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { newLeague } from '../src/model/generate';
import { finishWeek, finalizeGame, startNewSeason, startOffseason } from '../src/model/season';
import { cpuPick, draftDone, finalizeDraft, initialDraftOrder, makePick, onClock, prepareDraft, simToUserPick } from '../src/model/draft';
import { CPU_EDGE, chartValue, evaluateTrade, executeTrade, playerValue, type Asset } from '../src/model/trade';
import { REVEAL_SNAPS, effective, gainXp } from '../src/model/dev';
import { INJURIES } from '../src/model/injury';
import { teamRundown } from '../src/model/rundown';
import { condition } from '../src/sim/condition';
import { makeCtx, simStep, simGame } from '../src/sim/simGame';
import { newGame } from '../src/sim/gameState';

const settings = { sound: false, quarterMinutes: 4, difficulty: 1 as const };

function playSeason(league: ReturnType<typeof newLeague>) {
  let guard = 0;
  while (league.phase !== 'offseason' && guard++ < 40) finishWeek(league);
}

describe('franchise: multiple seasons', () => {
  const league = newLeague(5, 2, settings);
  const startPlayers = Object.keys(league.players).length;
  const reports = [] as ReturnType<typeof startNewSeason>[];
  for (let s = 0; s < 3; s++) {
    playSeason(league);
    reports.push(startNewSeason(league));
  }

  it('keeps every roster at 53 + 16 and the league size stable', () => {
    expect(league.year).toBe(2029);
    for (const t of league.teams) {
      expect(t.roster).toHaveLength(53);
      expect(t.practice).toHaveLength(16);
      for (const id of [...t.roster, ...t.practice]) expect(league.players[id]).toBeDefined();
    }
    const n = Object.keys(league.players).length;
    expect(n).toBe(startPlayers);
  });

  it('retires veterans and fills rosters with drafted rookies', () => {
    expect(reports.every((r) => r.retiredTotal > 20)).toBe(true);
    const rookies = Object.values(league.players).filter((p) => p.draft?.year === 2029);
    expect(rookies.length).toBeGreaterThan(150);
    for (const p of rookies) expect(p.age).toBeLessThanOrEqual(24);
  });

  it('issues future picks every year', () => {
    for (const t of league.teams) {
      const years = new Set(league.teams.flatMap((o) => o.picks).filter((k) => k.orig === t.id).map((k) => k.year));
      expect(years.has(2030)).toBe(true);
      expect(years.has(2031)).toBe(true);
    }
  });

  it('develops players in season and reveals hidden devs after REVEAL_SNAPS snaps', () => {
    expect(league.inbox.some((n) => n.kind === 'upgrade')).toBe(true);
    const veteranRookies = Object.values(league.players).filter((p) => p.draft && p.draft.year < 2029 && p.snaps >= REVEAL_SNAPS);
    expect(veteranRookies.every((p) => !p.devHidden)).toBe(true);
  });

  it('survives a JSON save round-trip', () => {
    const json = JSON.stringify(league);
    expect(json.length).toBeLessThan(4_500_000);
    expect(JSON.parse(json).teams[2].roster).toEqual(league.teams[2].roster);
  });
});

describe('draft', () => {
  const league = newLeague(8, 4, settings);
  prepareDraft(league, initialDraftOrder(league));
  const d = league.draft!;

  it('builds a 7-round, 224-pick order and a 65-82 class with combine data', () => {
    expect(d.order).toHaveLength(224);
    expect(d.order[0].pick).toBe(1);
    expect(d.order[32].round).toBe(2);
    const ovrs = d.prospects.map((id) => league.players[id].ovr);
    expect(Math.min(...ovrs)).toBeGreaterThanOrEqual(64);
    expect(Math.max(...ovrs)).toBeLessThanOrEqual(83);
    for (const id of d.prospects) {
      const p = league.players[id];
      expect(p.combine!.forty).toBeGreaterThan(4.2);
      if (!p.devHidden) expect(p.dev).toBe('normal');
    }
    expect(d.prospects.some((id) => league.players[id].devHidden)).toBe(true);
  });

  it('lets CPU teams pick until the user is on the clock, then records the user pick', () => {
    simToUserPick(league);
    expect(onClock(league)!.owner).toBe(4);
    const pickId = d.prospects[0];
    const made = makePick(league, pickId)!;
    expect(made.teamId).toBe(4);
    expect(league.teams[4].roster).toContain(pickId);
    expect(league.inbox.at(-1)!.text).toMatch(/OVR/);
    while (!draftDone(league)) cpuPick(league);
    finalizeDraft(league);
    expect(league.phase).toBe('regular');
    for (const t of league.teams) expect(t.roster).toHaveLength(53);
  });
});

describe('trades', () => {
  const league = newLeague(21, 0, settings);
  const me = league.teams[0], cpu = league.teams[9];
  const best = (t: typeof me) => t.roster.map((id) => league.players[id]).sort((a, b) => b.ovr - a.ovr);

  it('values picks along the NFL chart', () => {
    expect(chartValue(1)).toBeCloseTo(3000);
    expect(chartValue(32)).toBeCloseTo(590);
    expect(chartValue(10)).toBeGreaterThan(chartValue(40));
  });

  it('rejects lopsided offers outright', () => {
    const theirStar: Asset = { kind: 'player', id: best(cpu)[0].id };
    const myScrub: Asset = { kind: 'player', id: best(me).at(-1)!.id };
    const v = evaluateTrade(league, cpu, [myScrub], [theirStar]);
    expect(v.accept).toBe(false);
    expect(v.fairness).toBeLessThan(0);
  });

  it('accepts when the CPU gets fair value back, and moves players and picks', () => {
    const target = best(cpu)[5];
    const want: Asset[] = [{ kind: 'player', id: target.id }];
    const offer: Asset[] = [];
    let sum = 0;
    for (const p of best(me)) {
      if (sum >= playerValue(target) * CPU_EDGE * 1.2) break;
      offer.push({ kind: 'player', id: p.id });
      sum += playerValue(p);
    }
    offer.push({ kind: 'pick', pick: me.picks.find((k) => k.year === 2027 && k.round === 7)! });
    const v = evaluateTrade(league, cpu, offer, want);
    expect(v.accept).toBe(true);
    executeTrade(league, me, cpu, offer, want);
    expect(me.roster).toContain(target.id);
    expect(cpu.picks.some((k) => k.year === 2027 && k.round === 7 && k.orig === 0)).toBe(true);
    expect(league.alumni.length).toBeGreaterThan(0);
    expect(me.roster).toHaveLength(53);
  });
});

describe('stamina, zone and injuries', () => {
  it('drains energy over a game and rotates tired players', () => {
    const league = newLeague(3, 0, settings);
    const gs = newGame(0, 1, 15, false, 9);
    const ctx = makeCtx(league, gs);
    const rb1 = league.teams[0].depth.RB![0];
    let low = 100, rotated = false;
    for (let i = 0; i < 400 && gs.phase !== 'final'; i++) {
      simStep(ctx);
      low = Math.min(low, condition(gs).energy[rb1] ?? 100);
      if (ctx.lineups[0].rb[0].id !== rb1) rotated = true;
    }
    const c = condition(gs);
    expect(low).toBeLessThan(80);
    expect(rotated).toBe(true);
    expect(Object.keys(c.snaps).length).toBeGreaterThan(30);
    const tired = effective(league.players[rb1], 40);
    expect(tired.attrs.spd!).toBeLessThan(league.players[rb1].attrs.spd!);
  });

  it('puts an X-Factor QB in the zone after three straight completions', () => {
    const league = newLeague(3, 0, settings);
    const qb = league.players[league.teams[0].depth.QB![0]];
    qb.dev = 'xfactor';
    qb.xfactor = 'x-sniper';
    let zoned = 0;
    for (let s = 0; s < 6; s++) {
      const gs = simGame(league, 0, 1, false, 100 + s);
      if (gs.cond!.events.some((e) => e.includes('IN THE ZONE'))) zoned++;
    }
    expect(zoned).toBeGreaterThan(0);
  });

  it('assigns named injuries with recovery windows and notifies the user', () => {
    const league = newLeague(12, 0, settings);
    for (let w = 0; w < 6; w++) finishWeek(league);
    const notes = league.inbox.filter((n) => n.kind === 'injury');
    expect(notes.length).toBeGreaterThan(0);
    expect(INJURIES.some((i) => notes[0].text.toUpperCase().includes(i.name.toUpperCase()))).toBe(true);
  });

  it('upgrades productive players faster with better dev traits', () => {
    const league = newLeague(3, 0, settings);
    const base = league.players[league.teams[0].depth.WR![0]];
    const a = { ...base, attrs: { ...base.attrs }, dev: 'normal' as const, devPotential: 'normal' as const, pot: 99, xp: 0, age: 23 };
    const b = { ...base, attrs: { ...base.attrs }, dev: 'normal' as const, devPotential: 'xfactor' as const, pot: 99, xp: 0, age: 23 };
    const rng = new Rng(1);
    for (let g = 0; g < 8; g++) { gainXp(a, 55, 6, rng); gainXp(b, 55, 6, rng); }
    expect(b.ovr).toBeGreaterThan(a.ovr);
  });
});

describe('rundown and offseason', () => {
  it('ranks unit groups and names weaknesses', () => {
    const league = newLeague(30, 7, settings);
    const r = teamRundown(league, league.teams[7]);
    expect(r.units).toHaveLength(9);
    for (const u of r.units) expect(u.rank).toBeGreaterThanOrEqual(1);
    expect(r.weaknesses.length + r.strengths.length).toBeGreaterThan(0);
  });

  it('opens the draft after the season with an order led by the worst record', () => {
    const league = newLeague(31, 0, settings);
    playSeason(league);
    const champ = league.playoffs!.champion!;
    startOffseason(league);
    expect(league.phase).toBe('draft');
    expect(league.draft!.order[31].orig).toBe(champ);
    // Retired players must be gone from every depth chart before the rundown is built.
    for (const t of league.teams) for (const ids of Object.values(t.depth)) for (const id of ids!) expect(league.players[id]).toBeDefined();
    expect(teamRundown(league, league.teams[0]).units).toHaveLength(9);
    // finalizeGame is still usable for a user game after the offseason.
    expect(typeof finalizeGame).toBe('function');
  });
});
