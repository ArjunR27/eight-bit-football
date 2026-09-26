import { lineup, teamRatings } from './depth';
import { notify } from './news';
import type { League, Player, Team } from './types';

// Start-of-season team report: unit overalls, where each position group ranks in the
// league, the biggest weaknesses and strengths, and roster red flags.

export const UNIT_NAMES = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'K/P'] as const;
export type Unit = (typeof UNIT_NAMES)[number];
const UNIT_LONG: Record<Unit, string> = {
  QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receivers', TE: 'Tight End', OL: 'Offensive Line',
  DL: 'Defensive Line', LB: 'Linebackers', DB: 'Secondary', 'K/P': 'Special Teams',
};

function units(league: League, team: Team): Record<Unit, number> {
  const l = lineup(league, team);
  const avg = (ps: Player[]) => Math.round(ps.filter(Boolean).reduce((s, p) => s + p.ovr, 0) / Math.max(1, ps.filter(Boolean).length));
  return {
    QB: avg([l.qb]), RB: avg([l.rb[0]]), WR: avg(l.wr.slice(0, 3)), TE: avg([l.te[0]]), OL: avg(l.ol),
    DL: avg([...l.de, ...l.dt]), LB: avg([...l.olb, ...l.mlb]), DB: avg([...l.cb, l.fs, l.ss]), 'K/P': avg([l.k, l.p]),
  };
}

export interface Rundown {
  off: number;
  def: number;
  st: number;
  ovr: number;
  units: { unit: Unit; name: string; ovr: number; rank: number }[];
  weaknesses: string[];
  strengths: string[];
  flags: string[];
  stars: Player[];
}

export function teamRundown(league: League, team: Team): Rundown {
  const all = league.teams.map((t) => units(league, t));
  const mine = all[team.id];
  const list = UNIT_NAMES.map((unit) => ({
    unit,
    name: UNIT_LONG[unit],
    ovr: mine[unit],
    rank: 1 + all.filter((u) => u[unit] > mine[unit]).length,
  }));
  const r = teamRatings(league, team);
  const roster = team.roster.map((id) => league.players[id]);
  const old = roster.filter((p) => p.age >= 31 && (team.depth[p.pos]?.[0] === p.id)).length;
  const hurt = roster.filter((p) => p.injury > 0 && (team.depth[p.pos]?.indexOf(p.id) ?? 9) < 2).length;
  const flags: string[] = [];
  if (old) flags.push(`${old} starter${old > 1 ? 's are' : ' is'} 31 or older`);
  if (hurt) flags.push(`${hurt} key player${hurt > 1 ? 's are' : ' is'} injured`);
  const byRank = [...list].sort((a, b) => b.rank - a.rank);
  return {
    off: r.off,
    def: r.def,
    st: mine['K/P'],
    ovr: r.ovr,
    units: list,
    weaknesses: byRank.filter((u) => u.rank >= 17).slice(0, 3).map((u) => `${u.name} (${u.ovr} OVR, ${ordinal(u.rank)})`),
    strengths: [...byRank].reverse().filter((u) => u.rank <= 10).slice(0, 3).map((u) => `${u.name} (${u.ovr} OVR, ${ordinal(u.rank)})`),
    flags,
    stars: roster.filter((p) => !['K', 'P', 'LS'].includes(p.pos)).sort((a, b) => b.ovr - a.ovr).slice(0, 3),
  };
}

/**
 * Recompute the user's team needs from the current lineup (injuries, development, trades and
 * depth-chart edits all move them) and post a news notice when a weakness appears or is fixed.
 */
export function refreshNeeds(league: League, announce = true) {
  const r = teamRundown(league, league.teams[league.userTeamId]);
  const weak = r.units.filter((u) => u.rank >= 17).sort((a, b) => b.rank - a.rank).slice(0, 3);
  const prev = league.needs?.units;
  if (announce && prev) {
    for (const u of weak) if (!prev.includes(u.unit)) notify(league, 'needs', `New weakness: ${u.name} now ${ordinal(u.rank)} in the league (${u.ovr} OVR)`);
    for (const unit of prev) {
      if (weak.some((u) => u.unit === unit)) continue;
      const u = r.units.find((x) => x.unit === unit);
      if (u) notify(league, 'needs', `Weakness fixed: ${u.name} up to ${ordinal(u.rank)} (${u.ovr} OVR)`);
    }
  }
  league.needs = { units: weak.map((u) => u.unit), weak: r.weaknesses, strong: r.strengths };
}

export function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}
