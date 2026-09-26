import './style.css';
import { MAX_SAVES, createSave, deleteSave, listSaves, loadSave, saveLeague, loadLeague } from './core/save';
import { newLeague } from './model/generate';
import { TEAM_DEFS } from './data/teams';
import { SCHEME_LABELS, schemeForTeam } from './data/schemes';
import { lineup, teamRatings } from './model/depth';
import { finishWeek, finalizeGame, gameKey, playoffRoundName, recordStr, standings, startOffseason, userGameThisWeek, type OffseasonReport } from './model/season';
import { ATTR_LABELS, attrsFor, ovrColor } from './model/ratings';
import { DIFFICULTY_NAMES, POSITIONS, type AttrKey, type Difficulty, type DraftPick, type League, type Notice, type Player, type Pos, type ScheduledGame, type StatKey, type Team } from './model/types';
import { clockLabel, doKickoff, downLabel, expireClock, newGame, applyPlay, quarterLabel, spotLabel, type GameState, type PlayResult } from './sim/gameState';
import { Rng } from './core/rng';
import { ABILITIES, DEV_COLORS, DEV_LABELS, REVEAL_SNAPS, XFACTORS, groupOf, potentialOf } from './model/dev';
import { injuryLabel } from './model/injury';
import { induct } from './model/news';
import { ordinal, refreshNeeds, teamRundown } from './model/rundown';
import { byeWeekOf } from './model/schedule';
import { draftDone, finalizeDraft, initialDraftOrder, makePick, onClock, pickOwner, prepareDraft, projectedRound, simToUserPick, cpuPick, type PickMade } from './model/draft';
import { TRADE_DEADLINE_WEEK, assetLabel, assetValue, evaluateTrade, executeTrade, tradeWindowOpen, type Asset } from './model/trade';
import { afterSnap, condition, snapLineup } from './sim/condition';
import { makeCtx, simStep, type GameCtx } from './sim/simGame';
import { PlayEngine } from './field/engine';
import { DEF_CALLS, ELIGIBLE, HOT_ROUTES, HOT_ROUTES_BACK, PUNT_PLAY, playsForScheme, type Play, type Role, type RouteName } from './field/playbook';
import { Z_SCALE, drawField, drawKick, fieldView, type FieldPalette } from './field/render';
import { FieldGoalKick } from './field/kick';

type Screen = 'title' | 'saves' | 'team' | 'coach' | 'tutorial' | 'hub' | 'roster' | 'depth' | 'player' | 'standings' | 'schedule' | 'leaders' | 'playcall' | 'field' | 'results'
  | 'rundown' | 'draft' | 'trade' | 'news' | 'hof' | 'offseason';
type Button = { x: number; y: number; w: number; h: number; label: string; action: () => void; accent?: boolean };
const W = 960, H = 540;
// In-game layout: scorebar on top, the whole field in the middle, controls in a tray below it.
const TOP = 44, TRAY = 96, FIELD_H = H - TOP - TRAY;
const ROSTER_ROWS = 11, ROW_H = 29;
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

let screen: Screen = loadLeague() ? 'title' : 'title';
let league: League | null = loadLeague();
let game: GameState | null = null;
let gameRef: ScheduledGame | null = null;
let engine: PlayEngine | null = null;
let kick: FieldGoalKick | null = null;
// Result banners ("TOUCHDOWN!!!!", "SACK!!!") flash over the field; the last play stays on screen under them.
type Banner = { text: string; color: string; t: number };
let banners: Banner[] = [];
let lastEngine: PlayEngine | null = null;
let lastPalette: FieldPalette | null = null;
let eventIdx = 0;
let resultShown = false;
const GOOD = '#5ce65c', BAD = '#ec3b2e', ZONE = '#ff9a3c';
let camX = 50;
let playChoices: Play[] = [];
let playKind: 'pass' | 'run' = 'pass';
let playPage = 0;
let activePlay: Play | null = null;
let feedback = '';
let buttons: Button[] = [];
let pointer: { x: number; y: number; sx: number; sy: number; down: boolean; t0: number } | null = null;
const keys = new Set<string>();
let last = performance.now();
let cpuAt = 0;
let viewport = { scale: 1, x: 0, y: 0 };
let joystick: { x: number; y: number } | null = null; // virtual stick for the ball carrier (field space)
const STICK_R = 55; // screen px of thumb travel for a full push
let teamPage = 0;
let rosterScroll = 0;
let depthScroll = 0;
let depthSel: number | null = null;
let selectedPlayerId: number | null = null;
let playerReturn: 'roster' | 'depth' = 'roster';
let pendingTeamId = 0;
let pendingCoachName = 'Coach Riley Morgan';
let pendingDifficulty: Difficulty = 1;
let tutorialPage = 0;
let simCtx: GameCtx | null = null;
let offseasonReport: OffseasonReport | null = null;
type DraftFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DL' | 'LB' | 'DB' | 'K';
let draftFilter = 'ALL' as DraftFilter;
let draftScroll = 0;
let draftSel: number | null = null;
let draftReveal: PickMade | null = null;
let tradePartner = 1;
let tradeGive: Asset[] = [];
let tradeGet: Asset[] = [];
let tradeScroll: [number, number] = [0, 0];
let tradeMsg = '';
let listScroll = 0; // news / hall of fame
let lastGameKey = '';

function team(id: number) { return league!.teams[id]; }
function user() { return team(league!.userTeamId); }
function userIsHome() { return !!game && game.homeId === league!.userTeamId; }
function userSide() { return userIsHome() ? 0 : 1; }
function isUsersBall() { return !!game && game.poss === userSide(); }
function driveFlipped() { return league?.settings.driveDirection === 'left'; }
function toggleDrive() { if (!league) return; league.settings.driveDirection = driveFlipped() ? 'right' : 'left'; saveLeague(league); }
function seed() { return Math.floor(Math.random() * 0x7fffffff); }
function fmtTeam(t: Team) { return `${t.city} ${t.name}`; }
function short(t: Team) { return `${t.city.toUpperCase()} ${t.name.toUpperCase()}`; }
function nowGame() { return game!; }
function selectedPlayer() { return selectedPlayerId === null ? null : league?.players[selectedPlayerId] ?? null; }
function openPlayer(p: Player, from: 'roster' | 'depth') { selectedPlayerId = p.id; playerReturn = from; screen = 'player'; }

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * ratio);
  canvas.height = Math.floor(canvas.clientHeight * ratio);
}
window.addEventListener('resize', resize); resize();

function beginLeague(id = 0) { pendingTeamId = id; screen = 'coach'; }
/** Difficulty can change anytime; it applies from the next game (sim bonus + field AI). */
function cycleDifficulty() { if (!league) return; league.settings.difficulty = ((league.settings.difficulty + 1) % 4) as Difficulty; saveLeague(league); }
function createFranchise() {
  const next = newLeague(seed(), pendingTeamId, { sound: false, quarterMinutes: 3, difficulty: pendingDifficulty, driveDirection: 'right' });
  next.coachName = pendingCoachName;
  // Every season opens with a rundown and the draft, the first one included.
  prepareDraft(next, initialDraftOrder(next));
  next.pendingRundown = true;
  if (!createSave(next, pendingCoachName)) { feedback = `SAVE LIBRARY FULL (${MAX_SAVES})`; screen = 'saves'; return; }
  league = next; tutorialPage = 0; screen = 'tutorial';
}
function loadFranchise(id: string) { const next = loadSave(id); if (next) { league = next; screen = 'hub'; } }

function startGame() {
  const g = userGameThisWeek(league!);
  if (!g) { feedback = 'NO USER GAME THIS ROUND'; return; }
  gameRef = g;
  game = newGame(g.home, g.away, league!.settings.quarterMinutes, league!.phase === 'playoffs', seed());
  simCtx = makeCtx(league!, game);
  // Your snaps run on a live clock; keep CPU drives at a comparable pace instead of 30s per play.
  game.runoffScale = 0.4;
  engine = null; feedback = 'KICKOFF';
  doKickoff(game);
  routePossession();
}

function routePossession() {
  if (!game) return;
  if (game.phase === 'final') { endGame(); return; }
  if (game.phase === 'kickoff') { doKickoff(game); game.clockRunning = false; routePossession(); return; }
  if (game.phase === 'pat') {
    const r = simStep(simCtx!);
    if (r) feedback = r.desc.toUpperCase();
    routePossession(); return;
  }
  if (isUsersBall()) { choosePlays(); callPlay(playChoices[0]); }
  else { screen = 'field'; cpuAt = performance.now() + 650; feedback = 'DEFENSE: CPU DRIVE'; }
}

/** This scheme's plays of one kind (play-action counts as a pass). Each play appears once. */
function playsOfKind(kind: 'pass' | 'run') {
  return playsForScheme(user().scheme).filter(p => (kind === 'run') === (p.type === 'run'));
}
/** The tray shows up to three distinct plays: one page of the chosen kind. */
function choosePlays() {
  const list = playsOfKind(playKind);
  const pages = Math.max(1, Math.ceil(list.length / 3));
  playPage = ((playPage % pages) + pages) % pages;
  playChoices = list.slice(playPage * 3, playPage * 3 + 3);
}
function setPlayKind(kind: 'pass' | 'run') {
  if (!engine || engine.phase !== 'pre') return;
  playKind = kind; playPage = 0; choosePlays(); callPlay(playChoices[0]);
}
function morePlays() {
  if (!engine || engine.phase !== 'pre') return;
  playPage++; choosePlays(); callPlay(playChoices[0]);
}

function audible() {
  if (!activePlay || !engine || engine.phase !== 'pre') return;
  const options = playsForScheme(user().scheme).filter(p => p.formation === activePlay!.formation && p.id !== activePlay!.id);
  if (!options.length) { feedback = 'NO AUDIBLE IN THIS SET'; return; }
  const next = options[(nowGame().playCount + activePlay.name.length) % options.length];
  callPlay(next); feedback = `AUDIBLE: ${next.name.toUpperCase()}`;
}

function view() { return fieldView(W, FIELD_H, camX, driveFlipped()); }
/**
 * Thumb offset from where it landed (screen px) → joystick in field space. The field is drawn
 * wider per yard than it is tall, so directions are converted to keep on-screen motion
 * pointing where the thumb points.
 */
function stickFromScreen(dx: number, dy: number) {
  const len = Math.hypot(dx, dy);
  if (len < 10) return null; // dead zone
  const m = Math.min(1, len / STICK_R), v = view();
  const fx = (driveFlipped() ? -dx : dx) / (v.w / (v.right - v.left)), fy = dy / (v.h / 53.33);
  const fl = Math.hypot(fx, fy) || 1;
  return { x: (fx / fl) * m, y: (fy / fl) * m };
}
function carrierControlled() { return !!engine && engine.phase === 'live' && !!engine.controlled && engine.controlled === engine.carrier; }
function inField(y: number) { return y >= TOP && y < TOP + FIELD_H; }

function hotRouteAt(x: number, y: number) {
  if (!engine || engine.phase !== 'pre' || engine.o.play.type === 'punt') return false;
  // Sprites stand on their field spot, so hit-test around the body, not the feet.
  const receiver = engine.off
    .filter(f => ELIGIBLE.includes(f.role as Role))
    .map(f => ({ f, p: view().toScreen(f.x, f.y) }))
    .find(({ p }) => Math.hypot(p.x - x, p.y - 14 + TOP - y) < 26)?.f;
  if (!receiver) return false;
  const routes = receiver.role === 'RB' || receiver.role === 'FB' ? HOT_ROUTES_BACK : HOT_ROUTES;
  const current = engine.hot[receiver.role as Role];
  const next = routes[(Math.max(0, current ? routes.indexOf(current) : -1) + 1) % routes.length] as RouteName;
  engine.setHot(receiver, next);
  feedback = `${receiver.role} HOT: ${next.toUpperCase()}`;
  return true;
}

function callPlay(play: Play) {
  const g = nowGame();
  // Per-snap lineups: tired starters rotate out; energy, abilities and the zone shape ratings.
  const off = snapLineup(league!, g, teamId(g.poss));
  const def = snapLineup(league!, g, teamId(g.poss === 0 ? 1 : 0));
  const call = game!.ballOn > 87 ? DEF_CALLS.goalline : [DEF_CALLS.cover1, DEF_CALLS.cover2, DEF_CALLS.cover3, DEF_CALLS.cover0][g.playCount % 4];
  joystick = null; kick = null; eventIdx = 0; resultShown = false;
  engine = new PlayEngine({ los: g.ballOn, ballY: g.ballY, toGo: g.toGo, off, def, play, defCall: call, difficulty: league!.settings.difficulty, seed: seed() });
  camX = engine.focusX();
  activePlay = play; screen = 'field'; feedback = `PREVIEW: ${play.name.toUpperCase()}`;
}
function snapPlay() { if (!engine || engine.phase !== 'pre') return; engine.snap(); feedback = ''; }

