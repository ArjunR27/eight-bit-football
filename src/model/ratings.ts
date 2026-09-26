import type { AttrKey, Attrs, Pos } from './types';

export const ATTR_LABELS: Record<AttrKey, string> = {
  spd: 'Speed', str: 'Strength', awr: 'Awareness', dur: 'Durability',
  thp: 'Throw Power', acc: 'Accuracy', dac: 'Deep Accuracy', pac: 'Play Action', agi: 'Agility',
  car: 'Carrying', elu: 'Elusiveness', trk: 'Trucking', cth: 'Catching',
  rte: 'Route Running', spc: 'Spectacular Catch', rel: 'Release',
  rbk: 'Run Block', pbk: 'Pass Block', ibk: 'Impact Block',
  prs: 'Pass Rush', bsh: 'Block Shedding', pur: 'Pursuit', tak: 'Tackle', hit: 'Hit Power',
  prc: 'Play Recognition', cov: 'Coverage', man: 'Man Coverage', zon: 'Zone Coverage', pre: 'Press',
  kpw: 'Kick Power', kac: 'Kick Accuracy', snp: 'Snap Reliability',
};

export const CORE_ATTRS: AttrKey[] = ['spd', 'str', 'awr', 'dur'];

const QB: AttrKey[] = ['thp', 'acc', 'dac', 'pac', 'agi'];
const BACK: AttrKey[] = ['car', 'elu', 'trk', 'cth', 'agi'];
const WR: AttrKey[] = ['cth', 'rte', 'spc', 'rel', 'agi'];
const TE: AttrKey[] = ['cth', 'rte', 'rbk', 'pbk', 'agi'];
const OL: AttrKey[] = ['pbk', 'rbk', 'ibk'];
const DL: AttrKey[] = ['prs', 'bsh', 'pur', 'tak', 'hit'];
const LB: AttrKey[] = ['tak', 'pur', 'prc', 'cov', 'hit'];
const DB: AttrKey[] = ['man', 'zon', 'pre', 'prc', 'tak'];
const KP: AttrKey[] = ['kpw', 'kac'];

export const POS_ATTRS: Record<Pos, AttrKey[]> = {
  QB, RB: BACK, FB: BACK, WR, TE,
  LT: OL, LG: OL, C: OL, RG: OL, RT: OL,
  DE: DL, DT: DL, OLB: LB, MLB: LB,
  CB: DB, FS: DB, SS: DB,
  K: KP, P: KP, LS: ['snp'],
};

export function attrsFor(pos: Pos): AttrKey[] {
  return [...CORE_ATTRS, ...POS_ATTRS[pos]];
}

// Typical attribute values for a 70-OVR player at each position. Generation scales around these.
const OL_PROFILE: Attrs = { spd: 52, str: 82, awr: 68, dur: 75, pbk: 70, rbk: 70, ibk: 66 };
const DB_BASE: Attrs = { spd: 88, str: 55, awr: 68, dur: 72, man: 70, zon: 70, pre: 66, prc: 68, tak: 60 };
export const PROFILES: Record<Pos, Attrs> = {
  QB: { spd: 66, str: 60, awr: 70, dur: 74, thp: 80, acc: 70, dac: 68, pac: 68, agi: 68 },
  RB: { spd: 88, str: 64, awr: 66, dur: 72, car: 72, elu: 72, trk: 68, cth: 62, agi: 84 },
  FB: { spd: 70, str: 78, awr: 68, dur: 76, car: 68, elu: 50, trk: 72, cth: 62, agi: 64 },
  WR: { spd: 89, str: 55, awr: 67, dur: 72, cth: 72, rte: 70, spc: 66, rel: 68, agi: 84 },
  TE: { spd: 76, str: 70, awr: 68, dur: 74, cth: 70, rte: 64, rbk: 64, pbk: 60, agi: 70 },
  LT: OL_PROFILE, LG: OL_PROFILE, C: OL_PROFILE, RG: OL_PROFILE, RT: OL_PROFILE,
  DE: { spd: 76, str: 76, awr: 66, dur: 74, prs: 72, bsh: 68, pur: 70, tak: 68, hit: 68 },
  DT: { spd: 60, str: 86, awr: 66, dur: 74, prs: 64, bsh: 72, pur: 62, tak: 68, hit: 70 },
  OLB: { spd: 80, str: 68, awr: 68, dur: 74, tak: 70, pur: 72, prc: 68, cov: 62, hit: 70 },
  MLB: { spd: 76, str: 72, awr: 72, dur: 74, tak: 72, pur: 70, prc: 72, cov: 60, hit: 72 },
  CB: DB_BASE,
  FS: { ...DB_BASE, spd: 86, man: 64, zon: 72, pre: 50, tak: 64 },
  SS: { ...DB_BASE, spd: 84, str: 64, man: 62, zon: 68, pre: 50, tak: 70 },
  K: { spd: 50, str: 45, awr: 64, dur: 80, kpw: 78, kac: 72 },
  P: { spd: 50, str: 48, awr: 64, dur: 80, kpw: 76, kac: 70 },
  LS: { spd: 50, str: 70, awr: 64, dur: 80, snp: 72 },
};

