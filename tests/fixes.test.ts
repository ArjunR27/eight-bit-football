import { describe, expect, it } from 'vitest';
import { newLeague } from '../src/model/generate';
import { lineup } from '../src/model/depth';
import { finishWeek, startNewSeason } from '../src/model/season';
import { DEV_FLOOR, DEV_ORDER, potentialOf } from '../src/model/dev';
import { PlayEngine } from '../src/field/engine';
import { DEF_CALLS, PLAYS, PUNT_PLAY, playsForScheme } from '../src/field/playbook';
import type { OffensiveScheme } from '../src/model/types';

const settings = { sound: false, quarterMinutes: 3, difficulty: 1 as const };

describe('dev tiers are a rating hierarchy', () => {
  const league = newLeague(41, 0, settings);
  const check = () => {
    for (const p of Object.values(league.players)) {
      if (p.devHidden) continue;
      expect(p.ovr, `${p.dev} ${p.ovr}`).toBeGreaterThanOrEqual(DEV_FLOOR[p.dev]);
      expect(DEV_ORDER.indexOf(p.dev)).toBeLessThanOrEqual(DEV_ORDER.indexOf(potentialOf(p)));
    }
  };
  it('holds for a new league: X-Factors 87+, Superstars 83+, Stars 76+', check);
  it('still holds after two seasons of growth, decline and drafts', () => {
    for (let s = 0; s < 2; s++) { let g = 0; while (league.phase !== 'offseason' && g++ < 40) finishWeek(league); startNewSeason(league); }
    check();
  }, 300000);
});

describe('dive', () => {
  const league = newLeague(11, 0, settings);
  const off = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
  it('is a short lunge (under ~2.5 yds) that ends the play', () => {
    const run = PLAYS.find(p => p.id === 'sb-iz')!;
    let tested = 0;
    for (let seed = 1; seed < 30 && tested < 8; seed++) {
      const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play: run, defCall: DEF_CALLS.cover2, difficulty: 1, seed });
      e.snap();
      while (!e.carrier && e.phase === 'live') e.update();
      for (let i = 0; i < 20 && e.phase === 'live'; i++) e.update();
      if (e.phase !== 'live' || !e.carrier) continue;
      const x0 = e.carrier.x;
      e.gesture('dive');
      for (let i = 0; i < 120 && e.phase === 'live'; i++) e.update();
      expect(e.phase).toBe('dead');
      expect(e.carrier!.x - x0).toBeLessThan(2.5);
      tested++;
    }
    expect(tested).toBeGreaterThan(3);
  });
});

describe('throw preview matches the throw', () => {
  const league = newLeague(11, 0, settings);
  const off = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
  it('clamps to arm strength and lands within the shown accuracy circle', () => {
    const pass = PLAYS.find(p => p.id === 'sg-verts')!;
    let inside = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play: pass, defCall: DEF_CALLS.cover3, difficulty: 1, seed });
      e.snap();
      for (let i = 0; i < 40; i++) e.update();
      if (!e.canThrow()) continue;
      const far = e.throwPlan(e.qb.x + 200, e.qb.y);
      expect(far.d).toBeCloseTo(far.max);
      const plan = e.throwPlan(e.qb.x + 18, e.qb.y + 4);
      e.throwTo(e.qb.x + 18, e.qb.y + 4);
      const a = e.ball.air!;
      if (Math.hypot(a.x1 - plan.x, a.y1 - plan.y) <= plan.sd * 2.5) inside++;
      n++;
    }
    expect(n).toBeGreaterThan(40);
    expect(inside / n).toBeGreaterThan(0.9);
  });
});

