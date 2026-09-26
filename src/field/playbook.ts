// Offensive playbook (formation -> plays) and CPU defensive calls.
// Coordinates: dx = yards downfield from the line of scrimmage (negative = backfield),
// dy = yards from the ball laterally (negative = top of screen).

import type { OffensiveScheme } from '../model/types';

export type Role = 'QB' | 'RB' | 'FB' | 'WR1' | 'WR2' | 'WR3' | 'WR4' | 'TE1' | 'TE2' | 'LT' | 'LG' | 'C' | 'RG' | 'RT';
export const ELIGIBLE: Role[] = ['WR1', 'WR2', 'WR3', 'WR4', 'TE1', 'TE2', 'RB', 'FB'];

export type RouteName =
  | 'go' | 'seam' | 'slant' | 'out' | 'in' | 'curl' | 'comeback' | 'hitch' | 'post' | 'corner'
  | 'flat' | 'drag' | 'wheel' | 'swing' | 'fade' | 'dig' | 'whip' | 'angle' | 'deepout' | 'stick' | 'cross' | 'block';

export interface RouteDef {
  // (dx downfield, dOut toward the near sideline) offsets from the player's start
  pts: [number, number][];
  settle?: boolean; // stop and sit down at the end (curl/hitch) instead of continuing
}

export const ROUTES: Record<RouteName, RouteDef> = {
  go: { pts: [[45, 0]] },
  seam: { pts: [[6, 0], [45, -2]] },
  slant: { pts: [[2, 0], [9, -7]] },
  out: { pts: [[9, 0], [9.5, 6]] },
  in: { pts: [[10, 0], [10.5, -12]] },
  curl: { pts: [[11, 0], [9.5, -1]], settle: true },
  comeback: { pts: [[14, 0], [12, 2.5]], settle: true },
  hitch: { pts: [[6, 0], [5, 0]], settle: true },
  post: { pts: [[11, 0], [30, -11]] },
  corner: { pts: [[11, 0], [26, 9]] },
  flat: { pts: [[1, 2.5], [3, 10]] },
  drag: { pts: [[3, 0], [5, -6], [6, -26]] },
  wheel: { pts: [[1, 3], [4, 7], [32, 8]] },
  swing: { pts: [[-1, 4], [2, 10]] },
  fade: { pts: [[5, 1], [36, 8]] },
  dig: { pts: [[12, 0], [16, -12]] },
  whip: { pts: [[3, 0], [5, -5], [8, 3]] },
  angle: { pts: [[3, 4], [8, -7]] },
  deepout: { pts: [[15, 0], [16, 11]] },
  stick: { pts: [[6, 0], [6, 0]], settle: true },
  cross: { pts: [[8, 0], [19, -12]] },
  block: { pts: [] },
};

/** Routes offered by tapping a receiver pre-snap (hot routes). */
export const HOT_ROUTES: RouteName[] = ['go', 'slant', 'out', 'in', 'curl', 'post', 'corner', 'dig', 'deepout', 'whip'];
export const HOT_ROUTES_BACK: RouteName[] = ['flat', 'swing', 'angle', 'wheel', 'block'];

export interface Formation {
  name: string;
  spots: Partial<Record<Role, [number, number]>>;
}

const OL_SPOTS: Partial<Record<Role, [number, number]>> = {
  LT: [-0.9, -3.4], LG: [-0.9, -1.7], C: [-0.9, 0], RG: [-0.9, 1.7], RT: [-0.9, 3.4],
};

