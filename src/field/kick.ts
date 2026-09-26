import { Rng, clamp } from '../core/rng';
import type { Player } from '../model/types';
import { badSnapChance, has } from '../model/dev';

// User-kicked field goal: tap once to lock a sliding power bar, tap again to lock a
// swinging pendulum aimer, then the ball flies at the posts. Pure logic, no DOM.

/** Power bar zones, as fractions of the bar (bottom → top). */
export const POWER_ZONES = { yellow: 0.58, green: 0.8, over: 0.92 };
export const POST_HALF_WIDTH = 3.08; // yards (18'6" between the uprights)
export const CROSSBAR = 3.33; // yards (10 ft)
const POWER_PERIOD = 1.3;
const AIM_PERIOD = 1.7;
const AIM_SWING = 0.17; // radians either side of dead center
const FLIGHT = 1.6;

export type KickOutcome = 'good' | 'wide left' | 'wide right' | 'short';

export class FieldGoalKick {
  stage: 'power' | 'aim' | 'flight' | 'done' = 'power';
  t = 0;
  flightT = 0;
  power = 0; // locked bar position 0..1
  aim = 0; // locked angle, radians (negative = left)
  lateral = 0; // where the ball crosses the goal plane, yards from center
  carry = 0; // yards the kick can travel
  outcome: KickOutcome | null = null;
  readonly distance: number;
  /** The long snap was off: the hold is late and the kick loses range and accuracy. */
  readonly badSnap: boolean;
  private rng: Rng;

  /** `ballOn` is the line of scrimmage in offense yards; the kick is from 7 yards back to posts 10 yards deep. */
  constructor(ballOn: number, readonly kicker: Player, seed: number, snapper?: Player) {
    this.distance = Math.round(100 - ballOn + 17);
    this.rng = new Rng(seed);
    this.badSnap = this.rng.chance(badSnapChance(snapper));
  }

  /** Current bar position: slides bottom → top → bottom. */
  meter() {
    if (this.stage !== 'power') return this.power;
    const k = (this.t / POWER_PERIOD) % 1;
    return k < 0.5 ? k * 2 : 2 - k * 2;
  }

  /** Current aim angle: a pendulum swinging across the uprights. */
  pendulum() {
    if (this.stage === 'flight' || this.stage === 'done') return this.aim;
    return Math.sin((this.t / AIM_PERIOD) * Math.PI * 2) * AIM_SWING;
  }

  maxRange() {
    return 44 + (this.kicker.attrs.kpw ?? 60) * 0.22 + (has(this.kicker, 'bigleg') ? 4 : 0) - (this.badSnap ? 5 : 0);
  }

  /** Max distance only in the green window; a late tap over-kicks and hooks. */
  static powerFactor(m: number) {
    if (m >= POWER_ZONES.over) return 0.88;
    if (m >= POWER_ZONES.green) return 1;
    return 0.4 + (m / POWER_ZONES.green) * 0.55;
  }

  tap() {
    if (this.stage === 'power') {
      this.power = this.meter();
      this.stage = 'aim';
    } else if (this.stage === 'aim') {
      this.aim = this.pendulum();
      this.kick();
    }
  }

  private kick() {
    const acc = this.kicker.attrs.kac ?? 60;
    const hook = this.power >= POWER_ZONES.over ? this.rng.range(-2.5, 2.5) : 0;
    const noise = this.rng.normal(0, ((100 - acc) / 100) * 0.9 * (this.distance / 40) * (has(this.kicker, 'iceveins') ? 0.5 : 1) + (this.badSnap ? 1.4 : 0));
    this.carry = this.maxRange() * FieldGoalKick.powerFactor(this.power);
    this.lateral = this.distance * Math.tan(this.aim) + noise + hook;
    this.outcome = this.carry < this.distance + 1 ? 'short'
      : Math.abs(this.lateral) <= POST_HALF_WIDTH ? 'good'
      : this.lateral < 0 ? 'wide left' : 'wide right';
    this.stage = 'flight';
    this.flightT = 0;
  }

  get good() {
    return this.outcome === 'good';
  }

  /** Ball position in kick space: u lateral (yards), d downfield from the tee, z height. */
  ballAt() {
    if (this.stage === 'power' || this.stage === 'aim') return { u: 0, d: 0, z: 0.3 };
    const reach = Math.min(this.carry, this.distance + 8);
    const s = clamp(this.flightT / FLIGHT, 0, 1);
    const d = s * reach;
    // A made kick is drawn with an arc that visibly clears the crossbar.
    const arc = this.good ? Math.max(this.carry, this.distance * 1.4) : this.carry;
    const peak = Math.max(4.5, this.carry * 0.22);
    const z = Math.max(0.3, 4 * peak * (d / arc) * (1 - d / arc) + 0.3);
    return { u: (this.lateral * d) / this.distance, d, z };
  }

  update(dt: number) {
    this.t += dt;
    if (this.stage === 'flight') {
      this.flightT += dt;
      if (this.flightT >= FLIGHT + 1.1) this.stage = 'done';
    }
  }

  /** The kick has landed and its banner has had time to read. */
  get finished() {
    return this.stage === 'done';
  }

  get landed() {
    return this.stage === 'done' || (this.stage === 'flight' && this.flightT >= FLIGHT);
  }
}
