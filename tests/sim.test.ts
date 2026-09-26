import { describe, expect, it } from 'vitest';
import { newLeague } from '../src/model/generate';
import { finishWeek, standings, startNewSeason } from '../src/model/season';
import { simGame } from '../src/sim/simGame';
import { REAL_PLAYER_DENYLIST } from '../src/data/names';
import { POSITIONS } from '../src/model/types';

const settings = { sound: false, quarterMinutes: 15, difficulty: 1 as const };

describe('league generation', () => {
  const league = newLeague(42, 0, settings);
  it('builds 32 teams with 53-man rosters and 16-man practice squads', () => {
    expect(league.teams).toHaveLength(32);
    for (const t of league.teams) {
      expect(t.roster).toHaveLength(53);
      expect(t.practice).toHaveLength(16);
      for (const pos of POSITIONS) expect(t.depth[pos]!.length).toBeGreaterThan(0);
    }
  });
  it('never generates a denylisted real-player name', () => {
    for (const p of Object.values(league.players)) expect(REAL_PLAYER_DENYLIST.has(`${p.first} ${p.last}`)).toBe(false);
  });
  it('produces a sensible OVR spread', () => {
    const ovrs = Object.values(league.players).map((p) => p.ovr);
    const mean = ovrs.reduce((s, x) => s + x, 0) / ovrs.length;
    expect(mean).toBeGreaterThan(55);
    expect(mean).toBeLessThan(72);
    expect(Math.max(...ovrs)).toBeGreaterThan(85);
  });
  it('schedules 17 games and one bye per team over 18 weeks, byes spread out', () => {
    expect(league.schedule).toHaveLength(18);
    const games = new Array(32).fill(0);
    const byes = new Map<number, number>();
    league.schedule.forEach((wk, w) => {
      const ids = wk.flatMap((g) => [g.home, g.away]);
      expect(new Set(ids).size).toBe(ids.length); // nobody plays twice in a week
      for (const id of ids) games[id]++;
      if (ids.length < 32) byes.set(w, 32 - ids.length);
    });
    expect(games.every((n) => n === 17)).toBe(true);
    expect(byes.size).toBe(8);
    for (const n of byes.values()) expect(n).toBe(4);
  });
});

describe('game sim realism (15-min quarters)', () => {
  const league = newLeague(7, 0, settings);
  const N = 200;
  let pts = 0, att = 0, cmp = 0, passYds = 0, rushAtt = 0, rushYds = 0, ints = 0, sacks = 0, plays = 0, ties = 0;
  for (let i = 0; i < N; i++) {
    const gs = simGame(league, i % 32, (i + 5) % 32, false, 1000 + i);
    expect(gs.phase).toBe('final');
    pts += gs.score[0] + gs.score[1];
    if (gs.score[0] === gs.score[1]) ties++;
    plays += gs.team[0].plays + gs.team[1].plays;
    for (const l of Object.values(gs.stats)) {
      att += l.passAtt ?? 0; cmp += l.passCmp ?? 0; passYds += l.passYds ?? 0;
      rushAtt += l.rushAtt ?? 0; rushYds += l.rushYds ?? 0; ints += l.passInt ?? 0; sacks += l.sacked ?? 0;
    }
  }
  const stats = {
    ptsPerTeam: pts / N / 2, playsPerTeam: plays / N / 2, cmpPct: cmp / att, ypa: passYds / att,
    ypc: rushYds / rushAtt, intPct: ints / att, sackPct: sacks / (att + sacks), ties,
  };
  console.log(stats);
  it('is in a realistic NFL band', () => {
    expect(stats.ptsPerTeam).toBeGreaterThan(16);
    expect(stats.ptsPerTeam).toBeLessThan(30);
    expect(stats.cmpPct).toBeGreaterThan(0.56);
    expect(stats.cmpPct).toBeLessThan(0.72);
    expect(stats.ypc).toBeGreaterThan(3.6);
    expect(stats.ypc).toBeLessThan(5.2);
    expect(stats.intPct).toBeLessThan(0.04);
    expect(stats.playsPerTeam).toBeGreaterThan(50);
    expect(stats.playsPerTeam).toBeLessThan(75);
  });
});

describe('season flow', () => {
  it('runs a full season, playoffs, and rolls into the next year', () => {
    const league = newLeague(99, 3, { ...settings, quarterMinutes: 5 });
    let guard = 0;
    while (league.phase !== 'offseason' && guard++ < 40) finishWeek(league);
    expect(league.phase).toBe('offseason');
    expect(league.history).toHaveLength(1);
    const rows = standings(league);
    for (const r of rows) expect(r.w + r.l + r.t).toBe(17);
    startNewSeason(league);
    expect(league.year).toBe(2027);
    for (const t of league.teams) {
      expect(t.roster).toHaveLength(53);
      expect(t.practice).toHaveLength(16);
    }
    // Saves must survive a JSON round-trip.
    const copy = JSON.parse(JSON.stringify(league));
    expect(copy.teams[3].roster).toEqual(league.teams[3].roster);
  });
});
