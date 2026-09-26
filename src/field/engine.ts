import { Rng, clamp } from '../core/rng';
import type { Lineup } from '../model/depth';
import type { AttrKey, Player } from '../model/types';
import { FIELD_W, type PlayResult, type StatDelta } from '../sim/gameState';
import { badSnapChance, has } from '../model/dev';
import { ELIGIBLE, FORMATIONS, ROUTES, type DefCall, type Play, type Role, type RouteName } from './playbook';

// Real-time on-field play simulation. Coordinates are in yards from the offense's own goal line
// (x, offense moves +x) and from the top sideline (y). Pure logic, no DOM — also runs headless in tests.

export const DT = 1 / 60;
const HIST = 64;

export type Job =
  | 'qb' | 'route' | 'target' | 'passblock' | 'runblock' | 'lead' | 'fake' | 'carrier' | 'idle'
  | 'rush' | 'man' | 'zone' | 'pursue' | 'cover' | 'returner';

export interface Zone {
  x: number;
  y: number;
  r: number;
  deep: boolean;
}

export interface FP {
  p: Player;
  side: 0 | 1; // 0 offense, 1 defense
  role: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  maxSpd: number;
  accel: number;
  job: Job;
  routeName: RouteName | null;
  route: { x: number; y: number }[];
  ri: number;
  settle: boolean;
  dirX: number;
  dirY: number;
  man: FP | null;
  zone: Zone | null;
  engaged: FP | null;
  blockTarget: FP | null;
  shed: number;
  stun: number;
  tackleCd: number;
  release: number;
  react: number;
  bite: number;
  juke: number;
  jukeDir: number;
  jukeCd: number; // cooldown before the next juke
  stiff: number;
  dive: number;
  /** Defender committed to a diving tackle (seconds left in the lunge). */
  lunge: number;
  /** On the turf after a whiffed dive or broken tackle. */
  sprawl: number;
  down: boolean;
  anim: number;
  hx: Float32Array;
  hy: Float32Array;
  homeY: number;
}

export type EngineEventType =
  | 'snap' | 'throw' | 'catch' | 'drop' | 'int' | 'tackle' | 'sack' | 'td' | 'juke' | 'broken'
  | 'oob' | 'pancake' | 'handoff' | 'stiff' | 'dive' | 'breakup' | 'fumble' | 'juked' | 'badsnap';
export interface EngineEvent {
  type: EngineEventType;
  x: number;
  y: number;
}

export interface EngineOpts {
  los: number;
  ballY: number;
  toGo: number;
  off: Lineup;
  def: Lineup;
  play: Play;
  hot?: Partial<Record<Role, RouteName>>;
  defCall: DefCall;
  difficulty: number; // 0..3
  seed: number;
}

interface AirBall {
  x0: number; y0: number; x1: number; y1: number;
  T: number; t: number; h: number;
  target: FP | null;
}

const at = (p: Player, k: AttrKey, d = 50) => p.attrs[k] ?? d;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Distance from point (px, py) to the segment (ax, ay)-(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
  const t = len2 ? clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}
const short = (p: Player) => `${p.first[0]}. ${p.last}`;

const DIFF = {
  react: [1.5, 1.15, 0.95, 0.78],
  shed: [0.65, 0.9, 1.1, 1.3],
  tackle: [-0.12, -0.04, 0.03, 0.08],
  contest: [-12, -4, 2, 7],
  speed: [0.94, 0.98, 1, 1.02],
};

export class PlayEngine {
  readonly o: EngineOpts;
  rng: Rng;
  all: FP[] = [];
  off: FP[] = [];
  def: FP[] = [];
  qb!: FP;
  phase: 'pre' | 'live' | 'dead' = 'pre';
  t = 0;
  deadT = 0;
  los: number;
  ballY: number;
  hot: Partial<Record<Role, RouteName>>;
  ball = { x: 0, y: 0, z: 0, holder: null as FP | null, air: null as AirBall | null, loose: false };
  carrier: FP | null = null;
  carrierSince = 0;
  controlled: FP | null = null;
  thrown = false;
  throwT = 0;
  handedOff = false;
  crossedLos = false;
  intReturn = false;
  result: PlayResult | null = null;
  events: EngineEvent[] = [];
  input = { active: false, x: 0, y: 0 };
  /**
   * Virtual joystick for the ball carrier, in field space (x toward the end zone, y toward
   * the bottom sideline); length 0..1 = how hard it's pushed. null = stick released.
   */
  stick: { x: number; y: number } | null = null;
  /** Once the user has steered, releasing the stick means "run straight", not "go back to the hole". */
  private userSteered = false;
  returner: FP | null = null;
  puntStage: 'snap' | 'hold' | 'air' | 'return' | null = null;
  /** The long snap on this punt sailed: the punter has to go get it (late, shorter kick). */
  badSnap = false;
  stats: StatDelta[] = [];
  private catcher: FP | null = null;
  private catchX = 0;
  /** Yards the current ball carrier has run with the ball (drives long-run fatigue). */
  private carrierRun = 0;
  private meshT: number;
  private runAim: { x: number; y: number } | null = null;
  private diff: number;

  constructor(o: EngineOpts) {
    this.o = o;
    this.rng = new Rng(o.seed);
    this.los = o.los;
    this.ballY = clamp(o.ballY, 23.6, FIELD_W - 23.6);
    this.hot = { ...(o.hot ?? {}) };
    this.diff = o.difficulty;
    const f = FORMATIONS[o.play.formation];
    this.meshT = (f.spots.QB?.[0] ?? -2) < -3 ? 0.45 : 0.6;
    if (o.play.type === 'punt') {
      this.buildPunt();
    } else {
      this.buildOffense();
      this.buildDefense();
    }
    this.ball.x = this.los;
    this.ball.y = this.ballY;
  }

  // ---------- setup ----------

  private makeFP(p: Player, side: 0 | 1, role: string, x: number, y: number): FP {
    const spd = at(p, 'spd') * (side === 1 ? DIFF.speed[this.diff] : 1);
    const maxSpd = 4.2 + spd * 0.055;
    const agi = at(p, 'agi', 60);
    const fp: FP = {
      p, side, role, x, y: clamp(y, 1, FIELD_W - 1), vx: 0, vy: 0,
      maxSpd,
      accel: maxSpd / (1.15 - agi * 0.004),
      job: 'idle', routeName: null, route: [], ri: 0, settle: false, dirX: 1, dirY: 0,
      man: null, zone: null, engaged: null, blockTarget: null,
      shed: 0, stun: 0, tackleCd: 0, release: 0, react: 0.25, bite: 0,
      juke: 0, jukeDir: 0, jukeCd: 0, stiff: 0, dive: 0, lunge: 0, sprawl: 0, down: false, anim: this.rng.next() * 10,
      hx: new Float32Array(HIST), hy: new Float32Array(HIST), homeY: 0,
    };
    fp.homeY = fp.y;
    fp.hx.fill(fp.x);
    fp.hy.fill(fp.y);
    this.all.push(fp);
    (side === 0 ? this.off : this.def).push(fp);
    return fp;
  }

  private rolePlayer(role: Role): Player | undefined {
    const o = this.o.off;
    const map: Record<Role, Player | undefined> = {
      QB: o.qb, RB: o.rb[0], FB: o.fb, WR1: o.wr[0], WR2: o.wr[1], WR3: o.wr[2], WR4: o.wr[3],
      TE1: o.te[0], TE2: o.te[1], LT: o.ol[0], LG: o.ol[1], C: o.ol[2], RG: o.ol[3], RT: o.ol[4],
    };
    return map[role];
  }

  private buildOffense() {
    const f = FORMATIONS[this.o.play.formation];
    for (const [role, spot] of Object.entries(f.spots) as [Role, [number, number]][]) {
      const p = this.rolePlayer(role);
      if (!p) continue;
      const fp = this.makeFP(p, 0, role, this.los + spot[0], this.ballY + spot[1]);
      if (role === 'QB') this.qb = fp;
    }
    for (const fp of this.off) this.assignOffJob(fp);
  }

  routeFor(role: string): RouteName | null {
    const r = role as Role;
    if (!ELIGIBLE.includes(r)) return null;
    const play = this.o.play;
    if (this.hot[r]) return this.hot[r]!;
    if (play.type === 'run') return null;
    return play.routes?.[r] ?? 'block';
  }

  private assignOffJob(fp: FP) {
    const play = this.o.play;
    fp.route = [];
    fp.ri = 0;
    fp.routeName = null;
    if (fp.role === 'QB') {
      fp.job = 'qb';
      return;
    }
    if (!ELIGIBLE.includes(fp.role as Role)) {
      fp.job = play.type === 'run' ? 'runblock' : 'passblock';
      return;
    }
    if (play.type === 'run' && fp.role === play.run?.carrier && !this.hot[fp.role as Role]) {
      fp.job = 'idle';
      return;
    }
    if (play.type === 'run' && fp.role === 'FB' && play.run?.lead && !this.hot.FB) {
      fp.job = 'lead';
      return;
    }
    const rn = this.routeFor(fp.role);
    if (!rn) {
      fp.job = 'runblock';
      return;
    }
    fp.routeName = rn;
    if (rn === 'block') {
      fp.job = play.type === 'pa' && fp.role === play.run?.carrier ? 'fake' : 'passblock';
      return;
    }
    fp.job = 'route';
    const def = ROUTES[rn];
    const out = fp.y < this.ballY - 0.1 ? -1 : 1;
    let px = fp.x;
    let py = fp.y;
    for (const [dx, dOut] of def.pts) {
      const pt = { x: fp.x + dx, y: clamp(fp.y + dOut * out, 1.2, FIELD_W - 1.2) };
      fp.route.push(pt);
      fp.dirX = pt.x - px;
      fp.dirY = pt.y - py;
      px = pt.x;
      py = pt.y;
    }
    const m = Math.hypot(fp.dirX, fp.dirY) || 1;
    fp.dirX /= m;
    fp.dirY /= m;
    fp.settle = !!def.settle;
  }