export const FORMATIONS: Record<string, Formation> = {
  shotgun: {
    name: 'Shotgun',
    spots: { ...OL_SPOTS, QB: [-5, 0], RB: [-5, -2], TE1: [-1.2, 5.2], WR1: [-1, -19], WR2: [-1, 19], WR3: [-1.6, 12] },
  },
  singleback: {
    name: 'Singleback',
    spots: { ...OL_SPOTS, QB: [-1.6, 0], RB: [-7, 0], TE1: [-1.2, 5.2], TE2: [-1.2, -5.2], WR1: [-1, -19], WR2: [-1, 19] },
  },
  iform: {
    name: 'I-Form',
    spots: { ...OL_SPOTS, QB: [-1.6, 0], FB: [-4.5, 0], RB: [-7.2, 0], TE1: [-1.2, 5.2], WR1: [-1, -19], WR2: [-1, 19] },
  },
  empty: {
    name: 'Empty',
    spots: { ...OL_SPOTS, QB: [-5, 0], WR1: [-1, -20], WR2: [-1, 20], WR3: [-1.6, -12], WR4: [-1.6, 12], RB: [-1.6, 7] },
  },
  pistol: {
    name: 'Pistol',
    spots: { ...OL_SPOTS, QB: [-4, 0], RB: [-7.2, 0], TE1: [-1.2, 5.2], WR1: [-1, -19], WR2: [-1, 19], WR3: [-1.6, 12] },
  },
  trips: {
    name: 'Trips',
    spots: { ...OL_SPOTS, QB: [-5, 0], RB: [-5, -2], TE1: [-1.2, 5.2], WR1: [-1, -19], WR2: [-1.6, 12], WR3: [-1.6, 19] },
  },
  bunch: {
    name: 'Bunch',
    spots: { ...OL_SPOTS, QB: [-5, 0], RB: [-5, -2], TE1: [-1.2, 5.2], WR1: [-1, -18], WR2: [-2, 10], WR3: [-1.5, 15] },
  },
  heavy: {
    name: 'Heavy',
    spots: { ...OL_SPOTS, QB: [-1.6, 0], FB: [-4.5, 0], RB: [-7.2, 0], TE1: [-1.2, 5.2], TE2: [-1.2, -5.2], WR1: [-1, -19] },
  },
  // The punt unit is placed by the engine itself (it needs the punter and a returner).
  punt: { name: 'Punt', spots: {} },
};

export type PlayType = 'pass' | 'run' | 'pa' | 'punt';

export interface Play {
  id: string;
  name: string;
  formation: keyof typeof FORMATIONS;
  type: PlayType;
  schemes?: OffensiveScheme[];
  routes?: Partial<Record<Role, RouteName>>;
  run?: { carrier: 'RB' | 'QB'; gap: number; lead?: boolean };
}

