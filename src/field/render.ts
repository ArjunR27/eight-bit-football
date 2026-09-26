import { FIELD_W } from '../sim/gameState';
import type { FP, PlayEngine } from './engine';
import { drawText, textWidth } from './font';
import { CROSSBAR, POST_HALF_WIDTH, POWER_ZONES, type FieldGoalKick } from './kick';
import { ELIGIBLE, type Role } from './playbook';

export interface FieldView {
  x: number; y: number; w: number; h: number; left: number; right: number;
  /** Field coordinates: x goes toward the offense's end zone; y goes top-to-bottom. */
  toScreen(x: number, y: number): { x: number; y: number };
  toField(x: number, y: number): { x: number; y: number };
}
/** Screen pixels per yard of ball height: exaggerated so arcs read clearly from above. */
export const Z_SCALE = 12;

export interface FieldPalette {
  offense: string; offenseTrim: string; offenseHelmet: string;
  defense: string; defenseTrim: string; defenseHelmet: string;
}

function routeArrow(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], v: FieldView, color: string) {
  if (pts.length < 2) return;
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.beginPath(); const first = v.toScreen(pts[0].x, pts[0].y); ctx.moveTo(first.x, first.y);
  for (const pt of pts.slice(1)) { const p = v.toScreen(pt.x, pt.y); ctx.lineTo(p.x, p.y); }
  ctx.stroke();
  const a = v.toScreen(pts[pts.length - 2].x, pts[pts.length - 2].y), b = v.toScreen(pts.at(-1)!.x, pts.at(-1)!.y);
  const angle = Math.atan2(b.y - a.y, b.x - a.x), size = 8;
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - Math.cos(angle - .55) * size, b.y - Math.sin(angle - .55) * size); ctx.lineTo(b.x - Math.cos(angle + .55) * size, b.y - Math.sin(angle + .55) * size); ctx.closePath(); ctx.fill(); ctx.restore();
}

/** A broadcast-style moving camera: show the action, not the entire 120-yard field. */
export function fieldView(w: number, h: number, centerX = 50, flip = false): FieldView {
  const pad = 12, visible = 54;
  const left = Math.max(-10, Math.min(100 - visible + 10, centerX - visible * .38));
  const right = left + visible;
  const x = pad, y = 4, fw = w - pad * 2, fh = h - 8;
  const toScreen = (fx: number, fy: number) => ({ x: x + (flip ? right - fx : fx - left) / visible * fw, y: y + fy / FIELD_W * fh });
  const toField = (sx: number, sy: number) => ({ x: flip ? right - (sx - x) / fw * visible : left + (sx - x) / fw * visible, y: (sy - y) / fh * FIELD_W });
  return { x, y, w: fw, h: fh, left, right, toScreen, toField };
}

// ---------- pixel sprites ----------
// 10x16 side view facing right. h helmet, s helmet stripe, m facemask, k skin, j jersey,
// w jersey number, p pants, t socks, b cleats.
const HEAD_BODY = [
  '...hhhh...',
  '..hhhhhh..',
  '.hsshhkkk.',
  '.hhhhkmkm.',
  '..hhhkkmm.',
  '..jjjjjj..',
  '.jjjjjjjj.',
  '.jjjjjjkk.',
  '.kjjjjjkk.',
  '.kjjjjj.k.',
  '..pppppp..',
  '..pppppp..',
];
const LEGS = {
  stand: ['..pp..pp..', '..tt..tt..', '..tt..tt..', '..bbb.bbb.'],
  runA: ['.ppp.ppp..', '.tt...tt..', 'tt.....tt.', 'bb.....bbb'],
  runB: ['...pppp...', '...ttt....', '...ttt....', '...bbbb...'],
};
// Behind-the-kicker view for the field goal scene.
const BACK = [
  '...hhhh...', '..hhhhhh..', '..hhsshh..', '..hhsshh..', '...hhhh...',
  '.jjjjjjjj.', 'jjjjjjjjjj', 'kjjwwwwjjk', 'kjjwjjwjjk', 'kjjwwwwjjk',
  '.pppppppp.', '.pppppppp.', '.ppp..ppp.', '.ttt..ttt.', '.ttt..ttt.', '.bbb..bbb.',
];
const SKIN = ['#f1c9a2', '#d8a579', '#b0764c', '#7d4d2e', '#5a3620'];
const PX = 2; // canvas pixels per sprite pixel
const spriteCache = new Map<string, HTMLCanvasElement>();

