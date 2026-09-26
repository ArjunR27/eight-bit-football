import { Rng, clamp } from '../core/rng';
import { attrsFor, computeOvr } from './ratings';
import type { AttrKey, DevTrait, Player, Pos } from './types';

// Development traits and on-field abilities, modeled on Madden's dev tiers,
// Superstar abilities and X-Factor "zone" abilities (names are original).

export const DEV_LABELS: Record<DevTrait, string> = { normal: 'Normal', star: 'Star', superstar: 'Superstar', xfactor: 'X-Factor' };
export const DEV_COLORS: Record<DevTrait, string> = { normal: '#c9d6cf', star: '#f2c14e', superstar: '#83d9ff', xfactor: '#ff6b5a' };
export const ABILITY_SLOTS: Record<DevTrait, number> = { normal: 0, star: 2, superstar: 4, xfactor: 4 };
export const DEV_ORDER: DevTrait[] = ['normal', 'star', 'superstar', 'xfactor'];
/** Minimum overall to hold each tier: the tiers form a rating hierarchy. */
export const DEV_FLOOR: Record<DevTrait, number> = { normal: 0, star: 76, superstar: 83, xfactor: 87 };
/** Progression speed: how much XP a player banks per unit of play. */
export const DEV_GROWTH: Record<DevTrait, number> = { normal: 1, star: 1.5, superstar: 2, xfactor: 2.6 };
export const REVEAL_SNAPS = 150;

export type Group = 'QB' | 'RB' | 'REC' | 'OL' | 'DL' | 'LB' | 'DB' | 'K';
export function groupOf(pos: Pos): Group {
  switch (pos) {
    case 'QB': return 'QB';
    case 'RB': case 'FB': return 'RB';
    case 'WR': case 'TE': return 'REC';
    case 'DE': case 'DT': return 'DL';
    case 'OLB': case 'MLB': return 'LB';
    case 'CB': case 'FS': case 'SS': return 'DB';
    case 'K': case 'P': case 'LS': return 'K';
    default: return 'OL';
  }
}

export interface Ability {
  id: string;
  name: string;
  group: Group;
  desc: string;
  /** Flat in-game attribute bumps while the ability is equipped. */
  bumps: Partial<Record<AttrKey, number>>;
}

const ab = (id: string, name: string, group: Group, desc: string, bumps: Ability['bumps']): Ability => ({ id, name, group, desc, bumps });

export const ABILITIES: Ability[] = [
  ab('pinpoint', 'Pinpoint', 'QB', 'Tighter ball placement on every throw', { acc: 6, dac: 4 }),
  ab('cannon', 'Cannon', 'QB', 'Extra arm: longer, faster throws', { thp: 6 }),
  ab('poised', 'Poised', 'QB', 'Pressure does not hurt accuracy', { awr: 4 }),
  ab('fieldgeneral', 'Field General', 'QB', 'Reads coverage: fewer interceptions', { awr: 6, pac: 4 }),
  ab('anklebreaker', 'Ankle Breaker', 'RB', 'Jukes leave tacklers grabbing air', { elu: 6, agi: 4 }),
  ab('bulldozer', 'Bulldozer', 'RB', 'Runs through arm tackles', { trk: 6, str: 4 }),
  ab('burst', 'Burst', 'RB', 'Explosive first step and top speed', { spd: 3, agi: 4 }),
  ab('surehands', 'Sure Hands', 'RB', 'Almost never fumbles', { car: 10 }),
  ab('deepthreat', 'Deep Threat', 'REC', 'Gets behind the defense', { spd: 3, rte: 3 }),
  ab('routeartist', 'Route Artist', 'REC', 'Defenders react late to his cuts', { rte: 6, rel: 4 }),
  ab('highlight', 'Highlight Hands', 'REC', 'Wins contested catches', { spc: 8, cth: 3 }),
  ab('afterburner', 'Afterburner', 'REC', 'Extra speed after the catch', { spd: 2, agi: 4 }),
  ab('brickwall', 'Brick Wall', 'OL', 'Pass protection anchor', { pbk: 8 }),
  ab('roadgrader', 'Road Grader', 'OL', 'Moves defenders in the run game', { rbk: 8, ibk: 4 }),
  ab('anchor', 'Anchor', 'OL', 'Never gets bull-rushed', { str: 5, pbk: 3 }),
  ab('pancake', 'Pancake Maker', 'OL', 'Flattens second-level defenders', { ibk: 10 }),
  ab('edgerusher', 'Edge Rusher', 'DL', 'Sheds pass blocks quickly', { prs: 8 }),
  ab('runstuffer', 'Run Stuffer', 'DL', 'Clogs running lanes', { bsh: 8 }),
  ab('stripartist', 'Strip Artist', 'DL', 'Knocks the ball loose', { hit: 8 }),
  ab('relentless', 'Relentless', 'DL', 'Never stops chasing', { pur: 8 }),
  ab('lurker', 'Lurker', 'LB', 'Jumps passing lanes for picks', { cov: 6, prc: 4 }),
  ab('enforcer', 'Enforcer', 'LB', 'Sure, punishing tackles', { tak: 6, hit: 4 }),
  ab('sideline', 'Sideline to Sideline', 'LB', 'Elite pursuit range', { pur: 6, spd: 2 }),
  ab('blitzer', 'Blitz Master', 'LB', 'Gets home on blitzes', { prc: 4, str: 4 }),
  ab('shutdown', 'Shutdown', 'DB', 'Blankets his receiver', { man: 6, zon: 4 }),
  ab('ballhawk', 'Ball Hawk', 'DB', 'Turns breakups into interceptions', { prc: 6 }),
  ab('pressmaster', 'Press Master', 'DB', 'Jams receivers at the line', { pre: 8 }),
  ab('hitstick', 'Hit Stick', 'DB', 'Big hits jar the ball loose', { tak: 5, hit: 5 }),
  ab('bigleg', 'Big Leg', 'K', 'Extra distance on every kick', { kpw: 7 }),
  ab('iceveins', 'Ice Veins', 'K', 'Steady under pressure', { kac: 7 }),
  ab('coffincorner', 'Coffin Corner', 'K', 'Pins opponents deep', { kac: 4, kpw: 3 }),
  ab('automatic', 'Automatic', 'K', 'Rarely misses short kicks', { kac: 5 }),
];

