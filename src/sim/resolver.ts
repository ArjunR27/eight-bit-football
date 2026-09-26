import { Rng, clamp } from '../core/rng';
import type { Lineup } from '../model/depth';
import type { Player } from '../model/types';
import { badSnapChance, has } from '../model/dev';
import { isHurryUp, other, type GameState, type PlayResult, type StatDelta } from './gameState';

export type CpuCall = 'run' | 'pass' | 'punt' | 'fg' | 'kneel' | 'xp' | 'two';

const a = (p: Player | undefined, k: keyof Player['attrs'], dflt = 50) => (p?.attrs[k] ?? dflt);
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const name = (p: Player) => `${p.first[0]}. ${p.last}`;

export function fgDistance(ballOn: number) {
  return 100 - ballOn + 17;
}

export function fgMaxRange(k: Player) {
  return 49 + (a(k, 'kpw') - 60) * 0.35 + (has(k, 'bigleg') ? 4 : 0);
}

export function fgProb(k: Player, dist: number) {
  const max = fgMaxRange(k);
  if (dist > max + 3) return 0.02;
  let p = 0.995 - Math.max(0, dist - 22) * 0.011 * (1.45 - a(k, 'kac') / 100) * (has(k, 'iceveins') ? 0.7 : 1);
  p -= Math.max(0, dist - (max - 6)) * 0.06;
  return clamp(p, 0.03, 0.99);
}

/** Pre-snap decision for a CPU-controlled offense (also used for Sim of the user's team). */
export function cpuCall(gs: GameState, off: Lineup, rng: Rng): CpuCall {
  if (gs.phase === 'pat') {
    const diff = gs.score[gs.poss] - gs.score[other(gs.poss)];
    // Go for two in the classic late-game spots.
    if (gs.quarter >= 4 && gs.clock < 600 && (diff === -2 || diff === 1 || diff === -5)) return 'two';
    return 'xp';
  }
  const lead = gs.score[gs.poss] - gs.score[other(gs.poss)];
  const late = gs.quarter >= 4 && gs.clock < 300;
  if (gs.quarter >= 4 && lead > 0 && gs.clock < 110 && gs.down < 4) return 'kneel';

  const dist = fgDistance(gs.ballOn);
  const inRange = dist <= fgMaxRange(off.k) - 2;
  if (gs.down === 4) {
    const desperate = late && lead < 0 && (lead < -3 || !inRange);
    if (desperate) return rng.chance(0.7) ? 'pass' : 'run';
    if (late && lead < 0 && lead >= -3 && inRange) return 'fg';
    if (gs.toGo <= 1 && gs.ballOn >= 45 && gs.ballOn < 80 && !inRange) return 'run';
    if (inRange) return 'fg';
    if (gs.toGo <= 2 && gs.ballOn >= 55) return rng.chance(0.5) ? 'run' : 'pass';
    return 'punt';
  }
  // End of half: kick if in range with a few seconds left.
  if (gs.quarter === 2 && gs.clock < 12 && inRange) return 'fg';

  let passP = 0.56;
  if (gs.down === 3 && gs.toGo >= 7) passP = 0.86;
  else if (gs.down === 3 && gs.toGo <= 2) passP = 0.38;
  else if (gs.down === 2 && gs.toGo >= 8) passP = 0.66;
  else if (gs.down === 1) passP = 0.5;
  if (isHurryUp(gs) && lead < 0) passP = 0.82;
  if (late && lead > 7) passP = 0.28;
  if (gs.ballOn >= 97) passP = 0.35;
  passP += (a(off.qb, 'acc') - off.rb[0].ovr) * 0.004;
  return rng.chance(clamp(passP, 0.15, 0.92)) ? 'pass' : 'run';
}

interface Ctx {
  gs: GameState;
  off: Lineup;
  def: Lineup;
  rng: Rng;
  /** Rating bonus for offense / defense (difficulty scaling). */
  offBonus: number;
  defBonus: number;
}

function tackler(ctx: Ctx, pool: Player[]): Player {
  return ctx.rng.pick(pool);
}

function spotAfterReturn(ctx: Ctx, catchSpot: number, returner: Player): { spot: number; td: boolean } {
  const { rng } = ctx;
  let ret = Math.max(0, rng.normal(6, 7));
  if (rng.chance(0.05 + (a(returner, 'spd') - 80) * 0.002)) ret += rng.range(20, 70);
  const spot = catchSpot - ret;
  return spot <= 0 ? { spot: 0, td: true } : { spot, td: false };
}

