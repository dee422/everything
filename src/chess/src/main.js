import './style.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import {
  createIcons,
  Cpu,
  User,
  Users,
  Globe,
  Plus,
  Undo2,
  Trophy,
  Flag,
  Handshake,
  Sun,
  Moon,
  Monitor,
  Copy,
  Check,
  Link,
  LogOut,
  ChevronFirst,
  ChevronLeft,
  ChevronRight,
  ChevronLast,
  ClipboardCopy,
  Download,
} from 'lucide';

import { Chess, colorOf } from './engine/chess.js';
import { chooseMove, LEVELS } from './engine/ai.js';
import { BoardView, pieceUrl, pieceLabel } from './ui/boardView.js';
import { RoomGame, normalizeCode, POLL_MS, ROOM_MAX_TIME_MS } from './net/room.js';
import { problemText } from './net/auth.js';
import { mountAccount } from './ui/account.js';
import {
  Clock,
  DEFAULT_TIME_ID,
  LOW_TIME_MS,
  TIME_CONTROLS,
  formatClock,
  isTimeId,
  roomControl,
  speakClock,
  timeControl,
} from './game/clock.js';
import { buildPgn, pgnFilename } from './game/pgn.js';
import { clearGame, loadGame, saveGame } from './game/persistence.js';
import { track } from './analytics.js';

createIcons({
  icons: {
    Cpu,
    User,
    Users,
    Globe,
    Plus,
    Undo2,
    Trophy,
    Flag,
    Handshake,
    Sun,
    Moon,
    Monitor,
    Copy,
    Check,
    Link,
    LogOut,
    ChevronFirst,
    ChevronLeft,
    ChevronRight,
    ChevronLast,
    ClipboardCopy,
    Download,
  },
});

const $ = (id) => document.getElementById(id);

const els = {
  board: $('board'),
  resultBanner: $('result-banner'),
  topbarNote: $('topbar-note'),
  modeButtons: document.querySelectorAll('.mode-switch [data-mode]'),
  cardTop: $('card-top'),
  cardBottom: $('card-bottom'),
  topName: $('top-name'),
  topCaption: $('top-caption'),
  bottomName: $('bottom-name'),
  bottomCaption: $('bottom-caption'),
  topIconCpu: document.querySelector('#card-top .icon-cpu'),
  topIconUser: document.querySelector('#card-top .icon-user'),
  capturesTop: $('captures-top'),
  capturesBottom: $('captures-bottom'),
  materialTop: $('material-top'),
  materialBottom: $('material-bottom'),
  clockTop: $('clock-top'),
  clockBottom: $('clock-bottom'),
  movesCard: $('moves-card'),
  moveList: $('move-list'),
  movesEmpty: $('moves-empty'),
  pgnCopyBtn: $('pgn-copy-btn'),
  pgnDownloadBtn: $('pgn-download-btn'),
  reviewFirstBtn: $('review-first-btn'),
  reviewPrevBtn: $('review-prev-btn'),
  reviewNextBtn: $('review-next-btn'),
  reviewLastBtn: $('review-last-btn'),
  reviewNote: $('review-note'),
  srStatus: $('sr-status'),
  toast: $('toast'),
  controls: $('controls'),
  fieldRow: $('field-row'),
  levelField: $('level-field'),
  colorField: $('color-field'),
  colorLabel: $('color-label'),
  timeField: $('time-field'),
  levelSelect: $('level-select'),
  colorSelect: $('color-select'),
  timeSelect: $('time-select'),
  buttonRow: $('button-row'),
  newGameBtn: $('new-game-btn'),
  undoBtn: $('undo-btn'),
  resignBtn: $('resign-btn'),
  leaveBtn: $('leave-btn'),
  controlsHint: $('controls-hint'),
  onlineCard: $('online-card'),
  onlineIdle: $('online-idle'),
  onlineHosting: $('online-hosting'),
  onlineJoining: $('online-joining'),
  onlineInviteNote: $('online-invite-note'),
  onlineError: $('online-error'),
  hostBtn: $('host-btn'),
  hostBtnLabel: $('host-btn-label'),
  joinForm: $('join-form'),
  joinInput: $('join-input'),
  joinBtn: $('join-btn'),
  inviteCode: $('invite-code'),
  copyCodeBtn: $('copy-code-btn'),
  copyLinkBtn: $('copy-link-btn'),
  copyLinkLabel: $('copy-link-label'),
  cancelHostBtn: $('cancel-host-btn'),
  cancelJoinBtn: $('cancel-join-btn'),
  promoDialog: $('promo-dialog'),
  gameoverDialog: $('gameover-dialog'),
  gameoverTitle: $('gameover-title'),
  gameoverSub: $('gameover-sub'),
  gameoverNew: $('gameover-new'),
  gameoverClose: $('gameover-close'),
  gameoverIcons: {
    win: $('gameover-icon-win'),
    loss: $('gameover-icon-loss'),
    draw: $('gameover-icon-draw'),
  },
  confirmDialog: $('confirm-dialog'),
  confirmTitle: $('confirm-title'),
  confirmSub: $('confirm-sub'),
  confirmYes: $('confirm-yes'),
  confirmNo: $('confirm-no'),
  accountDialog: $('account-dialog'),
  themeButtons: document.querySelectorAll('.theme-toggle [data-theme-choice]'),
};

const SETTINGS_KEY = 'chess-settings';
// Display values for material difference (knight/bishop both count as 3).
const DISPLAY_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
// Online play is the room API (src/net/room.js): the server holds the position
// and the clocks, and this board asks it what it has missed every few seconds.
const MODES = ['computer', 'local', 'online'];
/** What each mode is called: the top bar note, the player cards, and the
 *  switch's confirm dialog. The buttons in index.html carry the short form. */
const MODE_LABELS = { computer: '电脑对弈', local: '同屏对弈', online: '在线对弈' };
/** Clock repaint rate. Tenths are shown when the time is low; this reads them. */
const CLOCK_TICK_MS = 100;
/** Shared by every board render that has nothing to highlight. */
const NO_TARGETS = new Map();

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const game = new Chess();
let mode = 'computer'; // 'computer' | 'local' | 'online'
let myColor = 'w'; // side controlled at this device (computer & online modes)
let level = 'medium';
let colorSetting = 'w';
let timeSetting = DEFAULT_TIME_ID; // time control for the next game we start
let themeSetting = 'system';
let thinking = false;
let thinkingLevel = null; // level the in-flight search actually uses
let aiToken = 0;
let selected = null;
let targets = new Map();
let pendingToggleOff = false;
let promoResolve = null;
let gameOverTimer = 0;
let announcedPlies = 0;

// Clocks. `clock` belongs to the game on the board (an untimed game gets a
// disabled one), and `clockStack` holds each side's time as it stood at the
// start of every ply, which is what undo rewinds to.
let clock = new Clock(null);
let clockTimer = 0;
let clockStack = [];
let lowAnnounced = { w: false, b: false }; // said "time is low" this game

// Reviewing an earlier position. null means the board shows the live game;
// otherwise it is the number of plies being shown.
let reviewIndex = null;

// Whether anything is currently in storage, so a game that cannot be saved
// (online, finished, not started) only clears it once instead of every render.
let hasSave = true;

// What the move list was last scrolled for: the ply on the board and the
// length of the game. While neither changes, the list keeps whatever scroll
// position the player has given it.
let movesShown = { plies: -1, total: -1 };

// Online play. `roomGame` holds the room and the cursor over its event list
// (net/room.js); the rest of this is the board's side of that conversation —
// which state the chrome shows, and which of the server's moves are already on
// the screen.
let onlineUiState = 'idle'; // 'idle'|'creating'|'hosting'|'joining'|'playing'|'ended'
let onlineReturnState = 'idle'; // where a failed create/join falls back to
let onlineEnd = null; // the verdict, in the referee's own words
let roomRole = null; // 'host' (we made the room) | 'guest' (we joined one)
let roomTimer = 0; // the interval that asks the server what we have missed
let appliedSeq = 0; // the last event the board is showing
let sentSan = null; // our move, on its way to the referee and not yet taken
let requestOut = false; // one call at a time: a slow host must not pile them up
let rebuilding = false; // the board is being replayed from the server's move list
let flagPollDone = false; // asked once already after a displayed clock hit zero
let manualEnd = null; // {kind,title,sub} for ends the engine can't see (a flag fall)
let confirmAction = null;
let toastTimer = 0;
let copyCodeTimer = 0;
let copyLinkTimer = 0;

const colorName = (color) => (color === 'w' ? '白方' : '黑方');
/** The color as it goes into 执白 / 执黑, which is how a player says it. */
const side = (color) => (color === 'w' ? '白' : '黑');
const otherColor = (color) => (color === 'w' ? 'b' : 'w');
/** The PGN result for a game `winner` won. */
const resultFor = (winner) => (winner === 'w' ? '1-0' : '0-1');

/** The color shown at the bottom of the board. */
function bottomColor() {
  return mode === 'local' ? 'w' : myColor;
}

function gameFinished() {
  return currentEnd() !== null;
}

/**
 * Is there a game on the board worth protecting from a stray click? One that
 * is still going and that the player has actually put moves into — against the
 * computer, the computer's own opening move does not count.
 */
function gameInProgress() {
  if (mode === 'online' || gameFinished()) return false;
  if (mode === 'computer') return game.history().some((m) => m.color === myColor);
  return game.history().length > 0;
}

/**
 * The nickname of whoever holds `color`, as the room's row carries it, or null
 * while that seat is still empty.
 */
function seatName(color) {
  return roomGame.room?.players?.[color]?.nickname ?? null;
}

function opponentLabel() {
  return seatName(otherColor(myColor)) || '对方';
}

/**
 * How to name whoever plays `color`, in a sentence the player reads about
 * themselves. English needed a lower-case mid-sentence form and a capitalized
 * one; Chinese has no case, so this serves wherever the name lands.
 */