/** X-Factor zone abilities: a large boost while "in the zone". */
export const XFACTORS: Record<Group, { id: string; name: string; objective: string }> = {
  QB: { id: 'x-sniper', name: 'Sniper', objective: '3 straight completions' },
  RB: { id: 'x-unstoppable', name: 'Unstoppable', objective: '40 rush yards' },
  REC: { id: 'x-moneyhands', name: 'Money Hands', objective: '2 catches of 12+ yds' },
  OL: { id: 'x-greatwall', name: 'Great Wall', objective: 'Team gains 50 yds' },
  DL: { id: 'x-wreckingcrew', name: 'Wrecking Crew', objective: 'A sack or tackle for loss' },
  LB: { id: 'x-onemanarmy', name: 'One Man Army', objective: '4 tackles' },
  DB: { id: 'x-noflyzone', name: 'No Fly Zone', objective: 'An interception or 3 tackles' },
  K: { id: 'x-laserleg', name: 'Laser Leg', objective: '2 made kicks' },
};
export const ZONE_PLAYS = 12; // plays an X-Factor stays in the zone

export function ability(id: string) {
  return ABILITIES.find((a) => a.id === id);
}
/** Does this player have the ability? An X-Factor in the zone "takes over" with his whole group's set. */
export function has(p: Player | undefined, id: string) {
  if (!p) return false;
  if (p.abilities?.includes(id)) return true;
  return !!p.zone && ability(id)?.group === groupOf(p.pos);
}

export function potentialOf(p: Player): DevTrait {
  return p.devPotential ?? p.dev;
}

/**
 * Roll a player's dev potential. Established stars mostly get premium tiers; lower-rated
 * players only occasionally carry one (as upside they still have to grow into).
 */
export function rollPotential(rng: Rng, ovr: number, age: number): DevTrait {
  const young = age <= 24 ? 1 : 0.4;
  const odds = ovr >= 87 ? [0, 0.15, 0.4, 0.45]
    : ovr >= 83 ? [0.05, 0.45, 0.4, 0.1]
    : ovr >= 76 ? [0.45, 0.45, 0.08, 0.02]
    : [1 - 0.175 * young, 0.12 * young, 0.04 * young, 0.015 * young];
  return rng.weighted(DEV_ORDER, odds);
}

/** The tier a player has earned: his potential, capped by what his overall supports. */
export function earnedDev(p: Player): DevTrait {
  let i = DEV_ORDER.indexOf(potentialOf(p));
  while (i > 0 && p.ovr < DEV_FLOOR[DEV_ORDER[i]]) i--;
  return DEV_ORDER[i];
}

/** Re-evaluate a (revealed) player's tier after his rating moves. */
export function refreshDev(p: Player, rng: Rng): 'up' | 'down' | null {
  if (p.devHidden) return null;
  const next = earnedDev(p);
  if (next === p.dev) return null;
  const dir = DEV_ORDER.indexOf(next) > DEV_ORDER.indexOf(p.dev) ? 'up' : 'down';
  p.dev = next;
  assignAbilities(p, rng);
  return dir;
}

/** Offseason: a player who has outgrown his potential by rating can break out a tier. */
export function breakout(p: Player, rng: Rng) {
  const i = DEV_ORDER.indexOf(potentialOf(p));
  const next = DEV_ORDER[i + 1];
  if (next && p.ovr >= DEV_FLOOR[next] && p.age <= 30 && rng.chance(0.5)) p.devPotential = next;
}

/** Fresh player: roll potential, then take the tier his rating supports. */
export function initDev(p: Player, rng: Rng) {
  p.devPotential = rollPotential(rng, p.ovr, p.age);
  p.dev = earnedDev(p);
  assignAbilities(p, rng);
}

