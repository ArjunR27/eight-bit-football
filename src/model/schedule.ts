import type { Rng } from '../core/rng';
import type { ScheduledGame, Team } from './types';

/**
 * 18-week schedule: 17 games per team plus one bye:
 * - 6 division games (home-and-home vs 3 rivals)
 * - 4 vs another division in the same conference
 * - 4 vs a second division in the same conference
 * - 3 vs a division from the other conference (rotates each year)
 */
export function makeSchedule(rng: Rng, teams: Team[], year = 2026): ScheduledGame[][] {
  const divs: number[][] = [];
  for (let c = 0; c < 2; c++)
    for (let d = 0; d < 4; d++) divs.push(teams.filter((t) => t.conf === c && t.div === d).map((t) => t.id));

  const weeks: ScheduledGame[][] = [];
  // Division double round-robin: 3 rounds, twice with home/away flipped.
  const rr = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  for (let leg = 0; leg < 2; leg++) {
    for (const round of rr) {
      const wk: ScheduledGame[] = [];
      for (const div of divs)
        for (const [a, b] of round) {
          const [h, w] = leg === 0 ? [div[a], div[b]] : [div[b], div[a]];
          wk.push({ home: h, away: w, played: false });
        }
      weeks.push(wk);
    }
  }

  const bipartite = (pairs: [number, number][], rounds: number, offset: number) => {
    for (let k = 0; k < rounds; k++) {
      const wk: ScheduledGame[] = [];
      for (const [da, db] of pairs)
        for (let i = 0; i < 4; i++) {
          const a = divs[da][i];
          const b = divs[db][(i + k) % 4];
          const homeA = (i + k + offset) % 2 === 0;
          wk.push({ home: homeA ? a : b, away: homeA ? b : a, played: false });
        }
      weeks.push(wk);
    }
  };
  // Divisions: 0-3 AC E/N/S/W, 4-7 NC E/N/S/W
  bipartite([[0, 1], [2, 3], [4, 5], [6, 7]], 4, year);
  bipartite([[0, 2], [1, 3], [4, 6], [5, 7]], 4, year + 1);
  const rot = year % 4;
  bipartite([0, 1, 2, 3].map((d) => [d, 4 + ((d + rot) % 4)] as [number, number]), 3, year);

  return withByes(rng, rng.shuffle(weeks));
}

/**
 * NFL-style bye weeks: each team rests once, four teams at a time across weeks 6-13.
 * Two games are lifted out of each of those weeks so that the 16 lifted games cover all
 * 32 teams exactly once; together they become an 18th week.
 */
function withByes(rng: Rng, rounds: ScheduledGame[][]): ScheduledGame[][] {
  const byeWeeks = [5, 6, 7, 8, 9, 10, 11, 12];
  for (let attempt = 0; attempt < 200; attempt++) {
    const used = new Set<number>();
    const lifted: ScheduledGame[][] = [];
    let ok = true;
    for (const w of byeWeeks) {
      const free = rng.shuffle(rounds[w].filter((g) => !used.has(g.home) && !used.has(g.away)));
      if (free.length < 2) { ok = false; break; }
      const pair = free.slice(0, 2);
      for (const g of pair) used.add(g.home).add(g.away);
      lifted.push(pair);
    }
    if (!ok) continue;
    const weeks = rounds.map((wk, w) => {
      const i = byeWeeks.indexOf(w);
      return i < 0 ? wk : wk.filter((g) => !lifted[i].includes(g));
    });
    weeks.push(lifted.flat());
    return weeks;
  }
  return rounds; // extremely unlikely; fall back to no byes
}

export function byeWeekOf(schedule: ScheduledGame[][], teamId: number) {
  return schedule.findIndex((wk) => !wk.some((g) => g.home === teamId || g.away === teamId));
}
