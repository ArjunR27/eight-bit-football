import { describe, expect, it } from 'vitest';
import { newLeague } from '../src/model/generate';
import { lineup } from '../src/model/depth';
import { FieldGoalKick, POWER_ZONES } from '../src/field/kick';

const league = newLeague(11, 0, { sound: false, quarterMinutes: 5, difficulty: 1 });
const kicker = lineup(league, league.teams[0]).k;

/** Advance the scene until the bar/pendulum reach the requested values, then tap. */
function kickAt(ballOn: number, power: number, aimCentered: boolean, seed = 1) {
  const k = new FieldGoalKick(ballOn, kicker, seed);
  while (Math.abs(k.meter() - power) > 0.02) k.update(1 / 240);
  k.tap();
  if (aimCentered) while (Math.abs(k.pendulum()) > 0.004) k.update(1 / 240);
  else while (k.pendulum() > -0.16) k.update(1 / 240);
  k.tap();
  while (!k.finished) k.update(1 / 60);
  return k;
}

describe('field goal kick', () => {
  it('measures distance from the line of scrimmage plus 17 yards', () => {
    expect(new FieldGoalKick(80, kicker, 1).distance).toBe(37);
  });

  it('green power and a centered aim make a medium field goal', () => {
    const k = kickAt(75, (POWER_ZONES.green + POWER_ZONES.over) / 2, true);
    expect(k.outcome).toBe('good');
  });

  it('a weak red-zone tap leaves a long kick short', () => {
    expect(kickAt(62, 0.3, true).outcome).toBe('short');
  });

  it('stopping the pendulum at the edge misses wide', () => {
    expect(kickAt(80, (POWER_ZONES.green + POWER_ZONES.over) / 2, false).outcome).toBe('wide left');
  });
});