// ---------- special teams ----------
function canPunt() { return !!game && isUsersBall() && game.down === 4; }
function canKickFg() { return !!game && isUsersBall() && game.ballOn >= 60; }
function startPunt() {
  if (!canPunt()) return;
  callPlay(PUNT_PLAY);
  engine!.snap(); feedback = '';
}
function startFieldGoal() {
  if (!canKickFg()) return;
  const g = nowGame();
  engine = null; activePlay = null;
  const unit = snapLineup(league!, g, teamId(g.poss));
  kick = new FieldGoalKick(g.ballOn, unit.k, seed(), unit.ls);
  feedback = `${kick.distance} YD ATTEMPT`;
}
function finishKick() {
  const k = kick!, id = k.kicker.id, name = `${k.kicker.first[0]}. ${k.kicker.last}`;
  resolve({
    kind: 'fg', yards: 0, elapsed: 5, clockStops: true, good: k.good,
    stats: k.good ? [[id, 'fga', 1], [id, 'fgm', 1]] : [[id, 'fga', 1]],
    desc: k.good ? `${name} ${k.distance} yd field goal is GOOD!` : `${name} ${k.distance} yd field goal NO GOOD, ${k.outcome}`,
  });
}
function palette(offense: Team, defense: Team): FieldPalette {
  return { offense: offense.primary, offenseTrim: offense.secondary, offenseHelmet: offense.helmet, defense: defense.primary, defenseTrim: defense.secondary, defenseHelmet: defense.helmet };
}
function teamId(s: 0 | 1) { return s === 0 ? game!.homeId : game!.awayId; }

/** X-Factor zone headlines become banners; the play description stays in the tray. */
function takeZoneEvents(fallback: string) {
  const ev = game ? condition(game).events.splice(0) : [];
  for (const e of ev) if (e.includes('ZONE')) banner(e.toUpperCase(), ZONE);
  return fallback.toUpperCase();
}
function banner(text: string, color: string) {
  if (banners.length < 3) banners.push({ text, color, t: 0 });
}
/** What just happened, told big: green is good for the user, red is bad (flipped on defense). */
function playBanner(r: PlayResult, userOffense: boolean, ballOn: number, intShown = false) {
  const good = userOffense ? GOOD : BAD, bad = userOffense ? BAD : GOOD;
  if ((r.kind === 'pass' || r.kind === 'run') && ballOn + r.yards >= 100) return banner('TOUCHDOWN!!!!', good);
  switch (r.kind) {
    case 'pass': if (userOffense && r.yards > 0) banner('CATCH!!', GOOD); break;
    case 'incomplete': banner(/broken up/i.test(r.desc) ? 'PBU!' : 'INCOMPLETE', bad); break;
    case 'int': if (r.defTd) banner('PICK SIX!!!', bad); else if (!intShown) banner('INTERCEPTION!!!', bad); break;
    case 'sack': banner('SACK!!!', bad); break;
    case 'fumble': banner('FUMBLE!!', bad); break;
    case 'punt': if (r.defTd) banner('RETURN TOUCHDOWN!!', bad); break;
    case 'fg': banner(r.good ? 'FIELD GOAL!' : 'NO GOOD', r.good ? good : bad); break;
  }
}
function drawBanner() {
  const b = banners[0];
  if (!b) return;
  const y = TOP + FIELD_H * 0.62;
  ctx.fillStyle = 'rgba(8,14,18,.7)'; ctx.fillRect(0, y - 38, W, 76);
  // Flash for the first beat, then hold.
  if (b.t > 0.6 || Math.floor(b.t / 0.12) % 2 === 0) {
    drawText(b.text, W / 2 + 4, y + 5, 48, 'rgba(0,0,0,.55)', 'center', W - 60);
    drawText(b.text, W / 2, y + 1, 48, b.color, 'center', W - 60);
  }
}

function resolve(result: PlayResult) {
  const g = nowGame();
  const onField = engine ? engine.all.map(f => f.p) : kick ? [kick.kicker] : [];
  afterSnap(league!, g, onField, result);
  if (kick) playBanner(result, true, g.ballOn);
  const poss = g.poss;
  if (engine) {
    // The game clock already ran live during the play; don't charge elapsed time or runoff again.
    lastEngine = engine; lastPalette = palette(team(teamId(g.poss)), team(teamId(g.poss === 0 ? 1 : 0)));
    applyPlay(g, { ...result, elapsed: 0, clockStops: true });
    g.clockRunning = !result.clockStops && (result.kind === 'run' || result.kind === 'pass' || result.kind === 'sack') && g.poss === poss && g.phase === 'play';
  } else {
    applyPlay(g, result);
    g.clockRunning = false;
  }
  feedback = takeZoneEvents(result.desc); engine = null; kick = null;
  setTimeout(routePossession, 700);
}
function endGame() {
  if (!league || !game || !gameRef) return;
  lastGameKey = gameKey(gameRef);
  finalizeGame(league, gameRef, game, new Rng(seed()));
  finishWeek(league); saveLeague(league); screen = 'results';
}

/** Menus never draw text smaller than this (canvas px; ~8pt once scaled onto a phone). */
const MENU_MIN_TEXT = 11;
/**
 * `maxWidth` shrinks the font until the text fits (down to a readable floor), then truncates
 * with "..." rather than overflow, so long team and player names stay inside their boxes.
 */