  /** Pre-snap hot route: cycle or set a receiver's route. */
  setHot(fp: FP, route: RouteName) {
    this.hot[fp.role as Role] = route;
    if (this.o.play.type === 'run') {
      // Hot-routing on a run play turns that player into a decoy route runner.
      fp.job = 'route';
    }
    this.assignOffJob(fp);
  }

  private buildDefense() {
    const d = this.o.def;
    const call = this.o.defCall;
    const los = this.los;
    const by = this.ballY;
    const wrCount = this.off.filter((f) => f.role.startsWith('WR')).length;
    const nickel = wrCount >= 3;
    const DE1 = this.makeFP(d.de[0], 1, 'DE', los + 1, by - 4.8);
    const DT1 = this.makeFP(d.dt[0], 1, 'DT', los + 1, by - 1.3);
    const DT2 = this.makeFP(d.dt[1], 1, 'DT', los + 1, by + 1.3);
    const DE2 = this.makeFP(d.de[1], 1, 'DE', los + 1, by + 4.8);
    for (const f of [DE1, DT1, DT2, DE2]) f.job = 'rush';
    const lbs: FP[] = [this.makeFP(d.olb[0], 1, 'OLB', los + 4.5, by - 4.5), this.makeFP(d.mlb[0], 1, 'MLB', los + 5, by)];
    const cbs: FP[] = [this.makeFP(d.cb[0], 1, 'CB', los + 6, by - 18), this.makeFP(d.cb[1], 1, 'CB', los + 6, by + 18)];
    if (nickel) cbs.push(this.makeFP(d.cb[2], 1, 'CB', los + 5, by + 10));
    else lbs.push(this.makeFP(d.olb[1], 1, 'OLB', los + 4.5, by + 4.5));
    const FS = this.makeFP(d.fs, 1, 'FS', los + 13, by - 7);
    const SS = this.makeFP(d.ss, 1, 'SS', los + 12, by + 7);

    const reactMult = DIFF.react[this.diff];
    for (const f of this.def) {
      const read = f.role === 'CB' || f.role === 'FS' || f.role === 'SS' ? (at(f.p, 'man') + at(f.p, 'zon')) / 2 : at(f.p, 'prc', 60);
      f.react = clamp((0.42 - (read + at(f.p, 'awr')) * 0.0013) * reactMult, 0.06, 0.6);
    }

    const eligibles = this.off.filter((f) => ELIGIBLE.includes(f.role as Role));
    const goalLine = los >= 95;
    const zoneX = (dx: number) => Math.min(los + dx, 109);

    if (call.man) {
      // Assign each eligible a defender: outside WRs get CBs, slots nickel/safety, TE safety/LB, backs LBs.
      const free = new Set<FP>([...cbs, ...lbs, SS, ...(call.blitz >= 2 || goalLine ? [FS] : [])]);
      const takeNearest = (r: FP, pool: FP[]) => {
        let best: FP | null = null;
        for (const c of pool) if (free.has(c) && (!best || Math.abs(c.y - r.y) < Math.abs(best.y - r.y))) best = c;
        if (best) free.delete(best);
        return best;
      };
      const order = [...eligibles].sort((a, b) => Math.abs(b.y - by) - Math.abs(a.y - by));
      for (const r of order) {
        const isBack = r.role === 'RB' || r.role === 'FB';
        const isTE = r.role.startsWith('TE');
        const pool = isBack ? [...lbs, SS] : isTE ? [SS, ...lbs] : [...cbs, SS, FS, ...lbs];
        const dfd = takeNearest(r, pool);
        if (!dfd) continue;
        dfd.job = 'man';
        dfd.man = r;
        const press = call.press && dfd.role === 'CB';
        dfd.x = press ? los + 1.3 : Math.max(r.x + (isBack ? 5 : 6), los + 3);
        dfd.y = clamp(r.y + (r.y < by ? 1 : -1) * 0.8, 1, FIELD_W - 1);
        if (press && (r.role.startsWith('WR') || r.role.startsWith('TE'))) {
          r.release = clamp(0.3 + (at(dfd.p, 'pre') - at(r.p, 'rel', 60)) * 0.012 + this.rng.range(-0.1, 0.15), 0.05, 0.9);
        }
      }
      let blitzLeft = call.blitz;
      for (const f of free) {
        if (f === FS && call.blitz < 2 && !goalLine) continue;
        if (blitzLeft > 0 && f !== FS) {
          f.job = 'rush';
          f.x = los + 2;
          blitzLeft--;
        } else {
          f.job = 'zone';
          f.zone = { x: zoneX(7), y: by, r: 7, deep: false };
        }
      }
      if (call.blitz < 2 && !goalLine) {
        FS.job = 'zone';
        FS.zone = { x: zoneX(17), y: by, r: 12, deep: true };
        FS.x = zoneX(14);
        FS.y = by;
      }
    } else {
      const top = cbs[0];
      const bot = cbs[1];
      const hookB = nickel ? cbs[2] : lbs[2];
      const set = (f: FP, dx: number, dy: number, r: number, deep: boolean) => {
        f.job = 'zone';
        f.zone = { x: zoneX(dx), y: clamp(by + dy, 2, FIELD_W - 2), r, deep };
      };
      if (call.id === 'cover2') {
        set(top, 4, -17, 7, false);
        set(bot, 4, 17, 7, false);
        set(FS, 16, -10, 13, true);
        set(SS, 16, 10, 13, true);
        set(lbs[0], 9, -8, 6, false);
        set(lbs[1], 11, 0, 7, false);
        set(hookB, 9, 8, 6, false);
      } else {
        set(top, 16, -17, 9, true);
        set(bot, 16, 17, 9, true);
        set(FS, 18, 0, 10, true);
        set(SS, 6, 13, 7, false);
        set(lbs[0], 6, -13, 7, false);
        set(lbs[1], 8, 0, 6, false);
        set(hookB, 8, 6, 6, false);
        SS.x = los + 7;
        SS.y = by + 10;
      }
      for (const f of this.def) if (f.job === 'zone' && f.zone!.deep) f.x = Math.min(f.zone!.x - 3, f.x);
    }
  }

  /** Punt unit vs. punt return. The punter stands in as `qb` so pocket/rush logic protects him. */
  private buildPunt() {
    const o = this.o.off;
    const d = this.o.def;
    const los = this.los;
    const by = this.ballY;
    const block = (fp: FP) => (fp.job = 'passblock');
    o.ol.forEach((p, i) => block(this.makeFP(p, 0, ['LT', 'LG', 'C', 'RG', 'RT'][i], los - 0.9, by + (i - 2) * 1.7)));
    block(this.makeFP(o.te[0], 0, 'TE1', los - 1.6, by - 5.2));
    block(this.makeFP(o.te[1] ?? o.wr[2], 0, 'TE2', los - 1.6, by + 5.2));
    block(this.makeFP(o.fb, 0, 'FB', los - 5, by));
    const gunners = [this.makeFP(o.wr[0], 0, 'WR1', los - 0.5, 4), this.makeFP(o.wr[1], 0, 'WR2', los - 0.5, FIELD_W - 4)];
    for (const g of gunners) g.job = 'cover';
    this.qb = this.makeFP(o.p, 0, 'P', los - 13, by);
    this.qb.job = 'idle';

    [d.de[0], d.dt[0], d.dt[1], d.de[1]].forEach((p, i) => (this.makeFP(p, 1, i % 3 ? 'DT' : 'DE', los + 1, by + [-4.8, -1.3, 1.3, 4.8][i]).job = 'rush'));
    gunners.forEach((g, i) => {
      const jam = this.makeFP(d.cb[i], 1, 'CB', los + 1.2, g.y);
      jam.job = 'man';
      jam.man = g;
      g.release = clamp(0.25 + (at(jam.p, 'pre') - at(g.p, 'rel', 60)) * 0.01, 0.05, 0.7);
    });
    const hold = (fp: FP, dx: number, dy: number) => {
      fp.job = 'zone';
      fp.zone = { x: los + dx, y: clamp(by + dy, 4, FIELD_W - 4), r: 6, deep: false };
    };
    hold(this.makeFP(d.olb[0], 1, 'OLB', los + 5, by - 5), 6, -5);
    hold(this.makeFP(d.mlb[0], 1, 'MLB', los + 5, by + 5), 6, 5);
    hold(this.makeFP(d.fs, 1, 'FS', los + 18, by - 8), 18, -8);
    hold(this.makeFP(d.ss, 1, 'SS', los + 18, by + 8), 18, 8);
    this.returner = this.makeFP(d.rb[1] ?? d.rb[0] ?? d.cb[2], 1, 'KR', Math.min(los + 42, 104), by);
    this.returner.job = 'returner';
  }

