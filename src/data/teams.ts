// 32 real NFL host cities with invented nicknames and hue-shifted palettes.
// Never use real team names, logos, or exact official colors.
export interface TeamDef {
  city: string;
  name: string;
  abbr: string;
  primary: string; // jersey
  secondary: string; // pants / trim
  helmet: string;
  conf: 0 | 1; // 0 = American Conference (AC), 1 = National Conference (NC)
  div: 0 | 1 | 2 | 3; // East, North, South, West
}

export const CONF_NAMES = ['AC', 'NC'] as const;
export const DIV_NAMES = ['East', 'North', 'South', 'West'] as const;

export const TEAM_DEFS: TeamDef[] = [
  // AC East
  { city: 'Buffalo', name: 'Blizzard', abbr: 'BUF', primary: '#1f3f8f', secondary: '#e8e4dc', helmet: '#e8e4dc', conf: 0, div: 0 },
  { city: 'Miami', name: 'Tides', abbr: 'MIA', primary: '#1c8f8a', secondary: '#f08a3c', helmet: '#f2efe6', conf: 0, div: 0 },
  { city: 'Boston', name: 'Colonials', abbr: 'BOS', primary: '#1d2a4d', secondary: '#b8bec6', helmet: '#b8bec6', conf: 0, div: 0 },
  { city: 'New York', name: 'Rockets', abbr: 'NYR', primary: '#2a6b3f', secondary: '#f2efe6', helmet: '#2a6b3f', conf: 0, div: 0 },
  // AC North
  { city: 'Baltimore', name: 'Crows', abbr: 'BAL', primary: '#3b2a6e', secondary: '#1a1a1a', helmet: '#1a1a1a', conf: 0, div: 1 },
  { city: 'Cincinnati', name: 'Stripes', abbr: 'CIN', primary: '#e0662a', secondary: '#1a1a1a', helmet: '#1a1a1a', conf: 0, div: 1 },
  { city: 'Cleveland', name: 'Hounds', abbr: 'CLE', primary: '#5a3a22', secondary: '#e8733a', helmet: '#e8733a', conf: 0, div: 1 },
  { city: 'Pittsburgh', name: 'Ironmen', abbr: 'PIT', primary: '#222222', secondary: '#d9a62e', helmet: '#d9a62e', conf: 0, div: 1 },
  // AC South
  { city: 'Houston', name: 'Wildcatters', abbr: 'HOU', primary: '#1b2c4f', secondary: '#b83a3a', helmet: '#b83a3a', conf: 0, div: 2 },
  { city: 'Indianapolis', name: 'Racers', abbr: 'IND', primary: '#2957a8', secondary: '#f2efe6', helmet: '#f2efe6', conf: 0, div: 2 },
  { city: 'Jacksonville', name: 'Surge', abbr: 'JAX', primary: '#17737a', secondary: '#c9a24a', helmet: '#1a1a1a', conf: 0, div: 2 },
  { city: 'Nashville', name: 'Sentinels', abbr: 'NSH', primary: '#223a64', secondary: '#6fa8d8', helmet: '#6fa8d8', conf: 0, div: 2 },
  // AC West
  { city: 'Denver', name: 'Peaks', abbr: 'DEN', primary: '#e56a2c', secondary: '#1e2b4a', helmet: '#1e2b4a', conf: 0, div: 3 },
  { city: 'Kansas City', name: 'Marshals', abbr: 'KC', primary: '#c22b2b', secondary: '#e8b640', helmet: '#c22b2b', conf: 0, div: 3 },
  { city: 'Las Vegas', name: 'Bandits', abbr: 'LV', primary: '#2a2a2a', secondary: '#9aa1a8', helmet: '#9aa1a8', conf: 0, div: 3 },
  { city: 'Los Angeles', name: 'Voltage', abbr: 'LAV', primary: '#4a9ad4', secondary: '#f0c23a', helmet: '#f2efe6', conf: 0, div: 3 },
  // NC East
  { city: 'Dallas', name: 'Mustangs', abbr: 'DAL', primary: '#1c2f5a', secondary: '#a9b1bb', helmet: '#a9b1bb', conf: 1, div: 0 },
  { city: 'New York', name: 'Empire', abbr: 'NYE', primary: '#233d8c', secondary: '#c23434', helmet: '#233d8c', conf: 1, div: 0 },
  { city: 'Philadelphia', name: 'Liberty', abbr: 'PHI', primary: '#1d4d4a', secondary: '#a7acb0', helmet: '#1d4d4a', conf: 1, div: 0 },
  { city: 'Washington', name: 'Admirals', abbr: 'WAS', primary: '#6a1f2a', secondary: '#e0b33e', helmet: '#6a1f2a', conf: 1, div: 0 },
  // NC North
  { city: 'Chicago', name: 'Wind', abbr: 'CHI', primary: '#1a2340', secondary: '#e2682e', helmet: '#1a2340', conf: 1, div: 1 },
  { city: 'Detroit', name: 'Motors', abbr: 'DET', primary: '#2f7fbf', secondary: '#b9c0c6', helmet: '#b9c0c6', conf: 1, div: 1 },
  { city: 'Green Bay', name: 'Ice', abbr: 'GB', primary: '#284a3a', secondary: '#e6c04a', helmet: '#e6c04a', conf: 1, div: 1 },
  { city: 'Minneapolis', name: 'Norsemen', abbr: 'MIN', primary: '#4b2a78', secondary: '#e8be3c', helmet: '#4b2a78', conf: 1, div: 1 },
  // NC South
  { city: 'Atlanta', name: 'Firebirds', abbr: 'ATL', primary: '#b3262e', secondary: '#1a1a1a', helmet: '#1a1a1a', conf: 1, div: 2 },
  { city: 'Charlotte', name: 'Cougars', abbr: 'CLT', primary: '#1b1b1b', secondary: '#2c8fd0', helmet: '#1b1b1b', conf: 1, div: 2 },
  { city: 'New Orleans', name: 'Krewe', abbr: 'NO', primary: '#1a1a1a', secondary: '#c7ad76', helmet: '#c7ad76', conf: 1, div: 2 },
  { city: 'Tampa Bay', name: 'Cannons', abbr: 'TB', primary: '#a8252c', secondary: '#4f4a45', helmet: '#4f4a45', conf: 1, div: 2 },
  // NC West
  { city: 'Phoenix', name: 'Scorpions', abbr: 'PHX', primary: '#9e2138', secondary: '#f2efe6', helmet: '#f2efe6', conf: 1, div: 3 },
  { city: 'Los Angeles', name: 'Stags', abbr: 'LAS', primary: '#1f3f9a', secondary: '#f1cf3a', helmet: '#1f3f9a', conf: 1, div: 3 },
  { city: 'San Francisco', name: 'Miners', abbr: 'SF', primary: '#a8201f', secondary: '#bf9a58', helmet: '#bf9a58', conf: 1, div: 3 },
  { city: 'Seattle', name: 'Orcas', abbr: 'SEA', primary: '#15264a', secondary: '#6fbf3e', helmet: '#15264a', conf: 1, div: 3 },
];
