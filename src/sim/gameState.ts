import { Rng, clamp } from '../core/rng';
import type { StatKey, StatLine } from '../model/types';
import type { Condition } from './condition';

export type Side = 0 | 1; // 0 = home, 1 = away

export interface TeamGameStats {
  plays: number;
  yds: number;
  passYds: number;
  rushYds: number;
  firstDowns: number;
  turnovers: number;
}

export interface LogEntry {
  q: number;
  clock: number;
  poss: Side;
  text: string;
  score?: boolean;
}

export interface GameState {
  homeId: number;
  awayId: number;
  score: [number, number];
  quarter: number;
  clock: number; // seconds left in quarter
  quarterLen: number;
  poss: Side;
  ballOn: number; // yards from the possessing team's own goal line
  ballY: number; // lateral spot 0..53.3 (for placing the formation)
  down: number;
  toGo: number;
  phase: 'kickoff' | 'play' | 'pat' | 'final';
  kickoffTo: Side;
  receivedOpening: Side;
  playoff: boolean;
  stats: Record<number, StatLine>;
  team: [TeamGameStats, TeamGameStats];
  log: LogEntry[];
  playCount: number;
  rng: number;
  /** Live-clock games: whether the clock is still running between plays (in-bounds tackle). */
  clockRunning?: boolean;
  /** Scales the between-play runoff for simulated snaps (user games keep CPU drives at a live-like pace). */
  runoffScale?: number;
  /** Stamina, snap counts and X-Factor zones for this game (created lazily). */
  cond?: Condition;
}

export type StatDelta = [pid: number, key: StatKey, val: number];

export type ResultKind =
  | 'run' | 'pass' | 'sack' | 'incomplete' | 'int' | 'fumble'
  | 'punt' | 'fg' | 'xp' | 'two' | 'kneel';

export interface PlayResult {
  kind: ResultKind;
  yards: number; // net yards for the offense from the line of scrimmage
  elapsed: number; // seconds the play itself took
  clockStops: boolean;
  /** For int/fumble/punt: spot (offense coordinates, 0..100+) where the other team takes over. */
  turnoverSpot?: number;
  defTd?: boolean;
  good?: boolean; // fg / xp / two-point
  endY?: number;
  stats: StatDelta[];
  desc: string;
}

export const FIELD_W = 53.33;

const emptyTeam = (): TeamGameStats => ({ plays: 0, yds: 0, passYds: 0, rushYds: 0, firstDowns: 0, turnovers: 0 });

export function newGame(homeId: number, awayId: number, quarterMinutes: number, playoff: boolean, seed: number): GameState {
  const rng = new Rng(seed);
  const receive: Side = rng.chance(0.5) ? 0 : 1;
  return {
    homeId, awayId,
    score: [0, 0],
    quarter: 1,
    clock: quarterMinutes * 60,
    quarterLen: quarterMinutes * 60,
    poss: receive,
    ballOn: 25,
    ballY: FIELD_W / 2,
    down: 1,
    toGo: 10,
    phase: 'kickoff',
    kickoffTo: receive,
    receivedOpening: receive,
    playoff,
    stats: {},
    team: [emptyTeam(), emptyTeam()],
    log: [],
    playCount: 0,
    rng: rng.state,
  };
}

export const other = (s: Side): Side => (s === 0 ? 1 : 0);

export function teamIdOf(gs: GameState, s: Side) {
  return s === 0 ? gs.homeId : gs.awayId;
}

function addStat(gs: GameState, [pid, key, val]: StatDelta) {
  const line = (gs.stats[pid] ??= {});
  line[key] = (line[key] ?? 0) + val;
}

function log(gs: GameState, text: string, score = false) {
  gs.log.push({ q: gs.quarter, clock: gs.clock, poss: gs.poss, text, score });
  if (gs.log.length > 60) gs.log.shift();
}