export const PLAYS: Play[] = [
  // Shotgun
  { id: 'sg-slants', name: 'Slants', formation: 'shotgun', type: 'pass', routes: { WR1: 'slant', WR2: 'slant', WR3: 'flat', TE1: 'drag', RB: 'block' } },
  { id: 'sg-verts', name: 'Verticals', formation: 'shotgun', type: 'pass', routes: { WR1: 'go', WR2: 'go', WR3: 'seam', TE1: 'seam', RB: 'flat' } },
  { id: 'sg-mesh', name: 'Mesh', formation: 'shotgun', type: 'pass', routes: { WR1: 'drag', WR2: 'curl', WR3: 'drag', TE1: 'out', RB: 'swing' } },
  { id: 'sg-smash', name: 'Smash', formation: 'shotgun', type: 'pass', routes: { WR1: 'hitch', WR2: 'hitch', WR3: 'corner', TE1: 'curl', RB: 'block' } },
  { id: 'sg-postwheel', name: 'Post Wheel', formation: 'shotgun', type: 'pass', routes: { WR1: 'post', WR2: 'comeback', WR3: 'in', TE1: 'flat', RB: 'wheel' } },
  { id: 'sg-draw', name: 'HB Draw', formation: 'shotgun', type: 'run', run: { carrier: 'RB', gap: 0.8 } },
  { id: 'sg-stretch', name: 'Outside Zone', formation: 'shotgun', type: 'run', run: { carrier: 'RB', gap: 6.5 } },
  // Singleback
  { id: 'sb-iz', name: 'Inside Zone', formation: 'singleback', type: 'run', run: { carrier: 'RB', gap: 1.7 } },
  { id: 'sb-power', name: 'Power Left', formation: 'singleback', type: 'run', run: { carrier: 'RB', gap: -2.6 } },
  { id: 'sb-boot', name: 'PA Boot', formation: 'singleback', type: 'pa', routes: { WR1: 'post', WR2: 'corner', TE1: 'flat', TE2: 'drag', RB: 'block' }, run: { carrier: 'RB', gap: 1.7 } },
  { id: 'sb-curlflat', name: 'Curl Flats', formation: 'singleback', type: 'pass', routes: { WR1: 'curl', WR2: 'curl', TE1: 'flat', TE2: 'flat', RB: 'block' } },
  { id: 'sb-cross', name: 'Deep Cross', formation: 'singleback', type: 'pass', routes: { WR1: 'in', WR2: 'post', TE1: 'drag', TE2: 'seam', RB: 'swing' } },
  // I-Form
  { id: 'i-iso', name: 'Iso', formation: 'iform', type: 'run', run: { carrier: 'RB', gap: -0.9, lead: true } },
  { id: 'i-toss', name: 'Toss Right', formation: 'iform', type: 'run', run: { carrier: 'RB', gap: 9, lead: true } },
  { id: 'i-dive', name: 'Dive Right', formation: 'iform', type: 'run', run: { carrier: 'RB', gap: 1.7, lead: true } },
  { id: 'i-padeep', name: 'PA Deep Shot', formation: 'iform', type: 'pa', routes: { WR1: 'go', WR2: 'post', TE1: 'corner', FB: 'flat', RB: 'block' }, run: { carrier: 'RB', gap: 0 } },
  { id: 'i-slants', name: 'Slant Flat', formation: 'iform', type: 'pass', routes: { WR1: 'slant', WR2: 'slant', TE1: 'drag', FB: 'flat', RB: 'block' } },
  // Empty
  { id: 'e-verts', name: 'Four Verts', formation: 'empty', type: 'pass', routes: { WR1: 'go', WR2: 'go', WR3: 'seam', WR4: 'seam', RB: 'curl' } },
  { id: 'e-quick', name: 'Quick Outs', formation: 'empty', type: 'pass', routes: { WR1: 'hitch', WR2: 'hitch', WR3: 'out', WR4: 'out', RB: 'slant' } },
  { id: 'e-spacing', name: 'Spacing', formation: 'empty', type: 'pass', routes: { WR1: 'curl', WR2: 'comeback', WR3: 'hitch', WR4: 'in', RB: 'drag' } },
  { id: 'e-qbdraw', name: 'QB Draw', formation: 'empty', type: 'run', run: { carrier: 'QB', gap: 0.8 } },
  // Pistol / option family
  { id: 'p-zone-read', name: 'Zone Read', formation: 'pistol', type: 'run', run: { carrier: 'QB', gap: 4.5 } },
  { id: 'p-split-zone', name: 'Split Zone', formation: 'pistol', type: 'run', run: { carrier: 'RB', gap: -2.2 } },
  { id: 'p-flood', name: 'PA Flood', formation: 'pistol', type: 'pa', routes: { WR1: 'deepout', WR2: 'go', WR3: 'out', TE1: 'flat', RB: 'block' }, run: { carrier: 'RB', gap: 2 } },
  { id: 'p-dagger', name: 'Dagger', formation: 'pistol', type: 'pass', routes: { WR1: 'dig', WR2: 'go', WR3: 'seam', TE1: 'drag', RB: 'block' } },
  // Trips and bunch concepts
  { id: 't-flood', name: 'Trips Flood', formation: 'trips', type: 'pass', routes: { WR1: 'deepout', WR2: 'corner', WR3: 'flat', TE1: 'drag', RB: 'block' } },
  { id: 't-cross', name: 'Y Cross', formation: 'trips', type: 'pass', routes: { WR1: 'go', WR2: 'dig', WR3: 'post', TE1: 'cross', RB: 'swing' } },
  { id: 't-bubble', name: 'Bubble RPO', formation: 'trips', type: 'pass', routes: { WR1: 'slant', WR2: 'block', WR3: 'flat', TE1: 'stick', RB: 'angle' } },
  { id: 'b-mesh', name: 'Bunch Mesh', formation: 'bunch', type: 'pass', routes: { WR1: 'drag', WR2: 'whip', WR3: 'corner', TE1: 'flat', RB: 'block' } },
  { id: 'b-spot', name: 'Spot', formation: 'bunch', type: 'pass', routes: { WR1: 'corner', WR2: 'stick', WR3: 'flat', TE1: 'curl', RB: 'swing' } },
  { id: 'b-sweep', name: 'Jet Sweep', formation: 'bunch', type: 'run', run: { carrier: 'RB', gap: 9.2 } },
  // Heavy / power family
  { id: 'h-counter', name: 'Counter', formation: 'heavy', type: 'run', run: { carrier: 'RB', gap: -4.5, lead: true } },
  { id: 'h-stretch', name: 'Strong Stretch', formation: 'heavy', type: 'run', run: { carrier: 'RB', gap: 5.5, lead: true } },
  { id: 'h-leak', name: 'TE Leak', formation: 'heavy', type: 'pa', routes: { WR1: 'go', TE1: 'block', TE2: 'corner', FB: 'flat', RB: 'block' }, run: { carrier: 'RB', gap: -1.5, lead: true } },
];