describe('playbook', () => {
  it('every scheme has unique plays and at least two runs and passes', () => {
    for (const scheme of ['westCoast', 'airRaid', 'powerRun', 'spreadOption', 'balanced'] as OffensiveScheme[]) {
      const book = playsForScheme(scheme);
      expect(new Set(book.map(p => p.id)).size).toBe(book.length);
      expect(book.filter(p => p.type === 'run').length).toBeGreaterThanOrEqual(2);
      expect(book.filter(p => p.type !== 'run').length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('live clock', () => {
  it('expiring the clock ends the quarter, and at 0:00 of Q2 goes to halftime', async () => {
    const { newGame, expireClock } = await import('../src/sim/gameState');
    const gs = newGame(0, 1, 3, false, 1);
    gs.phase = 'play'; gs.clock = 0.4;
    expireClock(gs);
    expect(gs.quarter).toBe(2);
    expect(gs.clock).toBe(180);
    expireClock(gs);
    expect(gs.quarter).toBe(3);
    expect(gs.phase).toBe('kickoff');
  });
  it('scales between-play runoff for simulated snaps', async () => {
    const { newGame, applyPlay } = await import('../src/sim/gameState');
    const a = newGame(0, 1, 15, false, 1), b = newGame(0, 1, 15, false, 1);
    for (const g of [a, b]) { g.phase = 'play'; g.poss = 0; }
    b.runoffScale = 0.4;
    const run = { kind: 'run' as const, yards: 3, elapsed: 5, clockStops: false, stats: [], desc: 'run' };
    applyPlay(a, { ...run }); applyPlay(b, { ...run });
    expect(900 - a.clock).toBe(35);
    expect(900 - b.clock).toBe(17);
  });
});

describe('juke', () => {
  const league = newLeague(11, 0, settings);
  const off = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
  it('moves the runner ~2.5+ yds sideways and drops defenders who were closing in', () => {
    const run = PLAYS.find(p => p.id === 'sb-iz')!;
    let jukedDefenders = 0, lateral = 0, n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play: run, defCall: DEF_CALLS.cover2, difficulty: 1, seed });
      e.snap();
      while (!e.carrier && e.phase === 'live') e.update();
      for (let i = 0; i < 15 && e.phase === 'live'; i++) e.update();
      if (e.phase !== 'live' || !e.carrier) continue;
      // Put a defender right in front, diving at him.
      const c = e.carrier, d = e.def.find(f => !f.engaged && f.role === 'MLB')!;
      d.x = c.x + 1.8; d.y = c.y; d.lunge = 0.2; d.stun = 0; d.sprawl = 0; d.tackleCd = 0;
      const y0 = c.y;
      e.gesture('jukeUp');
      if (d.sprawl > 0) jukedDefenders++;
      for (let i = 0; i < 20 && e.phase === 'live'; i++) e.update();
      lateral += Math.abs(c.y - y0); n++;
    }
    expect(n).toBeGreaterThan(20);
    expect(jukedDefenders / n).toBeGreaterThan(0.6);
    expect(lateral / n).toBeGreaterThan(2.2);
  });
});

describe('virtual joystick', () => {
  const league = newLeague(11, 0, settings);
  const off = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
  it('runs the carrier the way the stick points, including backward; released = straight upfield', () => {
    const run = PLAYS.find(p => p.id === 'sb-iz')!;
    const dirs = [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0.7, y: 0.7 }];
    for (const [k, dir] of dirs.entries()) {
      const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play: run, defCall: DEF_CALLS.cover2, difficulty: 1, seed: 20 + k });
      e.snap();
      while (!e.carrier && e.phase === 'live') e.update();
      for (const d of e.def) { d.x += 30; } // clear the way so nobody tackles him mid-test
      e.stick = dir;
      for (let i = 0; i < 40 && e.phase === 'live'; i++) e.update();
      const c = e.carrier!, sp = Math.hypot(c.vx, c.vy);
      expect((c.vx * dir.x + c.vy * dir.y) / (sp * Math.hypot(dir.x, dir.y))).toBeGreaterThan(0.95);
      e.stick = null;
      for (let i = 0; i < 90 && e.phase === 'live'; i++) e.update(); // time to turn around from a backward run
      expect(c.vx).toBeGreaterThan(Math.abs(c.vy) * 3);
    }
  });
});

describe('pursuit', () => {
  const league = newLeague(11, 0, settings);
  const off = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
  const breakaway = (gap: number) => {
    const run = PLAYS.find(p => p.id === 'sb-iz')!;
    let caught = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const e = new PlayEngine({ los: 20, ballY: 26.6, toGo: 10, off, def, play: run, defCall: DEF_CALLS.cover2, difficulty: 1, seed });
      e.snap();
      while (!e.carrier && e.phase === 'live') e.update();
      const c = e.carrier!;
      c.x = 35; c.y = 26; c.vx = c.maxSpd * 0.9; c.vy = 0;
      const chasers = e.def.filter(d => ['CB', 'FS', 'SS'].includes(d.role)).slice(0, 3);
      for (const d of e.def) if (!chasers.includes(d)) { d.x = -20; d.y = 1; d.stun = 99; }
      for (const o of e.off) if (o !== c) { o.x = -30; o.y = 2; o.stun = 99; }
      chasers.forEach((d, i) => { d.x = 35 - gap - i * 1.5; d.y = 26 + (i - 1) * 4; d.vx = d.maxSpd * 0.9; d.vy = 0; d.engaged = null; });
      for (let i = 0; i < 60 * 12 && e.phase === 'live'; i++) e.update();
      if (e.result && e.result.yards < 80) caught++;
    }
    return caught / 20;
  };
  it('faster chasers a few yards back run down the carrier instead of diving short', () => {
    expect(breakaway(4)).toBeGreaterThan(0.6);
  });
  it('a clean breakaway with a big cushion still scores', () => {
    expect(breakaway(12)).toBeLessThan(0.3);
  });
});