/** Seconds that run off between plays when the clock keeps running. */
export function runoff(gs: GameState): number {
  const lead = gs.score[gs.poss] - gs.score[other(gs.poss)];
  const lateHalf = (gs.quarter === 2 || gs.quarter >= 4) && gs.clock < 150;
  if (lateHalf && lead <= 0) return 10; // hurry-up
  if (gs.quarter >= 4 && lead > 0) return 38; // milk the clock
  return 30;
}

export function isHurryUp(gs: GameState): boolean {
  const lead = gs.score[gs.poss] - gs.score[other(gs.poss)];
  return (gs.quarter === 2 || gs.quarter >= 4) && gs.clock < 150 && lead <= 0;
}

function scoreFor(gs: GameState, side: Side, pts: number, text: string) {
  gs.score[side] += pts;
  log(gs, text, true);
}

/** Resolve a kickoff (automatic) and set up the receiving team's first down. */
export function doKickoff(gs: GameState) {
  const rng = new Rng(gs.rng);
  gs.poss = gs.kickoffTo;
  const r = rng.next();
  if (r < 0.004) {
    gs.rng = rng.state;
    gs.ballOn = 100;
    scoreFor(gs, gs.poss, 6, 'Kickoff returned for a TOUCHDOWN!');
    gs.kickoffTo = other(gs.poss);
    afterScore(gs, true);
    return;
  }
  gs.ballOn = r < 0.55 ? 35 : Math.round(clamp(rng.normal(29, 7), 8, 55));
  gs.ballY = FIELD_W / 2;
  gs.down = 1;
  gs.toGo = 10;
  gs.phase = 'play';
  gs.clock = Math.max(0, gs.clock - (gs.ballOn === 35 ? 0 : 5));
  gs.rng = rng.state;
  log(gs, `Kickoff, ball at own ${gs.ballOn}`);
  checkQuarterEnd(gs);
}

function startPossession(gs: GameState, side: Side, ballOn: number) {
  gs.poss = side;
  gs.ballOn = clamp(Math.round(ballOn), 1, 99);
  gs.down = 1;
  gs.toGo = Math.min(10, 100 - gs.ballOn);
  gs.ballY = FIELD_W / 2;
}

function isSuddenDeath(gs: GameState) {
  return gs.quarter >= 5;
}

function afterScore(gs: GameState, needPat: boolean) {
  if (isSuddenDeath(gs)) {
    gs.phase = 'final';
    return;
  }
  if (needPat) {
    gs.phase = 'pat';
    gs.ballOn = 85;
    gs.ballY = FIELD_W / 2;
  } else {
    gs.phase = 'kickoff';
  }
}

