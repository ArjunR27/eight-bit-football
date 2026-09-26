import { POSITIONS, type League, type Player, type Pos, type Team } from './types';

// When a position runs out of healthy bodies, pull from these (in order).
const FALLBACK: Record<Pos, Pos[]> = {
  QB: [], RB: ['FB', 'WR'], FB: ['RB', 'TE'], WR: ['TE', 'RB'], TE: ['FB', 'WR'],
  LT: ['RT', 'LG', 'RG', 'C'], LG: ['RG', 'C', 'LT', 'RT'], C: ['LG', 'RG', 'LT', 'RT'],
  RG: ['LG', 'C', 'RT', 'LT'], RT: ['LT', 'RG', 'LG', 'C'],
  DE: ['OLB', 'DT'], DT: ['DE', 'MLB'], OLB: ['MLB', 'DE', 'SS'], MLB: ['OLB', 'SS'],
  CB: ['FS', 'SS'], FS: ['SS', 'CB'], SS: ['FS', 'CB', 'OLB'],
  K: ['P'], P: ['K'], LS: ['C', 'TE'],
};

export function autoDepth(league: League, team: Team) {
  for (const pos of POSITIONS) {
    team.depth[pos] = team.roster
      .map((id) => league.players[id])
      .filter((p) => p.pos === pos)
      .sort((a, b) => b.ovr - a.ovr)
      .map((p) => p.id);
  }
}

/** Keep depth chart consistent with roster (remove departed players, append new ones). */
export function syncDepth(league: League, team: Team) {
  const onRoster = new Set(team.roster);
  for (const pos of POSITIONS) {
    const cur = (team.depth[pos] ?? []).filter((id) => onRoster.has(id) && league.players[id].pos === pos);
    const missing = team.roster
      .filter((id) => league.players[id].pos === pos && !cur.includes(id))
      .sort((a, b) => league.players[b].ovr - league.players[a].ovr);
    team.depth[pos] = [...cur, ...missing];
  }
}

/** In-game energy below this sends a starter to the bench for a breather if a backup is fresh. */
export const SUB_ENERGY = 55;

/** "Start whoever's healthy in this order", with cross-position fallback; gassed starters rotate out. */
function take(league: League, team: Team, pos: Pos, n: number, used: Set<number>, energy?: Record<number, number>): Player[] {
  const out: Player[] = [];
  const tired: Player[] = [];
  for (const src of [pos, ...FALLBACK[pos]]) {
    for (const id of team.depth[src] ?? []) {
      if (out.length >= n) return out;
      const p = league.players[id];
      if (!p || p.injury > 0 || used.has(id)) continue;
      if (src === pos && energy && (energy[id] ?? 100) < SUB_ENERGY) {
        tired.push(p);
        continue;
      }
      used.add(id);
      out.push(p);
    }
    // Only reach past the position when nobody rested is left at it: bring the tired starters back.
    if (src === pos) for (const p of tired) if (out.length < n) { used.add(p.id); out.push(p); }
  }
  // Absolute last resort: anyone healthy.
  for (const id of team.roster) {
    if (out.length >= n) break;
    const p = league.players[id];
    if (p.injury > 0 || used.has(id)) continue;
    used.add(id);
    out.push(p);
  }
  return out;
}

export interface Lineup {
  qb: Player; rb: Player[]; fb: Player; wr: Player[]; te: Player[];
  ol: Player[]; // LT, LG, C, RG, RT
  de: Player[]; dt: Player[]; olb: Player[]; mlb: Player[]; cb: Player[]; fs: Player; ss: Player;
  k: Player; p: Player; ls: Player;
}

export function lineup(league: League, team: Team, energy?: Record<number, number>): Lineup {
  const off = new Set<number>();
  const def = new Set<number>();
  const st = new Set<number>();
  const t = (pos: Pos, n: number, used: Set<number>) => take(league, team, pos, n, used, energy);
  return {
    qb: t('QB', 1, off)[0],
    rb: t('RB', 2, off),
    fb: t('FB', 1, off)[0],
    wr: t('WR', 4, off),
    te: t('TE', 2, off),
    ol: [...t('LT', 1, off), ...t('LG', 1, off), ...t('C', 1, off), ...t('RG', 1, off), ...t('RT', 1, off)],
    de: t('DE', 2, def),
    dt: t('DT', 2, def),
    olb: t('OLB', 2, def),
    mlb: t('MLB', 1, def),
    cb: t('CB', 3, def),
    fs: t('FS', 1, def)[0],
    ss: t('SS', 1, def)[0],
    k: take(league, team, 'K', 1, st)[0],
    p: take(league, team, 'P', 1, st)[0],
    ls: take(league, team, 'LS', 1, st)[0],
  };
}

/** Apply `fn` to every player slot of a lineup (used to hand the sims per-snap copies). */
export function mapLineup(l: Lineup, fn: (p: Player) => Player): Lineup {
  const m = (ps: Player[]) => ps.map(fn);
  return {
    qb: fn(l.qb), rb: m(l.rb), fb: fn(l.fb), wr: m(l.wr), te: m(l.te), ol: m(l.ol),
    de: m(l.de), dt: m(l.dt), olb: m(l.olb), mlb: m(l.mlb), cb: m(l.cb), fs: fn(l.fs), ss: fn(l.ss), k: fn(l.k), p: fn(l.p), ls: fn(l.ls),
  };
}

/** 48-man game-day list: injured players sit first, then the lowest-rated depth. */
export function inactives(league: League, team: Team): Set<number> {
  const out = new Set<number>(team.roster.filter((id) => league.players[id].injury > 0));
  const protectedPos = new Set<Pos>(['QB', 'K', 'P', 'LS']);
  const candidates = team.roster
    .filter((id) => !out.has(id) && !protectedPos.has(league.players[id].pos))
    .map((id) => league.players[id])
    .filter((p) => (team.depth[p.pos] ?? []).indexOf(p.id) >= 2)
    .sort((a, b) => a.ovr - b.ovr);
  for (const p of candidates) {
    if (out.size >= 5) break;
    out.add(p.id);
  }
  return out;
}

export function teamRatings(league: League, team: Team) {
  const l = lineup(league, team);
  const avg = (ps: Player[]) => Math.round(ps.reduce((s, p) => s + p.ovr, 0) / ps.length);
  const off = avg([l.qb, l.qb, l.rb[0], ...l.wr.slice(0, 3), l.te[0], ...l.ol]);
  const def = avg([...l.de, ...l.dt, ...l.olb, ...l.mlb, ...l.cb.slice(0, 2), l.fs, l.ss]);
  return { off, def, ovr: Math.round(off * 0.52 + def * 0.48) };
}