describe('arm strength', () => {
  it('caps every QB between 60 and 70 yards of air distance, abilities and the zone included', async () => {
    const { effective } = await import('../src/model/dev');
    const league = newLeague(11, 0, settings);
    const def = lineup(league, league.teams[1]);
    const pass = PLAYS.find(p => p.id === 'sg-verts')!;
    for (const thp of [40, 70, 85, 99]) {
      const base = lineup(league, league.teams[0]);
      const qb = { ...base.qb, attrs: { ...base.qb.attrs, thp }, abilities: ['cannon'] };
      const off = { ...base, qb: effective(qb, 100, true) }; // Cannon + zone boost
      const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play: pass, defCall: DEF_CALLS.cover2, difficulty: 1, seed: 1 });
      expect(e.maxThrow()).toBeGreaterThanOrEqual(60);
      expect(e.maxThrow()).toBeLessThanOrEqual(70);
    }
  });
});

describe('aim assist', () => {
  // Throw at a moving receiver, aiming either where he IS (no lead) or where he'll be (good lead).
  const run = (lead: boolean, qbAcc?: number) => {
    const league = newLeague(11, 0, settings);
    const base = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
    const off = qbAcc === undefined ? base : { ...base, qb: { ...base.qb, attrs: { ...base.qb.attrs, acc: qbAcc, awr: qbAcc } } };
    let complete = 0, n = 0, pull = 0;
    for (const id of ['sg-slants', 'sg-mesh', 'sb-curlflat', 'e-quick', 't-flood']) {
      const play = PLAYS.find(p => p.id === id)!;
      for (let seed = 1; seed <= 12; seed++) {
        const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play, defCall: DEF_CALLS.cover3, difficulty: 1, seed });
        e.snap();
        for (let i = 0; i < 70; i++) e.update();
        if (!e.canThrow()) continue;
        const r = e.off.filter(f => f.job === 'route' && Math.hypot(f.vx, f.vy) > 3 && Math.hypot(f.x - e.qb.x, f.y - e.qb.y) > 8 && Math.hypot(f.x - e.qb.x, f.y - e.qb.y) < 25)[0];
        if (!r) continue;
        const T = 0.12 + Math.hypot(r.x - e.qb.x, r.y - e.qb.y) / 24;
        const ax = lead ? r.x + r.vx * T : r.x, ay = lead ? r.y + r.vy * T : r.y;
        const plan = e.throwPlan(ax, ay);
        pull += Math.hypot(plan.x - ax, plan.y - ay);
        e.throwTo(ax, ay);
        for (let i = 0; i < 400 && !e.done; i++) e.update();
        n++;
        if (e.result?.kind === 'pass') complete++;
      }
    }
    return { rate: complete / n, pull: pull / n, n };
  };
  it('rewards leading the receiver: a good lead completes far more often than aiming at him', () => {
    const naive = run(false), led = run(true);
    expect(naive.n).toBeGreaterThan(20);
    expect(led.rate).toBeGreaterThan(0.55);
    expect(led.rate).toBeGreaterThan(naive.rate + 0.15);
  });
  it('is partial and scales with the QB: elite passers correct a sloppy aim more than backups', () => {
    const elite = run(false, 95), backup = run(false, 55);
    expect(elite.pull).toBeGreaterThan(backup.pull * 1.4);
  });
});

describe('route running', () => {
  it('crisp route runners get more separation from the same defender', () => {
    const league = newLeague(11, 0, settings);
    const base = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
    const play = PLAYS.find(p => p.id === 'sg-slants')!;
    const separation = (rte: number) => {
      const wr = { ...base.wr[0], attrs: { ...base.wr[0].attrs, rte }, abilities: [] };
      const off = { ...base, wr: [wr, ...base.wr.slice(1)] };
      let total = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play, defCall: DEF_CALLS.cover1, difficulty: 1, seed });
        e.snap();
        for (let i = 0; i < 100; i++) e.update(); // just past the break
        const r = e.off.find(f => f.role === 'WR1')!;
        const man = e.def.find(d => d.man === r) ?? e.def.reduce((a, b) => (Math.hypot(a.x - r.x, a.y - r.y) < Math.hypot(b.x - r.x, b.y - r.y) ? a : b));
        total += Math.hypot(man.x - r.x, man.y - r.y);
      }
      return total / 30;
    };
    const crisp = separation(95), sloppy = separation(40);
    expect(crisp).toBeGreaterThan(sloppy + 0.3);
  });
});

