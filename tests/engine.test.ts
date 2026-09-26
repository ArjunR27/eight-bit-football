import { describe, expect, it } from 'vitest';
import { newLeague } from '../src/model/generate';
import { lineup } from '../src/model/depth';
import { PlayEngine } from '../src/field/engine';
import { DEF_CALLS, PLAYS, PUNT_PLAY, type Play } from '../src/field/playbook';
import { ELIGIBLE, type Role } from '../src/field/playbook';

const league = newLeague(11, 0, { sound: false, quarterMinutes: 5, difficulty: 1 });
const off = lineup(league, league.teams[0]);
const def = lineup(league, league.teams[1]);

/** Simple bot QB: after a beat, throw to the receiver with the most separation, leading him. */
function runPlay(play: Play, callId: keyof typeof DEF_CALLS, seed: number, throwAt = 2.0) {
  const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play, defCall: DEF_CALLS[callId], difficulty: 1, seed });
  e.snap();
  let frames = 0;
  while (!e.done && frames++ < 60 * 40) {
    if (e.canThrow() && e.t >= throwAt) {
      let best: { x: number; y: number } | null = null;
      let bestSep = -1;
      for (const r of e.off) {
        if (!ELIGIBLE.includes(r.role as Role) || r.job !== 'route') continue;
        let sep = 99;
        for (const d of e.def) sep = Math.min(sep, Math.hypot(d.x - r.x, d.y - r.y));
        if (sep > bestSep) {
          bestSep = sep;
          const T = Math.hypot(r.x - e.qb.x, r.y - e.qb.y) / 24;
          best = { x: r.x + r.vx * T, y: r.y + r.vy * T };
        }
      }
      if (best) e.throwTo(best.x, best.y);
    }
    e.update();
  }
  return { e, frames };
}

describe('field engine', () => {
  it('every play in the playbook resolves against every defensive call', () => {
    for (const play of PLAYS)
      for (const call of Object.keys(DEF_CALLS) as (keyof typeof DEF_CALLS)[]) {
        const { e } = runPlay(play, call, 5);
        expect(e.done, `${play.id} vs ${call}`).toBe(true);
        expect(e.result).not.toBeNull();
      }
  });

  it('produces a plausible spread of outcomes', () => {
    const kinds: Record<string, number> = {};
    let passYds = 0, passN = 0, runYds = 0, runN = 0, time = 0, n = 0;
    for (let seed = 0; seed < 40; seed++)
      for (const play of PLAYS)
        for (const call of ['cover1', 'cover2', 'cover3'] as const) {
          const { e } = runPlay(play, call, seed * 97 + 3, 1.6 + (seed % 5) * 0.3);
          const r = e.result!;
          kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
          if (play.type === 'run') { runYds += r.yards; runN++; }
          else if (r.kind === 'pass' || r.kind === 'incomplete' || r.kind === 'int') { passYds += r.kind === 'pass' ? r.yards : 0; passN++; }
          time += r.elapsed;
          n++;
        }
    const summary = {
      kinds,
      cmpPct: (kinds.pass ?? 0) / passN,
      ypa: passYds / passN,
      ypc: runYds / runN,
      avgPlaySecs: time / n,
    };
    console.log(summary);
    // The bot is a perfect-read, perfect-placement QB, so these bands sit above NFL norms on purpose.
    expect(summary.cmpPct).toBeGreaterThan(0.4);
    expect(summary.cmpPct).toBeLessThan(0.85);
    expect(summary.ypa).toBeLessThan(22);
    expect(summary.ypc).toBeGreaterThan(2);
    expect(summary.ypc).toBeLessThan(10);
    expect(summary.avgPlaySecs).toBeLessThan(9);
    expect(kinds.sack ?? 0).toBeGreaterThan(0);
  });

  it('punts resolve as a change of possession, sometimes with a return', () => {
    const descs: string[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const e = new PlayEngine({ los: 35, ballY: 26.6, toGo: 6, off, def, play: PUNT_PLAY, defCall: DEF_CALLS.cover2, difficulty: 1, seed });
      e.snap();
      for (let i = 0; i < 60 * 30 && !e.done; i++) e.update();
      expect(e.done).toBe(true);
      expect(e.result!.kind).toBe('punt');
      expect(e.result!.turnoverSpot).toBeGreaterThan(35);
      descs.push(e.result!.desc);
    }
    expect(descs.some(d => d.includes('returns'))).toBe(true);
  });

  it('runs the controlled carrier straight upfield and jukes hard sideways without gaining speed', () => {
    const run = PLAYS.find(p => p.id === 'sb-iz')!;
    const e = new PlayEngine({ los: 30, ballY: 26.6, toGo: 10, off, def, play: run, defCall: DEF_CALLS.cover2, difficulty: 1, seed: 3 });
    e.snap();
    while (!e.carrier) e.update();
    for (let i = 0; i < 30; i++) e.update();
    const c = e.carrier!;
    if (e.phase !== 'live') return;
    expect(c.vx).toBeGreaterThan(Math.abs(c.vy));
    const before = Math.hypot(c.vx, c.vy);
    e.gesture('jukeUp');
    expect(c.vy).toBeLessThan(0);
    expect(Math.abs(c.vy)).toBeGreaterThan(c.vx);
    expect(Math.hypot(c.vx, c.vy)).toBeLessThanOrEqual(Math.max(before, c.maxSpd * 0.75) + 1e-6);
  });
});