export function resolveRun(ctx: Ctx, carrier?: Player): PlayResult {
  const { gs, off, def, rng } = ctx;
  const rb = carrier ?? off.rb[0];
  const stats: StatDelta[] = [];
  const runBlock = avg(off.ol.map((p) => a(p, 'rbk'))) * 0.8 + a(off.te[0], 'rbk') * 0.1 + a(off.fb, 'trk') * 0.1 + ctx.offBonus;
  const runDef = avg([...def.dt.map((p) => a(p, 'bsh')), ...def.de.map((p) => a(p, 'bsh')), a(def.mlb[0], 'tak'), ...def.olb.map((p) => a(p, 'tak')), a(def.ss, 'tak')]) + ctx.defBonus;
  const back = (a(rb, 'spd') + a(rb, 'elu') + a(rb, 'trk') + a(rb, 'agi')) / 4 + ctx.offBonus;
  const mean = 3.2 + (runBlock - runDef) * 0.07 + (back - 72) * 0.05;
  let yards = Math.round(rng.normal(mean, 3.1));
  const breakaway = 0.04 + (a(rb, 'spd') - 85) * 0.002 + (has(rb, 'anklebreaker') || has(rb, 'bulldozer') || has(rb, 'burst') ? 0.03 : 0);
  if (yards >= 3 && rng.chance(breakaway)) yards += Math.round(rng.range(6, 45));
  yards = Math.max(-5, yards);
  if (gs.ballOn + yards > 100) yards = 100 - gs.ballOn;
  const td = gs.ballOn + yards >= 100;

  const fumbleP = 0.009 * (100 - a(rb, 'car')) / 30 * (has(rb, 'surehands') ? 0.2 : 1);
  stats.push([rb.id, 'rushAtt', 1], [rb.id, 'rushYds', yards]);
  if (!td && rng.chance(fumbleP)) {
    const recoverer = tackler(ctx, [...def.dt, ...def.de, ...def.mlb]);
    stats.push([recoverer.id, 'tkl', 1]);
    return {
      kind: 'fumble', yards, elapsed: rng.range(4, 7), clockStops: true,
      turnoverSpot: gs.ballOn + yards, stats,
      desc: `${name(rb)} FUMBLES! Recovered by ${name(recoverer)}`,
    };
  }
  if (td) stats.push([rb.id, 'rushTd', 1]);
  else stats.push([tackler(ctx, [...def.dt, ...def.de, ...def.mlb, ...def.olb, def.ss]).id, 'tkl', 1]);
  const oob = !td && rng.chance(0.08);
  return {
    kind: 'run', yards, elapsed: rng.range(4, 7), clockStops: td || oob, stats,
    desc: td ? `${name(rb)} ${yards} yd TD run!` : `${name(rb)} runs for ${yards}`,
  };
}