interface Kit { jersey: string; trim: string; helmet: string; skin: string }

function spriteImage(rows: string[], kit: Kit, px: number, mirror: boolean) {
  const key = `${rows.join('')}|${kit.jersey}|${kit.trim}|${kit.helmet}|${kit.skin}|${px}|${mirror}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const cols = rows[0].length;
  const c = document.createElement('canvas');
  c.width = (cols + 2) * px; c.height = (rows.length + 2) * px;
  const g = c.getContext('2d')!;
  const colors: Record<string, string> = {
    h: kit.helmet, s: kit.trim, m: '#cfd6dc', k: kit.skin, j: kit.jersey, w: '#f4f1e4', p: kit.trim, t: kit.jersey, b: '#15181c',
  };
  const each = (fn: (x: number, y: number, ch: string) => void) => rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') fn(mirror ? cols - 1 - x : x, y, ch); }));
  // A dark one-pixel outline keeps players readable against the grass.
  g.fillStyle = '#0d1b12';
  each((x, y) => { for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillRect((x + 1 + dx) * px, (y + 1 + dy) * px, px, px); });
  each((x, y, ch) => { g.fillStyle = colors[ch]; g.fillRect((x + 1) * px, (y + 1) * px, px, px); });
  spriteCache.set(key, c);
  return c;
}

function kitFor(f: FP, colors: FieldPalette): Kit {
  return f.side === 0
    ? { jersey: colors.offense, trim: colors.offenseTrim, helmet: colors.offenseHelmet, skin: SKIN[f.p.skin % SKIN.length] }
    : { jersey: colors.defense, trim: colors.defenseTrim, helmet: colors.defenseHelmet, skin: SKIN[f.p.skin % SKIN.length] };
}

/** Screen-facing direction (+1 right, -1 left): where the player is moving, else toward his target end zone. */
function facing(f: FP, flip: boolean) {
  const sx = flip ? -f.vx : f.vx;
  if (Math.abs(sx) > 0.6) return Math.sign(sx);
  const toward = f.side === 0 ? 1 : -1;
  return flip ? -toward : toward;
}

function sprite(ctx: CanvasRenderingContext2D, f: FP, v: FieldView, selected: boolean, colors: FieldPalette, flip: boolean) {
  const p = v.toScreen(f.x, f.y), x = Math.round(p.x), y = Math.round(p.y);
  const face = facing(f, flip), moving = Math.hypot(f.vx, f.vy) > 0.8;
  const legs = !moving ? LEGS.stand : Math.floor(f.anim * 1.3) % 2 ? LEGS.runA : LEGS.runB;
  const img = spriteImage([...HEAD_BODY, ...legs], kitFor(f, colors), PX, face < 0);
  ctx.fillStyle = 'rgba(4,38,18,.45)'; ctx.beginPath(); ctx.ellipse(x, y, 11, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  if (f.p.zone) {
    // X-Factor in the zone: a glowing red X under his feet.
    ctx.strokeStyle = '#ff3b2f'; ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(x - 10, y - 4); ctx.lineTo(x + 10, y + 4); ctx.moveTo(x + 10, y - 4); ctx.lineTo(x - 10, y + 4); ctx.stroke();
  }
  if (selected) { ctx.strokeStyle = '#ffe45c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y, 15, 5.5, 0, 0, Math.PI * 2); ctx.stroke(); }
  if (f.down || f.sprawl > 0 || f.lunge > 0 || f.dive > 0) {
    // Laid out: rotate the sprite so the head points the way he fell.
    ctx.save(); ctx.translate(x, y); ctx.rotate(face * Math.PI / 2); ctx.drawImage(img, -img.width / 2, -img.height + PX * 2); ctx.restore();
  } else {
    ctx.drawImage(img, x - img.width / 2, y - img.height + PX);
  }
}

export function initials(f: FP) {
  return `${f.p.first[0]}.${f.p.last[0]}`;
}

function nameTag(ctx: CanvasRenderingContext2D, f: FP, v: FieldView, color: string) {
  const p = v.toScreen(f.x, f.y), label = initials(f), s = 2;
  drawText(ctx, label, Math.round(p.x - textWidth(label, s) / 2), Math.round(p.y - 50), f.p.zone ? '#ff6b5a' : color, s, '#0b1f14');
  if (f.p.energy !== undefined) {
    // Stamina under the name: green fresh, yellow tiring, red gassed.
    const e = f.p.energy, bx = Math.round(p.x - 11), by = Math.round(p.y - 39);
    ctx.fillStyle = '#0b1f14'; ctx.fillRect(bx - 1, by - 1, 24, 5);
    ctx.fillStyle = e > 70 ? '#6fdc6f' : e > 45 ? '#f2c14e' : '#e0503a'; ctx.fillRect(bx, by, Math.round(22 * e / 100), 3);
  }
}

function football(ctx: CanvasRenderingContext2D, bx: number, by: number, scale = 1) {
  bx = Math.round(bx); by = Math.round(by);
  const w = Math.round(12 * scale), h = Math.round(7 * scale);
  ctx.fillStyle = '#21130f'; ctx.fillRect(bx - w / 2, by - h / 2, w, h);
  ctx.fillStyle = '#8a4526'; ctx.fillRect(bx - w / 2 + 1, by - h / 2 + 1, w - 2, h - 2);
  ctx.fillStyle = '#f7dfab'; ctx.fillRect(bx - 2, by, 4, 1); ctx.fillRect(bx - 1, by - 1, 1, 3); ctx.fillRect(bx + 1, by - 1, 1, 3);
}

export function drawField(ctx: CanvasRenderingContext2D, engine: PlayEngine, w: number, h: number, colors: FieldPalette, flip = false, centerX = engine.focusX()) {
  const v = fieldView(w, h, centerX, flip);
  ctx.fillStyle = '#0b3f27'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#18713a'; ctx.fillRect(v.x, v.y, v.w, v.h);
  // A subtle stipple and strong sidelines keep the field readable at phone scale.
  ctx.fillStyle = 'rgba(222,244,157,.10)';
  for (let tx = Math.ceil(v.x) + 5; tx < v.x + v.w; tx += 17) for (let ty = Math.ceil(v.y) + 6; ty < v.y + v.h; ty += 13) ctx.fillRect(tx, ty, 1, 1);
  ctx.fillStyle = '#edf0c9'; ctx.fillRect(v.x, v.y, v.w, 3); ctx.fillRect(v.x, v.y + v.h - 3, v.w, 3);
  for (let n = Math.ceil(v.left / 5) * 5; n <= v.right; n += 5) {
    const p = v.toScreen(n, 0), major = n % 10 === 0;
    ctx.fillStyle = major ? '#d8e6a8' : '#70ad69'; ctx.fillRect(Math.round(p.x - (major ? 1 : .5)), v.y, major ? 2 : 1, v.h);
    if (major && n > 0 && n < 100) drawText(ctx, String(n <= 50 ? n : 100 - n), p.x - 5, v.y + 4, '#e8f2bd', 1);
  }
  for (let n = Math.ceil(v.left); n <= v.right; n++) {
    const p = v.toScreen(n, 0), major = n % 5 === 0;
    ctx.fillStyle = '#e8f2bd'; ctx.fillRect(Math.round(p.x), v.y + 5, major ? 2 : 1, major ? 12 : 6); ctx.fillRect(Math.round(p.x), v.y + v.h - (major ? 17 : 11), major ? 2 : 1, major ? 12 : 6);
    if (major && n > 0 && n < 100) drawText(ctx, String(n <= 50 ? n : 100 - n), p.x - 13, v.y + v.h / 2 - 9, 'rgba(232,242,189,.58)', 4);
  }
  // Draw each end zone from both of its field-space edges.  A positive
  // screen width only works for the normal camera; the flipped camera needs
  // the same band measured from right-to-left.
  const endZone = (from: number, to: number, color: string) => {
    const a = v.toScreen(from, 0).x, b = v.toScreen(to, 0).x;
    const left = Math.max(v.x, Math.min(a, b)), right = Math.min(v.x + v.w, Math.max(a, b));
    if (right <= left) return;
    ctx.fillStyle = color; ctx.fillRect(left, v.y, right - left, v.h);
  };
  endZone(-10, 0, colors.offense);
  endZone(100, 110, colors.defense);
  // Goal posts on the back line, seen from the side like the broadcast view.
  for (const gx of [-10, 110]) {
    const g = v.toScreen(gx, FIELD_W / 2);
    if (g.x < v.x - 4 || g.x > v.x + v.w + 4) continue;
    const top = v.toScreen(gx, FIELD_W / 2 - POST_HALF_WIDTH).y, bottom = v.toScreen(gx, FIELD_W / 2 + POST_HALF_WIDTH).y;
    ctx.fillStyle = '#6b5a12'; ctx.fillRect(Math.round(g.x) - 1, Math.round(top) + 2, 5, Math.round(bottom - top));
    ctx.fillStyle = '#f3d23c'; ctx.fillRect(Math.round(g.x) - 2, Math.round(top), 4, Math.round(bottom - top));
  }
  const los = v.toScreen(engine.los, 0); ctx.fillStyle = '#64bff4'; ctx.fillRect(Math.round(los.x - 1), v.y, 3, v.h);
  if (engine.o.play.type !== 'punt') {
    const first = v.toScreen(Math.min(100, engine.los + engine.o.toGo), 0); ctx.fillStyle = '#f7d34f'; ctx.fillRect(Math.round(first.x - 1), v.y, 3, v.h);
  }
  if (engine.phase === 'pre') {
    const routeColors = ['#69e86e', '#83d9ff', '#69e86e', '#83d9ff', '#69e86e'];
    let i = 0;
    for (const f of engine.off) if (f.route.length) routeArrow(ctx, [{ x: f.x, y: f.y }, ...f.route], v, routeColors[i++ % routeColors.length]);
    if (engine.o.play.type === 'run') {
      const runner = engine.off.find(f => f.role === engine.o.play.run?.carrier);
      if (runner) routeArrow(ctx, [{ x: runner.x, y: runner.y }, { x: engine.los + 5, y: Math.max(2, Math.min(FIELD_W - 2, engine.ballY + (engine.o.play.run?.gap ?? 0) * 2)) }], v, '#83d9ff');
    }
  }
  // Painter's order: players further down the screen overlap the ones behind them.
  const players = [...engine.all].sort((a, b) => a.y - b.y);
  for (const f of players) sprite(ctx, f, v, engine.controlled === f, colors, flip);
  for (const f of engine.all) {
    const carrier = engine.ball.holder === f;
    const skill = f.side === 0 && (ELIGIBLE.includes(f.role as Role) || f.role === 'QB' || f.role === 'P');
    if (carrier || skill || f.role === 'KR') nameTag(ctx, f, v, carrier ? '#ffe45c' : '#fff6d6');
  }
  const b = engine.ball, bp = v.toScreen(b.x, b.y);
  if (b.holder) {
    const hp = v.toScreen(b.holder.x, b.holder.y);
    football(ctx, hp.x + facing(b.holder, flip) * 7, hp.y - 15);
  } else {
    // Ground shadow shrinks and the ball grows as it climbs, so the arc reads from above.
    const lift = Math.max(0, b.z - 0.8) * Z_SCALE;
    if (b.z > 1) { const s = Math.max(3, 7 - lift / 25); ctx.fillStyle = 'rgba(4,38,18,.45)'; ctx.beginPath(); ctx.ellipse(bp.x, bp.y, s, s / 2.5, 0, 0, Math.PI * 2); ctx.fill(); }
    football(ctx, bp.x, Math.max(v.y + 8, bp.y - 6 - lift), 1 + Math.min(0.8, lift / 110));
  }
  return v;
}

// ---------- field goal scene ----------

/** Behind-the-kicker perspective: the uprights sit straight ahead so the user can see the target. */
export function drawKick(ctx: CanvasRenderingContext2D, kick: FieldGoalKick, w: number, h: number, colors: FieldPalette) {
  const horizon = Math.round(h * 0.3), camBack = 9, camZ = 3, focal = 540, cx = w / 2;
  const proj = (u: number, d: number, z = 0) => { const s = focal / (d + camBack); return { x: cx + u * s, y: horizon + (camZ - z) * s, s }; };
  const dist = kick.distance, goal = dist - 10;
  // Stands and crowd.
  ctx.fillStyle = '#0d2331'; ctx.fillRect(0, 0, w, horizon);
  const crowd = [colors.defense, colors.defenseTrim, '#f1c9a2', '#e8e4dc', colors.offense];
  for (let y = 10; y < horizon - 14; y += 7) for (let x = (y % 14 ? 3 : 7); x < w; x += 9) { ctx.fillStyle = crowd[(x * 7 + y * 3) % crowd.length]; ctx.fillRect(x, y, 4, 4); }
  ctx.fillStyle = '#1d3b4a'; ctx.fillRect(0, horizon - 12, w, 12);
  ctx.fillStyle = '#0e5a2e'; ctx.fillRect(0, horizon, w, h - horizon);
  // Alternating 5-yard bands between the sidelines, then the end zone.
  const band = (d0: number, d1: number, color: string) => {
    const a = proj(-FIELD_W / 2, d0), b = proj(FIELD_W / 2, d0), c = proj(FIELD_W / 2, d1), e = proj(-FIELD_W / 2, d1);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.closePath(); ctx.fill();
  };
  for (let d = goal, i = 0; d > -8; d -= 5, i++) band(Math.max(-7, d - 5), d, i % 2 ? '#1a7a3d' : '#197038');
  band(goal, dist, colors.defense);
  band(dist, dist + 60, '#155f31');
  ctx.strokeStyle = '#eef2cf';
  for (let d = goal; d > -8; d -= 5) { const a = proj(-FIELD_W / 2, d), b = proj(FIELD_W / 2, d); ctx.lineWidth = Math.max(1, a.s * 0.12); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  for (const u of [-FIELD_W / 2, FIELD_W / 2]) { const a = proj(u, -7), b = proj(u, dist + 60); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

  const ball = kick.ballAt(), bp = proj(ball.u, ball.d, ball.z), shadow = proj(ball.u, ball.d, 0);
  const posts = () => {
    const post = '#f3d23c', thick = (s: number) => Math.max(2, Math.round(s * 0.3));
    const base = proj(0, dist), bar = proj(0, dist, CROSSBAR), l = proj(-POST_HALF_WIDTH, dist, CROSSBAR), r = proj(POST_HALF_WIDTH, dist, CROSSBAR);
    const lt = proj(-POST_HALF_WIDTH, dist, CROSSBAR + 10), rt = proj(POST_HALF_WIDTH, dist, CROSSBAR + 10), t = thick(base.s);
    ctx.fillStyle = '#6b5a12'; ctx.fillRect(Math.round(base.x - t), Math.round(bar.y), t * 2, Math.round(base.y - bar.y));
    ctx.fillStyle = post;
    ctx.fillRect(Math.round(l.x), Math.round(l.y - t / 2), Math.round(r.x - l.x), t);
    ctx.fillRect(Math.round(l.x - t / 2), Math.round(lt.y), t, Math.round(l.y - lt.y));
    ctx.fillRect(Math.round(r.x - t / 2), Math.round(rt.y), t, Math.round(r.y - rt.y));
  };
  const drawBall = () => {
    if (ball.z > 0.6) { ctx.fillStyle = 'rgba(0,30,10,.35)'; ctx.beginPath(); ctx.ellipse(shadow.x, shadow.y, Math.max(2, shadow.s * 0.4), Math.max(1, shadow.s * 0.15), 0, 0, Math.PI * 2); ctx.fill(); }
    const r = Math.max(3, bp.s * 0.3);
    ctx.fillStyle = '#21130f'; ctx.beginPath(); ctx.ellipse(bp.x, bp.y, r + 1, r * 0.75 + 1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a4526'; ctx.beginPath(); ctx.ellipse(bp.x, bp.y, r, r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f7dfab'; ctx.fillRect(Math.round(bp.x - r * 0.4), Math.round(bp.y), Math.max(1, Math.round(r * 0.8)), 1);
  };
  if (ball.d > dist) { drawBall(); posts(); } else { posts(); drawBall(); }

  // Kicker from behind, beside the tee.
  const tee = proj(0, 0);
  ctx.fillStyle = '#e8732c'; ctx.fillRect(Math.round(tee.x - 4), Math.round(tee.y - 2), 8, 4);
  const kicked = kick.stage === 'flight' || kick.stage === 'done';
  const kicker = spriteImage(BACK, { jersey: colors.offense, trim: colors.offenseTrim, helmet: colors.offenseHelmet, skin: SKIN[kick.kicker.skin % SKIN.length] }, 5, false);
  ctx.drawImage(kicker, Math.round(tee.x - (kicked ? 30 : 95)), Math.round(tee.y - kicker.height + (kicked ? -8 : 34)));

  if (!kicked) {
    // Pendulum aimer: a dashed guide swinging from the tee to where it would cross the goal plane.
    const aim = kick.pendulum(), end = proj(dist * Math.tan(aim), dist, CROSSBAR + 2), start = proj(0, 0, 0.3);
    ctx.save(); ctx.strokeStyle = kick.stage === 'aim' ? '#ffe45c' : 'rgba(255,228,92,.55)'; ctx.lineWidth = 3; ctx.setLineDash([9, 7]);
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#ffe45c'; ctx.fillRect(Math.round(end.x - 6), Math.round(end.y - 6), 12, 12);
    ctx.fillStyle = '#0d1b12'; ctx.fillRect(Math.round(end.x - 3), Math.round(end.y - 3), 6, 6);
    ctx.fillStyle = '#ffe45c'; ctx.beginPath(); ctx.arc(start.x, start.y, 6, 0, Math.PI * 2); ctx.fill();
  }

  // Power bar: red → yellow → green (max power) → red (over-kick).
  const bx = w - 62, by = 34, bh = h - 90, bw = 28;
  ctx.fillStyle = '#0d1b12'; ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
  const zone = (from: number, to: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(bx, by + bh * (1 - to), bw, bh * (to - from)); };
  zone(0, POWER_ZONES.yellow, '#c7352b'); zone(POWER_ZONES.yellow, POWER_ZONES.green, '#e6b43a'); zone(POWER_ZONES.green, POWER_ZONES.over, '#48d15f'); zone(POWER_ZONES.over, 1, '#c7352b');
  const my = Math.round(by + bh * (1 - kick.meter()));
  ctx.fillStyle = '#ffffff'; ctx.fillRect(bx - 8, my - 2, bw + 16, 4);
  ctx.beginPath(); ctx.moveTo(bx - 16, my - 8); ctx.lineTo(bx - 8, my); ctx.lineTo(bx - 16, my + 8); ctx.closePath(); ctx.fill();
  drawText(ctx, 'POWER', bx - 5, by + bh + 12, '#fff6d6', 2, '#0b1f14');
  const title = `${dist} YD FIELD GOAL`;
  ctx.fillStyle = 'rgba(8,20,28,.85)'; ctx.fillRect(10, 10, textWidth(title, 3) + 20, 35);
  drawText(ctx, title, 20, 20, '#fff6d6', 3);
  if (kick.badSnap) {
    ctx.fillStyle = 'rgba(8,20,28,.85)'; ctx.fillRect(10, 50, textWidth('BAD SNAP!', 3) + 20, 35);
    drawText(ctx, 'BAD SNAP!', 20, 60, '#ff6b5a', 3);
  }

  if (kick.landed && kick.outcome) {
    const text = kick.good ? "IT'S GOOD!" : `NO GOOD - ${kick.outcome.toUpperCase()}`, s = 5;
    const tw = textWidth(text, s);
    ctx.fillStyle = 'rgba(8,20,28,.8)'; ctx.fillRect(cx - tw / 2 - 20, h * 0.42 - 16, tw + 40, 5 * s + 32);
    drawText(ctx, text, Math.round(cx - tw / 2), Math.round(h * 0.42), kick.good ? '#7cf08a' : '#ff8c74', s);
  }
}
