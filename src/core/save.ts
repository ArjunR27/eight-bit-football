import { SAVE_VERSION, type League } from '../model/types';
import { schemeForTeam } from '../data/schemes';
import { Rng } from './rng';
import { assignAbilities, earnedDev, initDev } from '../model/dev';
import { picksFor } from '../model/generate';

const LIBRARY_KEY = 'retro-rush-save-library-v2';
const ACTIVE_KEY = 'retro-rush-active-save-v2';
const LEGACY_KEY = 'retro-rush-save-v1';
export const MAX_SAVES = 3;

export interface SaveSummary {
  id: string;
  coachName: string;
  teamId: number;
  year: number;
  week: number;
  updatedAt: number;
}

interface SaveFile extends SaveSummary { league: League; createdAt: number; }

const MIGRATIONS: Record<number, (l: League) => League> = {
  1: (league) => {
    for (const team of league.teams) team.scheme ??= schemeForTeam(team.id);
    return league;
  },
  // v3: dev traits, abilities, stamina, draft picks, news inbox, Hall of Fame.
  2: (league) => {
    const rng = new Rng(league.rngState ^ 0x5eed);
    for (const p of Object.values(league.players)) {
      p.abilities ??= [];
      if (!p.dev) initDev(p, rng);
      p.snaps ??= p.yearsPro * 700;
      p.wear ??= 0;
      p.xp ??= 0;
      assignAbilities(p, rng);
    }
    for (const team of league.teams) {
      team.picks ??= [];
      if (!team.picks.length) for (let y = league.year + 1; y <= league.year + 2; y++) team.picks.push(...picksFor(y, team.id));
    }
    league.inbox ??= [];
    league.hallOfFame ??= [];
    league.alumni ??= [];
    return league;
  },
  // v4: dev tiers become a rating hierarchy; the old trait becomes the player's potential.
  3: (league) => {
    const rng = new Rng(league.rngState ^ 0xde7);
    for (const p of Object.values(league.players)) {
      p.devPotential ??= p.dev;
      p.dev = earnedDev(p);
      assignAbilities(p, rng);
    }
    return league;
  },
};

function migrate(league: League): League | null {
  while (league.version < SAVE_VERSION) {
    const migration = MIGRATIONS[league.version];
    if (!migration) return null;
    league = migration(league);
    league.version++;
  }
  league.coachName ??= 'Coach Riley Morgan';
  return league;
}

function writeLibrary(files: SaveFile[]) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(files));
}

function readLibrary(): SaveFile[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) return JSON.parse(raw) as SaveFile[];
    // Preserve an existing single-save franchise as the first slot.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return [];
    const league = migrate(JSON.parse(legacy) as League);
    if (!league) return [];
    const now = Date.now();
    const file: SaveFile = { id: `save-${now}`, coachName: league.coachName!, teamId: league.userTeamId, year: league.year, week: league.week, updatedAt: now, createdAt: now, league };
    writeLibrary([file]);
    localStorage.setItem(ACTIVE_KEY, file.id);
    return [file];
  } catch (error) {
    console.warn('Save library read failed', error);
    return [];
  }
}

export function listSaves(): SaveSummary[] {
  return readLibrary().map(({ league: _league, createdAt: _createdAt, ...summary }) => summary).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createSave(league: League, coachName: string): SaveSummary | null {
  try {
    const files = readLibrary();
    if (files.length >= MAX_SAVES) return null;
    const now = Date.now(), id = `save-${now}-${Math.floor(Math.random() * 1e6)}`;
    league.coachName = coachName.trim().slice(0, 24) || 'Coach Riley Morgan';
    const file: SaveFile = { id, coachName: league.coachName, teamId: league.userTeamId, year: league.year, week: league.week, updatedAt: now, createdAt: now, league };
    writeLibrary([...files, file]);
    localStorage.setItem(ACTIVE_KEY, id);
    return { id, coachName: file.coachName, teamId: file.teamId, year: file.year, week: file.week, updatedAt: now };
  } catch (error) {
    console.warn('Save creation failed', error);
    return null;
  }
}

export function loadSave(id: string): League | null {
  try {
    const file = readLibrary().find(save => save.id === id);
    if (!file) return null;
    const league = migrate(file.league);
    if (!league) return null;
    localStorage.setItem(ACTIVE_KEY, id);
    return league;
  } catch (error) {
    console.warn('Save load failed', error);
    return null;
  }
}

export function saveLeague(league: League) {
  try {
    const files = readLibrary();
    const id = localStorage.getItem(ACTIVE_KEY);
    const index = files.findIndex(file => file.id === id);
    if (index < 0) { createSave(league, league.coachName ?? 'Coach Riley Morgan'); return; }
    const now = Date.now(), old = files[index];
    files[index] = { ...old, coachName: league.coachName ?? old.coachName, teamId: league.userTeamId, year: league.year, week: league.week, updatedAt: now, league };
    writeLibrary(files);
  } catch (error) {
    console.warn('Save failed', error);
  }
}

export function loadLeague(): League | null {
  const files = readLibrary();
  const active = localStorage.getItem(ACTIVE_KEY);
  const chosen = active ? files.find(file => file.id === active) : files[0];
  return chosen ? loadSave(chosen.id) : null;
}

export function deleteSave(id?: string) {
  try {
    const active = id ?? localStorage.getItem(ACTIVE_KEY);
    const files = readLibrary().filter(file => file.id !== active);
    writeLibrary(files);
    if (active === localStorage.getItem(ACTIVE_KEY)) localStorage.removeItem(ACTIVE_KEY);
  } catch (error) {
    console.warn('Save deletion failed', error);
  }
}