export function resolvePass(ctx: Ctx): PlayResult {
  const { gs, off, def, rng } = ctx;
  const qb = off.qb;
  const stats: StatDelta[] = [];
  const passBlock = avg(off.ol.map((p) => a(p, 'pbk'))) + ctx.offBonus;
  const passRush = avg([...def.de.map((p) => a(p, 'prs')), ...def.dt.map((p) => a(p, 'prs') - 4)]) + ctx.defBonus;

  // QB scramble
  if (rng.chance(0.03 + (a(qb, 'spd') - 65) * 0.002)) return resolveRun(ctx, qb);

  const sackP = clamp(0.064 * Math.exp((passRush - passBlock) / 16) * (1 - (a(qb, 'agi') - 65) / 250) * (has(qb, 'poised') ? 0.8 : 1), 0.02, 0.2);
  if (rng.chance(sackP)) {
    const yards = -Math.round(rng.range(3, 10));
    const sacker = rng.weighted([...def.de, ...def.dt, ...def.olb], [3, 3, 1.5, 1.5, 1, 1]);
    stats.push([qb.id, 'sacked', 1], [sacker.id, 'sack', 1], [sacker.id, 'tkl', 1]);
    if (rng.chance(0.08)) {
      return {
        kind: 'fumble', yards, elapsed: rng.range(3, 5), clockStops: true,
        turnoverSpot: gs.ballOn + yards, stats,
        desc: `STRIP SACK by ${name(sacker)}! Fumble recovered`,
      };
    }
    return { kind: 'sack', yards, elapsed: rng.range(3, 5), clockStops: false, stats, desc: `${name(qb)} sacked by ${name(sacker)} for ${-yards}` };
  }

  const targets = [off.wr[0], off.wr[1], off.wr[2], off.te[0], off.rb[0]];
  const weights = targets.map((p, i) => [0.3, 0.22, 0.14, 0.18, 0.12][i] * (0.6 + p.ovr / 100));
  const target = rng.weighted(targets, weights);
  const ti = targets.indexOf(target);
  const cover = [def.cb[0], def.cb[1], def.cb[2], def.ss, def.olb[0]][ti];
  const coverSkill = (ti < 3 ? (a(cover, 'man') + a(cover, 'zon')) / 2 : ti === 3 ? a(cover, 'zon') : a(cover, 'cov')) + ctx.defBonus;
  const recvSkill = (a(target, 'cth') + a(target, 'rte', a(target, 'elu')) + a(target, 'spd')) / 3 + ctx.offBonus;

  const longYardage = gs.toGo >= 8;
  const depth = rng.weighted([0, 1, 2], ti === 4 ? [0.9, 0.1, 0] : longYardage ? [0.4, 0.42, 0.18] : [0.56, 0.3, 0.14]);
  const room = 100 - gs.ballOn;
  let air = depth === 0 ? rng.range(-1, 7) : depth === 1 ? rng.range(8, 16) : rng.range(19, 40);
  if (ti === 4) air = rng.range(-3, 4);
  air = Math.min(air, room + 8);
  const acc = (depth === 2 ? a(qb, 'dac') : a(qb, 'acc')) + ctx.offBonus;
  const pressure = (passRush - passBlock) * 0.002;
  const edge = (has(target, 'highlight') ? 0.04 : 0) + (depth === 2 && has(target, 'deepthreat') ? 0.05 : 0) + (has(cover, 'shutdown') ? -0.04 : 0);
  const compP = clamp([0.7, 0.54, 0.35][depth] + (acc - 70) * 0.006 + (recvSkill - coverSkill) * 0.005 - (has(qb, 'poised') ? 0 : pressure) - (room < 12 ? 0.08 : 0) + edge, 0.15, 0.93);
  const hawk = has(cover, 'ballhawk') || has(cover, 'lurker') ? 1.4 : 1;
  const intP = clamp([0.012, 0.026, 0.05][depth] * Math.exp((coverSkill - acc) / 22) * (1.3 - a(qb, 'awr') / 200) * hawk * (has(qb, 'fieldgeneral') ? 0.7 : 1), 0.004, 0.12);

  stats.push([qb.id, 'passAtt', 1]);
  const roll = rng.next();
  if (roll < intP) {
    const picker = ti < 3 ? cover : rng.pick([def.fs, def.ss, def.cb[0], def.mlb[0]]);
    const ret = spotAfterReturn(ctx, gs.ballOn + air, picker);
    stats.push([qb.id, 'passInt', 1], [picker.id, 'defInt', 1]);
    return {
      kind: 'int', yards: 0, elapsed: rng.range(4, 7), clockStops: true,
      turnoverSpot: ret.spot, defTd: ret.td, stats,
      desc: ret.td ? `PICK SIX! ${name(picker)} takes it to the house` : `INTERCEPTED by ${name(picker)}`,
    };
  }
  if (roll > intP + compP) {
    return { kind: 'incomplete', yards: 0, elapsed: rng.range(3, 6), clockStops: true, stats, desc: `Incomplete, intended for ${name(target)}` };
  }
  let yac = Math.max(0, rng.normal([3.2, 3, 4][depth] + (has(target, 'afterburner') ? 1.5 : 0), 3));
  if (rng.chance(0.03 + (a(target, 'spd') - 85) * 0.002)) yac += rng.range(8, 40);
  let yards = Math.round(air + yac);
  if (air >= room) yards = room;
  if (gs.ballOn + yards > 100) yards = room;
  const td = gs.ballOn + yards >= 100;
  stats.push([qb.id, 'passCmp', 1], [qb.id, 'passYds', yards], [target.id, 'rec', 1], [target.id, 'recYds', yards]);
  if (td) stats.push([qb.id, 'passTd', 1], [target.id, 'recTd', 1]);
  else stats.push([tackler(ctx, [cover, def.fs, def.ss, def.mlb[0], cover]).id, 'tkl', 1]);
  const oob = !td && rng.chance(isHurryUp(gs) ? 0.4 : 0.16);
  return {
    kind: 'pass', yards, elapsed: rng.range(4, 7), clockStops: td || oob, stats,
    desc: td ? `${name(qb)} to ${name(target)}, ${yards} yd TD!` : `${name(qb)} to ${name(target)} for ${yards}`,
  };
}