// OVR weights per position (Madden-style: each position leans on different attributes).
const OL_W: Attrs = { pbk: 2.5, rbk: 2.5, str: 2, awr: 1.2, ibk: 0.6, spd: 0.2, dur: 0.3 };
export const WEIGHTS: Record<Pos, Attrs> = {
  QB: { acc: 3, awr: 2.5, dac: 1.5, thp: 1.5, pac: 0.5, agi: 0.5, spd: 0.5, str: 0.1, dur: 0.2 },
  RB: { spd: 2, elu: 1.5, car: 1, trk: 1, agi: 1.5, cth: 0.7, awr: 0.8, str: 0.5, dur: 0.3 },
  FB: { trk: 1.5, str: 2, car: 0.8, cth: 0.8, awr: 1, spd: 0.6, elu: 0.2, agi: 0.3, dur: 0.3 },
  WR: { cth: 2, rte: 2, spd: 2, rel: 1, spc: 1, agi: 1, awr: 1, str: 0.2, dur: 0.3 },
  TE: { cth: 1.6, rte: 1.2, rbk: 1.2, pbk: 0.8, spd: 1, str: 1, awr: 1, agi: 0.5, dur: 0.3 },
  LT: OL_W, LG: OL_W, C: OL_W, RG: OL_W, RT: OL_W,
  DE: { prs: 2.5, bsh: 1.5, spd: 1.2, str: 1.2, pur: 1, tak: 1, hit: 0.5, awr: 0.8, dur: 0.3 },
  DT: { bsh: 2.5, str: 2, prs: 1.5, tak: 1, pur: 0.7, hit: 0.5, awr: 0.8, spd: 0.3, dur: 0.3 },
  OLB: { tak: 1.5, pur: 1.5, spd: 1.2, prc: 1.2, cov: 1, hit: 0.7, awr: 1, str: 0.6, dur: 0.3 },
  MLB: { tak: 2, prc: 2, pur: 1.2, awr: 1.5, cov: 0.8, hit: 0.8, str: 0.8, spd: 0.6, dur: 0.3 },
  CB: { man: 2, zon: 1.5, spd: 2, pre: 0.8, prc: 1, awr: 0.8, tak: 0.4, str: 0.2, dur: 0.3 },
  FS: { zon: 2, spd: 1.5, prc: 1.5, man: 0.8, awr: 1.2, tak: 0.8, pre: 0.2, str: 0.2, dur: 0.3 },
  SS: { zon: 1.5, tak: 1.5, prc: 1.5, man: 0.8, awr: 1.2, spd: 1.2, pre: 0.2, str: 0.6, dur: 0.3 },
  K: { kpw: 2.5, kac: 2.5, awr: 0.3, dur: 0.1, spd: 0.05, str: 0.05 },
  P: { kpw: 2.5, kac: 2.5, awr: 0.3, dur: 0.1, spd: 0.05, str: 0.05 },
  LS: { snp: 3, awr: 0.5, str: 0.3, dur: 0.2, spd: 0.05 },
};

function rawOvr(pos: Pos, attrs: Attrs): number {
  const w = WEIGHTS[pos];
  let sum = 0;
  let tot = 0;
  for (const k in w) {
    const key = k as AttrKey;
    sum += (attrs[key] ?? 50) * w[key]!;
    tot += w[key]!;
  }
  return sum / tot;
}

// Calibrate so the position's 70-OVR profile maps to exactly 70.
const OFFSET: Record<Pos, number> = Object.fromEntries(
  (Object.keys(PROFILES) as Pos[]).map((p) => [p, 70 - rawOvr(p, PROFILES[p])]),
) as Record<Pos, number>;

export function computeOvr(pos: Pos, attrs: Attrs): number {
  return Math.max(20, Math.min(99, Math.round(rawOvr(pos, attrs) + OFFSET[pos])));
}

export function ovrColor(ovr: number): string {
  if (ovr >= 85) return '#6fdc6f';
  if (ovr >= 75) return '#b8e05a';
  if (ovr >= 65) return '#f2c14e';
  if (ovr >= 55) return '#f08a3c';
  return '#e0503a';
}
