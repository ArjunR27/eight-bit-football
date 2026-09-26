import type { HallEntry, League, NoticeKind, Player, StatKey, StatLine } from './types';

const MAX_INBOX = 400;

export function notify(league: League, kind: NoticeKind, text: string, playerId?: number, gameKey?: string) {
  const id = (league.inbox.at(-1)?.id ?? 0) + 1;
  league.inbox.push({ id, year: league.year, week: league.week, kind, text, playerId, gameKey });
  if (league.inbox.length > MAX_INBOX) league.inbox.splice(0, league.inbox.length - MAX_INBOX);
}

export function pname(p: Player) {
  return `${p.first[0]}. ${p.last}`;
}

export function teamOf(league: League, playerId: number) {
  return league.teams.find((t) => t.roster.includes(playerId) || t.practice.includes(playerId));
}

/** Career line: every archived season plus the one in progress. */
export function careerTotals(p: Player): StatLine {
  const out: StatLine = {};
  for (const line of [...p.career.map((c) => c.stats), p.stats])
    for (const [k, v] of Object.entries(line)) out[k as StatKey] = (out[k as StatKey] ?? 0) + (v ?? 0);
  return out;
}

/** Snapshot a player for the Hall of Fame (he may later be deleted from the league). */
export function hallEntry(league: League, p: Player, reason: HallEntry['reason']): HallEntry {
  const current = teamOf(league, p.id)?.abbr;
  const teams = [...new Set([...p.career.map((c) => c.team), ...(current ? [current] : [])])];
  const first = p.career[0]?.year ?? league.year;
  return {
    playerId: p.id,
    name: `${p.first} ${p.last}`,
    pos: p.pos,
    peakOvr: Math.max(p.ovr, ...p.career.map((c) => c.ovr)),
    dev: p.dev,
    years: first === league.year ? String(league.year) : `${first}-${league.year}`,
    teams,
    reason,
    totals: careerTotals(p),
  };
}

/** A user player just left the franchise: keep him on the Hall of Fame ballot. */
export function addAlumnus(league: League, p: Player, reason: HallEntry['reason']) {
  if (league.alumni.some((a) => a.playerId === p.id) || league.hallOfFame.some((a) => a.playerId === p.id)) return;
  league.alumni.push(hallEntry(league, p, reason));
}

export function induct(league: League, playerId: number) {
  const i = league.alumni.findIndex((a) => a.playerId === playerId);
  if (i < 0) return false;
  const [entry] = league.alumni.splice(i, 1);
  league.hallOfFame.push({ ...entry, inductedYear: league.year });
  return true;
}
