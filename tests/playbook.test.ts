import { describe, expect, it } from 'vitest';
import { schemeForTeam } from '../src/data/schemes';
import { TEAM_DEFS } from '../src/data/teams';
import { playsForScheme } from '../src/field/playbook';
import type { OffensiveScheme } from '../src/model/types';

const schemes: OffensiveScheme[] = ['westCoast', 'airRaid', 'powerRun', 'spreadOption', 'balanced'];

describe('team scheme playbooks', () => {
  it('gives every offensive identity a varied, usable playbook', () => {
    for (const scheme of schemes) {
      const plays = playsForScheme(scheme);
      expect(plays.length, scheme).toBeGreaterThanOrEqual(10);
      expect(new Set(plays.map(p => p.formation)).size, scheme).toBeGreaterThanOrEqual(3);
      expect(plays.some(p => p.type === 'run'), scheme).toBe(true);
      expect(plays.some(p => p.type !== 'run'), scheme).toBe(true);
    }
  });

  it('assigns stable but varied identities around the league', () => {
    expect(TEAM_DEFS).toHaveLength(32);
    expect(new Set(Array.from({ length: 32 }, (_, id) => schemeForTeam(id))).size).toBe(schemes.length);
    expect(schemeForTeam(0)).toBe(schemeForTeam(32));
  });
});
