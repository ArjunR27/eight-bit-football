import { Rng, clamp } from '../core/rng';
import type { GameState } from '../sim/gameState';
import { simGame } from '../sim/simGame';
import { autoDepth, syncDepth } from './depth';
import { DEV_LABELS, breakout, gainXp, groupOf, maybeReveal, offseasonGrowth, potentialOf, refreshDev, type Group } from './dev';
import { cpuPick, draftOrderFromSeason, finalizeDraft, prepareDraft } from './draft';
import { injuryLabel, rollInjury } from './injury';
import { addAlumnus, notify, pname } from './news';
import { makeSchedule } from './schedule';
import { refreshNeeds } from './rundown';
import { cpuTrades } from './trade';
import type { League, Player, PlayoffState, Pos, ScheduledGame, StatKey, StatLine, Team } from './types';

export interface StandingRow {
  team: Team;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  divW: number;
  divL: number;
  pct: number;
}

export function standings(league: League): StandingRow[] {
  const rows = league.teams.map((team) => ({ team, w: 0, l: 0, t: 0, pf: 0, pa: 0, divW: 0, divL: 0, pct: 0 }));
  for (const wk of league.schedule)
    for (const g of wk) {
      if (!g.played) continue;
      const h = rows[g.home];
      const aw = rows[g.away];
      const sameDiv = h.team.conf === aw.team.conf && h.team.div === aw.team.div;
      h.pf += g.hs!; h.pa += g.as!; aw.pf += g.as!; aw.pa += g.hs!;
      if (g.hs! > g.as!) { h.w++; aw.l++; if (sameDiv) { h.divW++; aw.divL++; } }
      else if (g.hs! < g.as!) { aw.w++; h.l++; if (sameDiv) { aw.divW++; h.divL++; } }
      else { h.t++; aw.t++; }
    }
  for (const r of rows) {
    const gp = r.w + r.l + r.t;
    r.pct = gp ? (r.w + r.t / 2) / gp : 0;
  }
  return rows;
}

export function sortStandings(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((x, y) => y.pct - x.pct || y.divW - x.divW || (y.pf - y.pa) - (x.pf - x.pa) || y.pf - x.pf);
}