describe('long snapper', () => {
  it('bad-snap odds fall as snap reliability rises', async () => {
    const { badSnapChance } = await import('../src/model/dev');
    const ls = (snp: number) => ({ attrs: { snp } }) as never;
    expect(badSnapChance(ls(40))).toBeGreaterThan(badSnapChance(ls(70)));
    expect(badSnapChance(ls(70))).toBeGreaterThan(badSnapChance(ls(95)));
    expect(badSnapChance(ls(95))).toBeLessThan(0.01);
  });
  it('a bad snap costs the field goal range and accuracy', async () => {
    const { FieldGoalKick } = await import('../src/field/kick');
    const league = newLeague(11, 0, settings);
    const { k } = lineup(league, league.teams[0]);
    const awful = { ...lineup(league, league.teams[0]).ls, attrs: { snp: 1 } };
    let bad = 0, good = 0, badMakes = 0, goodMakes = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const kick = new FieldGoalKick(75, k, seed, awful);
      while (Math.abs(kick.meter() - 0.86) > 0.02) kick.update(1 / 240);
      kick.tap();
      while (Math.abs(kick.pendulum()) > 0.004) kick.update(1 / 240);
      kick.tap();
      if (kick.badSnap) { bad++; if (kick.good) badMakes++; } else { good++; if (kick.good) goodMakes++; }
    }
    expect(bad / 3000).toBeGreaterThan(0.02);
    expect(bad / 3000).toBeLessThan(0.05);
    expect(badMakes / bad).toBeLessThan(goodMakes / good);
  });
  it('a bad snap on a punt delays and shortens it', () => {
    const league = newLeague(11, 0, settings);
    const base = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
    const off = { ...base, ls: { ...base.ls, attrs: { ...base.ls.attrs, snp: 1 } } };
    const gross = { bad: [] as number[], good: [] as number[] };
    for (let seed = 1; seed <= 400; seed++) {
      const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 8, off, def, play: PUNT_PLAY, defCall: DEF_CALLS.cover2, difficulty: 1, seed });
      e.snap();
      while (e.phase === 'live' && !e.ball.air && e.puntStage !== 'return') e.update();
      if (e.ball.air) (e.badSnap ? gross.bad : gross.good).push(e.ball.air.x1 - 30);
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(gross.bad.length).toBeGreaterThan(3);
    expect(avg(gross.bad)).toBeLessThan(avg(gross.good) - 4);
  });
});

describe('difficulty', () => {
  it('Legend CPU teams outscore the user more than Rookie CPU teams (sim, both sides of the ball)', async () => {
    const { simGame } = await import('../src/sim/simGame');
    const margin = (difficulty: 0 | 3) => {
      const league = newLeague(5, 0, { ...settings, difficulty });
      let m = 0;
      for (let i = 0; i < 80; i++) { const gs = simGame(league, 0, 1 + (i % 31), false, 500 + i); m += gs.score[0] - gs.score[1]; }
      return m / 80;
    };
    expect(margin(0)).toBeGreaterThan(margin(3) + 4);
  });
  it('field AI reacts faster and tackles better on Legend', () => {
    const league = newLeague(11, 0, settings);
    const off = lineup(league, league.teams[0]), def = lineup(league, league.teams[1]);
    const run = PLAYS.find(p => p.id === 'sb-iz')!;
    const ypc = (difficulty: number) => {
      let y = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play: run, defCall: DEF_CALLS.cover2, difficulty, seed });
        e.snap();
        for (let i = 0; i < 60 * 20 && !e.done; i++) e.update();
        y += e.result!.yards;
      }
      return y / 60;
    };
    expect(ypc(0)).toBeGreaterThan(ypc(3));
  });
});

describe('team needs', () => {
  it('update as the roster changes and announce new weaknesses', async () => {
    const { refreshNeeds, teamRundown } = await import('../src/model/rundown');
    const { executeTrade } = await import('../src/model/trade');
    const league = newLeague(8, 0, settings);
    const me = league.teams[0];
    refreshNeeds(league, false);
    // Ship the whole starting offensive line away for a late pick: the OL should become a need.
    const ol = (['LT', 'LG', 'C', 'RG', 'RT'] as const).map(pos => ({ kind: 'player' as const, id: me.depth[pos]![0] }));
    const cpu = league.teams[5];
    executeTrade(league, me, cpu, ol, [{ kind: 'pick', pick: cpu.picks.at(-1)! }]);
    expect(league.needs!.units).toContain('OL');
    expect(league.inbox.some(n => n.kind === 'needs' && /Offensive Line/i.test(n.text))).toBe(true);
    // A regular week keeps the hub's needs in sync with a fresh rundown.
    finishWeek(league);
    expect(league.needs!.weak).toEqual(teamRundown(league, me).weaknesses);
  });
});
