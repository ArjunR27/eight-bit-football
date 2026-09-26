import type { OffensiveScheme } from '../model/types';

export const SCHEME_LABELS: Record<OffensiveScheme, string> = {
  westCoast: 'West Coast',
  airRaid: 'Air Raid',
  powerRun: 'Power Run',
  spreadOption: 'Spread Option',
  balanced: 'Balanced',
};

// A stable team identity makes playbooks consistent across saves and seasons.
// The sequence intentionally mixes every identity through the league.
const TEAM_SCHEMES: OffensiveScheme[] = [
  'airRaid', 'westCoast', 'powerRun', 'spreadOption',
  'balanced', 'powerRun', 'westCoast', 'balanced',
  'spreadOption', 'airRaid', 'westCoast', 'powerRun',
  'balanced', 'airRaid', 'powerRun', 'spreadOption',
  'balanced', 'airRaid', 'westCoast', 'powerRun',
  'powerRun', 'spreadOption', 'balanced', 'westCoast',
  'airRaid', 'powerRun', 'westCoast', 'balanced',
  'spreadOption', 'airRaid', 'westCoast', 'powerRun',
];

export function schemeForTeam(teamId: number): OffensiveScheme {
  return TEAM_SCHEMES[teamId % TEAM_SCHEMES.length];
}