function drawText(s: string, x: number, y: number, size = 16, color = '#eef2d5', align: CanvasTextAlign = 'left', maxWidth?: number) {
  const menu = screen !== 'field';
  if (menu) size = Math.max(size, MENU_MIN_TEXT);
  ctx.font = `${size}px 'Press Start 2P', monospace`;
  if (maxWidth) {
    const floor = Math.min(size, menu ? 10 : 7);
    while (size > floor && ctx.measureText(s).width > maxWidth) ctx.font = `${--size}px 'Press Start 2P', monospace`;
    if (ctx.measureText(s).width > maxWidth) { while (s.length > 1 && ctx.measureText(`${s}...`).width > maxWidth) s = s.slice(0, -1); s = `${s.trimEnd()}...`; }
  }
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function panel(x: number, y: number, w: number, h: number, color = '#16364a') {
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#71b9bc'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}
function button(x: number, y: number, w: number, h: number, label: string, action: () => void, accent = false) {
  buttons.push({ x, y, w, h, label, action, accent });
  ctx.fillStyle = accent ? '#e9a83a' : '#28546a'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = accent ? '#fff0a0' : '#79c3c4'; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  drawText(label, x + w / 2, y + h / 2 + 1, 13, accent ? '#162737' : '#f4f1d7', 'center', w - 12);
}

function drawTitle() {
  top(''); ctx.fillStyle = '#174f35'; ctx.fillRect(0, 0, W, H);
  for (let x = 30; x < W; x += 45) { ctx.fillStyle = '#236b44'; ctx.fillRect(x, 0, 3, H); }
  drawText('RETRO', W / 2, 125, 46, '#f4e7a5', 'center'); drawText('RUSH', W / 2, 185, 50, '#ffb347', 'center');
  drawText('FRANCHISE FOOTBALL', W / 2, 240, 16, '#e8f1d5', 'center');
  if (league) {
    button(310, 272, 340, 46, `CONTINUE ${user().abbr}`, () => screen = 'hub', true);
    button(310, 326, 340, 44, 'FRANCHISE SAVES', () => screen = 'saves');
    button(310, 378, 340, 44, 'NEW FRANCHISE', () => screen = 'team');
    button(310, 430, 340, 42, 'HOW TO PLAY', () => { tutorialPage = 0; screen = 'tutorial'; });
  } else {
    button(310, 300, 340, 50, 'NEW FRANCHISE', () => screen = 'team', true);
    button(310, 362, 340, 46, 'FRANCHISE SAVES', () => screen = 'saves');
    button(310, 418, 340, 46, 'HOW TO PLAY', () => { tutorialPage = 0; screen = 'tutorial'; });
  }
  drawText('PLAY IN LANDSCAPE • TOUCH OR KEYBOARD', W / 2, 505, 12, '#d2e8ce', 'center');
}

function drawSaveLibrary() {
  top('FRANCHISE SAVES'); panel(50, 70, 860, 385); const saves = listSaves();
  drawText(`${saves.length} / ${MAX_SAVES} FRANCHISE SLOTS ON THIS DEVICE`, 76, 100, 13, '#f6d365', 'left', 800);
  if (!saves.length) drawText('NO SAVES YET — CREATE YOUR FIRST FRANCHISE.', W / 2, 240, 14, '#d8ead8', 'center', 800);
  saves.forEach((save, i) => {
    const t = TEAM_DEFS[save.teamId], y = 128 + i * 106;
    ctx.fillStyle = t.primary; ctx.fillRect(72, y, 580, 92); ctx.strokeStyle = '#8ac7c6'; ctx.strokeRect(72, y, 580, 92);
    drawText(`${t.city} ${t.name}`.toUpperCase(), 92, y + 26, 16, '#fff6d6', 'left', 540);
    drawText(save.coachName.toUpperCase(), 92, y + 56, 13, '#d8ead8', 'left', 330);
    drawText(`${save.year} • WEEK ${save.week + 1}`, 632, y + 56, 13, '#fff6d6', 'right');
    button(668, y + 4, 222, 44, 'LOAD', () => loadFranchise(save.id), true);
    button(668, y + 54, 222, 36, 'DELETE', () => { deleteSave(save.id); league = null; });
  });
  if (saves.length < MAX_SAVES) button(310, 470, 340, 48, 'CREATE NEW FRANCHISE', () => screen = 'team', true);
  else drawText('DELETE A SAVE TO OPEN A NEW SLOT.', W / 2, 494, 13, '#f6d365', 'center');
  button(60, 470, 170, 48, 'BACK', () => screen = 'title');
}

const DIFF_COLORS = ['#9ee8c2', '#f6d365', '#ff9a3c', '#ff6b5a'];
const DIFF_BLURBS = ['SLOWER DEFENDERS, EASIER COVERAGE', 'BALANCED NFL CHALLENGE', 'SHARP AI, TIGHT WINDOWS', 'ELITE AI ON BOTH SIDES OF THE BALL'];
function drawCoachSetup() {
  const t = TEAM_DEFS[pendingTeamId]; top('CREATE YOUR COACH'); panel(110, 70, 740, 440, t.primary);
  drawText(`${t.city} ${t.name}`.toUpperCase(), W / 2, 106, 22, '#fff6d6', 'center', 690); drawText('HEAD COACH & GM', W / 2, 140, 14, '#d8ead8', 'center');
  panel(230, 160, 500, 84, '#17394d'); drawText('COACH NAME', W / 2, 184, 13, '#f6d365', 'center'); drawText(pendingCoachName.toUpperCase(), W / 2, 218, 18, '#fff6d6', 'center', 460);
  drawText('DIFFICULTY', W / 2, 272, 14, '#f6d365', 'center');
  DIFFICULTY_NAMES.forEach((name, i) => button(140 + i * 172, 290, 164, 46, name.toUpperCase(), () => { pendingDifficulty = i as Difficulty; }, pendingDifficulty === i));
  drawText(DIFF_BLURBS[pendingDifficulty], W / 2, 356, 12, DIFF_COLORS[pendingDifficulty], 'center', 680);
  button(170, 384, 200, 50, 'EDIT NAME', () => { const name = window.prompt('Coach / GM name', pendingCoachName); if (name?.trim()) pendingCoachName = name.trim().slice(0, 24); });
  button(380, 384, 200, 50, 'PICK TEAM', () => screen = 'team');
  button(590, 384, 200, 50, 'START JOB', createFranchise, true);
  drawText('YOU CAN CHANGE DIFFICULTY ANYTIME FROM THE HUB.', W / 2, 468, 12, '#d8ead8', 'center', 680);
}

function drawTutorial() {
  top(`HOW TO PLAY  ${tutorialPage + 1}/3`); panel(50, 72, 860, 372, tutorialPage === 1 ? '#1c6840' : '#17394d');
  const pages = [
    { title: 'CALL, PREVIEW, SNAP', body: ['1. PICK A PLAY IN THE TRAY BELOW THE FIELD.', '2. ROUTES SHOW BEFORE THE SNAP.', '3. TAP A RECEIVER FOR A HOT ROUTE.', '4. DRAG BACK FROM THE QB TO SNAP AND AIM.'] },
    { title: 'PASS, RUN, KICK', body: ['RELEASE TO PASS. DRAG FORWARD TO RUN WITH THE QB.', 'WITH THE BALL: HOLD + DRAG ANYWHERE = JOYSTICK.', 'FLICK UP/DOWN TO JUKE, FORWARD TO DIVE.', '4TH DOWN: PUNT. PAST YOUR 60: FIELD GOAL.'] },
    { title: 'BUILD YOUR FRANCHISE', body: ['SWIPE THROUGH THE 69-PLAYER ROSTER.', 'TAP A PLAYER FOR RATINGS AND STATS.', 'SET YOUR STARTERS ON THE DEPTH CHART.', 'YOUR FRANCHISE SAVES ON THIS DEVICE.'] },
  ][tutorialPage];
  drawText(pages.title, W / 2, 118, 22, '#f6d365', 'center');
  pages.body.forEach((line, i) => drawText(line, 84, 186 + i * 60, 15, '#eef2d5', 'left', 800));
  if (tutorialPage > 0) button(120, 460, 220, 50, '← BACK', () => tutorialPage--);
  button(620, 460, 220, 50, tutorialPage === 2 ? (league ? 'START SEASON' : 'FINISH') : 'NEXT →', () => { if (tutorialPage < 2) tutorialPage++; else screen = seasonEntry(); }, true);
}
function drawTeamPick() {
  top('CHOOSE YOUR TEAM');
  const pageSize = 8, pages = Math.ceil(TEAM_DEFS.length / pageSize);
  const teams = TEAM_DEFS.slice(teamPage * pageSize, teamPage * pageSize + pageSize).map((team, i) => ({ ...team, id: teamPage * pageSize + i }));
  teams.forEach((t, i) => {
    const x = 26 + (i % 4) * 232, y = 70 + Math.floor(i / 4) * 188;
    panel(x, y, 220, 176, t.primary);
    drawText(t.city.toUpperCase(), x + 110, y + 30, 14, '#fff', 'center', 196);
    drawText(t.name.toUpperCase(), x + 110, y + 62, 16, '#fff7d0', 'center', 196);
    drawText(SCHEME_LABELS[schemeForTeam(t.id)].toUpperCase(), x + 110, y + 94, 12, '#d5f0d7', 'center', 196);
    button(x + 20, y + 118, 180, 42, 'SELECT', () => beginLeague(t.id), true);
  });
  button(26, 454, 190, 50, '← PREV', () => { teamPage = (teamPage + pages - 1) % pages; });
  button(744, 454, 190, 50, 'NEXT →', () => { teamPage = (teamPage + 1) % pages; });
  drawText(`PAGE ${teamPage + 1} / ${pages}`, W / 2, 479, 14, '#c9ddd0', 'center');
}
function top(title: string) {
  ctx.fillStyle = '#102b3d'; ctx.fillRect(0, 0, W, H);
  const nav = !!league && !['title', 'saves', 'team', 'coach', 'tutorial', 'field', 'playcall'].includes(screen);
  drawText(title, 20, 32, 20, '#f6d365', 'left', nav ? 264 : 900);
  if (nav) {
    const labels: [string, Screen][] = [['HUB', 'hub'], ['ROSTER', 'roster'], ['DEPTH', 'depth'], ['TRADE', 'trade'],
      league!.phase === 'draft' ? ['DRAFT', 'draft'] : ['STAND', 'standings'], ['SCHED', 'schedule'], ['NEWS', 'news'], ['HOF', 'hof']];
    labels.forEach(([label, to], i) => button(292 + i * 83.5, 12, 80, 42, label, () => { screen = to; listScroll = 0; }, screen === to));
  }
}
/** Which screen the season flow wants next once the user leaves the tutorial / offseason recap. */
function seasonEntry(): Screen {
  if (!league) return 'title';
  if (league.pendingRundown) return 'rundown';
  return league.phase === 'draft' ? 'draft' : 'hub';
}
function simWeek() {
  if (!league || (league.phase !== 'regular' && league.phase !== 'playoffs')) return;
  finishWeek(league); saveLeague(league);
}
function beginOffseason() {
  if (!league || league.phase !== 'offseason') return;
  offseasonReport = startOffseason(league);
  league.pendingRundown = true;
  saveLeague(league); listScroll = 0; screen = 'offseason';
}
const NOTICE_COLORS: Record<Notice['kind'], string> = { upgrade: '#9ee8c2', injury: '#ff8c74', retire: '#f6d365', reveal: '#83d9ff', trade: '#e7b8ff', draft: '#f6d365', zone: '#ff6b5a', league: '#c9ddd0', needs: '#ff9a3c' };
function drawHub() {
  const t = user(), l = league!; const rows = standings(l); const row = rows.find(r => r.team.id === t.id)!; top(`${l.year} SEASON`);
  panel(24, 66, 424, 432, t.primary);
  drawText(t.city.toUpperCase(), 44, 94, 15, '#fff8da', 'left', 384); drawText(t.name.toUpperCase(), 44, 124, 24, '#fff8da', 'left', 384);
  drawText(`COACH ${(l.coachName ?? 'COACH').replace(/^coach\s+/i, '').toUpperCase()}`, 44, 152, 12, '#d8ead8', 'left', 384);
  drawText(`RECORD  ${recordStr(row)}`, 44, 184, 16);
  const rating = teamRatings(l, t);
  drawText(`OVR ${rating.ovr} • OFF ${rating.off} • DEF ${rating.def}`, 44, 214, 13, '#eef2d5', 'left', 384);
  drawText(`${SCHEME_LABELS[t.scheme].toUpperCase()} OFFENSE`, 44, 240, 12, '#f6d365', 'left', 384);
  const next = userGameThisWeek(l);
  const status = (a: string, b: string) => { drawText(a, 44, 280, 15, '#fff7d0', 'left', 384); drawText(b, 44, 310, 12, '#d8ead8', 'left', 384); };
  if (l.phase === 'draft') {
    status(`${l.year} DRAFT`, 'BUILD THROUGH THE DRAFT, THEN KICK OFF.');
    button(44, 340, 384, 60, 'GO TO DRAFT', () => screen = 'draft', true);
  } else if (l.phase === 'offseason') {
    const champ = l.playoffs?.champion;
    status(champ !== undefined ? `CHAMPS: ${short(team(champ))}` : 'SEASON COMPLETE', 'RETIREMENTS, DEVELOPMENT, THEN THE DRAFT.');
    button(44, 340, 384, 60, 'START OFFSEASON', beginOffseason, true);
  } else if (next) {
    const opp = team(next.home === t.id ? next.away : next.home);
    status(l.phase === 'playoffs' ? playoffRoundName(l.playoffs!.round).toUpperCase() : `WEEK ${l.week + 1}`, `NEXT: ${next.home === t.id ? 'VS' : 'AT'} ${fmtTeam(opp)}`.toUpperCase());
    button(44, 340, 384, 60, 'PLAY GAME', startGame, true);
  } else {
    status(l.phase === 'playoffs' ? 'ELIMINATED' : `WEEK ${l.week + 1}: BYE`, l.phase === 'playoffs' ? 'SIM AHEAD TO CROWN A CHAMPION.' : 'YOUR PLAYERS REST AND HEAL.');
    button(44, 340, 384, 60, l.phase === 'playoffs' ? 'SIM ROUND' : 'SIM BYE WEEK', simWeek, true);
  }
  if (l.phase === 'regular') drawText(`BYE: WEEK ${byeWeekOf(l.schedule, t.id) + 1} • DEADLINE: WK ${TRADE_DEADLINE_WEEK}`, 44, 428, 12, '#d8ead8', 'left', 384);
  drawText(`DIFFICULTY: ${DIFFICULTY_NAMES[l.settings.difficulty].toUpperCase()}`, 44, 462, 12, DIFF_COLORS[l.settings.difficulty], 'left', 384);

  panel(464, 66, 472, 432); drawText('LATEST NEWS', 486, 92, 14, '#f6d365');
  const news = l.inbox.slice(-3).reverse();
  if (!news.length) drawText('NO NEWS YET.', 486, 120, 12, '#b9d5c9');
  news.forEach((n, i) => drawText(n.text.toUpperCase(), 486, 118 + i * 25, 12, NOTICE_COLORS[n.kind], 'left', 430));
  // Live team needs: recomputed whenever the roster changes (injuries, development, trades, depth).
  if (!l.needs) refreshNeeds(l, false);
  const needs = l.needs!;
  drawText('TEAM NEEDS', 486, 200, 14, '#ff9a3c');
  if (!needs.weak.length) drawText('NO WEAK UNITS RIGHT NOW', 486, 226, 12, '#9ee8c2', 'left', 430);
  needs.weak.slice(0, 2).forEach((w, i) => drawText(`• ${w}`.toUpperCase(), 486, 226 + i * 24, 12, '#ff8c74', 'left', 430));
  if (needs.weak.length < 2 && needs.strong[0]) drawText(`★ ${needs.strong[0]}`.toUpperCase(), 486, 226 + Math.max(1, needs.weak.length) * 24, 12, '#9ee8c2', 'left', 430);
  const inSeason = l.phase === 'regular' || l.phase === 'playoffs';
  const bx = 486, bw = 138;
  if (inSeason) button(bx, 300, bw, 50, 'SIM WEEK', simWeek);
  button(inSeason ? bx + bw + 8 : bx, 300, bw, 50, 'RUNDOWN', () => screen = 'rundown');
  button(inSeason ? bx + (bw + 8) * 2 : bx + bw + 8, 300, bw, 50, 'LEADERS', () => { listScroll = 0; screen = 'leaders'; });
  button(bx, 360, 212, 50, 'HALL OF FAME', () => { listScroll = 0; screen = 'hof'; });
  button(bx + 220, 360, 210, 50, 'DIFFICULTY', cycleDifficulty);
  button(bx, 420, 430, 50, l.settings.sound ? 'SOUND: ON' : 'SOUND: OFF', () => { l.settings.sound = !l.settings.sound; saveLeague(l); });
}
type RosterEntry = { p: Player; unit: 'ACTIVE' | 'PRACTICE'; depth?: number };

function rosterEntries(depth: boolean): RosterEntry[] {
  const t = user();
  if (depth) {
    // Every active player, grouped by position in depth order (the order the user edits).
    return POSITIONS.flatMap(pos => (t.depth[pos] ?? []).filter(id => league!.players[id]).map((id, i) => ({ p: league!.players[id], unit: 'ACTIVE' as const, depth: i + 1 })));
  }
  const byRating = (a: Player, b: Player) => a.pos.localeCompare(b.pos) || b.ovr - a.ovr;
  return [
    ...t.roster.map(id => league!.players[id]).sort(byRating).map(p => ({ p, unit: 'ACTIVE' as const })),
    ...t.practice.map(id => league!.players[id]).sort(byRating).map(p => ({ p, unit: 'PRACTICE' as const })),
  ];
}

/** How many players at each position start (the rest are backups). */
const STARTER_SLOTS: Partial<Record<Pos, number>> = { WR: 3, TE: 1, DE: 2, DT: 2, OLB: 2, CB: 3 };
function startersAt(pos: Pos) { return STARTER_SLOTS[pos] ?? 1; }
function moveInDepth(pos: Pos, id: number, to: number) {
  const list = user().depth[pos]!, from = list.indexOf(id);
  if (from < 0) return;
  list.splice(from, 1); list.splice(Math.max(0, Math.min(to, list.length)), 0, id);
  refreshNeeds(league!); saveLeague(league!);
}
function swapInDepth(pos: Pos, a: number, b: number) {
  const list = user().depth[pos]!, i = list.indexOf(a), j = list.indexOf(b);
  if (i < 0 || j < 0) return;
  [list[i], list[j]] = [list[j], list[i]];
  refreshNeeds(league!); saveLeague(league!);
  feedback = `${league!.players[list[i]].last.toUpperCase()} ↔ ${league!.players[list[j]].last.toUpperCase()}`;
}
function tapDepthRow(p: Player) {
  const sel = depthSel !== null ? league!.players[depthSel] : null;
  if (sel?.id === p.id) { depthSel = null; openPlayer(p, 'depth'); return; }
  if (sel && sel.pos === p.pos) { swapInDepth(p.pos, sel.id, p.id); depthSel = null; return; }
  depthSel = p.id; feedback = '';
}
/** Shorter attribute names so the player card can use a readable font size. */
const ATTR_SHORT: Partial<Record<AttrKey, string>> = {
  dac: 'DEEP ACC', pac: 'PLAY ACTN', elu: 'ELUSIVE', spc: 'SPEC CATCH', rte: 'ROUTES', ibk: 'IMPACT BLK',
  bsh: 'BLOCK SHED', prc: 'PLAY RECOG', man: 'MAN COV', zon: 'ZONE COV', kac: 'KICK ACC', kpw: 'KICK PWR',
  snp: 'SNAPPING', thp: 'THROW PWR', awr: 'AWARENESS', dur: 'DURABILITY', pbk: 'PASS BLK', rbk: 'RUN BLK', prs: 'PASS RUSH',
};
function drawDepth() {
  top('DEPTH CHART');
  const rows = rosterEntries(true), shown = rows.slice(depthScroll, depthScroll + ROSTER_ROWS);
  panel(24, 66, 912, 432);
  drawText('TAP A PLAYER, THEN ANOTHER AT HIS SPOT TO SWAP', 44, 90, 12, '#f6d365', 'left', 820);
  [['SLOT', 44], ['PLAYER', 130], ['OVR', 452], ['AGE', 512], ['DEV', 552], ['FRESH', 668], ['ROLE', 748]].forEach(([h, x]) => drawText(String(h), Number(x), 116, 12, '#f6d365', h === 'OVR' || h === 'AGE' ? 'center' : 'left'));
  shown.forEach((entry, i) => {
    const y = 130 + i * ROW_H, p = entry.p, slot = entry.depth!, starter = slot <= startersAt(p.pos), sel = depthSel === p.id;
    const swapTarget = depthSel !== null && !sel && league!.players[depthSel]?.pos === p.pos;
    ctx.fillStyle = sel ? '#6b5a12' : swapTarget ? '#2d5a3a' : i % 2 ? '#1b4054' : '#17394d'; ctx.fillRect(36, y, 834, ROW_H - 2);
    buttons.push({ x: 36, y, w: 834, h: ROW_H - 2, label: p.last, action: () => tapDepthRow(p) });
    const cy = y + ROW_H / 2;
    drawText(`${p.pos}${slot}`, 44, cy, 14, starter ? '#9ee8c2' : '#c9ddd0', 'left', 80);
    drawText(`${p.first} ${p.last}`, 130, cy, 14, '#fff5d5', 'left', 290);
    drawText(String(p.ovr), 452, cy, 14, ovrColor(p.ovr), 'center'); drawText(String(p.age), 512, cy, 14, '#eef2d5', 'center');
    const [dev, devColor] = devTag(p); drawText(dev, 552, cy, 12, devColor, 'left', 108);
    conditionBar(668, cy, 66, 100 - p.wear);
    drawText(p.injury ? 'INJURED' : starter ? 'STARTER' : 'BACKUP', 748, cy, 12, p.injury ? '#ff8c74' : starter ? '#9ee8c2' : '#c9ddd0', 'left', 118);
  });
  button(878, 130, 50, 60, '▲', () => scrollRoster(-5)); button(878, 198, 50, 60, '▼', () => scrollRoster(5));
  const sel = depthSel !== null ? league!.players[depthSel] : null;
  if (sel) {
    const slot = user().depth[sel.pos]!.indexOf(sel.id);
    drawText(`${sel.pos} ${sel.last}`.toUpperCase(), 44, 476, 13, '#f6d365', 'left', 250);
    if (slot > 0) button(300, 456, 196, 38, 'MAKE STARTER', () => { moveInDepth(sel.pos, sel.id, 0); feedback = `${sel.last.toUpperCase()} NOW STARTS`; depthSel = null; }, true);
    if (slot > 0) button(504, 456, 116, 38, '▲ UP', () => moveInDepth(sel.pos, sel.id, slot - 1));
    button(628, 456, 130, 38, '▼ DOWN', () => moveInDepth(sel.pos, sel.id, slot + 1));
    button(766, 456, 104, 38, 'CARD', () => { depthSel = null; openPlayer(sel, 'depth'); });
  } else {
    drawText(feedback && screen === 'depth' ? feedback : `${depthScroll + 1}-${Math.min(depthScroll + ROSTER_ROWS, rows.length)} OF ${rows.length} • SWIPE TO SCROLL • TAP TWICE FOR CARD`, 44, 476, 12, '#c9ddd0', 'left', 820);
  }
}

function scrollRoster(delta: number) {
  const depth = screen === 'depth', rows = rosterEntries(depth), max = Math.max(0, rows.length - ROSTER_ROWS);
  if (depth) depthScroll = Math.max(0, Math.min(max, depthScroll + delta));
  else rosterScroll = Math.max(0, Math.min(max, rosterScroll + delta));
}

/** Dev tag as the user may see it: hidden rookies keep their true trait secret. */
function devTag(p: Player): [string, string] {
  return p.devHidden ? ['HIDDEN', '#b9a6ff'] : [DEV_LABELS[p.dev].toUpperCase(), DEV_COLORS[p.dev]];
}
function conditionBar(x: number, y: number, w: number, value: number) {
  ctx.fillStyle = '#0d2430'; ctx.fillRect(x, y - 7, w, 14);
  ctx.fillStyle = value > 70 ? '#6fdc6f' : value > 45 ? '#f2c14e' : '#e0503a'; ctx.fillRect(x, y - 7, Math.round(w * value / 100), 14);
}
function drawRoster() {
  top('ROSTER');
  const rows = rosterEntries(false), start = rosterScroll, shown = rows.slice(start, start + ROSTER_ROWS);
  panel(24, 66, 912, 432);
  drawText('ACTIVE 53 + PRACTICE SQUAD 16 • TAP A PLAYER', 44, 90, 12, '#f6d365', 'left', 820);
  [['POS', 44], ['PLAYER', 130], ['OVR', 452], ['AGE', 512], ['DEV', 552], ['FRESH', 668], ['STATUS', 748]].forEach(([h, x]) => drawText(String(h), Number(x), 116, 12, '#f6d365', h === 'OVR' || h === 'AGE' ? 'center' : 'left'));
  shown.forEach((entry, i) => {
    const y = 130 + i * ROW_H, p = entry.p, col = i % 2 ? '#1b4054' : '#17394d';
    ctx.fillStyle = col; ctx.fillRect(36, y, 834, ROW_H - 2);
    buttons.push({ x: 36, y, w: 834, h: ROW_H - 2, label: p.last, action: () => openPlayer(p, 'roster') });
    const ps = entry.unit === 'PRACTICE', cy = y + ROW_H / 2;
    drawText(`${ps ? 'PS ' : ''}${p.pos}`, 44, cy, 14, ps ? '#a9cdf1' : '#eef2d5', 'left', 80);
    drawText(`${p.first} ${p.last}`, 130, cy, 14, '#fff5d5', 'left', 290);
    drawText(String(p.ovr), 452, cy, 14, ovrColor(p.ovr), 'center'); drawText(String(p.age), 512, cy, 14, '#eef2d5', 'center');
    const [dev, devColor] = devTag(p); drawText(dev, 552, cy, 12, devColor, 'left', 108);
    conditionBar(668, cy, 66, 100 - p.wear);
    drawText(p.injury ? `${(p.injuryType ?? 'INJURED').toUpperCase()} ${p.injury >= 30 ? 'SEASON' : `${p.injury}W`}` : 'HEALTHY', 748, cy, 12, p.injury ? '#ff8c74' : '#9ee8c2', 'left', 118);
  });
  button(878, 130, 50, 60, '▲', () => scrollRoster(-5)); button(878, 198, 50, 60, '▼', () => scrollRoster(5));
  drawText(`${start + 1}-${Math.min(start + ROSTER_ROWS, rows.length)} OF ${rows.length} • SWIPE TO SCROLL`, 44, 476, 12, '#c9ddd0', 'left', 820);
}
function drawPlayerCard() {
  const p = selectedPlayer();
  if (!p) { screen = playerReturn; return; }
  top('PLAYER CARD'); panel(24, 66, 912, 432, '#17394d');
  ctx.fillStyle = user().primary; ctx.fillRect(40, 80, 280, 160);
  drawText(`#${p.num}  ${p.pos}`, 56, 102, 16, '#fff6d6'); drawText(p.first.toUpperCase(), 56, 130, 13, '#d7ead5', 'left', 170); drawText(p.last.toUpperCase(), 56, 158, 20, '#fff6d6', 'left', 170);
  drawText(`AGE ${p.age} • YR ${p.yearsPro}`, 56, 188, 12, '#d7ead5', 'left', 250);
  drawText(String(p.ovr), 276, 124, 34, ovrColor(p.ovr), 'center'); drawText('OVR', 276, 164, 12, '#fff6d6', 'center');
  drawText(p.injury ? injuryLabel(p.injury, p.injuryType) : 'HEALTHY', 56, 218, 12, p.injury ? '#ff8c74' : '#9ee8c2', 'left', 250);
  button(730, 78, 194, 42, playerReturn === 'depth' ? '← DEPTH' : '← ROSTER', () => screen = playerReturn);

  // Development trait and abilities (hidden rookies keep theirs secret until REVEAL_SNAPS snaps).
  const [dev, devColor] = devTag(p);
  drawText(`${dev} DEV`, 338, 96, 16, devColor, 'left', 380);
  if (p.devHidden) {
    drawText(`REVEALED AT ${REVEAL_SNAPS} SNAPS (${Math.min(p.snaps, REVEAL_SNAPS)}/${REVEAL_SNAPS})`, 338, 128, 12, '#d8ead8', 'left', 380);
    drawText('ABILITIES: ???', 338, 156, 13, '#b9a6ff');
  } else if (!p.abilities.length) {
    drawText('NO ABILITIES', 338, 128, 13, '#b8d3c6', 'left', 380);
    if (potentialOf(p) !== p.dev) drawText(`POTENTIAL: ${DEV_LABELS[potentialOf(p)].toUpperCase()}`, 338, 156, 12, DEV_COLORS[potentialOf(p)], 'left', 380);
  } else {
    p.abilities.forEach((id, i) => { const a = ABILITIES.find(x => x.id === id)!; drawText(`★ ${a.name.toUpperCase()}`, 338 + (i % 2) * 196, 128 + Math.floor(i / 2) * 28, 12, '#f2c14e', 'left', 190); });
    if (p.xfactor) { const x = XFACTORS[groupOf(p.pos)]; drawText(`X-FACTOR ${x.name.toUpperCase()}: ${x.objective.toUpperCase()}`, 338, 192, 12, '#ff6b5a', 'left', 380); }
  }
  drawText('FRESHNESS', 740, 144, 12, '#d8ead8'); conditionBar(740, 166, 184, 100 - p.wear);
  drawText(`${p.snaps} SNAPS`, 740, 192, 12, '#b8d3c6', 'left', 184);
  if (p.draft) drawText(`DRAFTED ${p.draft.year} RD ${p.draft.round} #${p.draft.pick}`, 338, 222, 12, '#c9ddd0', 'left', 380);

  drawText('ATTRIBUTES', 44, 264, 15, '#f6d365');
  attrsFor(p.pos).forEach((key, i) => {
    const col = i % 2, row = Math.floor(i / 2), x = 44 + col * 262, y = 296 + row * 36, value = p.attrs[key] ?? 0;
    drawText(ATTR_SHORT[key] ?? ATTR_LABELS[key].toUpperCase(), x, y, 12, '#d8ead8', 'left', 140);
    ctx.fillStyle = '#0d2430'; ctx.fillRect(x + 148, y - 7, 56, 14); ctx.fillStyle = ovrColor(value); ctx.fillRect(x + 148, y - 7, Math.round(value * .56), 14);
    drawText(String(value), x + 246, y, 13, '#fff6d6', 'right');
  });

  drawText('SEASON STATS', 590, 264, 15, '#f6d365');
  const stats = Object.entries(p.stats).filter(([, value]) => (value ?? 0) > 0) as [StatKey, number][];
  if (!stats.length) drawText('NO STATS YET', 590, 296, 12, '#b8d3c6');
  stats.slice(0, 6).forEach(([key, value], i) => { const x = 590 + (i % 2) * 170, y = 296 + Math.floor(i / 2) * 32; drawText(STAT_LABELS[key] ?? key.toUpperCase(), x, y, 12, '#d8ead8', 'left', 110); drawText(String(value), x + 160, y, 13, '#fff6d6', 'right'); });
  drawText('CAREER', 590, 408, 15, '#f6d365');
  const last = p.career.at(-1);
  drawText(last ? `${p.career.length} SEASONS • LAST ${last.ovr} OVR` : p.yearsPro ? `${p.yearsPro}-YR VET • 1ST YEAR HERE` : 'ROOKIE SEASON', 590, 438, 12, '#d8ead8', 'left', 330);
  if (p.combine) { const c = p.combine; drawText(`40 ${c.forty.toFixed(2)} • BENCH ${c.bench} • VERT ${c.vertical}"`, 590, 468, 12, '#c9ddd0', 'left', 330); }
}

const STAT_LABELS: Partial<Record<StatKey, string>> = {
  gp: 'GAMES', passAtt: 'ATT', passCmp: 'COMP', passYds: 'PASS YDS', passTd: 'PASS TD', passInt: 'INT', sacked: 'SACKED',
  rushAtt: 'RUSH ATT', rushYds: 'RUSH YDS', rushTd: 'RUSH TD', rec: 'REC', recYds: 'REC YDS', recTd: 'REC TD',
  tkl: 'TACKLES', sack: 'SACKS', defInt: 'DEF INT', fgm: 'FG MADE', fga: 'FG ATT', xpm: 'XP MADE', xpa: 'XP ATT', punts: 'PUNTS', puntYds: 'PUNT YDS',
};

const STANDINGS_ROWS = 13;
function drawStandings() {
  top('STANDINGS');
  const rows = [...standings(league!)].sort((a, b) => b.pct - a.pct || (b.pf - b.pa) - (a.pf - a.pa));
  const pages = Math.ceil(rows.length / STANDINGS_ROWS), page = Math.min(listScroll, pages - 1);
  panel(24, 66, 912, 432);
  [['#', 44], ['TEAM', 92], ['W', 630], ['L', 690], ['PF', 760], ['PA', 850]].forEach(([h, x]) => drawText(String(h), Number(x), 92, 13, '#f6d365', h === 'TEAM' ? 'left' : 'center'));
  rows.slice(page * STANDINGS_ROWS, page * STANDINGS_ROWS + STANDINGS_ROWS).forEach((r, i) => {
    const y = 120 + i * 25, mine = r.team.id === user().id, col = mine ? '#ffde7e' : '#e9f2da';
    if (mine) { ctx.fillStyle = '#3a4a2a'; ctx.fillRect(36, y - 12, 888, 24); }
    drawText(String(page * STANDINGS_ROWS + i + 1), 44, y, 13, col, 'center');
    drawText(`${r.team.city} ${r.team.name}`.toUpperCase(), 92, y, 13, col, 'left', 500);
    drawText(String(r.w), 630, y, 13, col, 'center'); drawText(String(r.l), 690, y, 13, col, 'center');
    drawText(String(r.pf), 760, y, 13, col, 'center'); drawText(String(r.pa), 850, y, 13, col, 'center');
  });
  button(36, 452, 160, 40, '◀ PREV', () => { listScroll = (page + pages - 1) % pages; });
  button(764, 452, 160, 40, 'NEXT ▶', () => { listScroll = (page + 1) % pages; });
  drawText(`PAGE ${page + 1} / ${pages}`, W / 2, 472, 13, '#c9ddd0', 'center');
}
function drawSchedule() {
  top('SCHEDULE'); panel(24, 66, 912, 432); const t = user();
  league!.schedule.forEach((wk, i) => {
    const g = wk.find(x => x.home === t.id || x.away === t.id); const y = 86 + i * 22.8;
    const now = i === league!.week && league!.phase === 'regular';
    if (now) { ctx.fillStyle = '#3a4a2a'; ctx.fillRect(36, y - 11, 888, 22); }
    drawText(`WK ${String(i + 1).padStart(2, '0')}`, 52, y, 13, now ? '#ffdc73' : '#c9e2d1');
    if (!g) { drawText('BYE WEEK', 180, y, 13, '#83d9ff'); return; }
    const opp = team(g.home === t.id ? g.away : g.home);
    drawText(`${g.home === t.id ? 'VS' : 'AT'} ${short(opp)}`, 180, y, 13, '#eef2d5', 'left', 540);
    drawText(g.played ? `${g.home === t.id ? g.hs : g.as} - ${g.home === t.id ? g.as : g.hs}` : 'UPCOMING', 908, y, 13, g.played ? '#a6ebad' : '#f0e4bc', 'right');
  });
}
function drawLeaders() {
  top('LEAGUE LEADERS'); panel(24, 66, 912, 432);
  const ps = Object.values(league!.players);
  const teamByPlayer = new Map<number, Team>();
  for (const t of league!.teams) for (const id of [...t.roster, ...t.practice]) teamByPlayer.set(id, t);
  const cats: [string, StatKey][] = [['PASS YDS', 'passYds'], ['RUSH YDS', 'rushYds'], ['REC YDS', 'recYds'], ['SACKS', 'sack'], ['TACKLES', 'tkl'], ['INTS', 'defInt']];
  cats.forEach(([label, stat], i) => {
    const x = 48 + (i % 3) * 296, y0 = 98 + Math.floor(i / 3) * 206;
    drawText(label, x, y0, 14, '#f6d365');
    const top5 = ps.filter(p => (p.stats[stat] ?? 0) > 0).sort((a, b) => (b.stats[stat] ?? 0) - (a.stats[stat] ?? 0)).slice(0, 5);
    if (!top5.length) drawText('—', x, y0 + 32, 12, '#b9d5c9');
    top5.forEach((p, j) => {
      const y = y0 + 32 + j * 30, t = teamByPlayer.get(p.id), mine = t?.id === league!.userTeamId;
      // Your players get the same gold highlight as your team on the standings.
      if (mine) { ctx.fillStyle = '#3a4a2a'; ctx.fillRect(x - 8, y - 13, 288, 26); }
      drawText(`${j + 1}. ${p.last}`.toUpperCase(), x, y, 12, mine ? '#ffde7e' : '#eef2d5', 'left', 158);
      drawText(t?.abbr ?? 'FA', x + 168, y, 12, mine ? '#ffde7e' : '#9fc4d6');
      drawText(String(p.stats[stat]), x + 272, y, 12, mine ? '#ffde7e' : '#fff6d6', 'right');
    });
  });
}
function scorebar() {
  const g = nowGame(), h = team(g.homeId), a = team(g.awayId);
  ctx.fillStyle = '#0c2331'; ctx.fillRect(0, 0, W, TOP); ctx.fillStyle = '#71b9bc'; ctx.fillRect(0, TOP - 2, W, 2);
  drawText(h.abbr, 20, 22, 14); drawText(String(g.score[0]), 92, 22, 18, '#f6d365'); drawText(a.abbr, 150, 22, 14); drawText(String(g.score[1]), 222, 22, 18, '#f6d365');
  drawText(`${quarterLabel(g.quarter)}  ${clockLabel(g.clock)}`, W / 2, 22, 14, '#fff', 'center');
  drawText(`${downLabel(g)} • ${spotLabel(g.ballOn)}`.toUpperCase(), W - 20, 22, 12, '#b8dacb', 'right');
}
/** Retro-style pass input: pull away from the desired target, then release. */
function pullBackTarget(gesture: { x: number; y: number; sx: number; sy: number }) {
  const e = engine!, v = view();
  const start = v.toField(gesture.sx, gesture.sy - TOP), end = v.toField(gesture.x, gesture.y - TOP);
  return { x: e.qb.x - (end.x - start.x) * 1.2, y: e.qb.y - (end.y - start.y) * 1.2 };
}
function tray(): number {
  const y0 = TOP + FIELD_H;
  ctx.fillStyle = '#0c2331'; ctx.fillRect(0, y0, W, TRAY); ctx.fillStyle = '#71b9bc'; ctx.fillRect(0, y0, W, 2);
  return y0;
}
function drawGame() {
  if (!game) return;
  const offTeam = team(teamId(game.poss)), defTeam = team(teamId(game.poss === 0 ? 1 : 0));
  if (kick) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, TOP, W, FIELD_H); ctx.clip(); ctx.translate(0, TOP);
    drawKick(ctx, kick, W, FIELD_H, palette(offTeam, defTeam)); ctx.restore(); scorebar();
    const y0 = tray(), k = kick.kicker;
    drawText(`K ${k.first[0]}. ${k.last} • POWER ${k.attrs.kpw ?? '--'} • ACCURACY ${k.attrs.kac ?? '--'}`.toUpperCase(), 20, y0 + 26, 11, '#d8efc4', 'left', 600);
    const prompt = kick.stage === 'power' ? 'TAP TO LOCK POWER — HIT THE GREEN' : kick.stage === 'aim' ? 'TAP TO STOP THE AIMER BETWEEN THE POSTS' : kick.good ? "IT'S GOOD!" : 'NO GOOD';
    drawText(prompt, 20, y0 + 62, 14, '#f6d365', 'left', 900);
    return;
  }
  if (!engine) {
    if (lastEngine && lastPalette && (banners.length || isUsersBall())) {
      // Between plays: keep the last snapshot of the field up under the result banner.
      ctx.save(); ctx.beginPath(); ctx.rect(0, TOP, W, FIELD_H); ctx.clip(); ctx.translate(0, TOP);
      drawField(ctx, lastEngine, W, FIELD_H, lastPalette, driveFlipped(), camX);
      ctx.restore(); scorebar(); const y0 = tray();
      drawText(feedback, 20, y0 + 40, 12, '#fff6c8', 'left', 920);
    } else {
      scorebar(); ctx.fillStyle = '#174f35'; ctx.fillRect(0, TOP, W, H - TOP);
      drawText(feedback || 'CPU DRIVING...', W / 2, TOP + FIELD_H * 0.3, 16, '#fff6ce', 'center', W - 60);
    }
    drawBanner();
    return;
  }
  ctx.save(); ctx.beginPath(); ctx.rect(0, TOP, W, FIELD_H); ctx.clip(); ctx.translate(0, TOP);
  drawField(ctx, engine, W, FIELD_H, palette(offTeam, defTeam), driveFlipped(), camX);
  ctx.restore(); scorebar();
  if (pointer?.down && engine.canThrow() && inField(pointer.sy)) {
    // Aim preview shares the engine's throw plan: true landing spot (clamped to arm
    // strength), the QB's accuracy circle (~95% of throws land inside) and the receiver it's for.
    const v = view(), aim = pullBackTarget(pointer), plan = engine.throwPlan(aim.x, aim.y);
    const qb = v.toScreen(engine.qb.x, engine.qb.y), land = v.toScreen(plan.x, plan.y);
    const sx = qb.x, sy = qb.y - 16 + TOP, ex = land.x, ey = land.y + TOP;
    // Quadratic curves peak halfway to their control point: 2x the ball's true apex height.
    const lift = Math.min(sy - TOP - 10, 2 * plan.h * Z_SCALE);
    ctx.strokeStyle = '#ffe35c'; ctx.lineWidth = 3; ctx.setLineDash([7, 5]); ctx.beginPath(); ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo((sx + ex) / 2, Math.min(sy, ey) - lift, ex, ey); ctx.stroke(); ctx.setLineDash([]);
    const pxPerYd = v.w / (v.right - v.left), pyPerYd = v.h / 53.33;
    const rx = Math.max(6, plan.sd * 2 * pxPerYd), ry = Math.max(4, plan.sd * 2 * pyPerYd);
    ctx.fillStyle = plan.target ? 'rgba(111,220,111,.28)' : 'rgba(255,242,170,.2)'; ctx.strokeStyle = plan.target ? '#6fdc6f' : '#fff2aa'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 3, 3);
    // Aim assist: a faint ring where the thumb is aiming, tied to where the ball will actually lead the receiver.
    const raw = v.toScreen(aim.x, aim.y);
    if (plan.target && Math.hypot(raw.x - ex, raw.y + TOP - ey) > 8) {
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(raw.x, raw.y + TOP); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(raw.x, raw.y + TOP, 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (plan.target) { const r = v.toScreen(plan.target.x, plan.target.y); ctx.strokeStyle = '#6fdc6f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(r.x, r.y + TOP, 16, 6, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (Math.hypot(aim.x - engine.qb.x, aim.y - engine.qb.y) > plan.max) drawText('MAX', ex, ey - ry - 10, 9, '#ff8c74', 'center');
  }
  const y0 = tray();
  if (engine.phase === 'pre') {
    const kindCount = playsOfKind(playKind).length;
    button(16, y0 + 5, 84, 20, 'PASS', () => setPlayKind('pass'), playKind === 'pass');
    button(104, y0 + 5, 84, 20, 'RUN', () => setPlayKind('run'), playKind === 'run');
    drawText(`${kindCount} ${playKind.toUpperCase()} PLAYS`, 200, y0 + 15, 11, '#d8efc4', 'left', 380);
    playChoices.forEach((play, i) => button(16 + i * 168, y0 + 30, 160, 38, play.name.toUpperCase(), () => callPlay(play), activePlay?.id === play.id));
    if (kindCount > 3) button(520, y0 + 30, 60, 38, 'MORE', morePlays);
    drawText('DRAG BACK FROM QB TO SNAP • TAP RECEIVER: HOT ROUTE', 16, y0 + 82, 11, '#d7ebd2', 'left', 566);
    if (canPunt()) button(592, y0 + 10, 170, 36, 'PUNT', startPunt, true);
    if (canKickFg()) button(772, y0 + 10, 172, 36, 'FIELD GOAL', startFieldGoal, true);
    button(592, y0 + 54, 170, 32, 'AUDIBLE', audible); button(772, y0 + 54, 172, 32, driveFlipped() ? 'FLIP RIGHT' : 'FLIP LEFT', toggleDrive);
    return;
  }
  if (pointer?.down && inField(pointer.sy) && carrierControlled()) {
    // Virtual joystick: base where the thumb landed, knob follows (clamped to the ring).
    const dx = pointer.x - pointer.sx, dy = pointer.y - pointer.sy, len = Math.hypot(dx, dy), k = len > STICK_R ? STICK_R / len : 1;
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(pointer.sx, pointer.sy, STICK_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,228,92,.85)'; ctx.beginPath(); ctx.arc(pointer.sx + dx * k, pointer.sy + dy * k, 18, 0, Math.PI * 2); ctx.fill();
  }
  if (engine.phase === 'dead') drawText(engine.result?.desc.toUpperCase() ?? '', 20, y0 + 28, 12, '#fff6c8', 'left', 900);
  else if (feedback) drawText(feedback, 20, y0 + 28, 12, '#fff6c8', 'left', 900);
  drawBanner();
  const hint = engine.o.play.type === 'punt' ? 'PUNT COVERAGE • WATCH THE RETURN'
    : engine.canThrow() ? 'PULL BACK TO AIM • RELEASE TO PASS • DRAG FWD TO RUN'
    : engine.controlled && engine.controlled === engine.carrier ? 'DRAG = JOYSTICK • FLICK UP/DOWN: JUKE • FLICK FWD: DIVE'
    : '';
  drawText(hint, 20, y0 + 66, 12, '#f6d365', 'left', 920);
}
function drawPlaycall() { top('CALL A PLAY'); scorebar(); drawText(feedback || 'SELECT A PLAY', W / 2, 104, 13, '#f6d365', 'center'); playChoices.forEach((p, i) => { const x = 90 + i * 290; panel(x, 150, 240, 230, p.type === 'run' ? '#244f55' : '#304468'); drawText(`${i + 1}`, x + 25, 181, 16, '#f6d365'); drawText(p.name.toUpperCase(), x + 120, 218, 14, '#fff6d6', 'center'); drawText(p.formation.toUpperCase(), x + 120, 250, 10, '#b8e1d7', 'center'); drawText(p.type === 'run' ? 'RUN PLAY' : p.type === 'pa' ? 'PLAY ACTION' : 'PASS PLAY', x + 120, 286, 10, '#ffcf73', 'center'); button(x + 30, 326, 180, 34, 'CALL PLAY', () => callPlay(p), true); }); drawText('ON FIELD: PULL BACK TO PASS • SWIPE UP / DOWN WITH THE BALL TO JUKE', W / 2, 460, 9, '#c9e4d4', 'center'); }
function drawResults() {
  const g = nowGame(), you = userSide(), won = g.score[you] > g.score[you === 0 ? 1 : 0];
  top(won ? 'VICTORY!' : 'GAME OVER');
  panel(24, 66, 360, 330, won ? '#1d6141' : '#733d36');
  drawText(`${team(g.homeId).abbr}  ${g.score[0]} - ${g.score[1]}  ${team(g.awayId).abbr}`, 204, 140, 22, '#fff8d8', 'center', 330);
  drawText(won ? 'YOU WIN' : 'KEEP GRINDING', 204, 204, 20, '#f6d365', 'center');
  drawText('THE REST OF THE LEAGUE', 204, 262, 13, '#d2e5d3', 'center'); drawText('HAS ADVANCED.', 204, 288, 13, '#d2e5d3', 'center');
  // Post-game report: rating upgrades, injuries and dev reveals for your players this game.
  panel(400, 66, 536, 432); drawText('POST-GAME REPORT', 422, 94, 16, '#f6d365');
  const items = league!.inbox.filter(n => n.gameKey === lastGameKey);
  if (!items.length) drawText('NO UPGRADES OR INJURIES.', 422, 134, 13, '#b9d5c9');
  items.slice(0, 11).forEach((n, i) => {
    const y = 132 + i * 33, tag = n.kind === 'upgrade' ? '▲ UP' : n.kind === 'injury' ? '✚ HURT' : '★ DEV';
    drawText(tag, 422, y, 12, NOTICE_COLORS[n.kind]);
    drawText(n.text.toUpperCase(), 520, y, 12, '#eef2d5', 'left', 400);
  });
  button(64, 420, 280, 60, 'SEASON HUB', () => { game = null; gameRef = null; simCtx = null; screen = 'hub'; }, true);
}

// ---------- franchise screens ----------

function drawRundown() {
  const l = league!, t = user(), r = teamRundown(l, t);
  top(`${l.year} RUNDOWN`);
  panel(24, 66, 452, 432, t.primary);
  drawText(fmtTeam(t).toUpperCase(), 44, 92, 15, '#fff8da', 'left', 412);
  drawText(String(r.ovr), 86, 138, 34, ovrColor(r.ovr), 'center'); drawText('TEAM OVR', 86, 172, 12, '#fff6d6', 'center');
  [['OFFENSE', r.off], ['DEFENSE', r.def], ['SPECIAL TMS', r.st]].forEach(([label, v], i) => {
    drawText(String(label), 172, 124 + i * 26, 13, '#fff6d6'); drawText(String(v), 452, 124 + i * 26, 14, ovrColor(Number(v)), 'right');
  });
  drawText('UNIT', 44, 208, 12, '#f6d365'); drawText('OVR', 340, 208, 12, '#f6d365', 'right'); drawText('RANK', 452, 208, 12, '#f6d365', 'right');
  r.units.forEach((u, i) => {
    const y = 234 + i * 29, rankColor = u.rank <= 8 ? '#9ee8c2' : u.rank >= 24 ? '#ff8c74' : '#f2c14e';
    drawText(u.name.toUpperCase(), 44, y, 12, '#eef2d5', 'left', 220);
    drawText(String(u.ovr), 340, y, 13, ovrColor(u.ovr), 'right'); drawText(ordinal(u.rank).toUpperCase(), 452, y, 13, rankColor, 'right');
  });
  panel(490, 66, 446, 432);
  const section = (title: string, items: string[], color: string, y: number, empty: string) => {
    drawText(title, 510, y, 14, color);
    if (!items.length) drawText(empty, 510, y + 28, 12, '#b9d5c9', 'left', 406);
    items.forEach((s, i) => drawText(`• ${s.toUpperCase()}`, 510, y + 28 + i * 25, 12, '#eef2d5', 'left', 410));
    return y + 44 + Math.max(1, items.length) * 25;
  };
  let y = section('WEAKNESSES', r.weaknesses, '#ff8c74', 92, 'NO GLARING HOLES.');
  y = section('STRENGTHS', r.strengths, '#9ee8c2', y, 'NO TOP-10 UNITS YET.');
  y = section('WATCH LIST', r.flags, '#f2c14e', y, 'NO RED FLAGS.');
  if (y < 380) {
    drawText('KEY PLAYERS', 510, y, 14, '#83d9ff');
    r.stars.slice(0, Math.max(1, Math.floor((440 - y) / 25))).forEach((p, i) => { const [dev, c] = devTag(p); drawText(`${p.pos} ${p.last} ${p.ovr}`.toUpperCase(), 510, y + 28 + i * 25, 12, '#eef2d5', 'left', 260); drawText(dev, 916, y + 28 + i * 25, 12, c, 'right', 130); });
  }
  const next: Screen = l.phase === 'draft' ? 'draft' : 'hub';
  button(600, 446, 320, 46, l.phase === 'draft' ? 'ON TO THE DRAFT →' : 'CONTINUE', () => { l.pendingRundown = false; saveLeague(l); screen = next; }, true);
}

function drawOffseason() {
  const l = league!, rep = offseasonReport;
  top(`${l.year} OFFSEASON`);
  panel(24, 66, 490, 432); drawText('RETIREMENTS', 44, 92, 15, '#f6d365');
  const retired = rep ? [...rep.retired].sort((a, b) => Number(b.mine) - Number(a.mine) || b.p.ovr - a.p.ovr) : [];
  if (!retired.length) drawText('NOBODY NOTABLE RETIRED.', 44, 128, 13, '#b9d5c9');
  retired.slice(listScroll, listScroll + 11).forEach(({ p, team: abbr, mine }, i) => {
    const y = 126 + i * 33;
    drawText(`${abbr} ${p.pos} ${p.last}`.toUpperCase(), 44, y, 13, mine ? '#f6d365' : '#eef2d5', 'left', 270);
    drawText(`${p.age}Y ${p.ovr}`, 330, y, 12, '#c9ddd0', 'left', 90);
    if (mine && l.alumni.some(a => a.playerId === p.id)) button(420, y - 14, 86, 28, 'INDUCT', () => { induct(l, p.id); saveLeague(l); });
    else if (mine) drawText('IN HOF', 462, y, 12, '#9ee8c2', 'center');
  });
  panel(528, 66, 408, 432); drawText('YOUR DEVELOPMENT', 548, 92, 15, '#f6d365');
  const changes = rep ? [...rep.changes].sort((a, b) => Math.abs(b.p.ovr - b.before) - Math.abs(a.p.ovr - a.before)).slice(0, 9) : [];
  changes.forEach(({ p, before }, i) => {
    const y = 126 + i * 33, up = p.ovr > before;
    drawText(`${p.pos} ${p.last}`.toUpperCase(), 548, y, 13, '#eef2d5', 'left', 230);
    drawText(`${before} → ${p.ovr}`, 916, y, 13, up ? '#9ee8c2' : '#ff8c74', 'right');
  });
  button(560, 446, 360, 46, 'SEASON RUNDOWN →', () => { listScroll = 0; screen = 'rundown'; }, true);
}

const DRAFT_FILTERS: Record<DraftFilter, Pos[] | null> = {
  ALL: null, QB: ['QB'], RB: ['RB', 'FB'], WR: ['WR'], TE: ['TE'], OL: ['LT', 'LG', 'C', 'RG', 'RT'], DL: ['DE', 'DT'], LB: ['OLB', 'MLB'], DB: ['CB', 'FS', 'SS'], K: ['K', 'P', 'LS'],
};
const DRAFT_ROWS = 11;
function draftBoard() {
  const l = league!, d = l.draft;
  if (!d) return [];
  const f = DRAFT_FILTERS[draftFilter];
  // Scouts' big board order (the exact overalls stay hidden until a player is picked).
  return d.prospects.map(id => l.players[id]).filter(p => !f || f.includes(p.pos)).sort((a, b) => (d.proj?.[a.id] ?? 999) - (d.proj?.[b.id] ?? 999));
}
const heightLabel = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;
function draftSelected() {
  if (!draftSel) return;
  const made = makePick(league!, draftSel);
  if (made) { draftReveal = made; draftSel = null; saveLeague(league!); }
}
function drawDraft() {
  const l = league!, d = l.draft;
  top(`${d?.year ?? l.year} DRAFT`);
  if (!d || draftDone(l)) {
    panel(180, 130, 600, 280); drawText('THE DRAFT IS COMPLETE', W / 2, 190, 20, '#f6d365', 'center');
    drawText('ROSTERS WILL BE CUT TO 53 + 16.', W / 2, 240, 14, '#d8ead8', 'center');
    button(290, 300, 380, 60, 'FINISH DRAFT', () => { finalizeDraft(l); saveLeague(l); screen = 'hub'; }, true);
    return;
  }
  const clock = onClock(l)!, mine = clock.owner === l.userTeamId;
  const myNext = d.order.slice(d.current).find(s => pickOwner(l, d.year, s.round, s.orig) === l.userTeamId);
  drawText(`RD ${clock.slot.round} PICK ${clock.slot.pick} • ${mine ? 'YOU ARE ON THE CLOCK' : `${team(clock.owner).abbr} ON THE CLOCK`}`, 20, 76, 13, mine ? '#9ee8c2' : '#fff6d6', 'left', 600);
  drawText(myNext ? `YOUR NEXT: #${myNext.pick}` : 'NO PICKS LEFT', 940, 76, 13, '#f6d365', 'right', 320);
  (Object.keys(DRAFT_FILTERS) as DraftFilter[]).forEach((k, i) => button(14 + i * 61, 92, 57, 32, k, () => { draftFilter = k; draftScroll = 0; }, draftFilter === k));
  const board = draftBoard();
  panel(14, 130, 610, 370);
  const cols: [string, number][] = [['POS', 24], ['PROSPECT', 78], ['AGE', 268], ['HT', 316], ['WT', 392], ['40', 446], ['RD', 510], ['DEV', 540]];
  cols.forEach(([c, x]) => drawText(c, x, 148, 12, '#f6d365'));
  board.slice(draftScroll, draftScroll + DRAFT_ROWS).forEach((p, i) => {
    const y = 162 + i * 30, c = p.combine!, sel = draftSel === p.id, cy = y + 14;
    ctx.fillStyle = sel ? '#3a6b3d' : i % 2 ? '#1b4054' : '#17394d'; ctx.fillRect(20, y, 598, 28);
    buttons.push({ x: 20, y, w: 598, h: 28, label: p.last, action: () => { draftSel = p.id; } });
    drawText(p.pos, 24, cy, 12); drawText(`${p.first[0]}. ${p.last}`.toUpperCase(), 78, cy, 12, '#fff5d5', 'left', 196);
    drawText(String(p.age), 268, cy, 12); drawText(heightLabel(c.heightIn), 316, cy, 12, '#eef2d5', 'left', 70); drawText(String(c.weightLb), 392, cy, 12);
    drawText(c.forty.toFixed(2), 446, cy, 12, c.forty < 4.45 ? '#9ee8c2' : '#eef2d5');
    drawText(String(projectedRound(l, p.id)), 516, cy, 12, '#f2c14e'); drawText(p.devHidden ? 'HIDDEN' : 'NORMAL', 540, cy, 11, p.devHidden ? '#b9a6ff' : '#c9d6cf', 'left', 76);
  });
  drawText(`${board.length} LEFT • SWIPE TO SCROLL`, 20, 514, 12, '#c9ddd0');
  // Scouting report for the selected prospect.
  panel(632, 130, 314, 370);
  const sel = draftSel !== null ? l.players[draftSel] : null;
  if (sel?.combine) {
    const c = sel.combine;
    drawText(`${sel.pos} • AGE ${sel.age} • RD ${projectedRound(l, sel.id)}`, 648, 152, 12, '#f6d365', 'left', 286);
    drawText(`${sel.first} ${sel.last}`.toUpperCase(), 648, 178, 14, '#fff6d6', 'left', 286);
    drawText(sel.devHidden ? 'HIDDEN DEV' : 'NORMAL DEV', 648, 202, 12, sel.devHidden ? '#b9a6ff' : '#c9d6cf');
    const combine: [string, string][] = [['HEIGHT', heightLabel(c.heightIn)], ['WEIGHT', `${c.weightLb}`], ['40 YD', `${c.forty.toFixed(2)}`], ['BENCH', `${c.bench}`], ['VERTICAL', `${c.vertical}"`], ['BROAD', heightLabel(c.broad)], ['3-CONE', `${c.cone.toFixed(2)}`], ['SHUTTLE', `${c.shuttle.toFixed(2)}`]];
    combine.forEach(([k, v], i) => { const x = 648 + (i % 2) * 150, y = 232 + Math.floor(i / 2) * 26; drawText(k, x, y, 11, '#d8ead8'); drawText(v, x + 136, y, 12, '#fff6d6', 'right'); });
  } else drawText('TAP A PROSPECT', 789, 240, 13, '#b9d5c9', 'center');
  if (mine) button(646, 352, 286, 48, sel ? 'DRAFT PLAYER' : 'PICK A PROSPECT', draftSelected, !!sel);
  else button(646, 352, 286, 48, 'SIM TO MY PICK', () => { simToUserPick(l); saveLeague(l); }, true);
  button(646, 410, 140, 48, 'AUTO PICK', () => { if (mine) cpuPick(l); else simToUserPick(l); saveLeague(l); });
  button(792, 410, 140, 48, 'TRADE', () => { tradeGive = []; tradeGet = []; tradeMsg = ''; screen = 'trade'; });
  if (draftReveal) {
    const p = draftReveal.player, hidden = !!p.devHidden;
    ctx.fillStyle = 'rgba(5,15,22,.85)'; ctx.fillRect(0, 0, W, H);
    panel(190, 90, 580, 370, user().primary);
    drawText(`ROUND ${draftReveal.round} • PICK ${draftReveal.pick}`, W / 2, 130, 14, '#fff6d6', 'center');
    drawText(`${p.first} ${p.last}`.toUpperCase(), W / 2, 172, 22, '#fff8da', 'center', 540);
    drawText(`${p.pos} • AGE ${p.age}`, W / 2, 208, 14, '#d8ead8', 'center');
    drawText(String(p.ovr), W / 2, 262, 42, ovrColor(p.ovr), 'center'); drawText('OVERALL', W / 2, 302, 13, '#fff6d6', 'center');
    drawText(hidden ? 'HIDDEN DEV' : 'NORMAL DEV', W / 2, 336, 16, hidden ? '#b9a6ff' : '#c9d6cf', 'center');
    drawText(hidden ? `TRUE TRAIT AT ${REVEAL_SNAPS} SNAPS` : 'DEVELOPS AT A NORMAL RATE', W / 2, 364, 12, '#d8ead8', 'center');
    buttons = []; button(360, 392, 240, 50, 'CONTINUE', () => { draftReveal = null; }, true);
  }
}

function tradeAssets(t: Team): Asset[] {
  const l = league!;
  const players = [...t.roster, ...t.practice].map(id => l.players[id]).sort((a, b) => b.ovr - a.ovr).map(p => ({ kind: 'player', id: p.id }) as Asset);
  const picks = [...t.picks].sort((a, b) => a.year - b.year || a.round - b.round).map(k => ({ kind: 'pick', pick: k }) as Asset);
  return [...picks.filter(a => a.kind === 'pick' && a.pick.round <= 3), ...players, ...picks.filter(a => a.kind === 'pick' && a.pick.round > 3)];
}
const sameAsset = (a: Asset, b: Asset) => a.kind === 'player' ? b.kind === 'player' && a.id === b.id : b.kind === 'pick' && a.pick.year === b.pick.year && a.pick.round === b.pick.round && a.pick.orig === b.pick.orig;
function toggleAsset(list: Asset[], a: Asset) {
  const i = list.findIndex(x => sameAsset(x, a));
  if (i >= 0) list.splice(i, 1); else list.push(a);
  tradeMsg = '';
}
const TRADE_ROWS = 9;
function drawTrade() {
  const l = league!, me = user();
  if (tradePartner === me.id) tradePartner = (tradePartner + 1) % 32;
  const them = team(tradePartner);
  top('TRADE CENTER');
  const cycle = (dir: number) => { do tradePartner = (tradePartner + dir + 32) % 32; while (tradePartner === me.id); tradeGet = []; tradeScroll[1] = 0; tradeMsg = ''; };
  button(14, 64, 50, 36, '◀', () => cycle(-1)); button(420, 64, 50, 36, '▶', () => cycle(1));
  drawText(`WITH ${fmtTeam(them)}`.toUpperCase(), 242, 82, 13, '#fff6d6', 'center', 340);
  drawText(tradeWindowOpen(l) ? `DEADLINE: WEEK ${TRADE_DEADLINE_WEEK}` : 'DEADLINE PASSED', 940, 82, 12, tradeWindowOpen(l) ? '#c9ddd0' : '#ff8c74', 'right');
  const column = (x: number, title: string, t: Team, picked: Asset[], side: 0 | 1) => {
    panel(x, 106, 464, 300); drawText(title, x + 14, 124, 13, '#f6d365');
    const assets = tradeAssets(t), start = tradeScroll[side];
    assets.slice(start, start + TRADE_ROWS).forEach((a, i) => {
      const y = 138 + i * 29, on = picked.some(p => sameAsset(p, a)), cy = y + 13;
      ctx.fillStyle = on ? '#3a6b3d' : i % 2 ? '#1b4054' : '#17394d'; ctx.fillRect(x + 8, y, 416, 27);
      buttons.push({ x: x + 8, y, w: 416, h: 27, label: 'asset', action: () => toggleAsset(picked, a) });
      if (a.kind === 'player') {
        const p = l.players[a.id], [dev, c] = devTag(p), tag = ({ SUPERSTAR: 'SUPER', 'X-FACTOR': 'X-FAC', NORMAL: 'NORM' } as Record<string, string>)[dev] ?? dev;
        drawText(`${p.pos} ${p.last}`.toUpperCase(), x + 14, cy, 12, '#fff5d5', 'left', 180);
        drawText(`${p.ovr}`, x + 222, cy, 12, ovrColor(p.ovr), 'center'); drawText(`${p.age}Y`, x + 250, cy, 11, '#c9ddd0'); drawText(tag, x + 298, cy, 11, c, 'left', 76);
      } else drawText(assetLabel(l, a), x + 14, cy, 12, '#f2c14e', 'left', 320);
      drawText(String(Math.round(assetValue(l, a))), x + 418, cy, 11, '#9fc4d6', 'right');
    });
    button(x + 428, 138, 30, 128, '▲', () => { tradeScroll[side] = Math.max(0, tradeScroll[side] - 6); });
    button(x + 428, 272, 30, 128, '▼', () => { tradeScroll[side] = Math.min(Math.max(0, assets.length - TRADE_ROWS), tradeScroll[side] + 6); });
  };
  column(14, `YOU SEND (${tradeGive.length})`, me, tradeGive, 0);
  column(482, `YOU GET (${tradeGet.length})`, them, tradeGet, 1);
  // Fairness meter, from the CPU's side: it needs to land in the green to accept.
  const v = evaluateTrade(l, them, tradeGive, tradeGet);
  const mx = 190, mw = 580, my = 432;
  ctx.fillStyle = '#c7352b'; ctx.fillRect(mx, my, mw * 0.5, 16);
  ctx.fillStyle = '#e6b43a'; ctx.fillRect(mx + mw * 0.5, my, mw * 0.012, 16);
  ctx.fillStyle = '#48d15f'; ctx.fillRect(mx + mw * 0.512, my, mw * 0.488, 16);
  const mark = mx + mw * (v.fairness + 1) / 2;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(mark) - 2, my - 6, 4, 28);
  drawText(`SEND ${Math.round(v.give)} • GET ${Math.round(v.get)}`, mx + mw / 2, my - 14, 12, '#c9ddd0', 'center', mw);
  drawText('NO', mx - 10, my + 8, 12, '#ff8c74', 'right'); drawText('YES', mx + mw + 10, my + 8, 12, '#9ee8c2');
  button(14, 474, 150, 50, 'CLEAR', () => { tradeGive = []; tradeGet = []; tradeMsg = ''; });
  button(796, 474, 150, 50, 'PROPOSE', () => {
    const verdict = evaluateTrade(l, them, tradeGive, tradeGet);
    tradeMsg = verdict.reason.toUpperCase();
    if (verdict.accept) { executeTrade(l, me, them, tradeGive, tradeGet); tradeGive = []; tradeGet = []; tradeScroll = [0, 0]; saveLeague(l); }
  }, true);
  if (l.phase === 'draft') button(172, 474, 150, 50, '← DRAFT', () => screen = 'draft');
  drawText(tradeMsg, l.phase === 'draft' ? 560 : 480, 499, 13, tradeMsg.startsWith('DEAL') ? '#9ee8c2' : '#ff8c74', 'center', l.phase === 'draft' ? 450 : 600);
}

const NEWS_ROWS = 12;
function drawNews() {
  const l = league!; top('NEWS');
  panel(24, 66, 912, 432);
  const items = [...l.inbox].reverse();
  if (!items.length) drawText('NOTHING TO REPORT YET.', W / 2, 200, 14, '#b9d5c9', 'center');
  items.slice(listScroll, listScroll + NEWS_ROWS).forEach((n, i) => {
    const y = 92 + i * 31, canInduct = n.playerId !== undefined && l.alumni.some(a => a.playerId === n.playerId);
    drawText(`WK${n.week + 1}`, 40, y, 12, '#9fc4d6');
    drawText(n.kind.toUpperCase(), 110, y, 11, NOTICE_COLORS[n.kind], 'left', 90);
    drawText(n.text.toUpperCase(), 210, y, 12, '#eef2d5', 'left', canInduct ? 590 : 710);
    if (canInduct) button(812, y - 14, 112, 28, 'INDUCT', () => { induct(l, n.playerId!); saveLeague(l); });
  });
  drawText(`${Math.min(items.length, listScroll + 1)}-${Math.min(items.length, listScroll + NEWS_ROWS)} OF ${items.length} • SWIPE TO SCROLL`, 40, 482, 12, '#c9ddd0');
}

function drawHallOfFame() {
  const l = league!; top('HALL OF FAME');
  panel(24, 66, 560, 432); drawText(`RING OF HONOR (${l.hallOfFame.length})`, 44, 92, 15, '#f6d365', 'left', 520);
  if (!l.hallOfFame.length) {
    drawText('NO INDUCTEES YET.', 44, 136, 14, '#b9d5c9');
    drawText('RETIRED OR TRADED PLAYERS', 44, 176, 12, '#c9ddd0'); drawText('APPEAR ON THE BALLOT.', 44, 200, 12, '#c9ddd0');
  }
  l.hallOfFame.slice(listScroll, listScroll + 3).forEach((h, i) => {
    const y = 110 + i * 126;
    ctx.fillStyle = '#1b4054'; ctx.fillRect(40, y, 528, 116); ctx.strokeStyle = '#f2c14e'; ctx.strokeRect(41, y + 1, 526, 114);
    drawText(`${h.pos} ${h.name}`.toUpperCase(), 54, y + 24, 14, '#fff6d6', 'left', 420);
    drawText(String(h.peakOvr), 552, y + 26, 22, ovrColor(h.peakOvr), 'right');
    drawText(`${h.years} • ${h.teams.join('/')} • ${DEV_LABELS[h.dev].toUpperCase()}`, 54, y + 56, 12, '#c9ddd0', 'left', 500);
    const t = h.totals, line = [t.passYds && `${t.passYds} PASS YDS`, t.passTd && `${t.passTd} TD`, t.rushYds && `${t.rushYds} RUSH YDS`, t.recYds && `${t.recYds} REC YDS`, t.sack && `${t.sack} SACKS`, t.defInt && `${t.defInt} INT`, t.tkl && `${t.tkl} TKL`, t.fgm && `${t.fgm} FG`].filter(Boolean).slice(0, 3).join(' • ');
    drawText(line || 'CAREER STATS: —', 54, y + 88, 12, '#9ee8c2', 'left', 500);
  });
  panel(598, 66, 338, 432); drawText('BALLOT', 616, 92, 15, '#f6d365');
  if (!l.alumni.length) drawText('NO FORMER PLAYERS YET.', 616, 130, 12, '#b9d5c9', 'left', 300);
  l.alumni.slice(0, 11).forEach((a, i) => {
    const y = 128 + i * 33;
    drawText(`${a.pos} ${a.name.split(' ').at(-1)}`.toUpperCase(), 616, y, 12, '#eef2d5', 'left', 150);
    drawText(String(a.peakOvr), 800, y, 12, ovrColor(a.peakOvr), 'right');
    button(812, y - 14, 112, 28, 'INDUCT', () => { induct(l, a.playerId); saveLeague(l); });
  });
}

function render() {
  const scale = Math.min(canvas.width / W, canvas.height / H); viewport = { scale, x: (canvas.width - W * scale) / 2, y: (canvas.height - H * scale) / 2 }; ctx.setTransform(scale, 0, 0, scale, viewport.x, viewport.y); ctx.fillStyle = '#07131c'; ctx.fillRect(-viewport.x / scale, -viewport.y / scale, canvas.width / scale, canvas.height / scale); buttons = [];
  switch (screen) { case 'title': drawTitle(); break; case 'saves': drawSaveLibrary(); break; case 'team': drawTeamPick(); break; case 'coach': drawCoachSetup(); break; case 'tutorial': drawTutorial(); break; case 'hub': drawHub(); break; case 'roster': drawRoster(); break; case 'depth': drawDepth(); break; case 'player': drawPlayerCard(); break; case 'standings': drawStandings(); break; case 'schedule': drawSchedule(); break; case 'leaders': drawLeaders(); break; case 'playcall': drawPlaycall(); break; case 'field': drawGame(); break; case 'results': drawResults(); break; case 'rundown': drawRundown(); break; case 'offseason': drawOffseason(); break; case 'draft': drawDraft(); break; case 'trade': drawTrade(); break; case 'news': drawNews(); break; case 'hof': drawHallOfFame(); break; }
}
function tick(ts: number) {
  const dt = Math.min(.05, (ts - last) / 1000); last = ts;
  if (banners[0] && (banners[0].t += dt) > 1.5) banners.shift();
  if (screen === 'field' && kick) {
    kick.update(dt); if (kick.finished) finishKick();
  } else if (screen === 'field' && engine) {
    const x = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    const y = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
    const running = !!engine.controlled && engine.controlled === engine.carrier;
    engine.stick = x || y ? stickFromScreen(x * STICK_R, y * STICK_R) : joystick;
    engine.input = { active: !running && (x !== 0 || y !== 0), x, y };
    engine.update(dt);
    camX += (engine.focusX() - camX) * Math.min(1, dt * 5);
    const userBall = isUsersBall();
    for (; eventIdx < engine.events.length; eventIdx++) {
      const ev = engine.events[eventIdx].type;
      if (ev === 'int' && userBall) banner('INTERCEPTION!!!', BAD);
      if (ev === 'juked' && userBall && !banners.some(b => b.text === 'JUKE!')) banner('JUKE!', GOOD);
      if (ev === 'badsnap') banner('BAD SNAP!', userBall ? BAD : GOOD);
    }
    if (engine.phase === 'dead' && engine.result && !resultShown) { resultShown = true; playBanner(engine.result, userBall, game!.ballOn, true); }
    // Live game clock: runs from the snap for as long as the play takes, and between plays
    // only while it's still running (in-bounds tackle); incompletions/out of bounds stop it.
    const g = game!, r = engine.result;
    const ticking = engine.phase === 'live' || (engine.phase === 'pre' && !!g.clockRunning) || (engine.phase === 'dead' && !!r && !r.clockStops);
    if (ticking && engine.o.play.type !== 'punt' && g.clock > 0) g.clock = Math.max(0, g.clock - dt);
    if (engine.phase === 'pre' && g.clock <= 0 && g.phase === 'play') {
      const q = g.quarter;
      expireClock(g); engine = null; lastEngine = null;
      banner((g.phase as GameState['phase']) === 'final' ? 'FINAL' : q === 2 ? 'HALFTIME' : `END OF ${quarterLabel(q)}`, '#f6d365');
      setTimeout(routePossession, 1200);
    } else if (engine.done && engine.result) resolve(engine.result);
  } else if (screen === 'field' && !engine && !kick && game && game.phase === 'play' && !isUsersBall() && ts > cpuAt) {
    // CPU possessions run through the full ratings sim (abilities, fatigue and the zone included).
    const ballOn = game.ballOn;
    const r = simStep(simCtx!);
    if (r) playBanner(r, false, ballOn);
    feedback = takeZoneEvents(r?.desc ?? 'CPU PLAY'); cpuAt = ts + (banners.length ? 1500 : 750);
    lastEngine = null;
    if (game.phase !== 'play') setTimeout(routePossession, 650); else if (isUsersBall()) { game.clockRunning = false; routePossession(); }
  }
  render(); requestAnimationFrame(tick);
}

function point(e: PointerEvent) { const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * canvas.width, y = (e.clientY - r.top) / r.height * canvas.height; return { x: (x - viewport.x) / viewport.scale, y: (y - viewport.y) / viewport.scale }; }
canvas.addEventListener('pointerdown', e => { const p = point(e); pointer = { ...p, sx: p.x, sy: p.y, down: true, t0: performance.now() }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!pointer?.down) return;
  const p = point(e); pointer.x = p.x; pointer.y = p.y;
  if (screen !== 'field' || !engine || !inField(pointer.sy)) return;
  // Retro-style snap: pulling back from the QB hikes the ball and keeps aiming in one motion.
  if (engine.phase === 'pre' && engine.o.play.type !== 'punt' && Math.hypot(p.x - pointer.sx, p.y - pointer.sy) > 12) snapPlay();
  if (carrierControlled()) joystick = stickFromScreen(p.x - pointer.sx, p.y - pointer.sy);
});
canvas.addEventListener('pointerup', e => {
  const p = point(e); const down = pointer; pointer = null; joystick = null;
  if (down && (screen === 'roster' || screen === 'depth')) { const dy = p.y - down.sy; if (Math.abs(dy) >= 16) { scrollRoster(dy < 0 ? 4 : -4); return; } }
  if (down && Math.abs(p.y - down.sy) >= 16 && ['draft', 'trade', 'news', 'hof', 'offseason'].includes(screen)) {
    const dir = p.y < down.sy ? 1 : -1;
    if (screen === 'draft') draftScroll = Math.max(0, Math.min(Math.max(0, draftBoard().length - DRAFT_ROWS), draftScroll + dir * 5));
    else if (screen === 'trade') { const side = down.sx < W / 2 ? 0 : 1, n = tradeAssets(side ? team(tradePartner) : user()).length; tradeScroll[side] = Math.max(0, Math.min(Math.max(0, n - TRADE_ROWS), tradeScroll[side] + dir * 5)); }
    else listScroll = Math.max(0, listScroll + dir * 5);
    return;
  }
  if (screen === 'field' && kick && down && inField(down.sy)) { kick.tap(); return; }
  if (screen === 'field' && engine && down && inField(down.sy)) {
    const dx = p.x - down.sx, dy = p.y - down.sy, quick = performance.now() - down.t0 < 260;
    if (engine.phase === 'pre') { if (Math.hypot(dx, dy) < 14) hotRouteAt(p.x, p.y); return; }
    if (engine.canThrow()) {
      if (Math.hypot(dx, dy) < 18) { feedback = 'PULL BACK TO AIM'; return; }
      const target = pullBackTarget({ ...down, x: p.x, y: p.y });
      if (target.x <= engine.qb.x + 1) {
        if (Math.hypot(dx, dy) > 40) { engine.scramble(); feedback = ''; } else feedback = 'PULL BACK TOWARD YOUR END ZONE';
        return;
      }
      engine.throwTo(target.x, target.y); feedback = ''; return;
    }
    if (engine.controlled && engine.controlled === engine.carrier && quick) {
      const forward = driveFlipped() ? -dx : dx;
      if (Math.abs(dy) >= 22 && Math.abs(dy) > Math.abs(dx)) { engine.gesture(dy < 0 ? 'jukeUp' : 'jukeDown'); }
      else if (forward >= 34 && Math.abs(dx) > Math.abs(dy) * 1.3) { engine.gesture('dive'); }
    }
    return;
  }
  const b = buttons.find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h); b?.action();
});
window.addEventListener('keydown', e => { keys.add(e.key); if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault(); if (screen === 'playcall' && ['1','2','3'].includes(e.key)) callPlay(playChoices[Number(e.key) - 1]); if (screen === 'field' && kick && (e.key === ' ' || e.key === 'Enter')) kick.tap(); if (screen === 'field' && engine?.phase === 'pre' && (e.key === ' ' || e.key === 'Enter')) snapPlay(); if (engine) { if (e.key === 'j') engine.gesture('jukeUp'); if (e.key === 'k') engine.gesture('stiff'); if (e.key === 'l') engine.gesture('dive'); } if (e.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : canvas.requestFullscreen(); });
window.addEventListener('keyup', e => keys.delete(e.key));
window.render_game_to_text = () => { const p = selectedPlayer(); return JSON.stringify({ mode: screen, coordinateSystem: 'field x runs toward offense end zone, y runs top to bottom', saveLibrary: screen === 'saves' ? { count: listSaves().length, max: MAX_SAVES, saves: listSaves().map(s => ({ coach: s.coachName, teamId: s.teamId, year: s.year, week: s.week })) } : null, teamPicker: screen === 'team' ? { page: teamPage + 1, totalPages: 4, visibleCities: TEAM_DEFS.slice(teamPage * 8, teamPage * 8 + 8).map(t => t.city) } : null, driveDirection: driveFlipped() ? 'left' : 'right', team: league ? { abbr: user().abbr, scheme: user().scheme, coach: league.coachName, roster: user().roster.length, picks: user().picks.length } : null, season: league ? { year: league.year, week: league.week, phase: league.phase, pendingRundown: !!league.pendingRundown, draftPick: league.draft ? league.draft.current : null, onClock: league.draft && onClock(league) ? onClock(league)!.owner : null, alumni: league.alumni.length, hof: league.hallOfFame.length, inbox: league.inbox.length } : null, tradeMsg, draftReveal: draftReveal ? { ovr: draftReveal.player.ovr, hidden: !!draftReveal.player.devHidden } : null, selectedPlayer: p ? { id: p.id, name: `${p.first} ${p.last}`, pos: p.pos, ovr: p.ovr, age: p.age, dev: p.dev, devHidden: !!p.devHidden, abilities: p.abilities, xfactor: p.xfactor ?? null, attrs: p.attrs, stats: p.stats } : null, activePlay: activePlay ? { id: activePlay.id, name: activePlay.name, type: activePlay.type } : null, kick: kick ? { stage: kick.stage, distance: kick.distance, meter: Math.round(kick.meter() * 100) / 100, aim: Math.round(kick.pendulum() * 1000) / 1000, outcome: kick.outcome } : null, game: game ? { score: game.score, quarter: game.quarter, clock: game.clock, possession: teamId(game.poss), down: game.down, toGo: game.toGo, ballOn: game.ballOn } : null, field: engine ? { phase: engine.phase, ball: { x: Math.round(engine.ball.x * 10) / 10, y: Math.round(engine.ball.y * 10) / 10, z: Math.round(engine.ball.z * 10) / 10, holder: engine.ball.holder?.role ?? null, inAir: !!engine.ball.air }, controlled: engine.controlled?.role, stick: engine.stick, carrier: engine.carrier?.role ?? null, jukeRemaining: Math.round((engine.controlled?.juke ?? 0) * 100) / 100, carrierVelocity: engine.controlled ? { x: Math.round(engine.controlled.vx * 100) / 100, y: Math.round(engine.controlled.vy * 100) / 100, speed: Math.round(Math.hypot(engine.controlled.vx, engine.controlled.vy) * 100) / 100 } : null, players: engine.all.map(p => ({ role: p.role, side: p.side, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })) } : null, feedback }); };
window.advanceTime = (ms: number) => { const steps = Math.max(1, Math.round(ms / (1000 / 60))); for (let i = 0; i < steps; i++) { if (engine) engine.update(1 / 60); if (kick) kick.update(1 / 60); } render(); };
// Dev-only test hook: jump the user's drive to a down and spot to exercise special teams.
if (import.meta.env.DEV) window.setSituation = (down: number, ballOn: number) => { if (!game || !isUsersBall()) return; game.down = down; game.ballOn = ballOn; game.toGo = 5; choosePlays(); callPlay(playChoices[0]); };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
requestAnimationFrame(tick);

declare global { interface Window { render_game_to_text: () => string; advanceTime: (ms: number) => void; setSituation?: (down: number, ballOn: number) => void; } }
