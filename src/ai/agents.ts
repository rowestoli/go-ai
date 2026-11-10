/**
 * The opponents you can play, from weakest to strongest. They retrace the original
 * project: a random baseline, a greedy stone counter, alpha-beta search, plain Monte
 * Carlo tree search, and the final agent that adds an opening book and the value network.
 */
import { BLACK, type Color, type Position, opponent } from '../engine/go';
import { mcts, type SearchStats } from './mcts';
import type { AgentId } from './agentInfo';

export type { AgentId } from './agentInfo';

export interface MoveResult {
  move: number;
  stats?: SearchStats;
}

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Stone difference after captures, from `me`'s side. */
function material(pos: Position, me: Color): number {
  let d = 0;
  for (let p = 0; p < pos.board.length; p++) {
    if (pos.board[p] === me) d++;
    else if (pos.board[p] === opponent(me)) d--;
  }
  return d;
}

/** Moves to consider for the simple agents: never fill your own eyes, and only pass when stuck. */
function candidates(pos: Position): number[] {
  const moves = pos.legalMoves(false).filter((p) => !pos.isEyeLike(p, pos.toPlay));
  return moves.length ? moves : [pos.pass];
}

function greedy(pos: Position): number {
  const me = pos.toPlay;
  let best = -Infinity;
  let bestMoves: number[] = [];
  for (const m of candidates(pos)) {
    const next = pos.clone();
    next.play(m);
    const v = material(next, me);
    if (v > best) { best = v; bestMoves = [m]; }
    else if (v === best) bestMoves.push(m);
  }
  return pick(bestMoves); // random tie-breaks matter a lot here (see README)
}

function alphaBeta(pos: Position, depth = 3): number {
  const me = pos.toPlay;
  const search = (p: Position, d: number, alpha: number, beta: number, maximizing: boolean): number => {
    if (d === 0 || p.isOver) {
      if (p.isOver) return p.score().winner === me ? 1000 : -1000;
      return material(p, me);
    }
    const moves = candidates(p);
    if (maximizing) {
      let v = -Infinity;
      for (const m of moves) {
        const next = p.clone();
        next.play(m);
        v = Math.max(v, search(next, d - 1, alpha, beta, false));
        alpha = Math.max(alpha, v);
        if (alpha >= beta) break;
      }
      return v;
    }
    let v = Infinity;
    for (const m of moves) {
      const next = p.clone();
      next.play(m);
      v = Math.min(v, search(next, d - 1, alpha, beta, true));
      beta = Math.min(beta, v);
      if (alpha >= beta) break;
    }
    return v;
  };

  let best = -Infinity;
  let bestMoves: number[] = [];
  const moves = candidates(pos).sort(() => Math.random() - 0.5);
  for (const m of moves) {
    const next = pos.clone();
    next.play(m);
    const v = search(next, depth - 1, -Infinity, Infinity, false);
    if (v > best) { best = v; bestMoves = [m]; }
    else if (v === best) bestMoves.push(m);
  }
  return pick(bestMoves);
}

/**
 * Choose a move. `onProgress` streams search statistics so the board can show what the
 * Monte Carlo agents are thinking about while they think.
 */
export function chooseMove(
  agent: AgentId,
  pos: Position,
  timeMs: number,
  onProgress?: (s: SearchStats) => void,
): MoveResult {
  // If the opponent just passed and we're ahead, pass too and end the game.
  if (pos.consecutivePasses === 1 && agent !== 'random') {
    const s = pos.score();
    const ahead = pos.toPlay === BLACK ? s.black > s.white : s.white > s.black;
    if (ahead) return { move: pos.pass };
  }
  switch (agent) {
    case 'random':
      return { move: pick(candidates(pos)) };
    case 'greedy':
      return { move: greedy(pos) };
    case 'alphabeta':
      return { move: alphaBeta(pos) };
    case 'mcts': {
      const stats = mcts(pos, { timeMs, c: Math.SQRT2, useValueNet: false, onProgress });
      return { move: stats.bestMove, stats };
    }
    case 'final': {
      // Opening book: on an empty board, the center is the strongest first move.
      if (pos.board.every((v) => v === 0) && pos.size % 2 === 1) {
        return { move: Math.floor((pos.size * pos.size) / 2) };
      }
      const stats = mcts(pos, { timeMs, c: 1, useValueNet: true, onProgress });
      return { move: stats.bestMove, stats };
    }
  }
}
