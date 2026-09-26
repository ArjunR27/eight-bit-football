import { Rng, clamp } from '../core/rng';
import { autoDepth, syncDepth, teamRatings } from './depth';
import { DEV_LABELS, assignAbilities, earnedDev } from './dev';
import { ROSTER_SHAPE, makePlayer, picksFor, teamNumbers } from './generate';
import { notify, pname } from './news';
import { computeOvr } from './ratings';
import { standings } from './season';
import { refreshNeeds } from './rundown';
import type { Combine, DevTrait, DraftPick, DraftSlot, League, Player, Pos, Team } from './types';

// NFL-style draft: 7 rounds x 32 picks in reverse order of finish, playoff teams by the
// round they went out, champion last. Picks are tradeable assets owned by teams.

export const ROUNDS = 7;
const CLASS_SIZE = ROUNDS * 32 + 40;
const PRACTICE_MAX = 16;

// Typical height (in) / weight (lb) by position for combine sheets.
const BUILD: Record<Pos, [number, number]> = {
  QB: [75, 220], RB: [70, 212], FB: [72, 245], WR: [72, 200], TE: [77, 252],
  LT: [78, 315], LG: [76, 315], C: [75, 305], RG: [76, 315], RT: [78, 318],
  DE: [76, 266], DT: [75, 310], OLB: [74, 242], MLB: [73, 246], CB: [71, 192], FS: [72, 205], SS: [72, 210],
  K: [72, 198], P: [74, 214], LS: [74, 240],
};

export function makeCombine(rng: Rng, p: Player): Combine {
  const a = (k: keyof Player['attrs'], d = 60) => p.attrs[k] ?? d;
  const [h, w] = BUILD[p.pos];
  const agi = a('agi', a('spd'));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    heightIn: Math.round(h + rng.normal(0, 1.5)),
    weightLb: Math.round(w + rng.normal(0, 9)),
    forty: r2(clamp(5.62 - (a('spd') - 40) * 0.0225 + rng.normal(0, 0.04), 4.24, 5.6)),
    bench: Math.round(clamp(a('str') * 0.48 - 12 + rng.normal(0, 2.5), 4, 45)),
    vertical: Math.round(clamp(22 + (agi - 50) * 0.33 + rng.normal(0, 1.5), 20, 44) * 2) / 2,
    broad: Math.round(clamp(96 + (a('spd') - 50) * 0.75 + rng.normal(0, 3), 90, 142)),
    cone: r2(clamp(7.95 - (agi - 50) * 0.022 + rng.normal(0, 0.06), 6.5, 8.3)),
    shuttle: r2(clamp(4.85 - (agi - 50) * 0.013 + rng.normal(0, 0.04), 3.9, 5.0)),
  };
}

/** Rookie dev odds for hidden prospects (a hidden dev can still turn out Normal). */
const HIDDEN_ODDS: [DevTrait[], number[]] = [['normal', 'star', 'superstar', 'xfactor'], [0.45, 0.33, 0.15, 0.07]];

function makeProspect(league: League, rng: Rng): Player {
  const pos = rng.weighted(ROSTER_SHAPE.map(([p]) => p), ROSTER_SHAPE.map(([p, n]) => (p === 'K' || p === 'P' || p === 'LS' ? 0.35 : n)));
  // Class ratings run ~65-82, bottom-heavy like a real class.
  const target = Math.round(65 + 17 * Math.pow(rng.next(), 1.7));
  const p = makePlayer(league, rng, pos, target, rng.int(21, 23));
  const drift = target - p.ovr;
  for (const k of Object.keys(p.attrs) as (keyof Player['attrs'])[]) p.attrs[k] = clamp(p.attrs[k]! + drift, 20, 99);
  p.ovr = clamp(computeOvr(pos, p.attrs), 64, 83);
  p.pot = Math.min(99, p.ovr + rng.int(2, 10));
  p.yearsPro = 0;
  p.snaps = 0;
  const hidden = rng.chance(0.45);
  p.devHidden = hidden;
  // Hidden devs carry a secret potential; the tier itself still has to be earned by rating.
  p.devPotential = hidden ? rng.weighted(...HIDDEN_ODDS) : 'normal';
  p.dev = earnedDev(p);
  p.abilities = [];
  assignAbilities(p, rng);
  p.combine = makeCombine(rng, p);
  return p;
}