function sideName(color) {
  if (mode === 'local') return colorName(color);
  if (color === myColor) return '你';
  return mode === 'computer' ? '电脑' : opponentLabel();
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/*                                                                     */
/* Four events, each standing for something a player actually got out  */
/* of the app: a game played, a game seen through to its end, an       */
/* invite made, and a friend actually reaching the board. Both flags   */
/* reset with the board, so undo and repeated game-over renders cannot */
/* double-count.                                                       */
/* ------------------------------------------------------------------ */

let startTracked = false;
let endTracked = false;

function resetTracking() {
  startTracked = false;
  endTracked = false;
}

/** A reset board is not a game — the first ply is what makes it one. */
function trackGameStart() {
  if (startTracked) return;
  startTracked = true;
  track('Game Started', {
    mode,
    level: mode === 'computer' ? level : null,
    clock: gameTimeId(),
  });
}

function trackGameEnd(end) {
  // Games that ended before anyone moved (an opponent leaving the lobby)
  // never happened as far as the numbers are concerned.
  if (endTracked || game.history().length === 0) return;
  endTracked = true;
  // `result` is this device's point of view. Pass & play has no "you", so a
  // decisive game there is always reported as a win.
  track('Game Completed', { mode, result: end.kind, reason: end.reason });
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (stored && LEVELS[stored.level]) level = stored.level;
    if (stored && ['w', 'b', 'random'].includes(stored.color)) colorSetting = stored.color;
    if (stored && isTimeId(stored.time)) timeSetting = stored.time;
    if (stored && ['light', 'dark', 'system'].includes(stored.theme)) {
      themeSetting = stored.theme;
    }
    if (stored && MODES.includes(stored.mode)) mode = stored.mode;
  } catch {
    // Corrupt or missing settings: keep defaults.
  }
  els.levelSelect.value = level;
  els.colorSelect.value = colorSetting;
  els.timeSelect.value = timeSetting;
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        level,
        color: colorSetting,
        time: timeSetting,
        theme: themeSetting,
        mode,
      }),
    );
  } catch {
    // Storage unavailable (private browsing, denied permission): settings
    // still apply for this session, they just won't persist.
  }
}

/**
 * Fill the clock picker from TIME_CONTROLS, grouped the way the menu reads
 * (子弹 / 闪电 / 快速). Building it here rather than in the markup keeps
 * the ids that cross the wire and land in saved games in one place.
 */
