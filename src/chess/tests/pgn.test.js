import { describe, it, expect } from 'vitest';
import {
  buildPgn,
  buildAnnotatedPgn,
  bundleFilename,
  bundlePgn,
  pgnDate,
  pgnFilename,
} from '../src/game/pgn.js';
import { Chess } from '../src/engine/chess.js';
import { parsePgn, startFenFromTags } from '../src/game/pgnParser.js';

const DATE = new Date(2026, 7, 11, 14, 32); // 11 August 2026, local time

const base = {
  sans: ['e4', 'e5'],
  result: '*',
  white: 'Player',
  black: 'Computer (Hard)',
  date: DATE,
};

/** The tag pairs of a PGN, as an ordered list of [key, value]. */
function tags(pgn) {
  return [...pgn.matchAll(/^\[(\w+) "(.*)"\]$/gm)].map((m) => [m[1], m[2]]);
}

function moveText(pgn) {
  return pgn.split('\n\n')[1].trim();
}

describe('tag pairs', () => {
  it('carries the mandatory seven-tag roster, in order', () => {
    const keys = tags(buildPgn(base)).map(([key]) => key);
    expect(keys.slice(0, 7)).toEqual([
      'Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result',
    ]);
  });

  it('writes the players and the result', () => {
    const pgn = buildPgn({ ...base, result: '1-0' });
    expect(pgn).toContain('[White "Player"]');
    expect(pgn).toContain('[Black "Computer (Hard)"]');
    expect(pgn).toContain('[Result "1-0"]');
  });

  it('formats the date as YYYY.MM.DD', () => {
    expect(pgnDate(DATE)).toBe('2026.08.11');
    expect(buildPgn(base)).toContain('[Date "2026.08.11"]');
  });

  it('writes the time control in seconds, or "-" when untimed', () => {
    expect(buildPgn(base)).toContain('[TimeControl "-"]');
    expect(
      buildPgn({ ...base, control: { initial: 300000, increment: 3000 } }),
    ).toContain('[TimeControl "300+3"]');
    expect(
      buildPgn({ ...base, control: { initial: 60000, increment: 0 } }),
    ).toContain('[TimeControl "60+0"]');
  });

  it('spells out a termination only when it was not a normal one', () => {
    expect(buildPgn(base)).not.toContain('Termination');
    expect(buildPgn({ ...base, termination: 'normal' })).not.toContain('Termination');
    expect(buildPgn({ ...base, termination: 'time forfeit' })).toContain(
      '[Termination "time forfeit"]',
    );
  });

  it('escapes quotes and backslashes in a name off the wire', () => {
    const pgn = buildPgn({ ...base, black: 'a"b\\c' });
    expect(pgn).toContain('[Black "a\\"b\\\\c"]');
  });

  it('caps a long name without splitting an escape in half', () => {
    // A cap applied to the escaped text can fall between a backslash and the
    // character it escapes, leaving a tag that ends on a dangling escape.
    const pgn = buildPgn({ ...base, black: `${'a'.repeat(119)}"` });
    const [, value] = tags(pgn).find(([key]) => key === 'Black');
    expect(value).toBe(`${'a'.repeat(119)}\\"`);
    expect(value.endsWith('\\')).toBe(false);
  });

  it('keeps a name with newlines on one line', () => {
    const pgn = buildPgn({ ...base, black: 'first\nsecond' });
    expect(pgn).toContain('[Black "first second"]');
    // One tag per line, and no stray line the parser would choke on.
    expect(pgn.split('\n').filter((line) => line.startsWith('['))).toHaveLength(8);
  });
});

describe('movetext', () => {
  it('numbers moves in pairs and ends with the result', () => {
    const pgn = buildPgn({ ...base, sans: ['e4', 'e5', 'Nf3', 'Nc6'], result: '1-0' });
    expect(moveText(pgn)).toBe('1. e4 e5 2. Nf3 Nc6 1-0');
  });

  it('numbers a game that ends on White’s move', () => {
    const pgn = buildPgn({ ...base, sans: ['e4', 'e5', 'Qh5'], result: '*' });
    expect(moveText(pgn)).toBe('1. e4 e5 2. Qh5 *');
  });

  it('is just the result when no moves were played', () => {
    expect(moveText(buildPgn({ ...base, sans: [], result: '*' }))).toBe('*');
  });

  it('wraps movetext at 80 columns', () => {
    const sans = Array.from({ length: 120 }, (_, i) => (i % 2 ? 'Nf6' : 'Nf3'));
    const lines = moveText(buildPgn({ ...base, sans, result: '1/2-1/2' })).split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
    // Nothing is lost or split across the wrap.
    expect(lines.join(' ').split(/\s+/).filter((t) => t === 'Nf3')).toHaveLength(60);
  });

  it('ends with a newline, as PGN readers expect', () => {
    expect(buildPgn(base).endsWith('\n')).toBe(true);
  });
});

