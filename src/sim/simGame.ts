import { Rng } from '../core/rng';
import { lineup, type Lineup } from '../model/depth';
import type { League } from '../model/types';
import { applyPlay, doKickoff, newGame, other, teamIdOf, type GameState, type PlayResult, type Side } from './gameState';
import { cpuCall, resolveCall } from './resolver';
import { afterSnap, defenseOnField, offenseOnField, snapLineup } from './condition';

export const DIFFICULTY_BONUS = [-5, 0, 3, 6];

export interface GameCtx {
  league: League;
  gs: GameState;
  lineups: [Lineup, Lineup];
  bonus: [number, number];
}

export function makeCtx(league: League, gs: GameState): GameCtx {
  const lineups: [Lineup, Lineup] = [lineup(league, league.teams[gs.homeId]), lineup(league, league.teams[gs.awayId])];
  const cpu = DIFFICULTY_BONUS[league.settings.difficulty];
  const bonus: [number, number] = [0, 0];
  if (gs.homeId === league.userTeamId) bonus[1] = cpu;
  if (gs.awayId === league.userTeamId) bonus[0] = cpu;
  return { league, gs, lineups, bonus };
}

/** Advance one snap (or kickoff) with the CPU calling plays for whoever has the ball. */
export function simStep(ctx: GameCtx): PlayResult | null {
  const { gs } = ctx;
  if (gs.phase === 'final') return null;
  if (gs.phase === 'kickoff') {
    doKickoff(gs);
    return null;
  }
  const rng = new Rng(gs.rng);
  const off = gs.poss;
  // Fresh lineups every snap: tired starters rotate out and ratings reflect energy and the zone.
  ctx.lineups = [snapLineup(ctx.league, gs, gs.homeId), snapLineup(ctx.league, gs, gs.awayId)];
  const o = ctx.lineups[off], d = ctx.lineups[other(off)];
  const call = cpuCall(gs, o, rng);
  const r = resolveCall(call, gs, o, d, rng, ctx.bonus[off], ctx.bonus[other(off)]);
  gs.rng = rng.state;
  const special = call === 'fg' || call === 'xp' ? [o.k] : call === 'punt' ? [o.p] : call === 'kneel' || call === 'two' ? [] : null;
  afterSnap(ctx.league, gs, special ?? [...offenseOnField(o), ...defenseOnField(d)], r);
  applyPlay(gs, r);
  return r;
}

export interface DriveSummary {
  side: Side;
  plays: number;
  yards: number;
  seconds: number;
  result: string;
  points: number;
}

/** Sim the current possession until the ball changes hands, someone scores, or the half/game ends. */
export function simDrive(ctx: GameCtx): DriveSummary {
  const { gs } = ctx;
  const side = gs.poss;
  const startOn = gs.ballOn;
  const startScore = [...gs.score];
  const startQ = gs.quarter;
  const startClock = gs.clock;
  let plays = 0;
  let last: PlayResult | null = null;
  let guard = 0;
  while (gs.phase !== 'final' && guard++ < 200) {
    if (gs.phase === 'kickoff') break;
    const beforeQ = gs.quarter;
    const beforePoss = gs.poss;
    if (gs.phase === 'pat') {
      simStep(ctx);
      break;
    }
    last = simStep(ctx);
    if (last && last.kind !== 'xp' && last.kind !== 'two') plays++;
    const ph = gs.phase as GameState['phase']; // mutated by simStep
    if (gs.poss !== beforePoss || ph !== 'play') {
      if (ph === 'pat') continue;
      break;
    }
    if (beforeQ === 2 && gs.quarter === 3) break;
  }
  const pts = gs.score[side] - startScore[side];
  let result: string;
  if (pts >= 6) result = 'TOUCHDOWN';
  else if (pts === 3) result = 'FIELD GOAL';
  else if (gs.score[other(side)] > startScore[other(side)]) result = last?.defTd ? 'DEFENSIVE TD' : 'SAFETY';
  else if (last?.kind === 'punt') result = 'PUNT';
  else if (last?.kind === 'int') result = 'INTERCEPTION';
  else if (last?.kind === 'fumble') result = 'FUMBLE';
  else if (last?.kind === 'fg') result = 'MISSED FG';
  else if (gs.phase === 'final') result = 'END OF GAME';
  else if (startQ === 2 && gs.quarter === 3) result = 'END OF HALF';
  else if (gs.poss !== side) result = 'TURNOVER ON DOWNS';
  else result = 'END OF QUARTER';
  const elapsed = gs.quarter === startQ ? startClock - gs.clock : startClock + (gs.quarterLen - gs.clock);
  return { side, plays, yards: Math.max(0, gs.ballOn - startOn), seconds: Math.max(0, Math.round(elapsed)), result, points: pts };
}

export function simToEnd(ctx: GameCtx) {
  let guard = 0;
  while (ctx.gs.phase !== 'final' && guard++ < 5000) simStep(ctx);
}

export function simGame(league: League, homeId: number, awayId: number, playoff: boolean, seed: number): GameState {
  const gs = newGame(homeId, awayId, league.settings.quarterMinutes, playoff, seed);
  simToEnd(makeCtx(league, gs));
  return gs;
}

export function userSide(league: League, gs: GameState): Side | null {
  if (teamIdOf(gs, 0) === league.userTeamId) return 0;
  if (teamIdOf(gs, 1) === league.userTeamId) return 1;
  return null;
}
