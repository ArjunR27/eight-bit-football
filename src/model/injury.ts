import type { Rng } from '../core/rng';
import type { Group } from './dev';

// Common NFL injuries with recovery windows in weeks. `weight` is how often each occurs;
// `groups` biases some injuries toward the positions that suffer them most.
export interface InjuryType {
  name: string;
  part: 'Leg' | 'Knee' | 'Ankle' | 'Foot' | 'Arm' | 'Hand' | 'Shoulder' | 'Head' | 'Torso' | 'Back';
  min: number;
  max: number;
  weight: number;
  groups?: Group[];
}

/** Anything this long ends the season (the player heals over the offseason). */
export const SEASON_ENDING = 30;

export const INJURIES: InjuryType[] = [
  { name: 'Ankle Sprain', part: 'Ankle', min: 1, max: 3, weight: 14 },
  { name: 'High Ankle Sprain', part: 'Ankle', min: 3, max: 7, weight: 6 },
  { name: 'Hamstring Strain', part: 'Leg', min: 1, max: 4, weight: 12, groups: ['RB', 'REC', 'DB'] },
  { name: 'Groin Strain', part: 'Leg', min: 1, max: 3, weight: 6 },
  { name: 'Quad Contusion', part: 'Leg', min: 1, max: 2, weight: 5 },
  { name: 'Calf Strain', part: 'Leg', min: 1, max: 3, weight: 5 },
  { name: 'MCL Sprain', part: 'Knee', min: 2, max: 6, weight: 7, groups: ['OL', 'DL'] },
  { name: 'Torn Meniscus', part: 'Knee', min: 4, max: 8, weight: 3 },
  { name: 'Torn ACL', part: 'Knee', min: SEASON_ENDING, max: SEASON_ENDING, weight: 2 },
  { name: 'Torn Achilles', part: 'Foot', min: SEASON_ENDING, max: SEASON_ENDING, weight: 1 },
  { name: 'Turf Toe', part: 'Foot', min: 2, max: 5, weight: 3 },
  { name: 'Foot Fracture', part: 'Foot', min: 6, max: 10, weight: 2 },
  { name: 'Concussion', part: 'Head', min: 1, max: 2, weight: 8, groups: ['REC', 'DB', 'LB'] },
  { name: 'Shoulder Sprain', part: 'Shoulder', min: 1, max: 3, weight: 6, groups: ['OL', 'DL', 'LB'] },
  { name: 'Separated Shoulder', part: 'Shoulder', min: 3, max: 6, weight: 3, groups: ['QB', 'DB'] },
  { name: 'Broken Forearm', part: 'Arm', min: 6, max: 10, weight: 2 },
  { name: 'Elbow Sprain', part: 'Arm', min: 1, max: 3, weight: 3, groups: ['QB', 'OL'] },
  { name: 'Broken Hand', part: 'Hand', min: 3, max: 6, weight: 3, groups: ['REC', 'DB', 'OL'] },
  { name: 'Wrist Sprain', part: 'Hand', min: 1, max: 2, weight: 3 },
  { name: 'Rib Injury', part: 'Torso', min: 1, max: 4, weight: 4, groups: ['QB', 'RB'] },
  { name: 'Back Strain', part: 'Back', min: 1, max: 3, weight: 4, groups: ['OL', 'DL'] },
];

export function rollInjury(rng: Rng, group: Group): { type: InjuryType; weeks: number } {
  const type = rng.weighted(INJURIES, INJURIES.map((i) => i.weight * (i.groups?.includes(group) ? 2 : 1)));
  return { type, weeks: rng.int(type.min, type.max) };
}

export function injuryLabel(weeks: number, type?: string) {
  const out = weeks >= SEASON_ENDING ? 'OUT FOR SEASON' : `OUT ${weeks} WK${weeks === 1 ? '' : 'S'}`;
  return type ? `${type.toUpperCase()} • ${out}` : out;
}