describe('a real game', () => {
  it('exports a game played through the engine', () => {
    // Scholar's mate, so the export includes a check, a capture and a mate.
    const game = new Chess();
    for (const [from, to] of [
      ['e2', 'e4'], ['e7', 'e5'],
      ['f1', 'c4'], ['b8', 'c6'],
      ['d1', 'h5'], ['g8', 'f6'],
      ['h5', 'f7'],
    ]) {
      expect(game.move({ from, to })).not.toBe(null);
    }
    expect(game.isCheckmate()).toBe(true);
    const pgn = buildPgn({
      ...base,
      sans: game.history().map((m) => m.san),
      result: game.status().result,
    });
    expect(moveText(pgn)).toBe('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0');
    expect(pgn).toContain('[Result "1-0"]');
  });
});

describe('pgnFilename', () => {
  it('names the file after the date and time', () => {
    expect(pgnFilename(DATE)).toBe('chess-20260811-1432.pgn');
  });
});

describe('a bundle of games', () => {
  it('is one game written exactly as buildPgn writes it', () => {
    expect(bundlePgn([base])).toBe(buildPgn(base));
  });

  it('leaves a blank line between one game’s movetext and the next tags', () => {
    // PGN readers split a file on the empty line that follows a tag section,
    // so two games run together are one game with a broken header.
    const second = { ...base, result: '0-1' };
    const pgn = bundlePgn([base, second]);
    expect(pgn).toBe(`${buildPgn(base)}\n${buildPgn(second)}`);
    const parts = pgn.split('\n\n');
    expect(parts).toHaveLength(4); // header, movetext, header, movetext
    expect(parts[2].startsWith('[Event ')).toBe(true);
    expect(pgn.endsWith('\n')).toBe(true);
  });

  it('keeps every game it is handed', () => {
    const pgn = bundlePgn([base, base, { ...base, sans: [], result: '*' }]);
    expect([...pgn.matchAll(/^\[Result /gm)]).toHaveLength(3);
    expect([...pgn.matchAll(/^\[White "Player"\]$/gm)]).toHaveLength(3);
  });

  it('writes each game with the date it was played, not the date of the export', () => {
    const pgn = bundlePgn([
      { ...base, date: new Date(2026, 0, 5, 9, 0) },
      base,
    ]);
    expect(pgn).toContain('[Date "2026.01.05"]');
    expect(pgn).toContain('[Date "2026.08.11"]');
  });

  it('names the file after the export and says how many games are in it', () => {
    expect(bundleFilename(DATE, 3)).toBe('chess-20260811-1432-3games.pgn');
    // The count is what keeps a second export of the same minute from being
    // silently renamed to "…(1).pgn" by the browser.
    expect(bundleFilename(DATE, 1)).not.toBe(pgnFilename(DATE));
  });
});

describe('buildAnnotatedPgn', () => {
  const annotatedBase = {
    ...base,
    sans: ['e4', 'e5', 'Nf3', 'Nc6'],
    result: '*',
  };
  // 复盘结果里的 fen 是走这手之前的局面，所以第 0 手轮白方
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  it('includes an Annotator tag when review data is provided', () => {
    const pgn = buildAnnotatedPgn({
      ...annotatedBase,
      review: {
        results: [
          { classification: 'best', evalAfter: 30 },
          { classification: 'good', evalAfter: 20 },
          { classification: 'best', evalAfter: 35 },
          { classification: 'good', evalAfter: 25 },
        ],
      },
    });
    expect(pgn).toContain('[Annotator "Stockfish (复盘分析)"]');
  });

  it('adds NAG codes for move classifications', () => {
    const pgn = buildAnnotatedPgn({
      ...annotatedBase,
      review: {
        results: [
          { classification: 'best', evalAfter: 30 },
          { classification: 'blunder', evalAfter: -200 },
          { classification: 'mistake', evalAfter: -100 },
          { classification: 'inaccuracy', evalAfter: -50 },
        ],
      },
    });
    // 标准 NAG 表：! = $1, ?? = $6, ? = $2, ?! = $4。走法后面跟的就是它在
    // 别的软件里会显示出来的符号，写错编号等于换了个意思。
    expect(moveText(pgn)).toContain('e4 $1');
    expect(moveText(pgn)).toContain('e5 $6');
    expect(moveText(pgn)).toContain('Nf3 $2');
    expect(moveText(pgn)).toContain('Nc6 $4');
  });

  it('exports "!!" only for the best move that gains a pawn', () => {
    const pgn = buildAnnotatedPgn({
      ...annotatedBase,
      review: {
        results: [
          // 引擎第一选，而且把局面抬了两兵 —— 这才配 $5
          { classification: 'best', fen: START, evalBefore: 20, evalAfter: 220 },
          { classification: 'best', fen: START, evalBefore: 20, evalAfter: 40 },
        ],
      },
    });
    expect(moveText(pgn)).toContain('e4 $5');
    expect(moveText(pgn)).toContain('e5 $1');
  });

  it('adds eval comments in PGN format', () => {
    const pgn = buildAnnotatedPgn({
      ...annotatedBase,
      review: {
        results: [
          { classification: 'best', evalAfter: 45 },
          { classification: 'good', evalAfter: -123 },
          { classification: 'best', evalAfter: 1000 },
          { classification: 'good', evalAfter: -1000 },
        ],
      },
    });
    expect(pgn).toContain('[%eval +0.45]');
    expect(pgn).toContain('[%eval -1.23]');
    expect(pgn).toContain('[%eval +M]');
    expect(pgn).toContain('[%eval -M]');
  });

  it('produces valid PGN structure with tags and movetext', () => {
    const pgn = buildAnnotatedPgn({
      ...annotatedBase,
      review: {
        results: [
          { classification: 'best', evalAfter: 30 },
          { classification: 'good', evalAfter: 20 },
        ],
      },
    });
    // Should have tag section and movetext section separated by blank line
    const parts = pgn.split('\n\n');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]).toContain('[Event');
    expect(parts[0]).toContain('[Annotator');
  });

  it('works without review data (falls back to plain PGN)', () => {
    const pgn = buildAnnotatedPgn(annotatedBase);
    expect(pgn).toContain('[Annotator "Stockfish (复盘分析)"]');
    expect(moveText(pgn)).toBe('1. e4 e5 2. Nf3 Nc6 *');
  });

  it('handles partial review data gracefully', () => {
    const pgn = buildAnnotatedPgn({
      ...annotatedBase,
      review: {
        results: [
          { classification: 'best', evalAfter: 30 },
          // Missing data for other moves
        ],
      },
    });
    // Should not throw, just annotate what's available
    expect(moveText(pgn)).toBe('1. e4 $1 { [%eval +0.30] } e5 2. Nf3 Nc6 *');
  });
});