export function resolvePunt(ctx: Ctx): PlayResult {
  const { gs, off, rng } = ctx;
  const p = off.p;
  const bad = rng.chance(badSnapChance(off.ls));
  const gross = rng.normal(44 + (a(p, 'kpw') - 70) * 0.3 + (has(p, 'bigleg') ? 3 : 0), 5) - (bad ? 9 : 0);
  let spot = gs.ballOn + gross;
  let desc: string;
  if (spot >= 100) {
    spot = 80;
    desc = `${name(p)} punts into the end zone, touchback`;
  } else {
    const ret = spot > 88 ? 0 : Math.max(0, rng.normal(7, 6));
    spot = spot - ret;
    desc = `${bad ? 'Bad snap! ' : ''}${name(p)} punts ${Math.round(gross)} yds${ret > 0 ? `, returned ${Math.round(ret)}` : ', fair catch'}`;
  }
  return {
    kind: 'punt', yards: 0, elapsed: rng.range(6, 10), clockStops: true, turnoverSpot: spot,
    stats: [[p.id, 'punts', 1], [p.id, 'puntYds', Math.round(gross)]], desc,
  };
}

export function resolveFg(ctx: Ctx): PlayResult {
  const { gs, off, rng } = ctx;
  const dist = Math.round(fgDistance(gs.ballOn));
  const bad = rng.chance(badSnapChance(off.ls));
  const good = rng.chance(fgProb(off.k, dist) * (bad ? 0.55 : 1));
  const r = fgResult(off.k, dist, good, rng.range(4, 6));
  if (bad) r.desc = `Bad snap! ${r.desc}`;
  return r;
}

export function fgResult(k: Player, dist: number, good: boolean, elapsed: number): PlayResult {
  const stats: StatDelta[] = [[k.id, 'fga', 1]];
  if (good) stats.push([k.id, 'fgm', 1]);
  return {
    kind: 'fg', yards: 0, elapsed, clockStops: true, good, stats,
    desc: good ? `${name(k)} ${dist} yd field goal is GOOD` : `${name(k)} ${dist} yd field goal NO GOOD`,
  };
}

export function xpResult(k: Player, good: boolean): PlayResult {
  const stats: StatDelta[] = [[k.id, 'xpa', 1]];
  if (good) stats.push([k.id, 'xpm', 1]);
  return { kind: 'xp', yards: 0, elapsed: 0, clockStops: true, good, stats, desc: good ? 'Extra point is good' : 'Extra point NO GOOD' };
}

export function resolveCall(call: CpuCall, gs: GameState, off: Lineup, def: Lineup, rng: Rng, offBonus = 0, defBonus = 0): PlayResult {
  const ctx: Ctx = { gs, off, def, rng, offBonus, defBonus };
  switch (call) {
    case 'run':
      return resolveRun(ctx);
    case 'pass':
      return resolvePass(ctx);
    case 'punt':
      return resolvePunt(ctx);
    case 'fg':
      return resolveFg(ctx);
    case 'kneel':
      return { kind: 'kneel', yards: -1, elapsed: 2, clockStops: false, stats: [[off.qb.id, 'rushAtt', 1], [off.qb.id, 'rushYds', -1]], desc: `${name(off.qb)} kneels` };
    case 'xp':
      return xpResult(off.k, rng.chance((0.93 + (a(off.k, 'kac') - 70) * 0.002) * (rng.chance(badSnapChance(off.ls)) ? 0.65 : 1)));
    case 'two': {
      const saved = gs.ballOn;
      gs.ballOn = 98;
      const r = rng.chance(0.5) ? resolveRun(ctx) : resolvePass(ctx);
      gs.ballOn = saved;
      const good = r.kind === 'run' || r.kind === 'pass' ? 98 + r.yards >= 100 : false;
      // Two-point tries don't count toward TD stats; keep attempts only.
      return { kind: 'two', yards: 0, elapsed: 0, clockStops: true, good, stats: [], desc: good ? 'Two-point conversion GOOD' : 'Two-point try fails' };
    }
  }
}