  // ---------- lifecycle ----------

  snap() {
    if (this.phase !== 'pre') return;
    this.phase = 'live';
    this.emit('snap', this.los, this.ballY);
    const play = this.o.play;
    if (play.type === 'punt') {
      // Long snap travels back to the punter; nobody is user-controlled on a punt.
      this.puntStage = 'snap';
      this.badSnap = this.rng.chance(badSnapChance(this.o.off.ls));
      if (this.badSnap) this.emit('badsnap', this.los, this.ballY);
      return;
    }
    this.ball.holder = this.qb;
    this.controlled = this.qb;
    if (play.type === 'run' || play.type === 'pa') {
      const gap = play.run?.gap ?? 0;
      this.runAim = { x: this.los + 0.6, y: clamp(this.ballY + gap, 2, FIELD_W - 2) };
    }
    // Play-action: second-level defenders who misread the fake bite toward the line.
    if (play.type === 'pa') {
      for (const f of this.def) {
        if (f.role === 'OLB' || f.role === 'MLB' || f.role === 'SS') {
          const fooled = this.rng.next() * 100 > at(f.p, 'prc', 60) - (at(this.qb.p, 'pac') - 70) * 0.8;
          if (fooled) f.bite = 0.9;
        }
      }
    }
    if (play.type === 'run' && play.run?.carrier === 'QB') this.controlled = this.qb;
  }

  private emit(type: EngineEventType, x: number, y: number) {
    this.events.push({ type, x, y });
  }

  get done() {
    // Hold the dead ball long enough for the result banner to read over the field.
    return this.phase === 'dead' && this.deadT > 1.6;
  }

  update(dt = DT) {
    if (this.phase === 'pre') {
      for (const f of this.all) f.anim += dt * 0.5;
      return;
    }
    this.t += dt;
    for (const f of this.all) {
      f.hx.copyWithin(1, 0);
      f.hy.copyWithin(1, 0);
      f.hx[0] = f.x;
      f.hy[0] = f.y;
    }
    if (this.phase === 'dead') {
      this.deadT += dt;
      for (const f of this.all) {
        f.vx *= 0.9;
        f.vy *= 0.9;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.anim += Math.hypot(f.vx, f.vy) * dt;
      }
      if (this.ball.holder) this.followBall();
      return;
    }

    for (const f of this.all) {
      f.stun = Math.max(0, f.stun - dt);
      f.tackleCd = Math.max(0, f.tackleCd - dt);
      f.release = Math.max(0, f.release - dt);
      f.bite = Math.max(0, f.bite - dt);
      f.juke = Math.max(0, f.juke - dt);
      f.jukeCd = Math.max(0, f.jukeCd - dt);
      f.stiff = Math.max(0, f.stiff - dt);
      f.sprawl = Math.max(0, f.sprawl - dt);
      if (f.lunge > 0) {
        f.lunge -= dt;
        // A dive that found nothing leaves the defender on the turf.
        if (f.lunge <= 0) this.whiff(f);
      }
    }

    if (this.o.play.type === 'punt') this.updatePunt(dt);
    else {
      this.scripted();
      if (this.ball.air) this.updateAir(dt);
    }
    if (this.phase !== 'live') return;

    for (const f of this.all) {
      if (f.engaged) continue;
      if (f.lunge > 0) continue; // committed: keep diving along the lunge velocity
      if (f.sprawl > 0) this.accelerate(f, 0, 0, dt * 3);
      else if (f.side === 0) this.offenseAI(f, dt);
      else this.defenseAI(f, dt);
    }
    if (this.controlled && this.input.active && !this.controlled.engaged && this.controlled !== this.carrier) this.userSteer(this.controlled, dt);
    this.lunges();

    this.updateBlocks(dt);

    for (const f of this.all) {
      if (f.engaged) continue;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.anim += Math.hypot(f.vx, f.vy) * dt;
    }
    if (this.carrier && this.carrier === this.ball.holder) this.carrierRun += Math.hypot(this.carrier.vx, this.carrier.vy) * dt;
    this.followBall();
    this.checkCarrier();
    if (this.t > 25 && this.phase === 'live') this.endTackled(this.ball.holder ?? this.qb, null);
  }

  private followBall() {
    const h = this.ball.holder;
    if (h) {
      this.ball.x = h.x + 0.25;
      this.ball.y = h.y;
      this.ball.z = 0.8;
    }
  }

  private scripted() {
    const play = this.o.play;
    if (this.thrown || this.handedOff || this.phase !== 'live') return;
    if (play.type === 'run' && play.run?.carrier === 'RB') {
      const rb = this.off.find((f) => f.role === 'RB');
      if (rb && this.t >= this.meshT) {
        this.handedOff = true;
        this.ball.holder = rb;
        this.setCarrier(rb);
        this.qb.job = 'idle';
        this.emit('handoff', rb.x, rb.y);
      }
    } else if (play.type === 'run' && play.run?.carrier === 'QB' && this.t >= 0.55) {
      this.handedOff = true;
      this.setCarrier(this.qb);
    }
  }

  private setCarrier(f: FP) {
    this.carrier = f;
    this.carrierRun = 0;
    this.carrierSince = this.t;
    f.job = 'carrier';
    f.engaged = null;
    if (!this.intReturn) this.controlled = f;
    for (const o of this.off) {
      if (o === f || this.intReturn) continue;
      if (o.job === 'route' || o.job === 'target' || o.job === 'idle' || o.job === 'fake') {
        o.job = o.role === 'QB' ? 'idle' : 'runblock';
        o.blockTarget = null;
      }
      if (o.job === 'passblock') o.job = 'runblock';
    }
  }

  // ---------- AI ----------

  /** `carry` keeps some speed through a waypoint instead of braking to it; `accelMult` sharpens turns. */
  private steer(f: FP, tx: number, ty: number, dt: number, frac = 1, carry = 0, accelMult = 1) {
    const dx = tx - f.x;
    const dy = ty - f.y;
    const d = Math.hypot(dx, dy);
    let sp = this.topSpeed(f) * frac * (f.stun > 0 ? 0.3 : 1);
    if (d < 1.2) sp *= Math.max(carry, d / 1.2);
    const dvx = d > 1e-4 ? (dx / d) * sp : 0;
    const dvy = d > 1e-4 ? (dy / d) * sp : 0;
    this.accelerate(f, dvx, dvy, dt * accelMult);
  }

  /**
   * Route running: crisp route runners carry speed through their breaks and cut harder, and
   * defenders read their cuts late (extra reaction delay, in seconds, used by coverage).
   */
  private routeSkill(r: FP) {
    const rte = at(r.p, 'rte', 60);
    return {
      carry: clamp((rte - 50) / 80, 0, 0.6),
      accel: 0.85 + rte / 400,
      delay: clamp((rte - 70) * 0.004, -0.06, 0.12) + (has(r.p, 'routeartist') ? 0.12 : 0),
    };
  }

  /**
   * Carrying the ball costs a little top speed so pursuit angles can close, and a long
   * run wears the carrier down (up to 8% slower after ~20 yds) so chasers can reel him in.
   */
  private topSpeed(f: FP) {
    if (this.ball.holder !== f || f === this.qb) return f.maxSpd;
    const tired = clamp((this.carrierRun - 20) / 250, 0, 0.08);
    return f.maxSpd * 0.92 * (1 - tired);
  }

  private accelerate(f: FP, dvx: number, dvy: number, dt: number) {
    let ax = dvx - f.vx;
    let ay = dvy - f.vy;
    const m = Math.hypot(ax, ay);
    const lim = f.accel * dt;
    if (m > lim) {
      ax *= lim / m;
      ay *= lim / m;
    }
    f.vx += ax;
    f.vy += ay;
  }

  /**
   * Where a defender *thinks* a receiver is: the receiver's position `secs` ago, extrapolated
   * along his velocity at that time. Straight lines are tracked well; cuts fool the defender
   * for about `secs`, which is where route-running separation comes from.
   */
  private perceived(f: FP, secs: number) {
    const i = clamp(Math.round(secs / DT), 1, HIST - 2);
    const vx = (f.hx[i - 1] - f.hx[i + 1]) / (2 * DT);
    const vy = (f.hy[i - 1] - f.hy[i + 1]) / (2 * DT);
    const look = secs + 0.1;
    return { x: f.hx[i] + vx * look, y: f.hy[i] + vy * look, vx, vy };
  }

  /** Follow a moving point: match its velocity and close the gap (no arrive-damping lag). */
  private track(f: FP, tx: number, ty: number, tvx: number, tvy: number, dt: number) {
    let dvx = tvx + (tx - f.x) * 3;
    let dvy = tvy + (ty - f.y) * 3;
    const m = Math.hypot(dvx, dvy);
    const top = this.topSpeed(f) * (f.stun > 0 ? 0.3 : 1);
    if (m > top) {
      dvx *= top / m;
      dvy *= top / m;
    }
    this.accelerate(f, dvx, dvy, dt);
  }

  private qbHasBall() {
    return this.ball.holder === this.qb && !this.thrown && !this.crossedLos;
  }