/** Apply a play result: stats, downs, scoring, possession, clock. Shared by sim and interactive play. */
export function applyPlay(gs: GameState, r: PlayResult) {
  const off = gs.poss;
  const def = other(off);
  for (const s of r.stats) addStat(gs, s);
  const ts = gs.team[off];

  if (gs.phase === 'pat') {
    if (r.good) scoreFor(gs, off, r.kind === 'two' ? 2 : 1, r.desc);
    else log(gs, r.desc);
    gs.kickoffTo = def;
    gs.phase = 'kickoff';
    if (isSuddenDeath(gs)) gs.phase = 'final';
    checkQuarterEnd(gs);
    return;
  }

  gs.playCount++;
  const used = r.elapsed + (r.clockStops ? 0 : runoff(gs) * (gs.runoffScale ?? 1));
  gs.clock = Math.max(0, gs.clock - used);
  if (r.endY !== undefined) gs.ballY = clamp(r.endY, 18, FIELD_W - 18);

  switch (r.kind) {
    case 'punt': {
      const spot = r.turnoverSpot ?? 80;
      log(gs, r.desc);
      startPossession(gs, def, 100 - spot);
      break;
    }
    case 'fg': {
      if (r.good) {
        scoreFor(gs, off, 3, r.desc);
        gs.kickoffTo = def;
        afterScore(gs, false);
      } else {
        log(gs, r.desc);
        startPossession(gs, def, Math.max(20, 100 - (gs.ballOn - 7)));
      }
      break;
    }
    case 'int':
    case 'fumble': {
      ts.turnovers++;
      if (r.kind === 'fumble') {
        ts.plays++;
        ts.yds += r.yards;
      }
      if (r.defTd) {
        gs.poss = def;
        scoreFor(gs, def, 6, r.desc);
        afterScore(gs, true);
      } else {
        log(gs, r.desc);
        const spot = r.turnoverSpot ?? gs.ballOn;
        startPossession(gs, def, spot >= 100 ? 20 : 100 - spot);
      }
      break;
    }
    default: {
      // run / pass / sack / incomplete / kneel
      const yards = r.kind === 'incomplete' ? 0 : r.yards;
      ts.plays++;
      ts.yds += yards;
      if (r.kind === 'pass') ts.passYds += yards;
      if (r.kind === 'run') ts.rushYds += yards;
      const newOn = gs.ballOn + yards;
      if (newOn >= 100) {
        gs.ballOn = 100;
        scoreFor(gs, off, 6, r.desc);
        gs.kickoffTo = def;
        afterScore(gs, true);
      } else if (newOn <= 0) {
        scoreFor(gs, def, 2, `${r.desc} SAFETY!`);
        gs.kickoffTo = def;
        gs.poss = off;
        afterScore(gs, false);
      } else {
        log(gs, r.desc);
        gs.ballOn = newOn;
        if (yards >= gs.toGo) {
          ts.firstDowns++;
          gs.down = 1;
          gs.toGo = Math.min(10, 100 - newOn);
        } else if (gs.down >= 4) {
          log(gs, 'Turnover on downs');
          ts.turnovers++;
          startPossession(gs, def, 100 - newOn);
        } else {
          gs.down++;
          gs.toGo -= yards;
        }
      }
    }
  }
  checkQuarterEnd(gs);
}

/** The live clock hit 0:00 before the snap: end the quarter/half/game. */
export function expireClock(gs: GameState) {
  gs.clock = 0;
  gs.clockRunning = false;
  checkQuarterEnd(gs);
}

function checkQuarterEnd(gs: GameState) {
  if (gs.phase === 'final' || gs.phase === 'pat') return;
  if (gs.clock > 0) return;
  const q = gs.quarter;
  if (q === 1 || q === 3) {
    gs.quarter++;
    gs.clock = gs.quarterLen;
    log(gs, `End of Q${q}`);
    return;
  }
  if (q === 2) {
    gs.quarter = 3;
    gs.clock = gs.quarterLen;
    gs.kickoffTo = other(gs.receivedOpening);
    gs.phase = 'kickoff';
    log(gs, 'Halftime');
    return;
  }
  // End of regulation or an OT period.
  if (gs.score[0] !== gs.score[1] || (!gs.playoff && q >= 5)) {
    gs.phase = 'final';
    log(gs, 'Final');
    return;
  }
  const rng = new Rng(gs.rng);
  gs.quarter++;
  gs.clock = Math.min(gs.quarterLen, 600);
  gs.kickoffTo = rng.chance(0.5) ? 0 : 1;
  gs.rng = rng.state;
  gs.phase = 'kickoff';
  log(gs, 'Overtime — sudden death');
}

export function quarterLabel(q: number) {
  return q <= 4 ? `Q${q}` : q === 5 ? 'OT' : `${q - 4}OT`;
}

export function clockLabel(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function downLabel(gs: GameState) {
  const d = ['1st', '2nd', '3rd', '4th'][gs.down - 1] ?? `${gs.down}th`;
  const toGo = gs.ballOn + gs.toGo >= 100 ? 'Goal' : String(gs.toGo);
  return `${d} & ${toGo}`;
}

export function spotLabel(ballOn: number) {
  if (ballOn === 50) return 'the 50';
  return ballOn < 50 ? `OWN ${Math.round(ballOn)}` : `OPP ${Math.round(100 - ballOn)}`;
}
