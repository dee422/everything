/**
 * PGN export (Portable Game Notation, the format every chess program reads).
 *
 * A tag pair section carrying the mandatory seven-tag roster, then the moves
 * in SAN with the result as the final token. Nothing here touches the DOM or
 * the engine: it takes the SAN list the move log already holds, plus whatever
 * the app knows about the players and how the game ended.
 */

/** PGN wraps movetext at 80 columns; long lines are legal but discourteous. */
const LINE_WIDTH = 80;

const pad = (n) => String(n).padStart(2, '0');

/**
 * Tag values are quoted strings in which `"` and `\` must be escaped, and
 * which cannot contain newlines. Opponent names come off the wire, so this
 * also caps the length rather than trusting it.
 */
function tagValue(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[\\"]/g, (ch) => `\\${ch}`);
}

/** `YYYY.MM.DD` in local time, the PGN date format. */
export function pgnDate(date) {
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

/** PGN's TimeControl tag: seconds+increment, or "-" for an untimed game. */
function timeControlTag(control) {
  if (!control) return '-';
  return `${Math.round(control.initial / 1000)}+${Math.round(control.increment / 1000)}`;
}

/** `1. e4 e5 2. Nf3` … wrapped at LINE_WIDTH, with the result appended. */
function movetext(sans, result) {
  const tokens = [];
  sans.forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(san);
  });
  tokens.push(result);

  const lines = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > LINE_WIDTH) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * Build a complete PGN game.
 *
 * @param {{
 *   sans: string[],                 moves in standard algebraic notation
 *   result: string,                 "1-0" | "0-1" | "1/2-1/2" | "*"
 *   white: string, black: string,   player names
 *   date: Date,
 *   control?: {initial: number, increment: number}|null,
 *   termination?: string,           PGN Termination, omitted when "normal"
 *   event?: string, site?: string,
 *   startFen?: string|null,         开局不是标准局时写进 SetUp + FEN，省略则不写
 * }} game
 */
export function buildPgn({
  sans,
  result,
  white,
  black,
  date,
  control = null,
  termination = 'normal',
  event = 'Casual game',
  site = 'www.ichessgeek.com/chess',
  startFen = null,
}) {
  const tags = [
    ['Event', event],
    ['Site', site],
    ['Date', pgnDate(date)],
    ['Round', '-'],
    ['White', white],
    ['Black', black],
    ['Result', result],
    ['TimeControl', timeControlTag(control)],
  ];
  // Termination is optional and "normal" is the default reading, so only a
  // game that ended some other way is worth spelling out.
  if (termination && termination !== 'normal') tags.push(['Termination', termination]);
  // A game that did not start from the usual position has to say so, or the
  // file re-imports as a different game than the one it recorded.
  if (startFen) tags.push(['SetUp', '1'], ['FEN', startFen]);

  const header = tags.map(([key, value]) => `[${key} "${tagValue(value)}"]`).join('\n');
  return `${header}\n\n${movetext(sans, result)}\n`;
}

/** A filesystem-safe name for a downloaded game. */
export function pgnFilename(date) {
  return `chess-${stamp(date)}.pgn`;
}

/** `20261123-1940`, the file-name form of a moment. */
function stamp(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

/**
 * Several games as one document.
 *
 * @param {Parameters<typeof buildPgn>[0][]} games each in buildPgn's own shape
 */
export function bundlePgn(games) {
  // buildPgn ends each game with a single newline, and PGN wants a blank line
  // before the next tag section — so joining with one newline is the whole job.
  return games.map((game) => buildPgn(game)).join('\n');
}

/**
 * The name for a bundle. The count is in it because a player exporting twice in
 * a session would otherwise get two files called chess-…-1940.pgn, one of which
 * the browser quietly renames to "(1)".
 */
export function bundleFilename(date, count) {
  return `chess-${stamp(date)}-${count}games.pgn`;
}

/**
 * NAG (Numeric Annotation Glyph) codes for move classifications.
 * These are standard PGN annotation codes that chess programs understand.
 */
const NAG = {
  blunder: '$4',      // Blunder
  mistake: '$2',      // Mistake
  inaccuracy: '$6',   // Inaccuracy
  good: '$1',         // Good move
  best: '$3',         // Excellent move
};

/**
 * Build an annotated PGN with review analysis.
 *
 * @param {{
 *   sans: string[],
 *   result: string,
 *   white: string, black: string,
 *   date: Date,
 *   control?: {initial: number, increment: number}|null,
 *   termination?: string,
 *   event?: string, site?: string,
 *   startFen?: string|null,         开局不是标准局时写进 SetUp + FEN
 *   review?: {
 *     results: Array<{ classification: string, loss?: number, evalBefore?: number, evalAfter?: number }>,
 *   },
 * }} game
 */
export function buildAnnotatedPgn({
  sans,
  result,
  white,
  black,
  date,
  control = null,
  termination = 'normal',
  event = 'Casual game',
  site = 'www.ichessgeek.com/chess',
  startFen = null,
  review,
}) {
  const tags = [
    ['Event', event],
    ['Site', site],
    ['Date', pgnDate(date)],
    ['Round', '-'],
    ['White', white],
    ['Black', black],
    ['Result', result],
    ['TimeControl', timeControlTag(control)],
    ['Annotator', 'Stockfish (复盘分析)'],
  ];
  if (termination && termination !== 'normal') tags.push(['Termination', termination]);
  if (startFen) tags.push(['SetUp', '1'], ['FEN', startFen]);

  const header = tags.map(([key, value]) => `[${key} "${tagValue(value)}"]`).join('\n');

  // Build annotated movetext
  const tokens = [];
  sans.forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(san);

    // Add review annotations if available
    if (review?.results?.[i]) {
      const r = review.results[i];

      // Add NAG for classification
      if (r.classification && NAG[r.classification]) {
        tokens.push(NAG[r.classification]);
      }

      // Add eval comment
      if (r.evalAfter !== undefined) {
        const evalStr = formatEvalForPgn(r.evalAfter);
        tokens.push(`{ [%eval ${evalStr}] }`);
      }
    }
  });
  tokens.push(result);

  // Wrap at LINE_WIDTH
  const lines = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > LINE_WIDTH) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) lines.push(line);

  return `${header}\n\n${lines.join('\n')}\n`;
}

/** Format eval for PGN comment: +0.45 or -1.23 */
function formatEvalForPgn(cp) {
  if (Math.abs(cp) >= 1000) {
    return cp > 0 ? '+M' : '-M';
  }
  const sign = cp >= 0 ? '+' : '';
  return `${sign}${(cp / 100).toFixed(2)}`;
}