function buildTimeOptions() {
  const groups = new Map();
  const items = [];
  for (const control of TIME_CONTROLS) {
    const option = document.createElement('option');
    option.value = control.id;
    option.textContent = control.label;
    if (!control.group) {
      items.push(option);
      continue;
    }
    let group = groups.get(control.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = control.group;
      groups.set(control.group, group);
      items.push(group);
    }
    group.appendChild(option);
  }
  els.timeSelect.replaceChildren(...items);
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const effective =
    themeSetting === 'system' ? (systemDark.matches ? 'dark' : 'light') : themeSetting;
  document.documentElement.dataset.theme = effective;
  // The theme-color metas pick by OS scheme; when the in-app theme overrides
  // it, keep the browser chrome in sync with the page background.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', bg);
  }
  for (const button of els.themeButtons) {
    const active = button.dataset.themeChoice === themeSetting;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

systemDark.addEventListener('change', () => {
  if (themeSetting === 'system') applyTheme();
});

/* ------------------------------------------------------------------ */
/* Clocks                                                              */
/*                                                                     */
/* The clock always belongs to the game on the board, and syncClock()   */
/* is what keeps that true: it is idempotent (re-asserting the side     */
/* already running charges nothing), so renderAll can simply call it    */
/* rather than every state change having to remember to.               */
/* ------------------------------------------------------------------ */

/** The id of the time control the game on the board is using. */
function gameTimeId() {
  return clock.control ? clock.control.id : DEFAULT_TIME_ID;
}

/** Put a fresh clock on the board. Takes a control, not an id, because an
 *  online game's control is built from the room's own number of milliseconds. */
function resetClock(control) {
  clock = new Clock(control);
  clockStack = [];
  lowAnnounced = { w: false, b: false };
}

/**
 * Whose move the clocks and the player cards should follow: the referee's while
 * an online game is on the board (our own guess is not the state of the game),
 * the engine's own reading everywhere else.
 */
function turnNow() {
  if (mode === 'online' && roomGame.room) return roomGame.room.turn;
  return game.turn();
}

function clockLive() {
  if (gameFinished()) return false;
  if (mode === 'online') {
    // The referee starts the clock the moment the second player sits down, so
    // an online game is timed from the first snapshot rather than from the
    // first move — and the time it charges is the server's, not ours.
    return onlineUiState === 'playing';
  }
  // The clock starts with the first move. Nothing else marks the moment a game
  // is under way — the board is simply there, and picking a control or opening
  // the tab is not the same as sitting down to play — so charging the first
  // mover before a piece has moved would run a clock down while nobody is
  // playing, and could lose a game on time that was never started.
  return game.history().length > 0;
}

function syncClock() {
  clock.setRunning(clockLive() ? turnNow() : null);
  if (clock.running) startClockTimer();
  else stopClockTimer();
}

function startClockTimer() {
  if (!clockTimer) clockTimer = setInterval(onClockTick, CLOCK_TICK_MS);
}

function stopClockTimer() {
  clearInterval(clockTimer);
  clockTimer = 0;
}

function onClockTick() {
  renderClocks();
  announceLowTime();
  const flagged = clock.flagged();
  if (!flagged) {
    flagPollDone = false;
    return;
  }
  if (mode === 'online') {
    // A clock that reads zero on this screen is only an estimate — the referee
    // has the time that counts. Ask it once, and ask again only if the number
    // comes back above zero (its clock started from a later moment than ours).
    if (flagPollDone) return;
    flagPollDone = true;
    pollRoom();
    return;
  }
  handleFlagFall(flagged);
}

/**
 * The clock turning red says "you are nearly out of time" to anyone who can
 * see it; role="timer" is deliberately never announced, so nothing says it to
 * anyone who cannot. Say it once per side, as that side crosses the mark.
 */
function announceLowTime() {
  const running = clock.running;
  if (!running || lowAnnounced[running]) return;
  const ms = clock.remaining(running);
  // Nothing to warn about once the time is actually gone: the flag fall that
  // follows announces itself.
  if (ms <= 0 || ms >= LOW_TIME_MS) return;
  lowAnnounced[running] = true;
  els.srStatus.textContent = `${sideName(running)}的时间快用完了 —— 还剩${speakClock(ms)}。`;
}

function handleFlagFall(loser) {
  if (gameFinished()) return;
  clock.setRunning(null);
  stopClockTimer();
  // A search still running would otherwise land a move after the flag fell.
  aiToken++;
  thinking = false;
  endGameManually(describeTimeout(loser));
}

/**
 * End the game for a reason the engine cannot see: a flag fall here, a
 * resignation there. An online game's end never comes this way — the referee
 * has already written it down, and `endFromRoom` puts it on the board.
 */
function endGameManually(end) {
  manualEnd = end;
  revealEnd(end);
}

/**
 * Say that the game is over, whatever decided it. The dialog comes a moment
 * later than the board (see showEnd) so the last move is still visible when the
 * player looks back at it.
 */
function revealEnd(end) {
  finishPromotion(null);
  clearSelection();
  // A confirm dialog opened before the game ended — our own pending resign,
  // say — is stale now, and acting on it could overwrite this result.
  closeDialogs();
  els.srStatus.textContent = `${end.title} —— ${end.sub}`;
  renderAll();
  showEnd(end);
}

/**
 * The result of a flag fall. Running out of time loses — unless the opponent
 * could not deliver mate with what is left on the board, which under FIDE 6.9
 * makes the game a draw instead.
 */
function describeTimeout(loser) {
  const winner = otherColor(loser);
  const base = { reason: 'timeout', termination: 'time forfeit' };
  if (!game.hasMatingMaterial(winner)) {
    return {
      ...base,
      kind: 'draw',
      result: '1/2-1/2',
      title: '和棋',
      sub: `${sideName(loser)}的钟走完了，可${sideName(winner)}没法将死。`,
    };
  }
  const sub = `${sideName(loser)}的钟走完了。`;
  if (mode === 'local') {
    return {
      ...base,
      kind: 'win',
      result: resultFor(winner),
      title: `${colorName(winner)}获胜`,
      sub,
    };
  }
  return {
    ...base,
    kind: loser === myColor ? 'loss' : 'win',
    result: resultFor(winner),
    title: loser === myColor ? '你输了' : '你赢了',
    sub,
  };
}

/**
 * Move the clock on after `mover` played: remember where it stood so undo can
 * put it back, charge the time they spent, add the increment, and hand over.
 * Only for games this board keeps time for — an online game's clocks are the
 * server's, and are put on the board whole by applyRoomClock().
 */
function afterPlyApplied(move) {
  clockStack.push(clock.baseline());
  if (clock.enabled) {
    clock.setRunning(null); // charges the mover for the time they just spent
    if (clock.remaining(move.color) > 0) clock.addIncrement(move.color);
    // Hand over now rather than after the move animation, or every move would
    // hand the other side a few free tenths of a second.
    syncClock();
  }
  trackGameStart();
}

/* ------------------------------------------------------------------ */
/* Reviewing earlier positions                                         */
/* ------------------------------------------------------------------ */

function reviewing() {
  return reviewIndex !== null;
}

/** How many plies the board is showing — the whole game unless reviewing. */
function viewPlies() {
  return reviewIndex === null ? game.history().length : reviewIndex;
}

/** An undo (or a new game) can leave the review index past the last move. */
function clampReview() {
  if (reviewIndex !== null && reviewIndex >= game.history().length) reviewIndex = null;
}

/**
 * The position after `plies` moves of the current game, replayed from the
 * start. A whole game is a few hundred moves and the engine makes short work
 * of them, which is cheaper to keep correct than a cache that would have to be
 * invalidated every time the live game moves on underneath it.
 */
function positionAt(plies) {
  const replay = new Chess();
  const history = game.history();
  for (let i = 0; i < plies; i++) {
    replay.move({
      from: history[i].from,
      to: history[i].to,
      promotion: history[i].promotion || 'q',
    });
  }
  return replay;
}

/** How a ply is written in chess: "12." for White's move, "12…" for Black's. */
function plyLabel(plies) {
  return `${Math.ceil(plies / 2)}${plies % 2 === 1 ? '.' : '…'}`;
}

function goToPly(target) {
  const total = game.history().length;
  const plies = Math.max(0, Math.min(total, target));
  const next = plies === total ? null : plies;
  if (next === reviewIndex) return;
  reviewIndex = next;
  // A piece cannot stay picked up across a jump to another position.
  boardView.cancelDrag();
  clearSelection();
  renderAll();
  announceReview();
}

function announceReview() {
  const plies = viewPlies();
  if (!reviewing()) {
    els.srStatus.textContent = '已回到最新局面。';
  } else if (plies === 0) {
    els.srStatus.textContent = '开局局面。';
  } else {
    const move = game.history()[plies - 1];
    els.srStatus.textContent = `回看中 —— ${colorName(move.color)}走了 ${move.san}。`;
  }
}

/* ------------------------------------------------------------------ */
/* Saving a game in progress                                           */
/* ------------------------------------------------------------------ */

/**
 * Keep storage in step with the board. Called from renderAll, so no state
 * change can forget to; also called when the page is hidden or leaving, which
 * is the only way a clock reading taken mid-move gets stored.
 */
function saveNow() {
  if (mode === 'online' || gameFinished() || game.history().length === 0) {
    // Nothing worth resuming: an online game cannot outlive its connection, a
    // finished one should not greet the player as if it were still going, and
    // an untouched board is what a fresh visit gets anyway.
    if (hasSave) {
      clearGame();
      hasSave = false;
    }
    return;
  }
  saveGame({
    mode,
    myColor,
    time: gameTimeId(),
    moves: game.history().map((m) => ({ from: m.from, to: m.to, promotion: m.promotion })),
    clock: clock.enabled ? clock.snapshot() : null,
    clockStack: clock.enabled ? clockStack : [],
  });
  hasSave = true;
}

/**
 * Put back the game stored by an earlier visit. Returns false when there is
 * nothing to restore, or when what is there doesn't replay — in which case the
 * caller starts a new game as usual.
 */
function restoreGame() {
  const saved = loadGame();
  if (!saved || saved.mode !== mode) return false;

  let ok = true;
  try {
    game.reset();
    for (const move of saved.moves) {
      if (!game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' })) {
        ok = false;
        break;
      }
    }
  } catch {
    ok = false; // malformed squares throw inside the engine
  }
  // Finished games are not stored, so one showing up here means the save was
  // written by something else; don't trust the rest of it either.
  if (ok && game.isGameOver()) ok = false;
  if (!ok) {
    game.reset();
    clearGame();
    hasSave = false;
    return false;
  }

  aiToken++;
  thinking = false;
  myColor = saved.myColor;
  manualEnd = null;
  reviewIndex = null;
  resetClock(timeControl(saved.time));
  if (clock.enabled && saved.clock) clock.restore(saved.clock);
  if (clock.enabled) clockStack = saved.clockStack.map((c) => ({ ...c }));
  // A stored game has moves, so it was already counted as started.
  resetTracking();
  startTracked = true;
  finishPromotion(null);
  clearSelection();
  closeDialogs();
  boardView.setOrientation(bottomColor());
  announcedPlies = game.history().length;
  els.srStatus.textContent =
    mode === 'local'
      ? `棋局已接上。${colorName(game.turn())}走。`
      : `棋局已接上。你执${side(myColor)}。`;
  renderAll();
  showToast('接着上次未完的一局。', { onlyIfIdle: true });
  if (mode === 'computer' && game.turn() !== myColor) computerTurn();
  return true;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const boardView = new BoardView(els.board, { onSquarePress, onDrop, onSquareActivate });

function renderAll() {
  clampReview();
  // Before anything is drawn, so the clocks are painted in the state they are
  // actually in rather than the one they were in a moment ago.
  syncClock();
  const plies = viewPlies();
  const live = !reviewing();
  // The board shows the position being reviewed; everything that describes the
  // game as it stands — the player cards, the clocks, the result — stays live.
  const shown = live ? game : positionAt(plies);
  const liveStatus = game.status();
  const shownStatus = live ? liveStatus : shown.status();
  const shownLast = shown.lastMove();

  boardView.render({
    board: shown.board(),
    selected: live ? selected : null,
    targets: live ? targets : NO_TARGETS,
    lastMove: shownLast ? { from: shownLast.from, to: shownLast.to } : null,
    checkSquare: shownStatus.check ? shown.kingSquare(shownStatus.turn) : null,
  });
  els.board.classList.toggle('reviewing', !live);

  renderPlayers();
  renderClocks();
  renderCaptures(plies);
  renderMoves(plies);
  renderReviewBar(plies);
  renderBanner();
  announceState(liveStatus, game.lastMove());

  els.undoBtn.disabled = !canUndo();
  updateModeUi();
  saveNow();
}

/** Undo takes back from the live position, so it is off while reviewing. */
function canUndo() {
  if (mode === 'online' || reviewing()) return false;
  if (mode === 'computer') {
    return !thinking && game.history().some((m) => m.color === myColor);
  }
  return game.history().length > 0;
}

/** Tell assistive technology about moves, check, and game results. */
function announceState(status, lastMove) {
  const plies = game.history().length;
  if (plies === announcedPlies) return;
  let text;
  if (plies < announcedPlies) {
    text = '已悔棋。';
  } else {
    text = `${sideName(lastMove.color)}走了 ${lastMove.san}。`;
    // The verdict the app is standing behind, not the engine's opinion: an
    // online game has not ended until the referee says it has, and its words
    // are the server's. revealEnd() says it again when the end arrives without
    // a move attached to it.
    const end = currentEnd();
    if (end) text += `${end.title}。${end.sub}`;
    else if (status.check) text += '将军。';
  }
  announcedPlies = plies;
  els.srStatus.textContent = text;
}

function renderPlayers() {
  const bottom = bottomColor();
  const top = otherColor(bottom);
  const finished = gameFinished();
  const turn = turnNow();

  let topIsCpu = false;
  if (mode === 'computer') {
    topIsCpu = true;
    els.topName.textContent = '电脑';
    els.topCaption.textContent = thinking
      ? `${LEVELS[thinkingLevel].label} · 思考中`
      : LEVELS[level].label;
    els.bottomName.textContent = '你';
    els.bottomCaption.textContent = `执${side(bottom)}`;
  } else if (mode === 'local') {
    els.topName.textContent = colorName(top);
    els.topCaption.textContent = MODE_LABELS.local;
    els.bottomName.textContent = colorName(bottom);
    els.bottomCaption.textContent = MODE_LABELS.local;
  } else {
    // The nicknames are the room's own row, so a player sees the name they
    // chose rather than "Opponent" — and the empty seat still has a name.
    els.topName.textContent = seatName(top) || opponentLabel();
    els.topCaption.textContent = `执${side(top)}`;
    els.bottomName.textContent = seatName(bottom) || '你';
    els.bottomCaption.textContent = `执${side(bottom)}`;
  }
  els.topIconCpu?.classList.toggle('hidden', !topIsCpu);
  els.topIconUser?.classList.toggle('hidden', topIsCpu);

  els.cardTop.classList.toggle('thinking', mode === 'computer' && thinking);
  els.cardTop.classList.toggle('active', !finished && turn === top);
  els.cardBottom.classList.toggle('active', !finished && turn === bottom);
}

function renderCaptures(plies) {
  const bottom = bottomColor();
  const byBottom = [];
  const byTop = [];
  // Only what has been captured in the position on the board, so a reviewed
  // position and the pieces beside it describe the same moment.
  for (const move of game.history().slice(0, plies)) {
    if (!move.captured) continue;
    (move.color === bottom ? byBottom : byTop).push(move.captured);
  }
  const value = (list) =>
    list.reduce((sum, piece) => sum + DISPLAY_VALUES[piece.toLowerCase()], 0);
  const fill = (el, list) => {
    list.sort(
      (a, b) => DISPLAY_VALUES[b.toLowerCase()] - DISPLAY_VALUES[a.toLowerCase()],
    );
    el.replaceChildren(
      ...list.map((piece) => {
        const img = document.createElement('img');
        img.src = pieceUrl(piece);
        img.alt = pieceLabel(piece);
        return img;
      }),
    );
  };
  fill(els.capturesBottom, byBottom);
  fill(els.capturesTop, byTop);
  const diff = value(byBottom) - value(byTop);
  els.materialBottom.textContent = diff > 0 ? `+${diff}` : '';
  els.materialTop.textContent = diff < 0 ? `+${-diff}` : '';
}

function renderMoves(plies) {
  const history = game.history();
  els.movesEmpty.classList.toggle('hidden', history.length > 0);
  // Which ply holds the keyboard. The list is rebuilt whole, so without this a
  // move activated from it — or one arriving from the opponent — would drop
  // focus to the top of the page, and the next Tab would start over.
  const focusedPly =
    els.moveList.contains(document.activeElement) && document.activeElement.dataset.ply;
  const rows = [];
  for (let i = 0; i < history.length; i += 2) {
    const row = document.createElement('li');
    row.className = 'move-row';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `${i / 2 + 1}.`;
    row.appendChild(num);
    for (const j of [i, i + 1]) {
      const move = history[j];
      if (!move) {
        // White has moved and Black has not: a blank that holds the column.
        row.appendChild(Object.assign(document.createElement('span'), { className: 'ply' }));
        continue;
      }
      const ply = document.createElement('button');
      ply.type = 'button';
      ply.className = 'ply';
      ply.textContent = move.san;
      ply.dataset.ply = String(j + 1);
      ply.setAttribute(
        'aria-label',
        `${colorName(move.color)}的第 ${Math.ceil((j + 1) / 2)} 手，${move.san}`,
      );
      if (j + 1 === plies) {
        ply.classList.add('current');
        ply.setAttribute('aria-current', 'true');
      }
      row.appendChild(ply);
    }
    rows.push(row);
  }
  els.moveList.replaceChildren(...rows);
  // Put the keyboard back on the same ply. Scrolling is left to the lines
  // below, which know which move the board is showing.
  if (focusedPly) {
    els.moveList
      .querySelector(`button.ply[data-ply="${focusedPly}"]`)
      ?.focus({ preventScroll: true });
  }
  // Scroll only when the move on the board has changed. The list is rebuilt on
  // every render — picking up a piece is one — and a player who has scrolled
  // up to look over the opening should not be yanked back down for it.
  if (plies !== movesShown.plies || history.length !== movesShown.total) {
    movesShown = { plies, total: history.length };
    scrollMoveIntoView();
  }
}

/**
 * Keep the move on the board in sight: at the bottom of the list while the
 * game is live, and inside the visible rows while reviewing. Scrolling is
 * measured against the list's own box so that it, and never an ancestor,
 * is what moves.
 */
function scrollMoveIntoView() {
  const list = els.moveList;
  if (!reviewing()) {
    list.scrollTop = list.scrollHeight;
    return;
  }
  const current = list.querySelector('.ply.current');
  if (!current) {
    list.scrollTop = 0; // the starting position, above the first move
    return;
  }
  const box = list.getBoundingClientRect();
  const rect = current.getBoundingClientRect();
  if (rect.top < box.top) list.scrollTop += rect.top - box.top;
  else if (rect.bottom > box.bottom) list.scrollTop += rect.bottom - box.bottom;
}

function renderClocks() {
  const shown = clock.enabled;
  els.clockTop.classList.toggle('hidden', !shown);
  els.clockBottom.classList.toggle('hidden', !shown);
  if (!shown) return;
  const bottom = bottomColor();
  const pairs = [
    [els.clockTop, otherColor(bottom)],
    [els.clockBottom, bottom],
  ];
  for (const [el, color] of pairs) {
    const ms = clock.remaining(color);
    const text = formatClock(ms);
    // This runs ten times a second; don't touch the DOM when nothing moved.
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('running', clock.running === color);
    el.classList.toggle('low', ms < LOW_TIME_MS);
    el.classList.toggle('out', ms <= 0);
  }
}

function renderReviewBar(plies) {
  const total = game.history().length;
  // Disabling the focused button blurs it there and then, so note where the
  // keyboard was before the flags below can take it away.
  const focused = document.activeElement;
  els.reviewFirstBtn.disabled = plies === 0;
  els.reviewPrevBtn.disabled = plies === 0;
  els.reviewNextBtn.disabled = plies >= total;
  els.reviewLastBtn.disabled = plies >= total;
  els.pgnCopyBtn.disabled = total === 0;
  els.pgnDownloadBtn.disabled = total === 0;
  keepReviewFocus(focused);
  if (!reviewing()) {
    els.reviewNote.textContent = '';
  } else if (plies === 0) {
    els.reviewNote.textContent = '回看开局';
  } else {
    els.reviewNote.textContent = `回看 ${plyLabel(plies)} ${game.history()[plies - 1].san}`;
  }
}

/**
 * Reaching either end of the game disables the button that got you there —
 * both of them, since first/prev and next/last go dark together. Hand the
 * keyboard to the pair that still leads somewhere, rather than let it fall to
 * the top of the page halfway through stepping over a game.
 */
function keepReviewFocus(focused) {
  const pairs = [
    [els.reviewFirstBtn, els.reviewNextBtn],
    [els.reviewPrevBtn, els.reviewNextBtn],
    [els.reviewNextBtn, els.reviewPrevBtn],
    [els.reviewLastBtn, els.reviewPrevBtn],
  ];
  for (const [button, fallback] of pairs) {
    if (focused === button && button.disabled && !fallback.disabled) {
      fallback.focus({ preventScroll: true });
      return;
    }
  }
}

/**
 * Describe a game the engine has called. `result` and `termination` are the
 * PGN spellings of the same thing, for the export; every end the app makes up
 * itself (a resignation, a flag fall) carries them too, so the exporter never
 * has to work out what happened. An online game is not described here — the
 * referee has already written its verdict down, in the room's own fields.
 */
function describeEnd(status) {
  if (status.reason === 'checkmate') {
    const base = { reason: 'checkmate', result: status.result, termination: 'normal' };
    if (mode === 'local') {
      const winner = status.result === '1-0' ? 'w' : 'b';
      return {
        ...base,
        kind: 'win',
        title: `${colorName(winner)}获胜`,
        sub: `将死 —— ${colorName(otherColor(winner))}的王无路可走。`,
      };
    }
    const iWon = (status.result === '1-0') === (myColor === 'w');
    if (iWon) {
      return {
        ...base,
        kind: 'win',
        title: '你赢了',
        sub: '将死 —— 电脑的王无路可走。',
      };
    }
    return {
      ...base,
      kind: 'loss',
      title: '你输了',
      sub: '将死 —— 你的王无路可走。',
    };
  }
  const reasons = {
    stalemate: '逼和 —— 已经没有合法走法。',
    'insufficient material': '双方的棋子都不够将死。',
    'fifty-move rule': '连续五十步没有吃子、没有动兵。',
    'threefold repetition': '同一局面出现了三次。',
  };
  return {
    kind: 'draw',
    reason: status.reason,
    result: status.result,
    termination: 'normal',
    title: '和棋',
    sub: reasons[status.reason] || '双方都无法将死。',
  };
}

/** How the game on the board ended, or null while it is still going. */
function currentEnd() {
  // Online, nothing but the server's verdict counts: it does not judge the
  // three draws the engine sees (repetition, fifty moves, bare kings), so
  // `game.status()` would end games the referee is still playing.
  if (mode === 'online') return onlineEnd;
  if (manualEnd) return manualEnd;
  const status = game.status();
  return status.over ? describeEnd(status) : null;
}

// Fills in the result text and color; whether it is on screen at all is
// updateModeUi's call, so the banner comes and goes with the player cards and
// the move list it belongs to.
function renderBanner() {
  const end = currentEnd();
  els.resultBanner.className = end ? `result-banner ${end.kind}` : 'result-banner';
  els.resultBanner.textContent = end ? `${end.title} · ${end.sub}` : '';
}

function showEnd(end) {
  trackGameEnd(end);
  els.gameoverTitle.textContent = end.title;
  els.gameoverSub.textContent = end.sub;
  for (const [kind, el] of Object.entries(els.gameoverIcons)) {
    el.classList.toggle('shown', kind === end.kind);
  }
  clearTimeout(gameOverTimer);
  gameOverTimer = setTimeout(() => {
    if (!els.gameoverDialog.open) els.gameoverDialog.showModal();
  }, 450);
}

function showToast(text, { onlyIfIdle = false } = {}) {
  // 'onlyIfIdle' is for news that is nice to know but must not push out news a
  // player is waiting on — the email-confirmation reply arrives on the same
  // load as the restored-game note, and losing it means reloading to check.
  if (onlyIfIdle && els.toast.classList.contains('show')) return;
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4000);
}

/* ------------------------------------------------------------------ */
/* Mode-dependent chrome                                               */
/* ------------------------------------------------------------------ */

function updateModeUi() {
  for (const button of els.modeButtons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  }
  els.topbarNote.textContent = MODE_LABELS[mode];

  const online = mode === 'online';
  const showIdle = online && ['idle', 'creating', 'ended'].includes(onlineUiState);
  els.onlineCard.classList.toggle('hidden', !online || onlineUiState === 'playing');
  els.onlineIdle.classList.toggle('hidden', !showIdle);
  els.onlineHosting.classList.toggle('hidden', onlineUiState !== 'hosting');
  els.onlineJoining.classList.toggle('hidden', onlineUiState !== 'joining');

  // The two doors into a game share one busy flag: a double click would ask
  // the referee for two rooms, or for a seat twice.
  const busy = onlineUiState === 'creating' || onlineUiState === 'joining';
  els.hostBtn.disabled = busy;
  els.joinBtn.disabled = busy;
  els.joinInput.disabled = busy;
  els.hostBtnLabel.textContent =
    onlineUiState === 'creating' ? '正在开局…' : '开一局';

  // The board-side cards only make sense once an online game exists. The
  // result banner goes with them: while the setup panel is up, a leftover
  // 「你赢了」 would read as a verdict on the game being arranged.
  const showGame = !online || onlineUiState === 'playing' || onlineUiState === 'ended';
  els.cardTop.classList.toggle('hidden', !showGame);
  els.cardBottom.classList.toggle('hidden', !showGame);
  els.movesCard.classList.toggle('hidden', !showGame);
  els.resultBanner.classList.toggle('hidden', !showGame || !els.resultBanner.textContent);

  const showLevel = mode === 'computer';
  const showColor = mode === 'computer' || showIdle;
  // A guest has nothing to pick: the room's clock and seats are the host's
  // doing, and the referee writes them down before either side moves.
  const showTime = !online || showIdle;
  // Nothing to press during a game arranged or reviewed — Undo and New game
  // belong to games this device owns, and there is no second game to offer a
  // friend from here (they need a new code; see the note in the online card).
  const playing = online && onlineUiState === 'playing';
  const showButtons = !online || playing;
  const showField = showLevel || showColor || showTime;
  const finished = gameFinished();
  els.levelField.classList.toggle('hidden', !showLevel);
  els.colorField.classList.toggle('hidden', !showColor);
  els.colorLabel.textContent = online ? '你执' : '执子';
  els.timeField.classList.toggle('hidden', !showTime);
  els.fieldRow.classList.toggle('hidden', !showField);
  // The hint belongs to the settings that only take hold at the start of a
  // game, so it comes and goes with them. Only the host of an online game
  // picks a side and a clock — a guest is dealt both, which is worth saying
  // next to controls that sit above the Join box.
  const showHint = showColor || showTime;
  if (online) {
    els.controlsHint.textContent =
      '只有开局的一方选颜色和时限，而且在线对弈的钟没有每步加时。';
  } else if (showColor) {
    els.controlsHint.textContent = '颜色和时限在开始新的一局时生效。';
  } else {
    els.controlsHint.textContent = '时限在开始新的一局时生效。';
  }
  els.controlsHint.classList.toggle('hidden', !showHint);

  els.newGameBtn.classList.toggle('hidden', online);
  els.undoBtn.classList.toggle('hidden', online);
  els.resignBtn.classList.toggle('hidden', !(playing && !finished));
  els.leaveBtn.classList.toggle('hidden', !playing);
  els.buttonRow.classList.toggle('hidden', !showButtons);
  els.controlsHint.classList.toggle('hidden', !showHint);
  // The card is only worth its border when one of the three things inside it
  // is on show.
  els.controls.classList.toggle('hidden', !(showField || showButtons || showHint));

  // The game-over dialog's other button starts a new game, which online means
  // a new room and a new friend: the panel above has that.
  els.gameoverNew.classList.toggle('hidden', online);
}

function setOnlineError(message) {
  els.onlineError.textContent = message;
  els.onlineError.hidden = !message;
}

/* ------------------------------------------------------------------ */
/* Interaction                                                         */
/* ------------------------------------------------------------------ */

function clearSelection() {
  boardView.cancelDrag();
  selected = null;
  targets = new Map();
  pendingToggleOff = false;
}

function targetsFor(square) {
  const map = new Map();
  for (const move of game.moves({ square })) {
    map.set(move.to, !!move.captured);
  }
  return map;
}

/** The color the person at this device may pick up right now, or null. */
function movableColorNow() {
  // An older position is a picture of the game, not a place to play from.
  if (reviewing() || gameFinished()) return null;
  if (mode === 'computer') return thinking ? null : myColor;
  if (mode === 'local') return game.turn();
  // Online, the referee's turn is the only one that counts, and a second move
  // may not leave before the first has been written down: the server would
  // refuse it as not-the-right-turn and the player would watch their own piece
  // jump back.
  if (onlineUiState !== 'playing' || sentSan !== null) return null;
  const snap = roomGame.room;
  return snap && snap.turn === myColor && appliedSeq === snap.seq ? myColor : null;
}

function onSquarePress(square, event) {
  const movable = movableColorNow();
  if (!movable) return;
  if (selected && targets.has(square)) {
    attemptMove(selected, square, { animate: true });
    return;
  }
  const piece = game.get(square);
  if (piece && colorOf(piece) === movable && game.turn() === movable) {
    pendingToggleOff = selected === square;
    selected = square;
    targets = targetsFor(square);
    renderAll();
    boardView.startDrag(square, event);
  } else if (selected) {
    clearSelection();
    renderAll();
  }
}

// Keyboard activation (Enter/Space on a focused square): same semantics as a
// pointer press, minus the drag, and pressing the selected square deselects.
function onSquareActivate(square) {
  const movable = movableColorNow();
  if (!movable) return;
  if (selected === square) {
    clearSelection();
    renderAll();
    return;
  }
  if (selected && targets.has(square)) {
    attemptMove(selected, square, { animate: true });
    return;
  }
  const piece = game.get(square);
  if (piece && colorOf(piece) === movable && game.turn() === movable) {
    selected = square;
    targets = targetsFor(square);
    renderAll();
  } else if (selected) {
    clearSelection();
    renderAll();
  }
}

function onDrop(from, to, moved) {
  if (to && to !== from && targets.has(to)) {
    attemptMove(from, to, { animate: false });
    return;
  }
  if (to === from && !moved && pendingToggleOff) {
    clearSelection();
  }
  renderAll();
}

function attemptMove(from, to, { animate }) {
  const candidates = game.moves({ square: from }).filter((m) => m.to === to);
  if (candidates.length === 0) {
    clearSelection();
    renderAll();
    return;
  }
  const commit = (promotion) => {
    const played = game.move({ from, to, promotion });
    if (!played) {
      clearSelection();
      renderAll();
      return;
    }
    if (mode === 'online') {
      // Show the move at once and ask the referee to write it down. `sentSan`
      // marks the ply as ours until the server's own record of it comes back,
      // and the clock is deliberately not moved here: the server keeps
      // charging the player who is thinking until their move lands, and the
      // reading that counts arrives with the snapshot.
      sentSan = played.san;
      trackGameStart();
      sendRoomMove(played.san);
    } else {
      afterPlyApplied(played);
    }
    clearSelection();
    const proceed = () => {
      renderAll();
      afterMove();
    };
    if (animate) boardView.animateMove(from, to, proceed);
    else proceed();
  };
  if (candidates[0].promotion) {
    askPromotion().then((promotion) => {
      if (promotion) {
        commit(promotion);
      } else {
        clearSelection();
        renderAll();
      }
    });
  } else {
    commit('q');
  }
}

function afterMove() {
  // Online, this board does not call games finished: the referee's verdict
  // arrives with the snapshot of the move that ends the game, and it is the
  // only one that can be exported or shown. An optimistic checkmate here would
  // be a result the server has not agreed to yet.
  if (mode === 'online') return;
  const status = game.status();
  if (status.over) {
    renderAll();
    showEnd(describeEnd(status));
    return;
  }
  if (mode === 'computer' && game.turn() !== myColor) {
    computerTurn();
  }
}

function computerTurn() {
  thinking = true;
  thinkingLevel = level;
  renderAll();
  const token = ++aiToken;
  chooseMove(game, thinkingLevel).then((reply) => {
    if (token !== aiToken || mode !== 'computer') return;
    thinking = false;
    if (!reply) {
      renderAll();
      return;
    }
    const played = game.move({
      from: reply.from,
      to: reply.to,
      promotion: reply.promotion || 'q',
    });
    if (!played) {
      renderAll();
      return;
    }
    afterPlyApplied(played); // also counts the game as started: the computer
                             // opens when the player chose Black
    showMove(reply.from, reply.to, () => {
      renderAll();
      const status = game.status();
      if (status.over) showEnd(describeEnd(status));
    });
  });
}

/**
 * Slide a piece into place and then re-render. While an older position is on
 * the board there is nothing to slide — the move has landed in the game, but
 * not in what the player is looking at.
 */
function showMove(from, to, done) {
  if (reviewing()) done();
  else boardView.animateMove(from, to, done);
}

/* ------------------------------------------------------------------ */
/* Promotion dialog                                                    */
/* ------------------------------------------------------------------ */

function askPromotion() {
  const mover = game.turn(); // promotion is asked before the move commits
  for (const button of els.promoDialog.querySelectorAll('[data-promo]')) {
    const piece = button.dataset.promo;
    button.querySelector('img').src = pieceUrl(
      mover === 'w' ? piece.toUpperCase() : piece,
    );
  }
  els.promoDialog.showModal();
  return new Promise((resolve) => {
    promoResolve = resolve;
  });
}

function finishPromotion(choice) {
  if (!promoResolve) return;
  const resolve = promoResolve;
  promoResolve = null;
  if (els.promoDialog.open) els.promoDialog.close();
  resolve(choice);
}

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                      */
/* ------------------------------------------------------------------ */

/**
 * `danger` paints the confirming button red: for giving up a game (resign,
 * leave) rather than merely moving on from one (a new game, another mode).
 */
function askConfirm({ title, sub, confirmLabel, danger = true }, onConfirm) {
  confirmAction = onConfirm;
  els.confirmTitle.textContent = title;
  els.confirmSub.textContent = sub;
  els.confirmYes.textContent = confirmLabel;
  els.confirmYes.classList.toggle('btn-danger-solid', danger);
  els.confirmYes.classList.toggle('btn-primary', !danger);
  els.confirmDialog.showModal();
}

function closeDialogs() {
  if (els.gameoverDialog.open) els.gameoverDialog.close();
  if (els.confirmDialog.open) els.confirmDialog.close();
}

/* ------------------------------------------------------------------ */
/* Game flow controls                                                  */
/* ------------------------------------------------------------------ */

function newGame() {
  if (mode === 'online') return; // an online game starts in a room, not here
  aiToken++;
  thinking = false;
  myColor =
    mode === 'computer'
      ? colorSetting === 'random'
        ? Math.random() < 0.5
          ? 'w'
          : 'b'
        : colorSetting
      : 'w';
  manualEnd = null;
  reviewIndex = null;
  game.reset();
  resetClock(timeControl(timeSetting));
  resetTracking();
  finishPromotion(null);
  clearSelection();
  clearTimeout(gameOverTimer);
  closeDialogs();
  boardView.setOrientation(bottomColor());
  announcedPlies = 0;
  els.srStatus.textContent =
    mode === 'local'
      ? '新的一局。白方走。'
      : `新的一局。你执${side(myColor)}。`;
  renderAll();
  if (mode === 'computer' && game.turn() !== myColor) computerTurn();
}

/** The New game button: a game in progress is worth a second look first. */
function requestNewGame() {
  if (mode === 'online') return;
  if (!gameInProgress()) {
    newGame();
    return;
  }
  askConfirm(
    {
      title: '开始新的一局？',
      sub: '现在这一局会丢掉。',
      confirmLabel: '新的一局',
      danger: false,
    },
    newGame,
  );
}

function undoTurn() {
  if (!canUndo()) return;
  aiToken++;
  thinking = false;
  // Taking a move back also takes back an end the app declared for itself —
  // running out of time is the one a player can undo their way out of.
  manualEnd = null;
  finishPromotion(null);
  clearTimeout(gameOverTimer);
  if (els.gameoverDialog.open) els.gameoverDialog.close();
  if (mode === 'computer') {
    // Take back the player's last move along with any computer reply.
    do {
      undoPly();
    } while (game.turn() !== myColor && game.history().length > 0);
  } else {
    undoPly();
  }
  clearSelection();
  renderAll();
}

/** Take back one ply, rewinding both clocks to where they stood before it. */
function undoPly() {
  if (!game.undo()) return;
  const before = clockStack.pop();
  if (before) clock.restore(before);
}

/** Drop every game, room and timer ahead of a mode change. */
function teardownForModeChange() {
  stopRoomPolling();
  roomGame.reset();
  onlineUiState = 'idle';
  onlineReturnState = 'idle';
  onlineEnd = null;
  roomRole = null;
  appliedSeq = 0;
  sentSan = null;
  flagPollDone = false;
  rebuilding = false;
  aiToken++;
  thinking = false;
  manualEnd = null;
  reviewIndex = null;
  closeDialogs();
  finishPromotion(null);
}

function setMode(next) {
  if (next === mode || !MODES.includes(next)) return;
  const perform = () => {
    teardownForModeChange();
    mode = next;
    saveSettings();
    if (mode === 'online') {
      enterOnlineIdle();
    } else {
      newGame();
    }
  };
  if (onlineUiState === 'playing' && !gameFinished() && game.history().length > 0) {
    askConfirm(
      {
        title: '离开在线对弈？',
        sub: '换了模式就不再刷新这一局：钟会一直走到归零，而这个房间码不能坐回来。',
        confirmLabel: '离开',
      },
      perform,
    );
  } else if (gameInProgress()) {
    // Switching modes starts over, and the game on the board is not kept for
    // coming back to. The mode buttons sit right above the board, so make sure
    // the player meant it.
    askConfirm(
      {
        title: `换到${MODE_LABELS[next]}？`,
        sub: `换了模式，现在的${MODE_LABELS[mode]}就丢掉了。`,
        confirmLabel: '换模式',
        danger: false,
      },
      perform,
    );
  } else {
    perform();
  }
}

/* ------------------------------------------------------------------ */
/* Online play                                                         */
/* ------------------------------------------------------------------ */

// The sentence the join box needs before any room exists, for a player who
// arrived through an invite link.
const INVITE_NOTE = '有人约你对弈 —— 按「进入」就能坐下。';

const roomGame = new RoomGame({
  onSnapshot: handleRoomSnapshot,
  onError: handleRoomProblem,
});

/**
 * The clock to open a room with: this device's picker, under the server's own
 * ceiling. "No limit" has no online equivalent — a game nobody can lose on time
 * would hold its room open forever — so that choice sends nothing and the room
 * gets the referee's default.
 */
function roomTimeMs() {
  const control = timeControl(timeSetting);
  return control ? Math.min(control.initial, ROOM_MAX_TIME_MS) : null;
}

/**
 * Where a sentence about the room goes. While the setup panel is on screen it
 * has a line of its own; a player mid-game has only the board to look at, so
 * the news goes to the toast there. `creating` and `joining` count as setup:
 * the call that failed came from this panel, and it is back on screen by the
 * time the answer arrives.
 */
function onlineProblem(message) {
  if (['idle', 'creating', 'joining', 'ended'].includes(onlineUiState)) setOnlineError(message);
  else showToast(message);
}

/**
 * The online tab with nothing in it: no room, no clock, and either an empty
 * code box or one already filled by an invite link.
 */
function enterOnlineIdle({ inviteCode = null } = {}) {
  stopRoomPolling();
  roomGame.reset();
  onlineUiState = 'idle';
  onlineReturnState = 'idle';
  onlineEnd = null;
  roomRole = null;
  appliedSeq = 0;
  sentSan = null;
  flagPollDone = false;
  rebuilding = false;
  myColor = 'w';
  manualEnd = null;
  reviewIndex = null;
  game.reset();
  // No clock until a game exists: an online game runs on the host's control,
  // which this side only learns from the room.
  resetClock(null);
  resetTracking();
  clearSelection();
  clearTimeout(gameOverTimer);
  boardView.setOrientation('w');
  announcedPlies = 0;
  setOnlineError('');
  els.joinInput.value = inviteCode || '';
  els.onlineInviteNote.hidden = !inviteCode;
  if (inviteCode) els.onlineInviteNote.textContent = INVITE_NOTE;
  els.srStatus.textContent = inviteCode
    ? '你收到了对弈邀请。按「进入」就能坐下。'
    : '在线对弈。开一局把房间码发给对方，或者输入对方的房间码。';
  renderAll();
  if (inviteCode) els.joinBtn.focus();
}

/** Open a room and wait for a friend to sit down in the other half of it. */
async function createRoom() {
  if (mode !== 'online' || !['idle', 'ended'].includes(onlineUiState)) return;
  onlineReturnState = onlineUiState; // a refusal keeps whatever board was there
  roomRole = 'host';
  // A room that has not been played starts at seq 0, and the cursor left over
  // from the game before it would read that as an answer arriving too late.
  appliedSeq = 0;
  sentSan = null;
  flagPollDone = false;
  setOnlineError('');
  els.onlineInviteNote.hidden = true;
  onlineUiState = 'creating';
  updateModeUi();
  const reply = await roomGame.create({ color: colorSetting, timeMs: roomTimeMs() });
  if (!reply?.ok) {
    roomRole = null;
    onlineUiState = onlineReturnState;
    updateModeUi();
    return;
  }
  // handleRoomSnapshot has already put the code on screen, moved the panel to
  // "waiting for your friend", and started the polling that tells us when
  // somebody arrives.
  if (onlineUiState === 'hosting') els.copyLinkBtn.focus();
}

/** Take the empty seat in somebody else's room. */
async function joinRoom(rawCode) {
  if (mode !== 'online' || !['idle', 'ended'].includes(onlineUiState)) return;
  const code = normalizeCode(rawCode);
  if (!code) {
    setOnlineError('先填房间码 —— 六位字母和数字。');
    els.joinInput.focus();
    return;
  }
  onlineReturnState = onlineUiState;
  roomRole = 'guest';
  // The cursor of the room this board last watched says nothing about this one.
  appliedSeq = 0;
  sentSan = null;
  flagPollDone = false;
  setOnlineError('');
  els.onlineInviteNote.hidden = true;
  onlineUiState = 'joining';
  updateModeUi();
  const reply = await roomGame.join(code);
  if (!reply?.ok) {
    roomRole = null;
    onlineUiState = onlineReturnState;
    updateModeUi();
    els.joinInput.focus();
    return;
  }
  // The room came back active with a seat in it, so handleRoomSnapshot has
  // already sat us down at it.
}

/**
 * Back out of an attempt: a room nobody joined, or a join that did not get in.
 *
 * There is nothing to tell the server. A room still `waiting` is not a game
 * yet, and reaping the ones nobody sits down in is a later phase's job; this
 * device simply stops asking about it.
 */
function cancelOnlineSetup() {
  stopRoomPolling();
  roomGame.reset();
  roomRole = null;
  appliedSeq = 0;
  sentSan = null;
  onlineUiState = onlineReturnState;
  setOnlineError('');
  updateModeUi();
}

/**
 * The referee's word about the room, whichever call brought it.
 *
 * This board is not a copy of the server's state but a replay of the server's
 * move list, with the clocks written in whole from every snapshot. That is what
 * lets one path serve all three ways news arrives: the answer to our own move,
 * a poll that found nothing, and a poll that found four moves this tab played
 * hide-and-seek through.
 */
function handleRoomSnapshot(snap, fresh) {
  if (mode !== 'online') return;
  // A question that left after a newer one can still answer first. The cursor
  // only moves forward, so the older picture is dropped rather than unplayable.
  if (snap.seq < appliedSeq) return;

  if (snap.status === 'waiting') {
    // A room with one seat. This is also the only thing that ever tells a host
    // a friend has arrived — a guest sitting down is not a move, so it makes no
    // event — which is why the hosting panel stays on the polling.
    els.inviteCode.textContent = snap.code;
    onlineUiState = 'hosting';
    startRoomPolling();
    updateModeUi();
    return;
  }

  if (onlineUiState !== 'playing' && onlineUiState !== 'ended') {
    sitDown(snap, fresh);
    return;
  }

  applyRoomClock(snap);
  // rebuild() reads the whole list itself when the catch-up poll lands; taking
  // its snapshot on the way through would play every move a second time.
  if (rebuilding) return;

  const before = game.history().length;
  if (!applyEvents(fresh) || needsRebuild(snap)) {
    rebuild();
    return;
  }
  const last = game.history()[game.history().length - 1];
  const settle = () => {
    clearSelection();
    renderAll();
    if (snap.status === 'over') endFromRoom(snap);
  };
  // Slide the newest ply in. A board that caught up on four moves animates the
  // last of them — the rest are history the player has already walked past.
  if (game.history().length > before) showMove(last.from, last.to, settle);
  else settle();
}

/**
 * A game to play has appeared, so sit down at it. The seat, the clock and the
 * moves so far all come from the room: a guest chose none of them, and a host
 * chose the first two on this device but sees them repeated back by the
 * referee, which is the version that counts.
 */
function sitDown(snap, fresh) {
  aiToken++;
  thinking = false;
  myColor = snap.you;
  onlineUiState = 'playing';
  onlineEnd = null;
  manualEnd = null;
  reviewIndex = null;
  appliedSeq = 0;
  sentSan = null;
  flagPollDone = false;
  game.reset();
  resetClock(roomControl(snap.time_ms));
  resetTracking();
  finishPromotion(null);
  clearSelection();
  clearTimeout(gameOverTimer);
  closeDialogs();
  boardView.setOrientation(myColor);
  announcedPlies = 0;
  track('Online Game Connected', { role: roomRole });
  applyRoomClock(snap);
  applyEvents(fresh);
  startRoomPolling();
  // A room that ended before this seat arrived — rejoining one somebody else
  // finished. The join reply carries no moves, so ask for the record now rather
  // than wait for the next poll to get round to it: the alternative is a board
  // that looks ready to play for a couple of seconds before the verdict lands.
  if (snap.status === 'over') {
    roomGame.reread();
    return;
  }
  // The clock starts here rather than at the first move: the referee sets it
  // running the moment the second seat fills, whether or not anybody answers.
  const text = `你执${side(myColor)}，对面是 ${opponentLabel()}${
    clock.enabled ? `，每方 ${speakClock(snap.time_ms)}` : ''
  }。`;
  els.srStatus.textContent = text;
  showToast(text);
  renderAll();
}

/**
 * Put the server's clocks on the board. Nothing here counts a move down by
 * hand: `Clock` keeps spending from the balance it is handed, so between two
 * polls the player watches a live countdown that the next snapshot straightens
 * out by the few hundred milliseconds of travel time it took.
 */
function applyRoomClock(snap) {
  if (!clock.enabled || !snap.clock) return;
  clock.restore(snap.clock);
}

/**
 * Replay the moves the board has not seen. Returns false the moment the list
 * stops fitting — a hole in the numbering, or a move the engine will not play
 * from here — which is the caller's cue to rebuild the game from the whole list
 * rather than go on patching it.
 */
function applyEvents(events) {
  for (const event of events) {
    if (!applyEvent(event)) return false;
  }
  return true;
}

function applyEvent(event) {
  if (event.seq <= appliedSeq) return true; // already on the board
  if (event.seq !== appliedSeq + 1) return false; // a move we were never told about
  if (event.san === sentSan) {
    // The referee writing down what this side already played in anticipation.
    // The ply is on the board, so only the cursor moves.
    appliedSeq = event.seq;
    sentSan = null;
    return true;
  }
  // A move of theirs where we had guessed ours: their word is the one that
  // stands, so take the guess back before playing what actually happened.
  if (sentSan !== null) rewindGuess();
  // The SAN came from the referee, so it is one this engine would have written
  // itself — unless the two have fallen out over the position, which is what
  // the null answer means and what a rebuild is for.
  const played = game.move(event.san);
  if (!played) return false;
  appliedSeq = event.seq;
  trackGameStart(); // also counts the game as started: they may have opened
  return true;
}

/** Lift the anticipated move off the board. Rendering is the caller's. */
function rewindGuess() {
  if (sentSan === null) return;
  sentSan = null;
  game.undo();
}

/** Do the board and the referee disagree about where the game is? */
function needsRebuild(snap) {
  if (appliedSeq < snap.seq) return true; // moves exist that this board has not seen
  // Ahead of the room row is the server's own two reads a move apart, not a
  // board out of step; and with a move in flight this side is honestly one ply
  // past the record until the referee confirms or refuses it.
  if (appliedSeq > snap.seq || sentSan !== null) return false;
  return game.fen() !== snap.fen;
}

/**
 * Play the game again from the referee's own list of moves. The one recovery
 * this board can do by itself, and the one thing a player should never notice:
 * the pieces land back where the server says they are.
 */
async function rebuild() {
  if (rebuilding) return;
  rebuilding = true;
  try {
    game.reset();
    appliedSeq = 0;
    sentSan = null;
    const reply = await roomGame.reread();
    if (!reply?.ok || !applyEvents(roomGame.events) || needsRebuild(roomGame.room)) {
      roomDesynced();
    }
  } finally {
    rebuilding = false;
  }
  if (onlineUiState === 'ended') return; // roomDesynced has already spoken
  applyRoomClock(roomGame.room);
  renderAll();
  if (roomGame.room?.status === 'over') endFromRoom(roomGame.room);
}

/**
 * The board cannot be brought into line with the referee. There is no move to
 * take back and no position to trust, so the game stops here; the two players
 * have to open another room. The list is still on the server if anybody wants
 * to read it.
 */
function roomDesynced() {
  if (onlineUiState === 'ended' && !roomTimer) return; // already said
  stopRoomPolling();
  onlineUiState = 'ended';
  finishPromotion(null);
  clearSelection();
  closeDialogs();
  const text = '棋盘和服务器的记录对不上，这一局只能停下。请重新开一局。';
  els.srStatus.textContent = text;
  showToast(text);
  renderAll();
}

/** How the referee ended a game, in the words PGN exports. */
const ROOM_TERMINATION = {
  checkmate: 'normal',
  stalemate: 'normal',
  'resign-white': 'resigned',
  'resign-black': 'resigned',
  'timeout-white': 'time forfeit',
  'timeout-black': 'time forfeit',
};

const ROOM_SIDE = {
  'resign-white': 'w',
  'resign-black': 'b',
  'timeout-white': 'w',
  'timeout-black': 'b',
};

/** The verdict, in the shape every other end on this board has. */
function roomEnd(snap) {
  const won = snap.winner !== null && snap.winner !== undefined;
  const kind = won ? (snap.winner === myColor ? 'win' : 'loss') : 'draw';
  return {
    kind,
    // The server's own code, so the analytics for online games name the reason
    // the referee gave rather than one this board inferred.
    reason: snap.result,
    result: won ? resultFor(snap.winner) : '1/2-1/2',
    termination: ROOM_TERMINATION[snap.result] || 'abandoned',
    title: kind === 'draw' ? '和棋' : kind === 'win' ? '你赢了' : '你输了',
    sub: roomEndText(snap),
  };
}

/**
 * What the end says to the person sitting at this seat. The room carries the
 * phrase too, but it is written for somebody reading a list of rooms: it names
 * colours, where a player wants to know about themselves.
 */
function roomEndText(snap) {
  if (snap.result === 'checkmate') {
    return snap.winner === myColor ? '你把对方将死了。' : `${opponentLabel()}把你将死了。`;
  }
  if (snap.result === 'stalemate') return '逼和 —— 两边都没有合法走法。';
  const side = ROOM_SIDE[snap.result];
  if (!side) return snap.result_text || '这局结束了。';
  const who = side === myColor ? '你' : opponentLabel();
  return snap.result.startsWith('resign') ? `${who}认输了。` : `${who}的钟走完了。`;
}

/** Take the referee's verdict onto the board, once. */
function endFromRoom(snap) {
  if (onlineEnd) return;
  onlineEnd = roomEnd(snap);
  onlineUiState = 'ended';
  // Nothing left to ask about: the game is written down and its clocks are
  // stopped where the referee stopped them.
  stopRoomPolling();
  revealEnd(onlineEnd);
}

/* ------------------------------------------------------------------ */
/* Keeping up with the room                                            */
/* ------------------------------------------------------------------ */

function startRoomPolling() {
  if (roomTimer || !roomGame.code) return;
  roomTimer = setInterval(pollRoom, POLL_MS);
}

function stopRoomPolling() {
  clearInterval(roomTimer);
  roomTimer = 0;
}

/**
 * Ask what we have missed. One question at a time, and the same flag covers a
 * move on its way: two answers arriving out of order is a board that has to be
 * rebuilt, and a slow host should not have twenty polls queued up behind them.
 */
async function pollRoom() {
  if (requestOut) return;
  requestOut = true;
  try {
    await roomGame.poll();
  } finally {
    requestOut = false;
  }
}

/** Send a move the player has already seen played. */
async function sendRoomMove(san) {
  requestOut = true;
  try {
    await roomGame.move(san);
  } finally {
    requestOut = false;
  }
  // The reply carried the room as the referee saw it after writing the move
  // down, so handleRoomSnapshot has already put the clocks right; a refusal
  // went to handleRoomProblem. There is nothing left to do from here.
}

/**
 * A call that came back refused. Which of the three kinds it is decides how
 * much changes: an account problem stops the game and opens the panel that
 * fixes it, a room we are no longer in stops the game, and a dropped question
 * is not news at all — the next poll asks it again.
 */
function handleRoomProblem(reply) {
  if (!reply || mode !== 'online') return;
  const code = reply.code;

  if (code === 'sign_in_required' || code === 'verify_required') {
    stopRoomPolling();
    const text = problemText(reply);
    els.srStatus.textContent = text;
    onlineProblem(text);
    if (onlineUiState === 'playing') onlineUiState = 'ended';
    updateModeUi();
    account.open(code === 'sign_in_required' ? 'signin' : 'account');
    return;
  }

  if (code === 'not_room_member' || code === 'no_such_room') {
    stopRoomPolling();
    onlineUiState = 'ended';
    onlineProblem(problemText(reply));
    updateModeUi();
    return;
  }

  const arranging = onlineUiState === 'creating' || onlineUiState === 'joining';
  if ((code === 'network' || code === 'service') && sentSan === null && !arranging) {
    return; // a hole in the connection, not a problem with the game
  }

  onlineProblem(problemText(reply));
  // The move came back refused, so the position on the board is one the
  // referee is not playing. A dropped request is the exception: the move may
  // well have landed, and waiting for the answer beats guessing it here.
  if (sentSan !== null && code !== 'network') {
    rewindGuess();
    renderAll();
  }
}

function requestResign() {
  if (!(mode === 'online' && onlineUiState === 'playing' && !gameFinished())) return;
  askConfirm(
    {
      title: '要认输吗？',
      sub: `认输就把这一局送给了 ${opponentLabel()}。`,
      confirmLabel: '认输',
    },
    () => {
      // The referee may have ended the game while this dialog was open; a stale
      // confirmation must not go and write over that verdict.
      if (!(mode === 'online' && onlineUiState === 'playing' && !gameFinished())) return;
      // Nothing is decided here. The reply comes back with the game over, and
      // that snapshot is what puts the result on the board.
      roomGame.resign();
    },
  );
}

/**
 * Stop watching this room. There is no message to send: the game stays exactly
 * as it is, the clocks included, and the other player goes on waiting for a
 * move that will not come. What cannot be undone is this side's seat — a room
 * only takes a player while it is empty — so leaving is final, and the player
 * is told so.
 */
function requestLeave() {
  if (mode !== 'online') return;
  const inPlay = onlineUiState === 'playing' && !gameFinished() && game.history().length > 0;
  if (!inPlay) {
    enterOnlineIdle();
    return;
  }
  askConfirm(
    {
      title: '离开这一局？',
      sub: '离开之后这个房间码不能再坐回来。钟会继续走，直到归零。',
      confirmLabel: '离开',
    },
    enterOnlineIdle,
  );
}

/* ------------------------------------------------------------------ */
/* Invite codes and links                                              */
/* ------------------------------------------------------------------ */

function inviteLink() {
  return `${location.origin}${location.pathname}#g=${encodeURIComponent(roomGame.code || '')}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function copyInviteCode() {
  if (!roomGame.code) return;
  if (await copyToClipboard(roomGame.code)) {
    showToast('房间码已复制。');
    const copyIcon = els.copyCodeBtn.querySelector('.icon-copy');
    const checkIcon = els.copyCodeBtn.querySelector('.icon-check');
    copyIcon?.classList.add('hidden');
    checkIcon?.classList.remove('hidden');
    clearTimeout(copyCodeTimer);
    copyCodeTimer = setTimeout(() => {
      copyIcon?.classList.remove('hidden');
      checkIcon?.classList.add('hidden');
    }, 1600);
  } else {
    showToast('复制没成功 —— 请选中房间码自己复制。');
  }
}

async function copyInviteLink() {
  if (!roomGame.code) return;
  if (await copyToClipboard(inviteLink())) {
    showToast('邀请链接已复制 —— 发给对方就能进来。');
    els.copyLinkLabel.textContent = '链接已复制！';
    clearTimeout(copyLinkTimer);
    copyLinkTimer = setTimeout(() => {
      els.copyLinkLabel.textContent = '复制邀请链接';
    }, 1600);
  } else {
    showToast('复制没成功 —— 请选中房间码自己复制。');
  }
}

/* ------------------------------------------------------------------ */
/* PGN export                                                          */
/* ------------------------------------------------------------------ */

/**
 * Player names for the export. A PGN header is scoresheet notation rather than
 * interface text, so it keeps the English form — the difficulty included, which
 * is why that is spelled out here instead of reading LEVELS' labels.
 */
const PGN_LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

function pgnNames() {
  if (mode === 'local') return { w: 'Player 1', b: 'Player 2' };
  if (mode === 'online') {
    // The nicknames the referee holds, so a scoresheet says who played rather
    // than who was sitting at this device.
    return { w: seatName('w') || 'White', b: seatName('b') || 'Black' };
  }
  const cpu = `Computer (${PGN_LEVEL[level]})`;
  return myColor === 'w' ? { w: 'Player', b: cpu } : { w: cpu, b: 'Player' };
}

function currentPgn(date) {
  const end = currentEnd();
  const names = pgnNames();
  return buildPgn({
    sans: game.history().map((m) => m.san),
    result: end ? end.result : '*',
    white: names.w,
    black: names.b,
    date,
    control: clock.control,
    termination: end ? end.termination : 'unterminated',
  });
}

async function copyPgn() {
  if (game.history().length === 0) return;
  if (await copyToClipboard(currentPgn(new Date()))) {
    showToast('棋谱已复制（PGN 格式）。');
  } else {
    showToast('复制没成功 —— 浏览器拦下了剪贴板。');
  }
}

function downloadPgn() {
  if (game.history().length === 0) return;
  const now = new Date();
  let url = null;
  try {
    url = URL.createObjectURL(
      new Blob([currentPgn(now)], { type: 'application/x-chess-pgn' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = pgnFilename(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Released on a later task, once the download has certainly started.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('棋谱已存成 PGN 文件。');
  } catch {
    if (url) URL.revokeObjectURL(url);
    copyPgn(); // no downloads here; the clipboard still gets the player the game
  }
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

/**
 * The ichessgeek panel in the top bar (see ui/account.js). Online play is the
 * only thing the account is needed for, so the one thing to keep in step with
 * it is the room: signing out stops watching it, since the referee will not
 * take another move from a seat that is no longer signed in.
 */
const account = mountAccount({ showToast, onSignOut: handleSignedOut });

/** Signed out with a room open: put the online tab back to where it starts. */
function handleSignedOut() {
  if (!roomGame.code) return; // nothing was open
  const inPlay = onlineUiState === 'playing' && !gameFinished();
  enterOnlineIdle();
  const text = inPlay
    ? '你已退出登录，这一局不再刷新。钟会继续走。'
    : '你已退出登录。';
  showToast(text);
  els.srStatus.textContent = text;
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

for (const button of els.modeButtons) {
  button.addEventListener('click', () => setMode(button.dataset.mode));
}

els.newGameBtn.addEventListener('click', requestNewGame);
els.undoBtn.addEventListener('click', undoTurn);
els.resignBtn.addEventListener('click', requestResign);
els.leaveBtn.addEventListener('click', requestLeave);
els.gameoverNew.addEventListener('click', newGame); // hidden in online mode
els.gameoverClose.addEventListener('click', () => els.gameoverDialog.close());

els.hostBtn.addEventListener('click', createRoom);
els.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinRoom(els.joinInput.value);
});
els.copyCodeBtn.addEventListener('click', copyInviteCode);
els.copyLinkBtn.addEventListener('click', copyInviteLink);
els.cancelHostBtn.addEventListener('click', cancelOnlineSetup);
els.cancelJoinBtn.addEventListener('click', cancelOnlineSetup);

els.levelSelect.addEventListener('change', () => {
  level = els.levelSelect.value;
  saveSettings();
  renderAll();
});

els.colorSelect.addEventListener('change', () => {
  colorSetting = els.colorSelect.value;
  saveSettings();
});

els.timeSelect.addEventListener('change', () => {
  timeSetting = els.timeSelect.value;
  saveSettings();
  // Nothing has been played yet, so there is no game to disturb: put the new
  // clock on the board at once rather than making the player press New game
  // to see the choice they just made.
  if (mode !== 'online' && !gameFinished() && game.history().length === 0) {
    resetClock(timeControl(timeSetting));
  }
  renderAll();
});

els.reviewFirstBtn.addEventListener('click', () => goToPly(0));
els.reviewPrevBtn.addEventListener('click', () => goToPly(viewPlies() - 1));
els.reviewNextBtn.addEventListener('click', () => goToPly(viewPlies() + 1));
els.reviewLastBtn.addEventListener('click', () => goToPly(game.history().length));

// The move list is rebuilt on every render, so the click lands on the list.
els.moveList.addEventListener('click', (e) => {
  const ply = e.target.closest('button.ply');
  if (ply) goToPly(Number(ply.dataset.ply));
});

els.pgnCopyBtn.addEventListener('click', copyPgn);
els.pgnDownloadBtn.addEventListener('click', downloadPgn);

for (const button of els.themeButtons) {
  button.addEventListener('click', () => {
    themeSetting = button.dataset.themeChoice;
    saveSettings();
    applyTheme();
  });
}

for (const button of els.promoDialog.querySelectorAll('[data-promo]')) {
  button.addEventListener('click', () => finishPromotion(button.dataset.promo));
}
// Native <dialog> close (Escape, close()) — resolve a pending promotion as
// cancelled. finishPromotion is a no-op when nothing is pending.
els.promoDialog.addEventListener('close', () => finishPromotion(null));

els.confirmYes.addEventListener('click', () => {
  const action = confirmAction;
  confirmAction = null;
  els.confirmDialog.close();
  action?.();
});
els.confirmNo.addEventListener('click', () => els.confirmDialog.close());
els.confirmDialog.addEventListener('close', () => {
  confirmAction = null;
});

// Clicking the backdrop dismisses a dialog. Backdrop clicks target the dialog
// element itself but land outside its box; padding clicks land inside it.
function closeOnBackdropClick(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) dialog.close();
  });
}
closeOnBackdropClick(els.promoDialog);
closeOnBackdropClick(els.gameoverDialog);
closeOnBackdropClick(els.confirmDialog);
closeOnBackdropClick(els.accountDialog);

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Escape in the account panel closes that panel and nothing else.
  if (e.target instanceof Element && e.target.closest('#account-dialog')) return;
  // Dialogs close natively on Escape; handle them here too so the shortcut
  // cannot be lost, and so Escape means "close dialog" before "deselect".
  if (els.promoDialog.open) {
    finishPromotion(null);
  } else if (els.gameoverDialog.open) {
    els.gameoverDialog.close();
  } else if (els.confirmDialog.open) {
    els.confirmDialog.close();
  } else if (els.accountDialog.open) {
    els.accountDialog.close();
  } else if (selected) {
    // Escape means "put it back": a piece still held under the pointer is
    // dropped along with the selection, rather than left riding the cursor
    // with nowhere legal to land.
    boardView.cancelDrag();
    clearSelection();
    renderAll();
  }
});

function anyDialogOpen() {
  return (
    els.promoDialog.open ||
    els.gameoverDialog.open ||
    els.confirmDialog.open ||
    els.accountDialog.open
  );
}

// Step through the game with the arrow keys. Two things already own these
// keys and keep them: a focused square, where they move around the board's
// ARIA grid, and a form control, where they change its value.
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (anyDialogOpen()) return;
  if (e.target instanceof Element && e.target.closest('#board, input, select, textarea')) {
    return;
  }
  const plies = viewPlies();
  switch (e.key) {
    case 'ArrowLeft': goToPly(plies - 1); break;
    case 'ArrowRight': goToPly(plies + 1); break;
    case 'Home': goToPly(0); break;
    case 'End': goToPly(game.history().length); break;
    default: return;
  }
  e.preventDefault();
});

// The page is going away, or into the back/forward cache. There is no goodbye
// to send: the room stays as it is, clock and all. So the two things worth
// doing are stop asking about it, and stop the local countdown — a page frozen
// for ten minutes should not come back ten minutes down, and `pagehide` is the
// only moment that knows the page is leaving.
window.addEventListener('pagehide', () => {
  stopRoomPolling();
  clock.setRunning(null);
  stopClockTimer();
  saveNow();
});

// Hidden: a tab put in the background may never be looked at again, so store
// the clock where it stands rather than at the last move. Shown again: the
// timers were throttled while we were away, so ask what happened rather than
// wait for the next poll to get round to it.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow();
  else if (mode === 'online' && roomGame.code) pollRoom();
});

// Back from the back/forward cache: the room is still ours but pagehide stopped
// watching it, and the clocks have been frozen for as long as the page was put
// away. One poll says what happened in the meantime; the render picks the clock
// back up where pagehide left it.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  if (mode === 'online' && roomGame.code && ['hosting', 'playing'].includes(onlineUiState)) {
    startRoomPolling();
    pollRoom();
  }
  renderAll();
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

buildTimeOptions();
loadSettings();
applyTheme();

// An invite link is a room code in the address bar. Arriving through one lands
// on the online tab with the code already in the box — but the player still has
// to press 进入, so a link that was not meant for them cannot seat them in a
// stranger's game. This does not go into the settings: the next plain visit to
// the board opens whatever mode they last chose.
const invited = normalizeCode(window.location.hash);
if (invited) mode = 'online';

if (mode === 'online') enterOnlineIdle({ inviteCode: invited });
else if (!restoreGame()) newGame(); // nothing stored, or what is stored no longer replays