/** Pick order for a finished season (call before the schedule is replaced). */
export function draftOrderFromSeason(league: League): number[] {
  const rows = standings(league);
  const byRecord = (a: number, b: number) => rows[a].pct - rows[b].pct || (rows[a].pf - rows[a].pa) - (rows[b].pf - rows[b].pa);
  const out = new Map<number, number>(); // team -> playoff exit round (champion = 4)
  const po = league.playoffs;
  if (po) {
    po.games.forEach((round, r) => round.forEach((g) => { if (g.played) out.set(g.hs! > g.as! ? g.away : g.home, r); }));
    if (po.champion !== undefined) out.set(po.champion, 4);
  }
  const ids = league.teams.map((t) => t.id);
  const missed = ids.filter((id) => !out.has(id)).sort(byRecord);
  const made = ids.filter((id) => out.has(id)).sort((a, b) => out.get(a)! - out.get(b)! || byRecord(a, b));
  return [...missed, ...made];
}

/** A brand-new league has no finished season: weakest rosters pick first. */
export function initialDraftOrder(league: League): number[] {
  return league.teams.map((t) => ({ id: t.id, ovr: teamRatings(league, t).ovr })).sort((a, b) => a.ovr - b.ovr).map((t) => t.id);
}

export function prepareDraft(league: League, order: number[]) {
  const rng = new Rng(league.rngState ^ 0xd4af7);
  const slots: DraftSlot[] = [];
  for (let round = 1; round <= ROUNDS; round++) order.forEach((orig, i) => slots.push({ round, pick: (round - 1) * 32 + i + 1, orig }));
  const prospects = Array.from({ length: CLASS_SIZE }, () => makeProspect(league, rng));
  // Scouting projection: true value blurred by noise, so the board is a guide, not gospel.
  const board = prospects.map((p) => ({ p, v: p.ovr + rng.normal(0, 2.5) + (p.devHidden ? 1.5 : 0) + premium(p.pos) })).sort((a, b) => b.v - a.v);
  const proj: Record<number, number> = {};
  board.forEach(({ p }, i) => (proj[p.id] = i + 1)); // big-board rank
  league.draft = { year: league.year, order: slots, current: 0, prospects: prospects.map((p) => p.id), proj };
  league.phase = 'draft';
  league.rngState = (league.rngState + 0x9e3779b9) >>> 0;
}

function premium(pos: Pos) {
  return pos === 'QB' ? 2 : pos === 'K' || pos === 'P' || pos === 'LS' ? -8 : pos === 'FB' ? -4 : 0;
}

export function pickOwner(league: League, year: number, round: number, orig: number): number {
  return league.teams.find((t) => t.picks.some((p) => p.year === year && p.round === round && p.orig === orig))?.id ?? orig;
}

export function onClock(league: League): { slot: DraftSlot; owner: number } | null {
  const d = league.draft;
  const slot = d?.order[d.current];
  if (!d || !slot) return null;
  return { slot, owner: pickOwner(league, d.year, slot.round, slot.orig) };
}

function starterOvr(league: League, team: Team, pos: Pos) {
  const id = team.depth[pos]?.[0];
  return id !== undefined && league.players[id] ? league.players[id].ovr : 40;
}

/** How a team rates a prospect: talent, a nudge for hidden upside, and roster need. */
export function draftValue(league: League, team: Team, p: Player) {
  const need = Math.max(0, p.ovr - starterOvr(league, team, p.pos));
  return p.ovr + (p.devHidden ? 1.5 : 0) + premium(p.pos) + Math.min(6, need * 0.5);
}

export interface PickMade { player: Player; round: number; pick: number; teamId: number }

export function makePick(league: League, playerId: number): PickMade | null {
  const clock = onClock(league);
  const d = league.draft!;
  if (!clock || !d.prospects.includes(playerId)) return null;
  const { slot, owner } = clock;
  const team = league.teams[owner];
  const p = league.players[playerId];
  const used = teamNumbers(league, team);
  if (used.has(p.num)) for (let n = 1; n < 100 && used.has(p.num); n++) p.num = n;
  team.roster.push(p.id);
  p.draft = { year: d.year, round: slot.round, pick: slot.pick, teamId: owner };
  team.picks = team.picks.filter((k) => !(k.year === d.year && k.round === slot.round && k.orig === slot.orig));
  d.prospects = d.prospects.filter((id) => id !== playerId);
  slot.playerId = p.id;
  slot.teamId = owner;
  d.current++;
  if (owner === league.userTeamId) {
    const dev = p.devHidden ? 'HIDDEN DEV' : `${DEV_LABELS[p.dev].toUpperCase()} DEV`;
    notify(league, 'draft', `Rd ${slot.round} Pick ${slot.pick}: ${p.first} ${p.last} (${p.pos}) • ${p.ovr} OVR • ${dev}`, p.id);
  }
  return { player: p, round: slot.round, pick: slot.pick, teamId: owner };
}

