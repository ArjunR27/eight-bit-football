import { Rng, clamp } from '../core/rng';
import { FIRST_NAMES, LAST_NAMES, REAL_PLAYER_DENYLIST } from '../data/names';
import { TEAM_DEFS } from '../data/teams';
import { schemeForTeam } from '../data/schemes';
import { PROFILES, attrsFor, computeOvr } from './ratings';
import { autoDepth } from './depth';
import { initDev } from './dev';
import { makeSchedule } from './schedule';
import { SAVE_VERSION, type Attrs, type DraftPick, type League, type Player, type Pos, type Settings, type Team } from './types';

// 53-man active roster shape.
export const ROSTER_SHAPE: [Pos, number][] = [
  ['QB', 3], ['RB', 3], ['FB', 1], ['WR', 5], ['TE', 3],
  ['LT', 2], ['LG', 2], ['C', 2], ['RG', 2], ['RT', 2],
  ['DE', 4], ['DT', 4], ['OLB', 4], ['MLB', 3],
  ['CB', 6], ['FS', 2], ['SS', 2], ['K', 1], ['P', 1], ['LS', 1],
];
// Number of starters per position (determines who gets starter-quality ratings).
const STARTERS: Partial<Record<Pos, number>> = { WR: 3, DE: 2, DT: 2, OLB: 2, CB: 3, TE: 1 };
// 16-man practice squad shape.
export const PRACTICE_SHAPE: [Pos, number][] = [
  ['QB', 1], ['RB', 1], ['WR', 2], ['TE', 1], ['LG', 1], ['C', 1], ['RT', 1],
  ['DE', 1], ['DT', 1], ['OLB', 1], ['MLB', 1], ['CB', 2], ['FS', 1], ['SS', 1],
];

const NUMBER_RANGES: Record<Pos, [number, number][]> = {
  QB: [[1, 19]], RB: [[20, 39]], FB: [[30, 49]], WR: [[10, 19], [80, 89]], TE: [[80, 89], [40, 49]],
  LT: [[60, 79]], LG: [[60, 79]], C: [[50, 69]], RG: [[60, 79]], RT: [[60, 79]],
  DE: [[90, 99], [50, 59]], DT: [[90, 99], [70, 79]], OLB: [[40, 59]], MLB: [[40, 59]],
  CB: [[20, 39]], FS: [[20, 49]], SS: [[20, 49]], K: [[1, 19]], P: [[1, 19]], LS: [[40, 69]],
};

export function randomName(rng: Rng): [string, string] {
  for (;;) {
    const f = rng.pick(FIRST_NAMES);
    const l = rng.pick(LAST_NAMES);
    if (!REAL_PLAYER_DENYLIST.has(`${f} ${l}`)) return [f, l];
  }
}

export function makeAttrs(rng: Rng, pos: Pos, quality: number): Attrs {
  const prof = PROFILES[pos];
  const attrs: Attrs = {};
  for (const k of attrsFor(pos)) {
    const base = prof[k] ?? 60;
    // Speed shifts less with quality than skill attributes do.
    const scale = k === 'spd' ? 0.45 : k === 'dur' ? 0.3 : 0.95;
    attrs[k] = Math.round(clamp(base + (quality - 70) * scale + rng.normal(0, 4.5), 20, 99));
  }
  return attrs;
}

export function makePlayer(league: League, rng: Rng, pos: Pos, quality: number, age: number, usedNums?: Set<number>): Player {
  const [first, last] = randomName(rng);
  const attrs = makeAttrs(rng, pos, quality);
  const ovr = computeOvr(pos, attrs);
  const youth = Math.max(0, 27 - age);
  const pot = Math.min(99, ovr + Math.round(rng.range(0, 3) + youth * rng.range(1, 3.5)));
  const p: Player = {
    id: league.nextPlayerId++,
    first, last, pos, age,
    num: pickNumber(rng, pos, usedNums),
    skin: rng.int(0, 3),
    attrs, ovr, pot,
    injury: 0,
    yearsPro: Math.max(0, age - 22),
    dev: 'normal',
    abilities: [],
    snaps: Math.max(0, age - 22) * 700,
    wear: 0,
    xp: 0,
    stats: {},
    career: [],
  };
  initDev(p, rng);
  league.players[p.id] = p;
  return p;
}

/** A team's own seven picks for one draft year. */
export function picksFor(year: number, teamId: number): DraftPick[] {
  return Array.from({ length: 7 }, (_, i) => ({ year, round: i + 1, orig: teamId }));
}

function pickNumber(rng: Rng, pos: Pos, used?: Set<number>): number {
  const ranges = NUMBER_RANGES[pos];
  for (let tries = 0; tries < 60; tries++) {
    const [lo, hi] = rng.pick(ranges);
    const n = rng.int(lo, hi);
    if (!used || !used.has(n)) {
      used?.add(n);
      return n;
    }
  }
  return rng.int(1, 99);
}

export function teamNumbers(league: League, team: Team): Set<number> {
  return new Set([...team.roster, ...team.practice].map((id) => league.players[id].num));
}

function buildTeamRoster(league: League, rng: Rng, team: Team) {
  const strength = rng.normal(0, 3.5);
  const used = new Set<number>();
  for (const [pos, count] of ROSTER_SHAPE) {
    const starters = STARTERS[pos] ?? 1;
    for (let i = 0; i < count; i++) {
      const tier = i < starters ? 0 : i < starters + 1 ? 1 : 2;
      const q = tier === 0 ? rng.normal(74, 6) : tier === 1 ? rng.normal(65, 5) : rng.normal(59, 5);
      const age = tier === 0 ? rng.int(23, 32) : rng.int(22, 29);
      team.roster.push(makePlayer(league, rng, pos, q + strength, age, used).id);
    }
  }
  for (const [pos, count] of PRACTICE_SHAPE) {
    for (let i = 0; i < count; i++) {
      team.practice.push(makePlayer(league, rng, pos, rng.normal(56, 5), rng.int(21, 25), used).id);
    }
  }
  autoDepth(league, team);
}

export function newLeague(seed: number, userTeamId: number, settings: Settings): League {
  const rng = new Rng(seed);
  const league: League = {
    version: SAVE_VERSION,
    rngState: 0,
    year: 2026,
    week: 0,
    phase: 'regular',
    userTeamId,
    teams: [],
    players: {},
    nextPlayerId: 1,
    schedule: [],
    history: [],
    settings,
    inbox: [],
    hallOfFame: [],
    alumni: [],
  };
  TEAM_DEFS.forEach((d, id) => {
    const team: Team = { id, ...d, scheme: schemeForTeam(id), roster: [], practice: [], depth: {}, picks: [] };
    for (let y = league.year; y <= league.year + 2; y++) team.picks.push(...picksFor(y, id));
    league.teams.push(team);
    buildTeamRoster(league, rng, team);
  });
  league.schedule = makeSchedule(rng, league.teams);
  league.rngState = rng.state;
  return league;
}