/** Give a player the ability slots his (possibly new) trait allows. */
export function assignAbilities(p: Player, rng: Rng) {
  const g = groupOf(p.pos);
  const pool = ABILITIES.filter((a) => a.group === g).map((a) => a.id);
  const keep = p.abilities.filter((id) => pool.includes(id));
  const want = ABILITY_SLOTS[p.dev];
  const rest = rng.shuffle(pool.filter((id) => !keep.includes(id)));
  p.abilities = [...keep, ...rest].slice(0, want);
  p.xfactor = p.dev === 'xfactor' ? XFACTORS[g].id : undefined;
}

export function setDev(p: Player, dev: DevTrait, rng: Rng) {
  p.dev = dev;
  assignAbilities(p, rng);
}

/**
 * The version of a player the sims actually use on a given snap: fatigue saps his
 * ratings, equipped abilities bump them, and an X-Factor in the zone gets a big lift.
 */
export function effective(p: Player, energy = 100, inZone = false): Player {
  const attrs = { ...p.attrs };
  for (const id of p.abilities ?? []) {
    const a = ability(id);
    if (a) for (const [k, v] of Object.entries(a.bumps)) attrs[k as AttrKey] = (attrs[k as AttrKey] ?? 50) + v!;
  }
  const tired = clamp(energy, 0, 100) / 100;
  for (const k of Object.keys(attrs) as AttrKey[]) {
    let v = attrs[k]!;
    if (inZone) v += k === 'spd' ? 3 : 10;
    v *= k === 'spd' || k === 'agi' ? 0.86 + 0.14 * tired : 0.92 + 0.08 * tired;
    attrs[k] = Math.round(clamp(v, 1, 110));
  }
  return { ...p, attrs, energy, zone: inZone };
}

/** Rating-point cost of the next upgrade: higher overalls take longer. */
export function xpForUpgrade(p: Player) {
  return 60 + Math.max(0, p.ovr - 60) * 4;
}

const AGE_GROWTH = (age: number) => (age <= 24 ? 1.2 : age <= 27 ? 0.8 : age <= 30 ? 0.3 : 0.1);

/** Potential ceiling: premium dev traits can push past a player's natural potential. */
export function ceiling(p: Player) {
  return Math.min(99, p.pot + { normal: 0, star: 3, superstar: 6, xfactor: 9 }[potentialOf(p)]);
}

/**
 * Bank in-season XP from snaps and production. Returns the new OVR if the player
 * upgraded (the caller turns that into a post-game notification).
 */
export function gainXp(p: Player, snaps: number, grade: number, rng: Rng): number | null {
  p.xp = (p.xp ?? 0) + (snaps * 0.35 + Math.max(0, grade) * 10) * DEV_GROWTH[potentialOf(p)] * AGE_GROWTH(p.age);
  const before = p.ovr;
  let guard = 0;
  while (p.xp >= xpForUpgrade(p) && p.ovr < ceiling(p) && guard++ < 3) {
    p.xp -= xpForUpgrade(p);
    // Push the attributes that drive this position's overall.
    const keys = rng.shuffle(attrsFor(p.pos).filter((k) => k !== 'dur')).slice(0, 3);
    for (const k of keys) p.attrs[k] = Math.min(99, (p.attrs[k] ?? 50) + rng.int(1, 3));
    p.ovr = computeOvr(p.pos, p.attrs);
  }
  return p.ovr > before ? p.ovr : null;
}

/** Hidden rookie devs reveal themselves once they've logged enough snaps. */
export function maybeReveal(p: Player): boolean {
  if (!p.devHidden || p.snaps < REVEAL_SNAPS) return false;
  p.devHidden = false;
  return true;
}

/** Chance a long snap goes wrong: ~0.6% for an elite snapper up to ~3% for a poor one. */
export function badSnapChance(ls: Player | undefined) {
  const snp = ls?.attrs.snp ?? 65;
  return clamp(0.03 - (snp - 50) * 0.0006, 0.004, 0.035);
}

/** Offseason growth by age and dev trait (premium traits grow faster and decline slower). */
export function offseasonGrowth(p: Player, rng: Rng) {
  const g = DEV_GROWTH[potentialOf(p)];
  let delta: number;
  if (p.age <= 24) delta = rng.range(0, 3.5) * g;
  else if (p.age <= 27) delta = rng.range(-1.5, 2) * g;
  else if (p.age <= 30) delta = rng.range(-3.5, 0.5) + (g - 1) * 0.5;
  else delta = rng.range(-6, -1);
  // Growth stops at the ceiling (decline always applies).
  if (delta > 0) delta = Math.min(delta, Math.max(0, ceiling(p) - p.ovr));
  for (const k of attrsFor(p.pos)) {
    const ageSpeed = k === 'spd' && p.age >= 28 ? -rng.range(0, 2) : 0;
    p.attrs[k] = Math.round(clamp((p.attrs[k] ?? 50) + delta + ageSpeed + rng.normal(0, 1.2), 20, 99));
  }
  p.ovr = computeOvr(p.pos, p.attrs);
}
