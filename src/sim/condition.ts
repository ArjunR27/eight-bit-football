import { clamp } from '../core/rng';
import { groupOf, XFACTORS, ZONE_PLAYS, effective, type Group } from '../model/dev';
import { lineup, mapLineup, type Lineup } from '../model/depth';
import type { League, Player, StatKey } from '../model/types';
import type { GameState, PlayResult } from './gameState';

// In-game condition shared by the full sim and the user's played games:
// energy (stamina) drains with every snap and recovers on the sideline, snap
// counts drive progression and hidden-dev reveals, and X-Factors enter the zone.

export interface ZoneState {
  prog: number;
  streak: number;
  left: number; // plays remaining in the zone (0 = not in it)
}

export interface Condition {
  energy: Record<number, number>;
  snaps: Record<number, number>;
  zone: Record<number, ZoneState>;
  /** Headline events for the UI ("X is IN THE ZONE"), drained by the caller. */
  events: string[];
}

export function condition(gs: GameState): Condition {
  return (gs.cond ??= { energy: {}, snaps: {}, zone: {}, events: [] });
}

/** Players start a game fresh unless the season has worn them down. */
export function startEnergy(p: Player) {
  return clamp(100 - (p.wear ?? 0) * 0.45, 45, 100);
}

export function energyOf(gs: GameState, p: Player) {
  const c = condition(gs);
  return (c.energy[p.id] ??= startEnergy(p));
}

export function inZone(gs: GameState, id: number) {
  return (condition(gs).zone[id]?.left ?? 0) > 0;
}

/** This snap's lineup: rotation for fatigue, then per-snap copies carrying energy, abilities and zone. */
export function snapLineup(league: League, gs: GameState, teamId: number): Lineup {
  const team = league.teams[teamId];
  const c = condition(gs);
  for (const id of team.roster) c.energy[id] ??= startEnergy(league.players[id]);
  const l = lineup(league, team, c.energy);
  return mapLineup(l, (p) => effective(p, c.energy[p.id] ?? 100, inZone(gs, p.id)));
}

export function offenseOnField(l: Lineup): Player[] {
  return [l.qb, l.rb[0], l.wr[0], l.wr[1], l.wr[2], l.te[0], ...l.ol].filter(Boolean);
}
export function defenseOnField(l: Lineup): Player[] {
  return [...l.de, ...l.dt, ...l.olb, ...l.mlb, l.cb[0], l.cb[1], l.fs, l.ss].filter(Boolean);
}

const DRAIN: Record<Group, number> = { QB: 0.6, RB: 2.3, REC: 1.7, OL: 1.0, DL: 2.0, LB: 1.6, DB: 1.4, K: 0.3 };

/** After a snap: on-field players tire and log a snap; everyone on the sideline catches their breath. */
export function afterSnap(league: League, gs: GameState, onField: Player[], result: PlayResult) {
  const c = condition(gs);
  const played = new Set(onField.map((p) => p.id));
  for (const tid of [gs.homeId, gs.awayId]) {
    for (const id of league.teams[tid].roster) {
      if (played.has(id)) continue;
      if (c.energy[id] !== undefined) c.energy[id] = Math.min(startEnergy(league.players[id]), c.energy[id] + 1.1);
    }
  }
  for (const p of onField) {
    const base = league.players[p.id] ?? p;
    const dur = base.attrs.dur ?? 70;
    const cost = DRAIN[groupOf(base.pos)] * (1.35 - dur / 150) * (result.kind === 'run' || result.kind === 'pass' ? 1 + Math.min(1, Math.abs(result.yards) / 25) : 1);
    c.energy[p.id] = clamp((c.energy[p.id] ?? startEnergy(base)) - cost, 20, 100);
    c.snaps[p.id] = (c.snaps[p.id] ?? 0) + 1;
  }
  updateZones(league, gs, onField, result);
}

function statOf(r: PlayResult, id: number, key: StatKey) {
  let n = 0;
  for (const [pid, k, v] of r.stats) if (pid === id && k === key) n += v;
  return n;
}

/** Madden-style zone: finish an objective to switch the X-Factor on; bad plays or time switch it off. */
function updateZones(league: League, gs: GameState, onField: Player[], r: PlayResult) {
  const c = condition(gs);
  for (const p of onField) {
    const base = league.players[p.id];
    if (!base?.xfactor) continue;
    const z = (c.zone[p.id] ??= { prog: 0, streak: 0, left: 0 });
    if (z.left > 0) {
      z.left--;
      const g = groupOf(base.pos);
      const cold = (g === 'QB' && (statOf(r, p.id, 'passInt') || statOf(r, p.id, 'sacked')))
        || (g === 'RB' && r.kind === 'fumble')
        || (['DL', 'LB', 'DB'].includes(g) && r.yards >= 20);
      if (cold) z.left = 0;
      if (z.left === 0) c.events.push(`${base.first[0]}. ${base.last} cools off`);
      continue;
    }
    let hit = false;
    switch (groupOf(base.pos)) {
      case 'QB':
        if (statOf(r, p.id, 'passCmp')) z.streak++;
        else if (statOf(r, p.id, 'passAtt') || statOf(r, p.id, 'sacked')) z.streak = 0;
        hit = z.streak >= 3;
        break;
      case 'RB': z.prog += statOf(r, p.id, 'rushYds'); hit = z.prog >= 40; break;
      case 'REC': if (statOf(r, p.id, 'recYds') >= 12) z.prog++; hit = z.prog >= 2; break;
      case 'OL': z.prog += Math.max(0, r.yards); hit = z.prog >= 50; break;
      case 'DL': hit = statOf(r, p.id, 'sack') > 0 || (statOf(r, p.id, 'tkl') > 0 && r.yards < 0); break;
      case 'LB': z.prog += statOf(r, p.id, 'tkl'); hit = z.prog >= 4; break;
      case 'DB': z.prog += statOf(r, p.id, 'tkl'); hit = statOf(r, p.id, 'defInt') > 0 || z.prog >= 3; break;
      case 'K': z.prog += statOf(r, p.id, 'fgm'); hit = z.prog >= 2; break;
    }
    if (hit) {
      z.left = ZONE_PLAYS;
      z.prog = 0;
      z.streak = 0;
      c.events.push(`${base.first[0]}. ${base.last} IN THE ZONE: ${XFACTORS[groupOf(base.pos)].name.toUpperCase()}!`);
    }
  }
}