export function cpuPick(league: League): PickMade | null {
  const clock = onClock(league);
  if (!clock) return null;
  const team = league.teams[clock.owner];
  const d = league.draft!;
  let best: Player | null = null;
  let bestV = -Infinity;
  for (const id of d.prospects) {
    const v = draftValue(league, team, league.players[id]);
    if (v > bestV) { bestV = v; best = league.players[id]; }
  }
  return best ? makePick(league, best.id) : null;
}

/** CPU teams pick until the user is on the clock (or the draft ends). */
export function simToUserPick(league: League) {
  let guard = 0;
  while (guard++ < 300) {
    const c = onClock(league);
    if (!c || c.owner === league.userTeamId) return;
    cpuPick(league);
  }
}

export function draftDone(league: League) {
  return !league.draft || league.draft.current >= league.draft.order.length;
}

/** Wrap up: undrafted prospects leave, every roster is cut to 53 + 16, and new future picks are issued. */
export function finalizeDraft(league: League) {
  const d = league.draft;
  if (d) for (const id of d.prospects) delete league.players[id];
  const year = d?.year ?? league.year;
  for (const t of league.teams) {
    for (const y of [year + 1, year + 2]) {
      const issued = league.teams.some((o) => o.picks.some((k) => k.year === y && k.orig === t.id));
      if (!issued) t.picks.push(...picksFor(y, t.id));
    }
    normalizeRoster(league, t);
  }
  league.draft = undefined;
  league.phase = 'regular';
  refreshNeeds(league);
}

/**
 * Bring a roster back to the 53-man shape plus a 16-man practice squad: keep the best
 * (early-round rookies are protected), stash young depth on the practice squad, release
 * the rest, and sign free agents for any empty spots.
 */
export function normalizeRoster(league: League, team: Team) {
  const rng = new Rng((league.rngState ^ (team.id * 7919)) >>> 0);
  const pool = [...team.roster, ...team.practice].map((id) => league.players[id]).filter(Boolean);
  const protect = (p: Player) => (p.draft && p.draft.year === league.year && p.draft.round <= 3 ? 12 : 0);
  const rank = (p: Player) => p.ovr + protect(p) - (p.injury >= 30 ? 6 : 0);
  const active: Player[] = [];
  for (const [pos, count] of ROSTER_SHAPE) active.push(...pool.filter((p) => p.pos === pos).sort((a, b) => rank(b) - rank(a)).slice(0, count));
  const activeIds = new Set(active.map((p) => p.id));
  const extra = pool.filter((p) => !activeIds.has(p.id)).sort((a, b) => (b.ovr + (b.age <= 25 ? 4 : 0)) - (a.ovr + (a.age <= 25 ? 4 : 0)));
  const practice = extra.slice(0, PRACTICE_MAX);
  const released = extra.slice(PRACTICE_MAX);
  team.roster = active.map((p) => p.id);
  team.practice = practice.map((p) => p.id);
  const used = teamNumbers(league, team);
  const signed: Player[] = [];
  for (const [pos, count] of ROSTER_SHAPE) {
    let have = active.filter((p) => p.pos === pos).length;
    while (have++ < count) {
      const fa = makePlayer(league, rng, pos, rng.normal(60, 4), rng.int(24, 29), used);
      team.roster.push(fa.id);
      signed.push(fa);
    }
  }
  while (team.practice.length < PRACTICE_MAX) {
    const pos = rng.pick(ROSTER_SHAPE.slice(0, 17)).at(0) as Pos;
    team.practice.push(makePlayer(league, rng, pos, rng.normal(55, 4), rng.int(22, 24), used).id);
  }
  for (const p of released) delete league.players[p.id];
  if (team.id === league.userTeamId) {
    if (released.length) notify(league, 'league', `Roster cuts: released ${released.map(pname).join(', ')}`);
    if (signed.length) notify(league, 'league', `Signed free agents: ${signed.map((p) => `${pname(p)} (${p.pos})`).join(', ')}`);
    syncDepth(league, team);
  } else autoDepth(league, team);
}

/** Display grade for the draft board (scouts see ranges, not exact overalls). */
export function projectedRound(league: League, id: number) {
  const rank = league.draft?.proj?.[id];
  return rank ? Math.min(ROUNDS, Math.ceil(rank / 32)) : ROUNDS;
}

export function pickLabel(p: DraftPick, league: League) {
  return `${p.year} RD ${p.round} (${league.teams[p.orig].abbr})`;
}