  private offenseAI(f: FP, dt: number) {
    const play = this.o.play;
    switch (f.job) {
      case 'qb': {
        if (!this.qbHasBall()) {
          this.accelerate(f, 0, 0, dt);
          break;
        }
        const shot = this.t;
        if (play.type === 'run') {
          this.steer(f, this.los - 2, this.ballY + (play.run!.gap > 0 ? 0.6 : -0.6), dt, 0.5);
        } else if (play.type === 'pa' && shot < 0.5) {
          this.steer(f, this.los - 2.2, this.ballY + ((play.run?.gap ?? 0) >= 0 ? 1.2 : -1.2), dt, 0.55);
        } else {
          this.steer(f, this.los - 6.5, this.ballY, dt, 0.62);
        }
        break;
      }
      case 'route':
        this.runRoute(f, dt);
        break;
      case 'target': {
        // Receivers don't read the throw instantly: they keep running the route for a beat,
        // then break for the ball. Leading him properly still matters.
        const air = this.ball.air;
        if (air && this.t - this.throwT < 0.3) this.runRoute(f, dt);
        else if (air) this.steer(f, air.x1, air.y1, dt);
        break;
      }
      case 'fake': {
        if (this.t < 0.75 && this.runAim) this.steer(f, this.runAim.x - 1.5, this.runAim.y, dt, 0.8);
        else f.job = 'passblock';
        break;
      }
      case 'passblock':
        this.passBlock(f, dt);
        break;
      case 'lead': {
        if (this.runAim && f.x < this.los + 0.5 && dist(f, this.runAim) > 1.2) this.steer(f, this.runAim.x + 0.8, this.runAim.y, dt);
        else f.job = 'runblock';
        break;
      }
      case 'runblock':
        this.runBlock(f, dt);
        break;
      case 'carrier':
        if (f === this.controlled) this.userRun(f, dt);
        else this.autoRun(f, dt);
        break;
      case 'cover': {
        // Punt coverage: gunners race to the landing spot, then everyone pursues the returner.
        const air = this.ball.air;
        if (f.release > 0) this.accelerate(f, 0, 0, dt);
        else if (air && this.puntStage === 'air') this.steer(f, air.x1 - 2, air.y1 + (f.homeY - this.ballY) * 0.35, dt);
        else if (this.carrier) this.pursue(f, this.carrier, dt);
        else this.steer(f, f.x + 5, f.y, dt);
        break;
      }
      case 'pursue': {
        const c = this.carrier;
        if (c) this.pursue(f, c, dt);
        break;
      }
      case 'idle': {
        if (f.role === 'RB' && play.type === 'run' && !this.handedOff && this.runAim) {
          // Pre-handoff: RB heads for the mesh then the hole.
          this.steer(f, this.runAim.x - 1.2, this.runAim.y, dt, 0.85);
        } else {
          this.accelerate(f, f.vx * 0.9, f.vy * 0.9, dt);
        }
        break;
      }
      default:
        break;
    }
  }

  private runRoute(f: FP, dt: number) {
    if (f.release > 0) {
      this.accelerate(f, 0, 0, dt);
      return;
    }
    const tgt = f.route[f.ri];
    if (tgt) {
      const rs = this.routeSkill(f);
      // Intermediate waypoints are the breaks: keep speed through them; the last one is where he settles.
      this.steer(f, tgt.x, tgt.y, dt, 1, f.ri < f.route.length - 1 ? rs.carry : 0, rs.accel);
      if (dist(f, tgt) < 0.7) f.ri++;
    } else if (f.settle || (Math.abs(f.dirY) > Math.abs(f.dirX) && (f.y < 3 || f.y > FIELD_W - 3))) {
      // Sit down in the window (curls/hitches) or stop at the sideline (flats/outs).
      this.steer(f, f.x - 0.2, f.y, dt, 0.3);
    } else {
      const tx = f.x + f.dirX * 5;
      const ty = clamp(f.y + f.dirY * 5, 1, FIELD_W - 1);
      this.steer(f, tx, ty, dt);
    }
  }

  private passBlock(f: FP, dt: number) {
    const homeX = this.los - (f.role === 'RB' || f.role === 'FB' ? 4 : 1.6);
    const homeY = f.homeY;
    if (f.stun > 0) {
      this.accelerate(f, 0, 0, dt);
      return;
    }
    let best: FP | null = f.blockTarget && !f.blockTarget.engaged && !f.blockTarget.down ? f.blockTarget : null;
    if (!best) {
      let bestScore = 7;
      for (const d of this.def) {
        if (d.engaged || d.job !== 'rush' || this.isClaimed(d, f)) continue;
        const s = Math.abs(d.y - homeY) + Math.abs(d.x - f.x) * 0.5;
        if (s < bestScore) {
          bestScore = s;
          best = d;
        }
      }
      f.blockTarget = best;
    }
    if (best) {
      const qx = this.qb.x;
      const qy = this.qb.y;
      const d = Math.hypot(qx - best.x, qy - best.y) || 1;
      this.steer(f, best.x + ((qx - best.x) / d) * 0.9, best.y + ((qy - best.y) / d) * 0.9, dt);
    } else {
      this.steer(f, homeX, homeY, dt, 0.5);
    }
  }

  private isClaimed(d: FP, by: FP) {
    for (const o of this.off) if (o !== by && o.blockTarget === d) return true;
    return false;
  }

  private runBlock(f: FP, dt: number) {
    if (f.stun > 0) {
      this.accelerate(f, f.vx * 0.9, f.vy * 0.9, dt);
      return;
    }
    let t = f.blockTarget && !f.blockTarget.engaged && !f.blockTarget.down ? f.blockTarget : null;
    if (!t) {
      const range = f.role.startsWith('WR') ? 12 : 6;
      let best = range;
      const c0 = this.carrier;
      for (const d of this.def) {
        if (d.engaged || d.stun > 0 || this.isClaimed(d, f) || d.x < f.x - 2.5) continue;
        if (c0 && c0 !== this.qb && d.x < c0.x - 1) continue;
        const s = dist(f, d);
        if (s < best) {
          best = s;
          t = d;
        }
      }
      f.blockTarget = t;
    }
    const c = this.carrier ?? this.qb;
    if (t) {
      const d = Math.hypot(c.x - t.x, c.y - t.y) || 1;
      this.steer(f, t.x + ((c.x - t.x) / d) * 0.8, t.y + ((c.y - t.y) / d) * 0.8, dt);
    } else {
      this.steer(f, f.x + 2, f.y, dt, 0.5);
    }
  }

  private autoRun(f: FP, dt: number) {
    if (f.dive > 0 || f.juke > 0) return;
    const dir = this.intReturn ? -1 : 1;
    if (!this.intReturn && !this.crossedLos && this.runAim && f.x < this.runAim.x - 0.3 && f.role !== 'QB') {
      this.steer(f, this.runAim.x + 1, this.runAim.y, dt);
      return;
    }
    let ay = 0;
    const foes = f.side === 0 ? this.def : this.off;
    for (const d of foes) {
      if (d.engaged || d.down) continue;
      const dx = (d.x - f.x) * dir;
      if (dx < -1) continue;
      const dd = Math.hypot(d.x - f.x, d.y - f.y);
      if (dd > 5) continue;
      const w = (5 - dd) / 5;
      ay += (f.y >= d.y ? 1 : -1) * w * 0.8;
    }
    if (f.y < 4) ay += 0.9;
    if (f.y > FIELD_W - 4) ay -= 0.9;
    const m = Math.hypot(1, ay);
    this.steer(f, f.x + (dir / m) * 5, f.y + (ay / m) * 5, dt);
  }

