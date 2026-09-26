import { Rng, clamp } from '../core/rng';
import { normalizeRoster, pickOwner } from './draft';
import { addAlumnus, notify, pname } from './news';
import { seasonPerf, standings } from './season';
import { refreshNeeds } from './rundown';
import { potentialOf } from './dev';
import type { DraftPick, League, Player, Pos, Team } from './types';

// Trade values, modeled on how Madden's franchise mode prices deals: a player's value
// climbs steeply with overall and is scaled by position, age, dev trait, this season's
// production and health; draft picks follow an NFL-style pick value chart. The CPU
// only accepts when it comes out slightly ahead.

export const TRADE_DEADLINE_WEEK = 9; // no trades from week 10 until the season ends
export const CPU_EDGE = 1.05; // CPU needs to get back at least 5% more value than it gives

export type Asset = { kind: 'player'; id: number } | { kind: 'pick'; pick: DraftPick };

const POS_WEIGHT: Record<Pos, number> = {
  QB: 1.6, LT: 1.15, DE: 1.15, CB: 1.1, WR: 1.1, DT: 1.0, RT: 1.0, OLB: 0.95, MLB: 0.9, RB: 0.85, TE: 0.9,
  FS: 0.9, SS: 0.9, LG: 0.85, RG: 0.85, C: 0.9, FB: 0.4, K: 0.35, P: 0.3, LS: 0.2,
};
const DEV_WEIGHT = { normal: 1, star: 1.2, superstar: 1.45, xfactor: 1.75 };

function ageFactor(age: number) {
  return age <= 24 ? 1.15 : age <= 27 ? 1.05 : age <= 30 ? 0.88 : age <= 32 ? 0.65 : 0.4;
}

/** Player value in pick-chart points (a 90 OVR young QB is worth about the #1 pick). */
export function playerValue(p: Player): number {
  // Young players are priced on their potential tier, veterans on the tier they've earned.
  const dev = p.devHidden ? 1.15 : Math.max(DEV_WEIGHT[p.dev], p.age <= 25 ? DEV_WEIGHT[potentialOf(p)] * 0.85 : 0);
  const health = p.injury >= 30 ? 0.5 : 1 - Math.min(0.4, p.injury * 0.05);
  return 33 * Math.exp((p.ovr - 60) / 7.5) * POS_WEIGHT[p.pos] * ageFactor(p.age) * dev * seasonPerf(p) * health;
}

// Anchor points (overall pick -> value) of the classic NFL trade value chart.
const CHART: [number, number][] = [[1, 3000], [5, 1700], [10, 1300], [16, 1000], [32, 590], [48, 420], [64, 270], [80, 190], [96, 116], [128, 62], [160, 34], [192, 20], [224, 6]];

export function chartValue(overall: number) {
  const n = clamp(overall, 1, 224);
  for (let i = 1; i < CHART.length; i++) {
    const [x1, y1] = CHART[i];
    const [x0, y0] = CHART[i - 1];
    if (n <= x1) return Math.exp(Math.log(y0) + ((n - x0) / (x1 - x0)) * (Math.log(y1) - Math.log(y0)));
  }
  return CHART.at(-1)![1];
}

/** Which draft year is "next up" right now (the one being made, or the coming one). */
function nextDraftYear(league: League) {
  return league.draft?.year ?? league.year + 1;
}

/** Projected slot within a round: worst current record picks first. */
function projectedSlot(league: League, orig: number) {
  const rows = standings(league);
  const order = [...rows].sort((a, b) => a.pct - b.pct || (a.pf - a.pa) - (b.pf - b.pa)).map((r) => r.team.id);
  const played = rows.some((r) => r.w + r.l + r.t > 0);
  return played ? order.indexOf(orig) + 1 : 16;
}

export function pickValue(league: League, k: DraftPick): number {
  const d = league.draft;
  if (d && k.year === d.year) {
    const slot = d.order.find((s) => s.round === k.round && s.orig === k.orig);
    return slot ? chartValue(slot.pick) : 0;
  }
  const next = nextDraftYear(league);
  const within = k.year === next ? projectedSlot(league, k.orig) : 16;
  // Future picks are worth less: nobody knows where they'll land.
  return chartValue((k.round - 1) * 32 + within) * Math.pow(0.85, Math.max(0, k.year - next));
}

export function assetValue(league: League, a: Asset) {
  return a.kind === 'player' ? playerValue(league.players[a.id]) : pickValue(league, a.pick);
}

export function tradeWindowOpen(league: League) {
  return league.phase === 'draft' || league.phase === 'offseason' || (league.phase === 'regular' && league.week < TRADE_DEADLINE_WEEK);
}

export interface TradeEval {
  give: number; // value the CPU receives
  get: number; // value the CPU sends
  fairness: number; // -1 (robbing the CPU) .. 0 even .. 1 (CPU wins big)
  accept: boolean;
  reason: string;
}

