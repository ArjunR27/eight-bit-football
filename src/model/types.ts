export const POSITIONS = [
  'QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT',
  'DE', 'DT', 'OLB', 'MLB', 'CB', 'FS', 'SS', 'K', 'P', 'LS',
] as const;
export type Pos = (typeof POSITIONS)[number];

export type AttrKey =
  | 'spd' | 'str' | 'awr' | 'dur'
  | 'thp' | 'acc' | 'dac' | 'pac' | 'agi'
  | 'car' | 'elu' | 'trk' | 'cth'
  | 'rte' | 'spc' | 'rel'
  | 'rbk' | 'pbk' | 'ibk'
  | 'prs' | 'bsh' | 'pur' | 'tak' | 'hit'
  | 'prc' | 'cov' | 'man' | 'zon' | 'pre'
  | 'kpw' | 'kac' | 'snp';

export type Attrs = Partial<Record<AttrKey, number>>;

export type OffensiveScheme = 'westCoast' | 'airRaid' | 'powerRun' | 'spreadOption' | 'balanced';

export type StatKey =
  | 'gp' | 'passAtt' | 'passCmp' | 'passYds' | 'passTd' | 'passInt' | 'sacked'
  | 'rushAtt' | 'rushYds' | 'rushTd'
  | 'rec' | 'recYds' | 'recTd'
  | 'tkl' | 'sack' | 'defInt'
  | 'fgm' | 'fga' | 'xpm' | 'xpa' | 'punts' | 'puntYds';

export type StatLine = Partial<Record<StatKey, number>>;

/** Development trait: how fast a player grows and how many ability slots he has. */
export type DevTrait = 'normal' | 'star' | 'superstar' | 'xfactor';

/** NFL-combine style measurables shown for draft prospects. */
export interface Combine {
  heightIn: number;
  weightLb: number;
  forty: number;
  bench: number;
  vertical: number;
  broad: number; // inches
  cone: number; // 3-cone drill seconds
  shuttle: number;
}

export interface DraftInfo {
  year: number;
  round: number;
  pick: number; // overall
  teamId: number;
}

export interface Player {
  id: number;
  first: string;
  last: string;
  pos: Pos;
  age: number;
  num: number;
  skin: number; // sprite skin tone index
  attrs: Attrs;
  ovr: number;
  pot: number; // growth ceiling (hidden in UI for now; dev traits come in a later phase)
  injury: number; // weeks out, 0 = healthy
  injuryType?: string;
  yearsPro: number;
  /** Current tier, always backed by rating (see DEV_FLOOR in dev.ts). */
  dev: DevTrait;
  /** Highest tier this player can grow into; also sets how fast he develops. Defaults to `dev`. */
  devPotential?: DevTrait;
  /** Rookie drafted as a hidden dev: the true trait is revealed after REVEAL_SNAPS career snaps. */
  devHidden?: boolean;
  abilities: string[]; // ability ids (star: 2 slots, superstar/x-factor: 4)
  xfactor?: string; // x-factor ability id (x-factor dev only)
  snaps: number; // career snaps
  wear: number; // season-long fatigue 0..100; lowers starting energy and raises injury risk
  xp: number; // in-season progression points toward the next rating upgrade
  combine?: Combine;
  draft?: DraftInfo;
  /** Transient in-game energy 0..100 (only set on the per-play copies handed to the sims). */
  energy?: number;
  /** Transient: in the X-Factor zone this play. */
  zone?: boolean;
  stats: StatLine; // current season
  career: { year: number; team: string; ovr: number; stats: StatLine }[];
}

export interface Team {
  id: number;
  city: string;
  name: string;
  abbr: string;
  primary: string;
  secondary: string;
  helmet: string;
  conf: 0 | 1;
  div: 0 | 1 | 2 | 3;
  scheme: OffensiveScheme;
  roster: number[]; // 53-man active roster (player ids)
  picks: DraftPick[]; // draft picks this team currently owns
  practice: number[]; // 16-man practice squad
  depth: Partial<Record<Pos, number[]>>;
}

export interface DraftPick {
  year: number;
  round: number; // 1..7
  orig: number; // team id whose slot this is
}

export interface ScheduledGame {
  home: number;
  away: number;
  hs?: number;
  as?: number;
  played: boolean;
}

export interface PlayoffState {
  // seeds[conf] = team ids ordered 1..7
  seeds: number[][];
  round: number; // 0 wildcard, 1 divisional, 2 conference, 3 final, 4 done
  games: ScheduledGame[][]; // per round
  champion?: number;
}

export type Difficulty = 0 | 1 | 2 | 3; // Rookie, Starter, All-Star, Legend
export const DIFFICULTY_NAMES = ['Rookie', 'Starter', 'All-Star', 'Legend'] as const;

export interface Settings {
  sound: boolean;
  quarterMinutes: number;
  difficulty: Difficulty;
  /** Visual offense direction; optional so existing local saves continue to load. */
  driveDirection?: 'right' | 'left';
}

export interface League {
  version: number;
  rngState: number;
  year: number;
  week: number; // index into schedule during regular season
  phase: 'regular' | 'playoffs' | 'offseason' | 'draft';
  userTeamId: number;
  /** Franchise owner/coach identity, stored with each save slot. */
  coachName?: string;
  teams: Team[];
  players: Record<number, Player>;
  nextPlayerId: number;
  schedule: ScheduledGame[][];
  playoffs?: PlayoffState;
  history: { year: number; champion: number; userRecord: string }[];
  settings: Settings;
  currentGame?: unknown; // serialized in-progress GameState
  draft?: DraftState;
  inbox: Notice[];
  hallOfFame: HallEntry[];
  /** Former user players (retired or traded away) eligible for the Hall of Fame. */
  alumni: HallEntry[];
  /** Screens the user still has to see: season rundown, draft, etc. */
  pendingRundown?: boolean;
  /** The user's current team needs, kept up to date as the roster changes. */
  needs?: { units: string[]; weak: string[]; strong: string[] };
}

export interface DraftSlot {
  round: number;
  pick: number; // overall 1..224
  orig: number;
  playerId?: number;
  teamId?: number; // who actually picked
}

export interface DraftState {
  year: number;
  order: DraftSlot[];
  current: number; // index into order
  prospects: number[]; // undrafted prospect ids
  /** Scouts' big-board rank per prospect id (projected round = rank / 32). */
  proj?: Record<number, number>;
}

export type NoticeKind = 'upgrade' | 'injury' | 'retire' | 'reveal' | 'trade' | 'draft' | 'zone' | 'league' | 'needs';
export interface Notice {
  id: number;
  year: number;
  week: number;
  kind: NoticeKind;
  text: string;
  playerId?: number;
  /** Game this notice belongs to (post-game report groups by it). */
  gameKey?: string;
}

export interface HallEntry {
  playerId: number;
  name: string;
  pos: Pos;
  peakOvr: number;
  dev: DevTrait;
  years: string; // e.g. "2026-2034"
  teams: string[];
  reason: 'retired' | 'traded';
  totals: StatLine;
  inductedYear?: number;
}

export const SAVE_VERSION = 4;