describe('a game that did not start from the usual position', () => {
  const ENDGAME = '8/6pk/8/7p/4K2P/5P2/8/8 b - - 3 61';

  it('writes SetUp and FEN only when given a start position', () => {
    expect(tags(buildPgn(base)).map(([key]) => key)).not.toContain('FEN');
    const pairs = tags(buildPgn({ ...base, startFen: ENDGAME }));
    expect(pairs).toContainEqual(['SetUp', '1']);
    expect(pairs).toContainEqual(['FEN', ENDGAME]);
  });

  it('keeps the movetext itself unchanged', () => {
    expect(moveText(buildPgn({ ...base, startFen: ENDGAME }))).toBe('1. e4 e5 *');
  });

  it('carries the same tags through the annotated export', () => {
    const pgn = buildAnnotatedPgn({
      ...base,
      startFen: ENDGAME,
      review: { results: [{ classification: 'blunder', evalAfter: -180 }] },
    });
    const pairs = tags(pgn);
    expect(pairs).toContainEqual(['SetUp', '1']);
    expect(pairs).toContainEqual(['FEN', ENDGAME]);
    // 错着 = ?? = $6
    expect(moveText(pgn)).toContain('$6');
  });

  it('survives a round trip back through the parser', () => {
    const parsed = parsePgn(buildPgn({ ...base, startFen: ENDGAME }));
    expect(startFenFromTags(parsed.tags)).toBe(ENDGAME);
  });
});