/** Special teams: never offered in the play tray, only from the 4th-down PUNT button. */
export const PUNT_PLAY: Play = { id: 'st-punt', name: 'Punt', formation: 'punt', type: 'punt' };

export function playsFor(formation: string) {
  return PLAYS.filter((p) => p.formation === formation);
}

const SCHEME_PLAY_IDS: Record<OffensiveScheme, string[]> = {
  westCoast: ['sg-slants', 'sg-mesh', 'sg-smash', 'sg-draw', 'sb-iz', 'sb-curlflat', 'sb-cross', 'e-quick', 'e-spacing', 'b-mesh', 'b-spot', 't-bubble', 'p-flood'],
  airRaid: ['sg-verts', 'sg-postwheel', 'sg-draw', 'e-verts', 'e-quick', 'e-spacing', 'e-qbdraw', 't-flood', 't-cross', 't-bubble', 'p-dagger', 'b-mesh'],
  powerRun: ['i-iso', 'i-toss', 'i-dive', 'i-padeep', 'sb-iz', 'sb-power', 'sb-boot', 'h-counter', 'h-stretch', 'h-leak', 'p-split-zone'],
  spreadOption: ['sg-draw', 'sg-stretch', 'e-qbdraw', 'p-zone-read', 'p-split-zone', 'p-flood', 'p-dagger', 't-flood', 't-bubble', 'b-sweep'],
  balanced: ['sg-slants', 'sg-verts', 'sg-draw', 'sb-iz', 'sb-boot', 'sb-cross', 'i-iso', 'i-slants', 'e-quick', 'p-flood', 't-cross', 'h-counter'],
};

/** A franchise only calls concepts that belong to its offensive identity. */
export function playsForScheme(scheme: OffensiveScheme): Play[] {
  const ids = new Set(SCHEME_PLAY_IDS[scheme]);
  return PLAYS.filter((play) => ids.has(play.id));
}

// ---------- Defense ----------

export type DefCallId = 'cover1' | 'cover2' | 'cover3' | 'cover0' | 'goalline';
export interface DefCall {
  id: DefCallId;
  name: string;
  man: boolean;
  press: boolean;
  blitz: number; // extra rushers beyond the front four
}

export const DEF_CALLS: Record<DefCallId, DefCall> = {
  cover1: { id: 'cover1', name: 'Cover 1 Man', man: true, press: true, blitz: 0 },
  cover2: { id: 'cover2', name: 'Cover 2', man: false, press: false, blitz: 0 },
  cover3: { id: 'cover3', name: 'Cover 3', man: false, press: false, blitz: 0 },
  cover0: { id: 'cover0', name: 'Cover 0 Blitz', man: true, press: true, blitz: 2 },
  goalline: { id: 'goalline', name: 'Goal Line', man: true, press: true, blitz: 1 },
};
