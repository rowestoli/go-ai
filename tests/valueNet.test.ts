import { describe, expect, it } from 'vitest';
import { BLACK, EMPTY, Position, WHITE } from '../src/engine/go';
import { evaluate, features, FEATURE_SIZE } from '../src/ai/valueNet';

function from(rows: string[], toPlay: typeof BLACK | typeof WHITE): Position {
  const pos = new Position(5);
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      pos.board[r * 5 + c] = ch === 'X' ? BLACK : ch === 'O' ? WHITE : EMPTY;
    }),
  );
  pos.toPlay = toPlay;
  return pos;
}

// Reference outputs computed with NumPy from the same weights (see scripts/export_weights.py)
describe('value network', () => {
  it('has the 55 inputs it was trained with', () => {
    expect(FEATURE_SIZE).toBe(55);
  });

  it('builds features in the training order', () => {
    const f = features(from(['X....', '.....', '.....', '.....', '....O'], WHITE));
    expect(f[0]).toBe(1); // Black stone at A5
    expect(f[25 + 24]).toBe(1); // White stone at E1
    expect(f[50]).toBe(1); // White to move
    expect(f[51]).toBeCloseTo(2 / 25); // Black liberties
    expect(f[53]).toBeCloseTo(1 / 25); // Black stone count
  });

  it('matches the NumPy forward pass', () => {
    expect(evaluate(new Position(5))).toBeCloseTo(-0.35186, 4);
    const rows = ['.X...', 'XO...', '..X..', '.O...', '....O'];
    expect(evaluate(from(rows, BLACK))).toBeCloseTo(-0.98863, 4);
    expect(evaluate(from(rows, WHITE))).toBeCloseTo(-0.99998, 4);
  });
});
