import { describe, expect, it } from 'vitest';
import { BLACK, EMPTY, Position, WHITE } from '../src/engine/go';

/** Build a position from rows like ['.X...', 'O....'] (X = Black, O = White). */
function from(rows: string[], toPlay = BLACK): Position {
  const pos = new Position(rows.length);
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      pos.board[r * rows.length + c] = ch === 'X' ? BLACK : ch === 'O' ? WHITE : EMPTY;
    }),
  );
  pos.toPlay = toPlay as typeof BLACK;
  return pos;
}
const at = (pos: Position, r: number, c: number) => r * pos.size + c;

describe('captures', () => {
  it('removes a surrounded stone and counts the capture', () => {
    const pos = from(['.X...', 'XOX..', '.....', '.....', '.....']);
    pos.play(at(pos, 2, 1));
    expect(pos.board[at(pos, 1, 1)]).toBe(EMPTY);
    expect(pos.captures[BLACK]).toBe(1);
  });

  it('captures a whole group at once', () => {
    const pos = from(['.OOX.', '.XX..', '.....', '.....', '.....']);
    pos.play(at(pos, 0, 0));
    expect(pos.board[at(pos, 0, 1)]).toBe(EMPTY);
    expect(pos.board[at(pos, 0, 2)]).toBe(EMPTY);
    expect(pos.captures[BLACK]).toBe(2);
  });
});

describe('legality', () => {
  it('forbids suicide', () => {
    const pos = from(['.X...', 'X....', '.....', '.....', '.....'], WHITE);
    expect(pos.isLegal(at(pos, 0, 0))).toBe(false);
  });

  it('allows a move with no liberties if it captures', () => {
    // White at (0,0) would have no liberties, but it captures the Black stone at (0,1)
    const pos = from(['.XO..', 'XO...', '.X...', '.....', '.....'], WHITE);
    expect(pos.isLegal(at(pos, 0, 0))).toBe(true);
  });

  it('forbids immediately retaking a ko', () => {
    const pos = from(['.XO..', 'XO.O.', '.XO..', '.....', '.....']);
    pos.play(at(pos, 1, 2)); // Black captures White at (1,1)
    expect(pos.board[at(pos, 1, 1)]).toBe(EMPTY);
    expect(pos.koPoint).toBe(at(pos, 1, 1));
    expect(pos.isLegal(at(pos, 1, 1))).toBe(false); // White can't retake right away
    pos.play(at(pos, 4, 4)); // White plays elsewhere
    pos.play(at(pos, 4, 0)); // Black plays elsewhere
    expect(pos.isLegal(at(pos, 1, 1))).toBe(true);
  });
});

describe('end of game and scoring', () => {
  it('ends after two passes', () => {
    const pos = new Position(5);
    pos.play(pos.pass);
    expect(pos.isOver).toBe(false);
    pos.play(pos.pass);
    expect(pos.isOver).toBe(true);
  });

  it('counts stones and surrounded territory, with komi for White', () => {
    // Black wall on column 2 owns columns 0-1; White owns columns 3-4
    const pos = from(['..XO.', '..XO.', '..XO.', '..XO.', '..XO.']);
    const s = pos.score();
    expect(s.black).toBe(15);
    expect(s.white).toBe(10 + 0.5);
    expect(s.winner).toBe(BLACK);
  });

  it('gives no one a region that touches both colors', () => {
    const pos = from(['X...O', '.....', '.....', '.....', '.....']);
    const s = pos.score();
    expect(s.black).toBe(1);
    expect(s.white).toBe(1.5);
  });
});