/** Evaluate from the CPU team's side: `incoming` goes to the CPU, `outgoing` leaves it. */
export function evaluateTrade(league: League, cpu: Team, incoming: Asset[], outgoing: Asset[]): TradeEval {
  // A CPU values help at its weak spots a little more (roster fit).
  const fit = (a: Asset) => {
    if (a.kind !== 'player') return 1;
    const p = league.players[a.id];
    const starter = cpu.depth[p.pos]?.[0];
    const s = starter !== undefined ? league.players[starter] : undefined;
    return !s || p.ovr > s.ovr ? 1.1 : 1;
  };
  const give = incoming.reduce((s, a) => s + assetValue(league, a) * fit(a), 0);
  const get = outgoing.reduce((s, a) => s + assetValue(league, a), 0);
  const total = give + get || 1;
  const fairness = clamp((give - get) / total, -1, 1);
  let accept = give >= get * CPU_EDGE && outgoing.length > 0;
  let reason = accept ? 'Deal! They accept.' : give < get * 0.7 ? 'Rejected: not even close.' : 'Rejected: they want more value.';
  if (!tradeWindowOpen(league)) { accept = false; reason = 'The trade deadline has passed.'; }
  if (!incoming.length || !outgoing.length) { accept = false; reason = 'Each side must include something.'; }
  return { give, get, fairness, accept, reason };
}

function moveAsset(league: League, from: Team, to: Team, a: Asset) {
  if (a.kind === 'player') {
    from.roster = from.roster.filter((id) => id !== a.id);
    from.practice = from.practice.filter((id) => id !== a.id);
    to.roster.push(a.id);
    for (const pos of Object.keys(from.depth) as Pos[]) from.depth[pos] = from.depth[pos]!.filter((id) => id !== a.id);
  } else {
    const i = from.picks.findIndex((k) => k.year === a.pick.year && k.round === a.pick.round && k.orig === a.pick.orig);
    if (i >= 0) to.picks.push(...from.picks.splice(i, 1));
  }
}

export function assetLabel(league: League, a: Asset) {
  if (a.kind === 'pick') return `${a.pick.year} RD${a.pick.round} (${league.teams[a.pick.orig].abbr})`;
  const p = league.players[a.id];
  return `${p.pos} ${pname(p)} ${p.ovr}`;
}

/** Swap assets between two teams, then re-shape both rosters. */
export function executeTrade(league: League, a: Team, b: Team, aGives: Asset[], bGives: Asset[]) {
  for (const x of aGives) if (x.kind === 'player' && a.id === league.userTeamId) addAlumnus(league, league.players[x.id], 'traded');
  for (const x of bGives) if (x.kind === 'player' && b.id === league.userTeamId) addAlumnus(league, league.players[x.id], 'traded');
  for (const x of aGives) moveAsset(league, a, b, x);
  for (const x of bGives) moveAsset(league, b, a, x);
  const text = `TRADE: ${a.abbr} send ${aGives.map((x) => assetLabel(league, x)).join(', ')} to ${b.abbr} for ${bGives.map((x) => assetLabel(league, x)).join(', ')}`;
  notify(league, a.id === league.userTeamId || b.id === league.userTeamId ? 'trade' : 'league', text);
  normalizeRoster(league, a);
  normalizeRoster(league, b);
  if (a.id === league.userTeamId || b.id === league.userTeamId) refreshNeeds(league);
}

/** Owner check so the UI never offers an asset that already moved. */
export function ownsAsset(league: League, team: Team, a: Asset) {
  if (a.kind === 'player') return team.roster.includes(a.id) || team.practice.includes(a.id);
  return pickOwner(league, a.pick.year, a.pick.round, a.pick.orig) === team.id;
}

/** The rest of the league deals too: now and then a contender buys a veteran with picks. */
export function cpuTrades(league: League, rng: Rng) {
  if (!tradeWindowOpen(league) || !rng.chance(0.35)) return;
  const cpus = league.teams.filter((t) => t.id !== league.userTeamId);
  const seller = rng.pick(cpus);
  const buyer = rng.pick(cpus.filter((t) => t !== seller));
  const pool = seller.roster.map((id) => league.players[id]).filter((p) => p.ovr >= 70 && p.ovr <= 86 && p.injury === 0 && p.pos !== 'K' && p.pos !== 'P' && p.pos !== 'LS');
  if (!pool.length) return;
  const star = rng.pick(pool);
  const target = playerValue(star) * CPU_EDGE;
  // Buyer builds a pick package, cheapest picks first, until the seller is satisfied.
  const picks = [...buyer.picks].sort((x, y) => pickValue(league, x) - pickValue(league, y));
  const offer: Asset[] = [];
  let sum = 0;
  for (const k of picks.reverse()) {
    if (sum >= target) break;
    const v = pickValue(league, k);
    if (sum + v > target * 1.6 && offer.length) continue;
    offer.push({ kind: 'pick', pick: k });
    sum += v;
  }
  const verdict = evaluateTrade(league, seller, offer, [{ kind: 'player', id: star.id }]);
  if (verdict.accept) executeTrade(league, buyer, seller, offer, [{ kind: 'player', id: star.id }]);
}