export function recordStr(r: StandingRow) {
  return r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

export function gameKey(g: ScheduledGame) {
  return `${g.home}-${g.away}`;
}

/** One game's production as a single number (drives in-season XP). */
export function gameGrade(pos: Pos, l: StatLine): number {
  const s = (k: StatKey) => l[k] ?? 0;
  switch (groupOf(pos)) {
    case 'QB': return s('passYds') / 40 + s('passTd') * 1.5 - s('passInt') * 1.5 + s('rushYds') / 20;
    case 'RB': return s('rushYds') / 15 + s('rushTd') * 1.5 + s('recYds') / 20;
    case 'REC': return s('recYds') / 15 + s('recTd') * 1.5 + s('rec') * 0.2;
    case 'DL': return s('tkl') * 0.4 + s('sack') * 1.5 + s('defInt') * 2;
    case 'LB': return s('tkl') * 0.35 + s('sack') * 1.2 + s('defInt') * 2;
    case 'DB': return s('tkl') * 0.3 + s('defInt') * 2;
    case 'K': return s('fgm') * 0.8 + s('xpm') * 0.2 + s('punts') * 0.3;
    default: return 1; // linemen: graded on snaps
  }
}

const PERF_BENCH: Record<Group, number> = { QB: 7, RB: 4.5, REC: 3.5, OL: 1, DL: 1.4, LB: 2, DB: 1.1, K: 2 };

/** This season's production versus a typical starter: 0.8 (struggling) .. 1.25 (on fire). */
export function seasonPerf(p: Player): number {
  const gp = p.stats.gp ?? 0;
  if (gp < 2 || groupOf(p.pos) === 'OL') return 1;
  const ratio = gameGrade(p.pos, p.stats) / gp / PERF_BENCH[groupOf(p.pos)];
  return clamp(0.8 + ratio * 0.2, 0.8, 1.25);
}

/**
 * Commit a finished game: score, stats, snaps, fatigue, in-season progression,
 * hidden-dev reveals and injuries. User-team events become post-game notices.
 */
export function finalizeGame(league: League, g: ScheduledGame, gs: GameState, rng: Rng) {
  g.hs = gs.score[0];
  g.as = gs.score[1];
  g.played = true;
  const key = gameKey(g);
  for (const [pid, line] of Object.entries(gs.stats)) {
    const p = league.players[Number(pid)];
    if (!p) continue;
    for (const [k, v] of Object.entries(line)) p.stats[k as StatKey] = (p.stats[k as StatKey] ?? 0) + (v as number);
  }
  const snaps = gs.cond?.snaps ?? {};
  for (const tid of [g.home, g.away]) {
    const team = league.teams[tid];
    const mine = tid === league.userTeamId;
    for (const id of team.roster) {
      const p = league.players[id];
      if (p.injury > 0) {
        p.injury--;
        if (p.injury === 0) p.injuryType = undefined;
        continue;
      }
      p.stats.gp = (p.stats.gp ?? 0) + 1;
      const n = snaps[id] ?? 0;
      p.snaps += n;
      // Season-long wear builds with snaps and eases a little every week.
      p.wear = clamp(p.wear - 6 + n * 0.22 * (1.3 - (p.attrs.dur ?? 70) / 150), 0, 100);
      const before = p.ovr;
      const up = n > 0 ? gainXp(p, n, gameGrade(p.pos, gs.stats[id] ?? {}), rng) : null;
      if (up && mine) notify(league, 'upgrade', `${pname(p)} (${p.pos}) upgraded ${before} → ${up} OVR`, id, key);
      if (maybeReveal(p)) {
        refreshDev(p, rng);
        if (mine) notify(league, 'reveal', `${pname(p)} dev revealed: ${DEV_LABELS[potentialOf(p)].toUpperCase()} POTENTIAL (now ${DEV_LABELS[p.dev].toUpperCase()})`, id, key);
      } else if (up && refreshDev(p, rng) === 'up' && mine) {
        notify(league, 'reveal', `${pname(p)} promoted to ${DEV_LABELS[p.dev].toUpperCase()} dev at ${p.ovr} OVR!`, id, key);
      }
    }
    rollInjuries(league, team, rng, key);
  }
}

function rollInjuries(league: League, team: Team, rng: Rng, key: string) {
  const n = rng.weighted([0, 1, 2], [0.45, 0.4, 0.15]);
  for (let i = 0; i < n; i++) {
    const starters = team.roster.map((id) => league.players[id]).filter((p) => p.injury === 0 && (team.depth[p.pos] ?? []).indexOf(p.id) < 2);
    if (!starters.length) return;
    // Low durability and heavy wear both raise the odds.
    const weights = starters.map((p) => Math.max(5, 110 - (p.attrs.dur ?? 70)) * (1 + p.wear / 60));
    const p = rng.weighted(starters, weights);
    const { type, weeks } = rollInjury(rng, groupOf(p.pos));
    p.injury = weeks;
    p.injuryType = type.name;
    if (team.id === league.userTeamId) notify(league, 'injury', `${pname(p)} (${p.pos}): ${injuryLabel(weeks, type.name)}`, p.id, key);
  }
}

export function userGameThisWeek(league: League): ScheduledGame | undefined {
  if (league.phase === 'regular') {
    return league.schedule[league.week]?.find((g) => g.home === league.userTeamId || g.away === league.userTeamId);
  }
  if (league.phase === 'playoffs' && league.playoffs) {
    const round = league.playoffs.games[league.playoffs.round];
    return round?.find((g) => !g.played && (g.home === league.userTeamId || g.away === league.userTeamId));
  }
  return undefined;
}

/** Sim every unplayed game in the current week / playoff round, then advance. */
export function finishWeek(league: League) {
  const rng = new Rng(league.rngState);
  const games = league.phase === 'regular' ? league.schedule[league.week] : league.playoffs!.games[league.playoffs!.round];
  for (const g of games) {
    if (g.played) continue;
    const gs = simGame(league, g.home, g.away, league.phase === 'playoffs', rng.int(0, 2 ** 31));
    finalizeGame(league, g, gs, rng);
  }
  // Teams on bye (or eliminated) rest: injuries heal a week and wear eases more.
  const busy = new Set(games.flatMap((g) => [g.home, g.away]));
  for (const t of league.teams) {
    if (busy.has(t.id)) continue;
    for (const id of t.roster) {
      const p = league.players[id];
      if (p.injury > 0 && --p.injury === 0) p.injuryType = undefined;
      p.wear = Math.max(0, p.wear - 20);
    }
  }
  if (league.phase === 'regular') cpuTrades(league, rng);
  league.rngState = rng.state;
  refreshNeeds(league);
  for (const t of league.teams) if (t.id !== league.userTeamId) autoDepth(league, t);
  if (league.phase === 'regular') {
    league.week++;
    if (league.week >= league.schedule.length) startPlayoffs(league);
  } else {
    advancePlayoffs(league);
  }
}

function seedConference(league: League, conf: number): number[] {
  const rows = standings(league).filter((r) => r.team.conf === conf);
  const winners: typeof rows = [];
  for (let d = 0; d < 4; d++) winners.push(sortStandings(rows.filter((r) => r.team.div === d))[0]);
  const top = sortStandings(winners);
  const rest = sortStandings(rows.filter((r) => !winners.includes(r))).slice(0, 3);
  return [...top, ...rest].map((r) => r.team.id);
}

function startPlayoffs(league: League) {
  const seeds = [seedConference(league, 0), seedConference(league, 1)];
  const wc: ScheduledGame[] = [];
  for (const s of seeds) for (const [hi, lo] of [[1, 6], [2, 5], [3, 4]]) wc.push({ home: s[hi], away: s[lo], played: false });
  league.playoffs = { seeds, round: 0, games: [wc] };
  league.phase = 'playoffs';
}

const winner = (g: ScheduledGame) => (g.hs! > g.as! ? g.home : g.away);

function advancePlayoffs(league: League) {
  const po = league.playoffs as PlayoffState;
  const games = po.games[po.round];
  const alive = new Set(games.map(winner));
  po.round++;
  if (po.round === 4) {
    po.champion = winner(games[0]);
    const r = sortStandings(standings(league)).find((x) => x.team.id === league.userTeamId)!;
    league.history.push({ year: league.year, champion: po.champion, userRecord: recordStr(r) });
    league.phase = 'offseason';
    return;
  }
  const next: ScheduledGame[] = [];
  if (po.round === 3) {
    const [a, b] = games.map(winner);
    next.push({ home: a, away: b, played: false });
  } else {
    for (const s of po.seeds) {
      let left = s.filter((id, i) => (po.round === 1 && i === 0) || alive.has(id));
      if (po.round === 2) left = s.filter((id) => alive.has(id));
      // Highest seed hosts lowest seed.
      while (left.length >= 2) next.push({ home: left.shift()!, away: left.pop()!, played: false });
    }
  }
  po.games.push(next);
}

export function playoffRoundName(round: number) {
  return ['Wild Card', 'Divisional', 'Conference Final', 'Retro Rush Bowl'][round] ?? 'Offseason';
}

export interface OffseasonReport {
  retired: { p: Player; team: string; mine: boolean }[]; // notable retirements (shown to the user)
  retiredTotal: number;
  changes: { p: Player; before: number }[]; // user players whose OVR moved
}

function retires(p: Player, rng: Rng) {
  // Premium players hang on a little longer.
  const hang = p.dev === 'normal' ? 0 : 1;
  return p.age >= 37 + hang || (p.age >= 33 + hang && rng.chance(0.3 + (p.age - 33 - hang) * 0.15)) || (p.ovr < 50 && p.age >= 28);
}

/**
 * Close the books on a season: archive stats, age and develop everyone, retire veterans
 * (notifying the user), heal up, then open the draft for the new league year.
 */
export function startOffseason(league: League): OffseasonReport {
  const rng = new Rng(league.rngState);
  const order = draftOrderFromSeason(league);
  const report: OffseasonReport = { retired: [], retiredTotal: 0, changes: [] };
  league.year++;
  league.week = 0;
  for (const team of league.teams) {
    const mine = team.id === league.userTeamId;
    for (const id of [...team.roster, ...team.practice]) {
      const p = league.players[id];
      p.career.push({ year: league.year - 1, team: team.abbr, ovr: p.ovr, stats: p.stats });
      p.stats = {};
      p.age++;
      p.yearsPro++;
      p.injury = 0;
      p.injuryType = undefined;
      p.wear = 0;
      p.xp = 0;
      const before = p.ovr;
      offseasonGrowth(p, rng);
      breakout(p, rng);
      const moved = refreshDev(p, rng);
      if (moved && mine) notify(league, 'reveal', `${pname(p)} ${moved === 'up' ? 'promoted' : 'drops'} to ${DEV_LABELS[p.dev].toUpperCase()} dev (${p.ovr} OVR)`, id);
      if (mine && p.ovr !== before) report.changes.push({ p, before });
    }
    for (const id of [...team.roster, ...team.practice]) {
      const p = league.players[id];
      if (!retires(p, rng)) continue;
      report.retiredTotal++;
      const notable = mine || p.ovr >= 82 || p.yearsPro >= 12;
      if (notable) {
        report.retired.push({ p: { ...p }, team: team.abbr, mine });
        notify(league, 'retire', `${mine ? '' : `${team.abbr} `}${p.pos} ${p.first} ${p.last} retires after ${p.yearsPro} seasons (${p.ovr} OVR)`, p.id);
      }
      if (mine) addAlumnus(league, p, 'retired');
      delete league.players[id];
    }
    team.roster = team.roster.filter((id) => league.players[id]);
    team.practice = team.practice.filter((id) => league.players[id]);
    if (mine) syncDepth(league, team);
    else autoDepth(league, team);
  }
  league.playoffs = undefined;
  league.schedule = makeSchedule(rng, league.teams, league.year);
  league.rngState = rng.state;
  prepareDraft(league, order);
  return report;
}

/** Fully automatic rollover (used by the sim and tests): offseason, a CPU-run draft, roster cuts. */
export function startNewSeason(league: League) {
  const report = startOffseason(league);
  while (league.draft && league.draft.current < league.draft.order.length) cpuPick(league);
  finalizeDraft(league);
  return report;
}
