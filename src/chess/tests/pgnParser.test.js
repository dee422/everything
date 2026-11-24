import { describe, it, expect } from 'vitest';
import { parsePgn, parseFen, detectFormat } from '../src/game/pgnParser.js';

describe('parsePgn', () => {
  it('parses a minimal PGN', () => {
    const pgn = `[Event "Test"]

1. e4 e5 2. Nf3 *`;
    const result = parsePgn(pgn);
    expect(result.tags.Event).toBe('Test');
    expect(result.moves).toEqual(['e4', 'e5', 'Nf3']);
    expect(result.result).toBe('*');
  });

  it('parses tags correctly', () => {
    const pgn = `[Event "World Championship"]
[Site "London"]
[Date "2024.11.23"]
[White "Player1"]
[Black "Player2"]
[Result "1-0"]

1. e4 e5 *`;
    const result = parsePgn(pgn);
    expect(result.tags.Event).toBe('World Championship');
    expect(result.tags.Site).toBe('London');
    expect(result.tags.White).toBe('Player1');
    expect(result.tags.Black).toBe('Player2');
    expect(result.tags.Result).toBe('1-0');
  });

  it('parses comments', () => {
    const pgn = `1. e4 {Best move} e5 2. Nf3 *`;
    const result = parsePgn(pgn);
    expect(result.moves).toEqual(['e4', 'e5', 'Nf3']);
    expect(result.comments[0]).toBe('Best move');
  });

  it('handles result markers', () => {
    const pgn1 = `1. e4 e5 1-0`;
    expect(parsePgn(pgn1).result).toBe('1-0');

    const pgn2 = `1. e4 e5 0-1`;
    expect(parsePgn(pgn2).result).toBe('0-1');

    const pgn3 = `1. e4 e5 1/2-1/2`;
    expect(parsePgn(pgn3).result).toBe('1/2-1/2');
  });

  it('skips line numbers', () => {
    const pgn = `1. e4 e5 2. Nf3 Nc6 3. Bb5 *`;
    const result = parsePgn(pgn);
    expect(result.moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });

  it('handles castling', () => {
    const pgn = `1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *`;
    const result = parsePgn(pgn);
    expect(result.moves[6]).toBe('O-O');
  });

  it('handles captures', () => {
    const pgn = `1. e4 d5 2. exd5 *`;
    const result = parsePgn(pgn);
    expect(result.moves).toEqual(['e4', 'd5', 'exd5']);
  });

  it('handles promotions', () => {
    const pgn = `1. e4 d5 2. e5 d4 3. e6 d3 4. exd7+ d2 5. d8=Q *`;
    const result = parsePgn(pgn);
    expect(result.moves[8]).toBe('d8=Q');
  });

  it('handles check and checkmate symbols', () => {
    const pgn = `1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# *`;
    const result = parsePgn(pgn);
    expect(result.moves[6]).toBe('Qxf7#');
  });
});

describe('parseFen', () => {
  it('validates a correct FEN', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = parseFen(fen);
    expect(result.valid).toBe(true);
    expect(result.fen).toBe(fen);
  });

  it('rejects FEN with wrong number of fields', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
    const result = parseFen(fen);
    expect(result.valid).toBe(false);
  });

  it('rejects FEN with invalid active color', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1';
    const result = parseFen(fen);
    expect(result.valid).toBe(false);
  });

  it('rejects FEN with wrong number of ranks', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = parseFen(fen);
    expect(result.valid).toBe(false);
  });
});

describe('detectFormat', () => {
  it('detects PGN format', () => {
    const pgn = `[Event "Test"]

1. e4 e5 *`;
    expect(detectFormat(pgn)).toBe('pgn');
  });

  it('detects FEN format', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(detectFormat(fen)).toBe('fen');
  });

  it('detects PGN without tags', () => {
    const pgn = `1. e4 e5 2. Nf3 *`;
    expect(detectFormat(pgn)).toBe('pgn');
  });

  it('returns unknown for invalid input', () => {
    expect(detectFormat('random text')).toBe('unknown');
  });
});
