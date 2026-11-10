/**
 * A small, fast Go engine for boards up to 9×9.
 *
 * Rules: stones are captured when their group has no liberties, suicide is illegal,
 * simple ko is enforced, two consecutive passes end the game, and scoring is area
 * scoring (stones on the board plus empty regions surrounded by one color) with komi
 * added to White.
 *
 * Points are indexed row-major: point = row * size + col. The pass move is size * size.
 */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Color = typeof BLACK | typeof WHITE;

export const opponent = (c: Color): Color => (c === BLACK ? WHITE : BLACK);

export interface Score {
  black: number;
  white: number;
  winner: Color;
}

/** Precomputed neighbor lists per board size, so hot loops never do bounds checks. */
const neighborCache = new Map<number, number[][]>();
export function neighbors(size: number): number[][] {
  let n = neighborCache.get(size);
  if (!n) {
    n = [];
    for (let p = 0; p < size * size; p++) {
      const r = Math.floor(p / size);
      const c = p % size;
      const list: number[] = [];
      if (r > 0) list.push(p - size);
      if (r < size - 1) list.push(p + size);
      if (c > 0) list.push(p - 1);
      if (c < size - 1) list.push(p + 1);
      n.push(list);
    }
    neighborCache.set(size, n);
  }
  return n;
}

export class Position {
  readonly size: number;
  readonly komi: number;
  board: Int8Array;
  toPlay: Color = BLACK;
  /** Point that can't be played this turn because of ko, or -1. */
  koPoint = -1;
  consecutivePasses = 0;
  moveCount = 0;
  /** Stones each color has captured. */
  captures = { [BLACK]: 0, [WHITE]: 0 } as Record<Color, number>;
  lastMove = -1;

  constructor(size = 5, komi = defaultKomi(size)) {
    this.size = size;
    this.komi = komi;
    this.board = new Int8Array(size * size);
  }

  get pass(): number {
    return this.size * this.size;
  }

  /** The game ends after two passes in a row, or after a generous move cap. */
  get isOver(): boolean {
    return this.consecutivePasses >= 2 || this.moveCount >= this.size * this.size * 4;
  }

  clone(): Position {
    const p = new Position(this.size, this.komi);
    p.board.set(this.board);
    p.toPlay = this.toPlay;
    p.koPoint = this.koPoint;
    p.consecutivePasses = this.consecutivePasses;
    p.moveCount = this.moveCount;
    p.captures = { ...this.captures };
    p.lastMove = this.lastMove;
    return p;
  }

  /**
   * Walk the group containing `start`. Returns its stones and whether it has at least
   * one liberty (and, when `countLiberties` is set, how many distinct liberties).
   */
  group(start: number, countLiberties = false): { stones: number[]; liberties: number } {
    const color = this.board[start];
    const nbrs = neighbors(this.size);
    const seen = new Uint8Array(this.board.length);
    const libSeen = countLiberties ? new Uint8Array(this.board.length) : null;
    const stack = [start];
    const stones: number[] = [];
    let liberties = 0;
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      stones.push(p);
      for (const q of nbrs[p]) {
        const v = this.board[q];
        if (v === EMPTY) {
          if (libSeen) {
            if (!libSeen[q]) {
              libSeen[q] = 1;
              liberties++;
            }
          } else {
            liberties = 1;
          }
        } else if (v === color && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    return { stones, liberties };
  }

  /** True if `point` is a legal move for the player to move. Passing is always legal. */
  isLegal(point: number): boolean {
    if (this.isOver) return false;
    if (point === this.pass) return true;
    if (this.board[point] !== EMPTY || point === this.koPoint) return false;
    const me = this.toPlay;
    const them = opponent(me);
    const nbrs = neighbors(this.size)[point];
    // Any empty neighbor means the new stone has a liberty.
    for (const q of nbrs) if (this.board[q] === EMPTY) return true;
    // Otherwise the move is legal if it captures something or connects to a group with another liberty.
    this.board[point] = me;
    let ok = false;
    for (const q of nbrs) {
      const v = this.board[q];
      if (v === them && this.group(q).liberties === 0) { ok = true; break; }
      if (v === me && this.group(q).liberties > 0) { ok = true; break; }
    }
    this.board[point] = EMPTY;
    return ok;
  }

  legalMoves(includePass = true): number[] {
    const moves: number[] = [];
    if (this.isOver) return moves;
    for (let p = 0; p < this.board.length; p++) if (this.board[p] === EMPTY && this.isLegal(p)) moves.push(p);
    if (includePass) moves.push(this.pass);
    return moves;
  }

  /** Play a move for the player to move. Assumes it's legal; returns the captured points. */
  play(point: number): number[] {
    const me = this.toPlay;
    const them = opponent(me);
    const captured: number[] = [];
    this.moveCount++;
    this.lastMove = point;
    if (point === this.pass) {
      this.consecutivePasses++;
      this.koPoint = -1;
      this.toPlay = them;
      return captured;
    }
    this.consecutivePasses = 0;
    this.board[point] = me;
    for (const q of neighbors(this.size)[point]) {
      if (this.board[q] !== them) continue;
      const g = this.group(q);
      if (g.liberties === 0) {
        for (const s of g.stones) {
          this.board[s] = EMPTY;
          captured.push(s);
        }
      }
    }
    this.captures[me] += captured.length;
    // Simple ko: a single stone that captured exactly one stone and now sits in atari
    // can't be recaptured immediately.
    this.koPoint = -1;
    if (captured.length === 1) {
      const g = this.group(point, true);
      if (g.stones.length === 1 && g.liberties === 1) this.koPoint = captured[0];
    }
    this.toPlay = them;
    return captured;
  }

  /** Area scoring: stones plus empty regions that touch only one color, komi to White. */
  score(): Score {
    const size = this.size;
    const nbrs = neighbors(size);
    let black = 0;
    let white = this.komi;
    const seen = new Uint8Array(this.board.length);
    for (let p = 0; p < this.board.length; p++) {
      const v = this.board[p];
      if (v === BLACK) black++;
      else if (v === WHITE) white++;
      else if (!seen[p]) {
        // Flood the empty region and note which colors border it
        const stack = [p];
        seen[p] = 1;
        let count = 0;
        let borders = 0; // bit 1 = black, bit 2 = white
        while (stack.length) {
          const q = stack.pop()!;
          count++;
          for (const r of nbrs[q]) {
            const w = this.board[r];
            if (w === EMPTY) {
              if (!seen[r]) { seen[r] = 1; stack.push(r); }
            } else borders |= w;
          }
        }
        if (borders === BLACK) black += count;
        else if (borders === WHITE) white += count;
      }
    }
    return { black, white, winner: black > white ? BLACK : WHITE };
  }

  /** True if `point` is empty and every neighbor is `color` — a likely eye, never worth filling. */
  isEyeLike(point: number, color: Color): boolean {
    if (this.board[point] !== EMPTY) return false;
    for (const q of neighbors(this.size)[point]) if (this.board[q] !== color) return false;
    return true;
  }

  pointToLabel(point: number): string {
    if (point === this.pass) return 'pass';
    const letters = 'ABCDEFGHJ'; // Go coordinates skip I
    return `${letters[point % this.size]}${this.size - Math.floor(point / this.size)}`;
  }
}

/** Komi used in the original class project: 0.5 on 5×5, then common values for larger boards. */
export function defaultKomi(size: number): number {
  if (size <= 5) return 0.5;
  if (size <= 7) return 4.5;
  return 5.5;
}