  /** Take an intercept angle on the carrier; better pursuit ratings read the angle more fully. */
  private pursue(f: FP, c: FP, dt: number) {
    const rx = c.x - f.x;
    const ry = c.y - f.y;
    const s = f.maxSpd;
    const qa = c.vx * c.vx + c.vy * c.vy - s * s;
    const qb = 2 * (rx * c.vx + ry * c.vy);
    const qc = rx * rx + ry * ry;
    let t = -1;
    if (Math.abs(qa) < 1e-6) t = qb < 0 ? -qc / qb : -1;
    else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const r = Math.sqrt(disc);
        const t1 = (-qb - r) / (2 * qa);
        const t2 = (-qb + r) / (2 * qa);
        t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
        if (!isFinite(t)) t = -1;
      }
    }
    if (t < 0 || t > 3) t = Math.min(1.6, Math.hypot(rx, ry) / s);
    t *= clamp(0.5 + at(f.p, 'pur', at(f.p, 'awr', 60)) / 180, 0.5, 1);
    this.steer(f, c.x + c.vx * t, c.y + c.vy * t, dt);
  }

  private defenseAI(f: FP, dt: number) {
    if (f.stun > 0 && !this.carrier) {
      this.accelerate(f, f.vx * 0.95, f.vy * 0.95, dt);
      return;
    }
    const c = this.carrier;
    const air = this.ball.air;

    if (f.job === 'returner' && air) {
      this.steer(f, air.x1 + 0.4, air.y1, dt);
      return;
    }
    if (this.puntStage === 'air' || (this.puntStage === 'hold' && f.job !== 'rush')) {
      // Return team peels back to wall off the coverage in front of the returner.
      const land = air ? air.x1 : this.los + 30;
      if (f.job === 'man' && this.puntStage === 'hold') this.track(f, f.man!.x + 1, f.man!.y, f.man!.vx, f.man!.vy, dt);
      else this.steer(f, land - 9, f.y + (this.ballY - f.y) * 0.2, dt, this.puntStage === 'air' ? 1 : 0.4);
      return;
    }

    if (this.intReturn) {
      if (f === c) this.autoRun(f, dt);
      else if (c) this.returnBlock(f, c, dt);
      return;
    }

    if (air && this.t - this.throwT > f.react) {
      const tLeft = air.T - air.t;
      const reach = dist(f, { x: air.x1, y: air.y1 }) / f.maxSpd;
      if (reach < tLeft + 0.35 && f.job !== 'rush') {
        this.steer(f, air.x1, air.y1, dt);
        return;
      }
      const tgt = air.target;
      if (tgt && f.job !== 'rush') {
        this.steer(f, tgt.x, tgt.y, dt);
        return;
      }
      this.accelerate(f, f.vx * 0.9, f.vy * 0.9, dt);
      return;
    }

    if (c && (f.job === 'rush' || this.t - this.carrierSince > f.react)) {
      this.pursue(f, c, dt);
      return;
    }
    if (this.qbHasBall() && this.qb.x > this.los - 0.5 && this.t > 0.8) {
      // QB scrambling toward the line: everyone collapses.
      this.pursue(f, this.qb, dt);
      return;
    }
    if (f.bite > 0) {
      this.steer(f, this.los + 1.5, f.y + (this.ballY - f.y) * 0.3, dt, 0.8);
      return;
    }

    switch (f.job) {
      case 'rush': {
        if (this.qbHasBall()) this.steer(f, this.qb.x, this.qb.y, dt);
        else this.accelerate(f, 0, 0, dt);
        break;
      }
      case 'man': {
        const r = f.man!;
        if (r.job === 'passblock' || r.job === 'fake') {
          f.job = 'rush';
          break;
        }
        const rp = this.perceived(r, Math.max(0.05, f.react + this.routeSkill(r).delay));
        const deep = rp.x - this.los > 8 ? 1.0 : 0.4;
        const tx = Math.max(rp.x + deep, this.los + 1);
        this.track(f, tx, rp.y, rp.vx, rp.vy, dt);
        break;
      }
      case 'zone': {
        const z = f.zone!;
        let target: { x: number; y: number; vx: number; vy: number } | null = null;
        let best = Infinity;
        for (const r of this.off) {
          if (r.job !== 'route' && r.job !== 'target') continue;
          const rp = this.perceived(r, Math.max(0.05, f.react + this.routeSkill(r).delay));
          const d = Math.hypot(rp.x - z.x, (rp.y - z.y) * 0.9);
          if (d > z.r + 3) continue;
          // Deep defenders take the deepest threat; underneath defenders the nearest.
          const score = z.deep ? -rp.x : d;
          if (score < best) {
            best = score;
            target = rp;
          }
        }
        if (target) {
          // Pattern-match: underneath defenders sit on the receiver's hip; deep defenders stay over the top.
          if (z.deep) this.track(f, Math.max(target.x + 2.5, z.x - 6), target.y + (z.y - target.y) * 0.15, target.vx, target.vy, dt);
          else this.track(f, target.x + 0.8, target.y + (z.y - target.y) * 0.1, target.vx * 0.9, target.vy * 0.9, dt);
        } else {
          this.steer(f, z.x, z.y, dt, 0.7);
        }
        break;
      }
      default:
        this.accelerate(f, 0, 0, dt);
    }
  }

  /** Return blocking: pick off the nearest pursuer ahead of the carrier and knock him off his line. */
  private returnBlock(f: FP, c: FP, dt: number) {
    let t: FP | null = null;
    let best = 9;
    for (const o of this.off) {
      if (o.stun > 0 || o.sprawl > 0 || o.x > c.x + 1) continue;
      const d = dist(o, c);
      if (d < best && dist(f, o) < 14) {
        best = d;
        t = o;
      }
    }
    if (!t) {
      this.steer(f, c.x - 2, c.y + (f.y > c.y ? 2 : -2), dt, 0.8);
      return;
    }
    this.steer(f, t.x + (c.x - t.x) * 0.15, t.y + (c.y - t.y) * 0.15, dt);
    if (dist(f, t) < 0.9) {
      t.stun = 0.7;
      t.lunge = 0;
      t.vx *= 0.2;
      t.vy *= 0.2;
      f.stun = 0.4;
      this.emit('pancake', t.x, t.y);
    }
  }

  // ---------- blocking ----------

  private blockSkill(b: FP, run: boolean) {
    const p = b.p;
    const str = at(p, 'str');
    if (b.role.startsWith('WR')) return str * 0.5 + at(p, 'awr') * 0.2 + 12;
    if (b.role === 'RB' || b.role === 'FB') return str * 0.6 + at(p, 'awr') * 0.3 + (b.role === 'FB' ? 8 : -2);
    return at(p, run ? 'rbk' : 'pbk') * 0.75 + str * 0.25;
  }

  private defSkill(d: FP, run: boolean) {
    const p = d.p;
    const str = at(p, 'str');
    if (d.role === 'DE' || d.role === 'DT') return at(p, run ? 'bsh' : 'prs') * 0.75 + str * 0.25;
    if (d.role === 'OLB' || d.role === 'MLB') return (at(p, 'pur') + str) / 2 - 3;
    return at(p, 'tak') * 0.6 + str * 0.3;
  }

  private updateBlocks(dt: number) {
    const run = !!this.carrier || this.handedOff;
    // New engagements
    for (const b of this.off) {
      if (b.engaged || b.stun > 0 || !b.blockTarget) continue;
      if (b.job !== 'passblock' && b.job !== 'runblock' && b.job !== 'lead') continue;
      const d = b.blockTarget;
      if (d.engaged || d.down || d.stun > 0 || dist(b, d) > 1.05) continue;
      if (this.ball.holder === d) continue;
      b.engaged = d;
      d.engaged = b;
      d.shed = this.rng.range(0, 0.25);
      // Impact block: pancake chance for road-graders on run plays.
      if (run && this.rng.next() < clamp((at(b.p, 'ibk', 40) - at(d.p, 'bsh', 60)) * 0.004 + 0.02, 0, 0.08)) {
        this.release(b, d, 0.1);
        d.stun = 1.3;
        d.vx = 0;
        d.vy = 0;
        this.emit('pancake', d.x, d.y);
      }
    }
    // Active engagements
    const shedMult = DIFF.shed[this.diff];
    for (const d of this.def) {
      const b = d.engaged;
      if (!b) continue;
      const goal = this.carrier ?? (this.qbHasBall() ? this.qb : null);
      if (!goal || this.ball.air) {
        // Nothing to fight toward (ball in the air): hold the block.
        d.shed += dt * 0.15;
      }
      const diff = this.defSkill(d, run) - this.blockSkill(b, run);
      const burst = has(d.p, run ? 'runstuffer' : 'edgerusher') ? 1.4 : 1;
      const wall = has(b.p, run ? 'roadgrader' : 'brickwall') ? 0.7 : 1;
      d.shed += dt * 0.26 * Math.exp(diff / 14) * shedMult * (run ? 1.25 : 1) * burst * wall;
      if (goal) {
        const gx = goal.x - d.x;
        const gy = goal.y - d.y;
        const gd = Math.hypot(gx, gy) || 1;
        const push = clamp(diff * 0.03 + 0.2, -1.2, 1.4);
        d.vx = (gx / gd) * push;
        d.vy = (gy / gd) * push;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        b.x = d.x + (gx / gd) * 0.85;
        b.y = d.y + (gy / gd) * 0.85;
        b.vx = d.vx;
        b.vy = d.vy;
        b.anim += dt * 2;
        d.anim += dt * 2;
      }
      if (d.shed >= 1) this.release(b, d, 0.8);
      else if (this.carrier && this.carrier !== this.qb && this.carrier.x - d.x > 1.5 && dist(this.carrier, d) > 2.5) {
        // Runner is past this block: the defender peels off and chases.
        this.release(b, d, 0);
        d.shed = 0;
      }
    }
  }

  private release(b: FP, d: FP, stun: number) {
    b.engaged = null;
    d.engaged = null;
    b.blockTarget = null;
    b.stun = stun;
    d.shed = 0;
  }

  // ---------- user input ----------

  private userSteer(f: FP, dt: number) {
    if (f.dive > 0) return;
    const m = Math.min(1, Math.hypot(this.input.x, this.input.y));
    if (m < 0.05) return;
    const nx = this.input.x / (Math.hypot(this.input.x, this.input.y) || 1);
    const ny = this.input.y / (Math.hypot(this.input.x, this.input.y) || 1);
    const sp = this.topSpeed(f) * Math.max(0.45, m) * (f.stun > 0 ? 0.35 : 1) * (f.stiff > 0 ? 0.85 : 1);
    this.accelerate(f, nx * sp, ny * sp, dt);
  }

  /**
   * User-controlled carrier. With the virtual joystick held he runs wherever it points
   * (any direction, speed scaled by how far it's pushed); released, he sprints straight upfield.
   */
  private userRun(f: FP, dt: number) {
    if (f.dive > 0 || f.juke > 0) return; // let the dive / sidestep play out
    const stick = this.stick && Math.hypot(this.stick.x, this.stick.y) > 0.05 ? this.stick : null;
    if (stick) this.userSteered = true;
    if (!stick && !this.userSteered && !this.crossedLos && this.runAim && f.x < this.runAim.x - 0.3 && f.role !== 'QB') {
      this.steer(f, this.runAim.x + 1, this.runAim.y, dt); // follow the blocking to the hole until the user steers
      return;
    }
    const top = this.topSpeed(f) * (f.stun > 0 ? 0.3 : 1) * (f.stiff > 0 ? 0.85 : 1);
    if (stick) {
      const m = Math.hypot(stick.x, stick.y);
      const sp = top * Math.min(1, 0.35 + m * 0.65);
      this.accelerate(f, (stick.x / m) * sp, (stick.y / m) * sp, dt * 2.2);
    } else {
      this.accelerate(f, top, 0, dt * 1.8);
    }
  }

  /**
   * Close pursuers commit to a diving tackle, but only when the dive can actually get
   * there: predict where the carrier will be when the lunge lands and require that spot to
   * be within lunge range. Chasers from behind keep running until they're right on him.
   */
  private lunges() {
    const c = this.carrier;
    if (!c || c !== this.ball.holder || this.phase !== 'live') return;
    const foes = c.side === 0 ? this.def : this.off;
    const LUNGE_T = 0.3;
    for (const d of foes) {
      if (d.engaged || d.stun > 0 || d.lunge > 0 || d.sprawl > 0 || d.tackleCd > 0) continue;
      const dd = dist(d, c);
      if (dd > 2.6 || dd < 1.3) continue;
      // Earliest moment in the dive window when he can meet the carrier (head-on: almost
      // immediately; from behind: only if he's nearly on him). No meeting point = keep running.
      const sp = d.maxSpd * 1.3;
      let hit = -1;
      for (let t = 0; t <= LUNGE_T; t += 0.025) {
        if (Math.hypot(c.x + c.vx * t - d.x, c.y + c.vy * t - d.y) <= sp * t + 1.0) { hit = t; break; }
      }
      if (hit < 0) continue;
      const tx = c.x + c.vx * hit;
      const ty = c.y + c.vy * hit;
      const m = Math.hypot(tx - d.x, ty - d.y) || 1;
      d.lunge = LUNGE_T;
      d.vx = ((tx - d.x) / m) * sp;
      d.vy = ((ty - d.y) / m) * sp;
    }
  }

  private whiff(f: FP) {
    f.lunge = 0;
    f.sprawl = 0.8;
    f.stun = 0.8;
    f.vx *= 0.3;
    f.vy *= 0.3;
  }

  /** Swipe gestures on the ball carrier. */
  gesture(kind: 'jukeUp' | 'jukeDown' | 'stiff' | 'dive') {
    const f = this.controlled;
    if (!f || this.phase !== 'live' || f.dive > 0) return;
    if (f !== this.ball.holder) return;
    if (kind === 'jukeUp' || kind === 'jukeDown') {
      const direction = kind === 'jukeUp' ? -1 : 1;
      // A reverse cut takes effect right away; otherwise one juke per short cooldown.
      if (f.juke > 0 && f.jukeDir === direction) return;
      if (f.jukeCd > 0 && !(f.juke > 0 && f.jukeDir !== direction)) return;
      f.juke = 0.32;
      f.jukeDir = direction;
      f.jukeCd = 0.6;
      // Hard sidestep: nearly all of his speed goes sideways for a beat (~2.5-3 yds),
      // then userRun curves him back upfield. Speed is redirected, not added.
      const speed = Math.max(Math.hypot(f.vx, f.vy), f.maxSpd * 0.75);
      const forward = this.intReturn ? -1 : 1;
      f.vx = forward * speed * 0.33;
      f.vy = direction * speed * Math.sqrt(1 - 0.33 ** 2);
      // Break ankles: defenders closing in front react late and can end up on the turf.
      const elu = at(f.p, 'elu', at(f.p, 'agi', 60));
      const foes = f.side === 0 ? this.def : this.off;
      for (const d of foes) {
        if (d.engaged || d.down || d.sprawl > 0) continue;
        const dd = dist(d, f);
        if (dd > 4.5 || (d.x - f.x) * forward < -1) continue;
        const read = at(d.p, 'prc', at(d.p, 'awr', 60));
        const p = clamp(0.5 + (elu - read) * 0.012 + (d.lunge > 0 ? 0.35 : 0) + (dd < 2.5 ? 0.1 : 0) + (has(f.p, 'anklebreaker') ? 0.2 : 0), 0.2, 0.95);
        if (this.rng.chance(p)) {
          d.lunge = 0;
          d.sprawl = 0.75;
          d.stun = 0.75;
          d.tackleCd = 0.9;
          d.vx *= 0.2;
          d.vy *= 0.2;
          this.emit('juked', d.x, d.y);
        }
      }
      this.emit('juke', f.x, f.y);
    } else if (kind === 'stiff') {
      f.stiff = 0.5;
      this.emit('stiff', f.x, f.y);
    } else if (kind === 'dive') {
      // A short forward lunge for extra yards: carries his momentum ~1.5-2 yds, no burst.
      f.dive = 0.3;
      const dir = this.intReturn ? -1 : 1;
      const speed = Math.min(Math.max(Math.hypot(f.vx, f.vy), 4), f.maxSpd) * 1.05;
      f.vx = dir * speed;
      f.vy *= 0.3;
      this.emit('dive', f.x, f.y);
    }
  }

  canThrow() {
    return this.phase === 'live' && this.qbHasBall() && this.o.play.type !== 'run' && this.o.play.type !== 'punt' && this.carrier !== this.qb;
  }

  /** "Throw" toward your own goal: the QB tucks it and runs. */
  scramble() {
    if (!this.canThrow()) return;
    this.setCarrier(this.qb);
  }

  /** Where the broadcast camera should center: ahead of the ball in its direction of travel. */
  focusX() {
    return this.intReturn ? this.ball.x - 13 : this.ball.x;
  }

  /** Max air distance in yards: 60 for a weak arm up to a hard 70 for the strongest (Cannon can't exceed it). */
  maxThrow() {
    const arm = clamp((at(this.qb.p, 'thp') - 60) / 38, 0, 1);
    return Math.min(70, 60 + arm * 10 + (has(this.qb.p, 'cannon') ? 2 : 0));
  }

  /** Throw toward a field point. Distance/direction come from the user's drag vector. */
  /**
   * Where a throw toward (tx, ty) is really headed: clamped to arm strength, with the
   * scatter (1 sd, yards) this QB will put on it and the receiver it's going to.
   * The on-screen aim preview and the actual throw share this, so they always agree.
   */
  throwPlan(tx: number, ty: number) {
    const qb = this.qb;
    const max = this.maxThrow();
    const reach = (x: number, y: number) => {
      let dx = x - qb.x;
      let dy = y - qb.y;
      const d = Math.hypot(dx, dy);
      if (d > max) {
        dx *= max / d;
        dy *= max / d;
      }
      return { x: qb.x + dx, y: qb.y + dy, d: Math.min(d, max) };
    };
    // Flight time: a beat of hang on every throw, then distance over arm speed.
    const speed = 16 + at(qb.p, 'thp') * 0.1;
    const flight = (d: number) => 0.12 + d / speed;
    const aim = reach(tx, ty);

    // Aim assist: the receiver whose path runs nearest the aim point gets the throw nudged
    // toward where he'll be when it arrives, but only by a capped distance: it cleans up a
    // near-miss, it doesn't do the leading for you. Smart, accurate QBs correct a bit more.
    const ASSIST = 3.5;
    const skill = clamp(((at(qb.p, 'awr') + at(qb.p, 'acc')) / 2 - 55) / 40, 0, 1);
    const maxCorrection = 0.6 + skill * 1.4; // yards: ~0.6 for a weak passer, 2.0 for an elite one
    let target: FP | null = null;
    let best = ASSIST;
    const T0 = flight(aim.d);
    for (const f of this.off) {
      if (f === qb || !ELIGIBLE.includes(f.role as Role) || f.job === 'passblock') continue;
      // Distance from the aim to his path over the flight (where he is -> where he'll be).
      const s = segDist(aim.x, aim.y, f.x, f.y, f.x + f.vx * T0, f.y + f.vy * T0);
      if (s < best) {
        best = s;
        target = f;
      }
    }
    let land = aim;
    if (target) {
      let px = target.x;
      let py = target.y;
      for (let i = 0; i < 3; i++) {
        const T = flight(Math.hypot(px - qb.x, py - qb.y));
        px = target.x + target.vx * T;
        py = target.y + target.vy * T;
      }
      const gap = Math.hypot(px - aim.x, py - aim.y);
      const move = Math.min(gap, maxCorrection) * (best <= 1 ? 1 : 1 - (best - 1) / (ASSIST - 1));
      land = gap > 1e-6 ? reach(aim.x + ((px - aim.x) / gap) * move, aim.y + ((py - aim.y) / gap) * move) : aim;
    }
    const d = land.d;
    const T = flight(d);
    const acc = d > 20 ? at(qb.p, 'dac') : at(qb.p, 'acc');
    let pressure = 0;
    for (const f of this.def) if (!f.engaged && dist(f, qb) < 2.5) pressure = 1;
    const moving = Math.hypot(qb.vx, qb.vy) > 2.5 ? 1 : 0;
    if (has(qb.p, 'poised')) pressure = 0;
    const sd = (0.1 + d * 0.02 * (1.15 - acc / 100) * (1 + pressure * 0.8 + moving * 0.3)) * (has(qb.p, 'pinpoint') ? 0.7 : 1);
    // Arc grows with the square of distance: short throws are flat darts, deep balls hang as lobs.
    const h = clamp(0.8 + d * d * 0.0045, 1, 17);
    return { x: land.x, y: land.y, d, sd, T, h, target, max };
  }

  throwTo(tx: number, ty: number) {
    if (!this.canThrow()) return false;
    const qb = this.qb;
    const plan = this.throwPlan(tx, ty);
    if (plan.d < 1) return false;
    const { T, h } = plan;
    const x1 = plan.x + this.rng.normal(0, plan.sd);
    const y1 = plan.y + this.rng.normal(0, plan.sd);
    // The planned receiver stays the target; with no receiver near the aim, whoever is closest.
    let target: FP | null = plan.target;
    let best = 9;
    if (!target) for (const f of this.off) {
      if (f === qb || !ELIGIBLE.includes(f.role as Role) || f.job === 'passblock') continue;
      const s = Math.hypot(f.x + f.vx * T * 0.6 - x1, f.y + f.vy * T * 0.6 - y1);
      if (s < best) {
        best = s;
        target = f;
      }
    }
    this.ball.air = { x0: qb.x, y0: qb.y, x1, y1, T, t: 0, h, target };
    this.ball.holder = null;
    this.thrown = true;
    this.throwT = this.t;
    this.stats.push([qb.p.id, 'passAtt', 1]);
    if (target) {
      target.job = 'target';
      this.controlled = target;
    } else {
      this.controlled = null;
    }
    this.emit('throw', qb.x, qb.y);
    return true;
  }

  // ---------- punt ----------

  private updatePunt(dt: number) {
    const p = this.qb;
    if (this.puntStage === 'snap') {
      // A bad snap is slow and wide: it skips past the punter's side before he corrals it.
      const k = Math.min(1, this.t / (this.badSnap ? 0.95 : 0.45));
      const wide = this.badSnap ? Math.sin(k * Math.PI) * 2.5 : 0;
      this.ball.x = this.los + (p.x - this.los) * k;
      this.ball.y = this.ballY + (p.y - this.ballY) * k + wide;
      this.ball.z = 0.8 + k * (1 - k) * 2;
      if (k >= 1) {
        this.puntStage = 'hold';
        this.ball.holder = p;
      }
    } else if (this.puntStage === 'hold' && this.t >= (this.badSnap ? 1.75 : 1.15) && this.ball.holder === p) {
      this.kickPunt();
    } else if (this.puntStage === 'air') {
      const a = this.ball.air!;
      a.t += dt;
      const k = Math.min(1, a.t / a.T);
      this.ball.x = a.x0 + (a.x1 - a.x0) * k;
      this.ball.y = a.y0 + (a.y1 - a.y0) * k;
      this.ball.z = 0.8 + 4 * a.h * k * (1 - k);
      if (k >= 1) this.landPunt();
    }
  }

  private kickPunt() {
    const p = this.qb;
    const kpw = at(p.p, 'kpw', 60);
    const gross = clamp(this.rng.normal(37 + (kpw - 60) * 0.35 + (has(p.p, 'bigleg') ? 3 : 0) - (this.badSnap ? 9 : 0), 4.5), 18, 62);
    const x1 = this.los + gross;
    const y1 = clamp(this.ballY + this.rng.range(-9, 9), 6, FIELD_W - 6);
    this.ball.air = { x0: p.x, y0: p.y, x1, y1, T: 3.3 + kpw * 0.012, t: 0, h: 10 + kpw * 0.05, target: this.returner };
    this.ball.holder = null;
    this.thrown = true;
    this.throwT = this.t;
    this.puntStage = 'air';
    this.stats.push([p.p.id, 'punts', 1], [p.p.id, 'puntYds', Math.round(Math.min(x1, 100) - this.los)]);
    for (const o of this.off) {
      if (o.engaged) this.release(o, o.engaged, 0);
      if (o !== p) o.job = 'cover';
    }
    this.emit('throw', p.x, p.y);
  }

  private landPunt() {
    const a = this.ball.air!;
    this.ball.air = null;
    const kr = this.returner!;
    if (a.x1 >= 100) {
      return this.finish({ kind: 'punt', yards: 0, elapsed: this.t, clockStops: true, turnoverSpot: 80, stats: this.stats, desc: `${short(this.qb.p)} punts into the end zone. Touchback.` });
    }
    if (dist(kr, { x: a.x1, y: a.y1 }) > 2.4) {
      return this.finish({ kind: 'punt', yards: 0, elapsed: this.t, clockStops: true, turnoverSpot: a.x1, stats: this.stats, desc: `${short(this.qb.p)} punt downed at the ${Math.round(100 - a.x1)}` });
    }
    // Catch: the return is on, kicking team becomes the pursuers.
    this.catchX = kr.x;
    this.puntStage = 'return';
    this.intReturn = true;
    this.ball.holder = kr;
    this.carrier = kr;
    this.carrierRun = 0;
    this.carrierSince = this.t;
    kr.job = 'carrier';
    for (const o of this.off) {
      o.job = 'pursue';
      o.react = 0.2;
    }
    this.emit('catch', kr.x, kr.y);
  }

  // ---------- ball in air / catch ----------

  private updateAir(dt: number) {
    const a = this.ball.air!;
    a.t += dt;
    const k = Math.min(1, a.t / a.T);
    this.ball.x = a.x0 + (a.x1 - a.x0) * k;
    this.ball.y = a.y0 + (a.y1 - a.y0) * k;
    this.ball.z = 0.8 + 4 * a.h * k * (1 - k);
    if (k >= 1) this.resolveCatch();
  }

  private resolveCatch() {
    const a = this.ball.air!;
    this.ball.air = null;
    const bp = { x: this.ball.x, y: this.ball.y };
    let r: FP | null = null;
    let rd = 9;
    for (const f of this.off) {
      if (f === this.qb || !ELIGIBLE.includes(f.role as Role)) continue;
      const d = dist(f, bp);
      // The intended receiver can lay out for it; anyone else needs to be right there.
      if (d < (f === a.target ? 2.4 : 1.5) && d < rd) {
        rd = d;
        r = f;
      }
    }
    let df: FP | null = null;
    let dd = 1.4;
    for (const f of this.def) {
      if (f.engaged) continue;
      const d = dist(f, bp);
      if (d < dd) {
        dd = d;
        df = f;
      }
    }
    const inBounds = bp.y >= 0 && bp.y <= FIELD_W && bp.x <= 110;
    if (!inBounds) return this.endIncomplete(a.target, 'drop');

    const cover = (f: FP) => {
      const p = f.p;
      const skill = p.attrs.man !== undefined ? (at(p, 'man') + at(p, 'zon')) / 2 : at(p, 'cov', 45);
      return skill * 0.7 + at(p, 'prc', 55) * 0.3 + DIFF.contest[this.diff];
    };

    if (r && !df) {
      const p = 0.93 + (at(r.p, 'cth') - 70) * 0.004 - Math.max(0, rd - 1) * 0.28 + (rd > 1 ? (at(r.p, 'spc', 55) - 60) * 0.004 : 0);
      if (this.rng.chance(p)) return this.completeCatch(r);
      return this.endIncomplete(r, 'drop');
    }
    if (r && df) {
      const rs = at(r.p, 'cth') * 0.6 + at(r.p, 'spc', 55) * 0.4 + this.rng.range(0, 30) - rd * 10 + (has(r.p, 'highlight') ? 12 : 0);
      const ds = cover(df) + this.rng.range(0, 30) - dd * 10;
      if (ds - rs > (has(df.p, 'ballhawk') || has(df.p, 'lurker') ? 16 : 20)) return this.interception(df);
      if (ds > rs) return this.endIncomplete(r, 'breakup');
      return this.completeCatch(r);
    }
    if (df) {
      const p = (0.22 + (at(df.p, 'prc', 55) - 60) * 0.006 - dd * 0.1 + DIFF.contest[this.diff] * 0.01) * (has(df.p, 'ballhawk') || has(df.p, 'lurker') ? 1.25 : 1);
      if (this.rng.chance(p)) return this.interception(df);
      return this.endIncomplete(a.target, 'breakup');
    }
    return this.endIncomplete(a.target, 'drop');
  }

  private completeCatch(r: FP) {
    this.catcher = r;
    this.ball.holder = r;
    this.emit('catch', r.x, r.y);
    this.setCarrier(r);
    // Securing the catch costs momentum; defenders breaking on the ball can close.
    r.vx *= 0.5;
    r.vy *= 0.5;
    this.crossedLos = true;
    if (r.x >= 100) this.endTd(r);
  }

  private interception(df: FP) {
    this.emit('int', df.x, df.y);
    this.intReturn = true;
    this.ball.holder = df;
    this.carrier = df;
    this.carrierRun = 0;
    this.carrierSince = this.t;
    df.job = 'carrier';
    df.engaged = null;
    this.controlled = null;
    for (const o of this.off) {
      if (o.engaged) this.release(o, o.engaged, 0);
      o.job = 'pursue';
      o.react = 0.3;
    }
    for (const d of this.def) if (d.engaged) this.release(d.engaged, d, 0);
    this.stats.push([this.qb.p.id, 'passInt', 1], [df.p.id, 'defInt', 1]);
  }

  // ---------- carrier checks, tackles, end of play ----------

  private tackleSkill(f: FP) {
    const p = f.p;
    if (p.attrs.tak !== undefined) return at(p, 'tak') * 0.8 + at(p, 'hit', 60) * 0.2;
    return (at(p, 'str') + at(p, 'awr')) / 2 - 8;
  }

  private checkCarrier() {
    const h = this.ball.holder;
    if (!h || this.phase !== 'live') return;
    if (!this.intReturn && h === this.qb && !this.crossedLos && h.x > this.los + 0.3) {
      this.crossedLos = true;
      this.setCarrier(h);
    }
    if (h.y < 0 || h.y > FIELD_W) {
      this.emit('oob', h.x, h.y);
      return this.endTackled(h, null, true);
    }
    if (!this.intReturn && h.x >= 100) return this.endTd(h);
    if (this.intReturn && h.x <= 0) return this.endTackled(h, null);

    const foes = h.side === 0 ? this.def : this.off;
    if (h.dive > 0) {
      // Airborne: momentum bleeds off, and he's down the moment a defender is in reach
      // (forward progress) or when he hits the turf. Nobody gets dived through.
      h.dive -= DT;
      h.vx *= 0.93;
      h.vy *= 0.93;
      for (const d of foes) if (!d.down && d.sprawl <= 0 && dist(d, h) < 1.2) return this.endTackled(h, d);
      if (h.dive <= 0) return this.endTackled(h, null);
      return;
    }
    for (const d of foes) {
      if (d.stun > 0 || d.tackleCd > 0 || d.down) continue;
      if (dist(d, h) > (d.engaged ? 0.9 : d.lunge > 0 ? 1.1 : 1.25)) continue;
      let p = 0.8 + (this.tackleSkill(d) - 70) * 0.008 + (h.side === 0 ? DIFF.tackle[this.diff] : 0);
      const elu = at(h.p, 'elu', at(h.p, 'agi', 60));
      const trk = at(h.p, 'trk', at(h.p, 'str', 60) - 10);
      p -= (elu - 70) * 0.003 + (trk - 70) * 0.002;
      if (h === this.qb && !this.crossedLos && !this.intReturn) p = 0.86 - (at(h.p, 'agi', 60) - 65) * 0.004;
      if (h.juke > 0) p *= (0.28 + (100 - elu) / 350) * (has(h.p, 'anklebreaker') ? 0.5 : 1);
      if (has(h.p, 'bulldozer')) p -= 0.1;
      if (h.stiff > 0) p *= 1 - (at(h.p, 'str') + trk) / 260;
      p = clamp(p, 0.08, 0.97);
      if (d.engaged) p *= 0.4; // arm tackle while still blocked
      if (this.rng.chance(p)) return this.endTackled(h, d);
      if (d.engaged) {
        d.tackleCd = 0.6;
        continue;
      }
      this.whiff(d);
      d.tackleCd = 1.2;
      h.vx *= 0.8;
      this.emit('broken', h.x, h.y);
    }
  }

  private endTd(h: FP) {
    this.emit('td', h.x, h.y);
    const yards = 100 - this.los;
    const stats = this.stats;
    if (this.catcher) {
      stats.push([this.qb.p.id, 'passCmp', 1], [this.qb.p.id, 'passYds', yards], [this.qb.p.id, 'passTd', 1]);
      stats.push([h.p.id, 'rec', 1], [h.p.id, 'recYds', yards], [h.p.id, 'recTd', 1]);
    } else {
      stats.push([h.p.id, 'rushAtt', 1], [h.p.id, 'rushYds', yards], [h.p.id, 'rushTd', 1]);
    }
    this.finish({
      kind: this.catcher ? 'pass' : 'run', yards, elapsed: this.t, clockStops: true, endY: h.y, stats,
      desc: this.catcher ? `${short(this.qb.p)} to ${short(h.p)}, ${yards} yd TOUCHDOWN!` : `${short(h.p)} ${yards} yd TOUCHDOWN run!`,
    });
  }

  private endIncomplete(target: FP | null, why: 'drop' | 'breakup') {
    this.emit(why === 'breakup' ? 'breakup' : 'drop', this.ball.x, this.ball.y);
    this.ball.z = 0;
    this.ball.loose = true;
    this.finish({
      kind: 'incomplete', yards: 0, elapsed: this.t, clockStops: true, stats: this.stats,
      desc: why === 'breakup' ? 'Pass broken up!' : target ? `Incomplete, intended for ${short(target.p)}` : 'Incomplete',
    });
  }

  private endTackled(h: FP, by: FP | null, oob = false) {
    h.down = !oob;
    if (by) {
      by.vx *= 0.3;
      by.vy *= 0.3;
    }
    const stats = this.stats;
    if (this.o.play.type === 'punt') {
      // Return (or a blocked punt): the receiving team takes over where the ball is downed.
      const spot = h.x;
      if (by) stats.push([by.p.id, 'tkl', 1]);
      this.emit('tackle', h.x, h.y);
      const blocked = h === this.qb;
      return this.finish({
        kind: 'punt', yards: 0, elapsed: this.t, clockStops: true, turnoverSpot: spot, defTd: !blocked && spot <= 0, stats,
        desc: blocked ? `Punt BLOCKED! ${short(h.p)} is swarmed` : spot <= 0 ? `${short(h.p)} returns the punt for a TOUCHDOWN!` : `${short(h.p)} returns the punt ${Math.max(0, Math.round(this.catchX - spot))} yds`,
      });
    }
    if (this.intReturn) {
      const spot = h.x;
      if (by) stats.push([by.p.id, 'tkl', 1]);
      this.emit('tackle', h.x, h.y);
      return this.finish({
        kind: 'int', yards: 0, elapsed: this.t, clockStops: true, turnoverSpot: spot, defTd: spot <= 0, stats,
        desc: spot <= 0 ? `PICK SIX by ${short(h.p)}!` : `INTERCEPTED by ${short(h.p)}!`,
      });
    }
    const fwd = h.vx > 1 && by ? 0.5 : 0;
    const yards = Math.round(h.x + fwd - this.los);
    const sack = h === this.qb && !this.crossedLos && !this.thrown && this.o.play.type !== 'run';
    this.emit(sack ? 'sack' : 'tackle', h.x, h.y);
    if (by) stats.push([by.p.id, 'tkl', 1]);
    if (sack) {
      if (by) stats.push([by.p.id, 'sack', 1]);
      stats.push([h.p.id, 'sacked', 1]);
      return this.finish({
        kind: 'sack', yards, elapsed: this.t, clockStops: false, endY: h.y, stats,
        desc: by ? `${short(h.p)} sacked by ${short(by.p)}` : `${short(h.p)} sacked`,
      });
    }
    // Fumble on contact
    const fumbleP = 0.012 * (at(by?.p ?? h.p, 'hit', 60) / 70) * ((100 - at(h.p, 'car', 60)) / 30) * (has(h.p, 'surehands') ? 0.2 : 1) * (by && (has(by.p, 'stripartist') || has(by.p, 'hitstick')) ? 1.8 : 1);
    if (by && this.rng.chance(fumbleP) && this.rng.chance(0.55)) {
      this.emit('fumble', h.x, h.y);
      this.pushGainStats(h, yards);
      return this.finish({
        kind: 'fumble', yards, elapsed: this.t, clockStops: true, turnoverSpot: this.los + yards, stats,
        desc: `${short(h.p)} FUMBLES! Recovered by ${short(by.p)}`,
      });
    }
    this.pushGainStats(h, yards);
    this.finish({
      kind: this.catcher ? 'pass' : 'run', yards, elapsed: this.t, clockStops: oob, endY: h.y, stats,
      desc: this.catcher
        ? `${short(this.qb.p)} to ${short(h.p)} for ${yards}${oob ? ', out of bounds' : ''}`
        : `${short(h.p)} ${yards >= 0 ? 'runs for' : 'loses'} ${Math.abs(yards)}${oob ? ', out of bounds' : ''}`,
    });
  }

  private pushGainStats(h: FP, yards: number) {
    if (this.catcher) {
      this.stats.push([this.qb.p.id, 'passCmp', 1], [this.qb.p.id, 'passYds', yards], [h.p.id, 'rec', 1], [h.p.id, 'recYds', yards]);
    } else {
      this.stats.push([h.p.id, 'rushAtt', 1], [h.p.id, 'rushYds', yards]);
    }
  }

  private finish(r: PlayResult) {
    this.result = r;
    this.phase = 'dead';
    this.controlled = null;
    for (const f of this.all) {
      if (f.engaged) f.engaged = null;
    }
  }
}
