/**
 * Monte Carlo tree search (UCT).
 *
 * Each iteration walks down the tree by the UCT formula, adds one new move, plays a fast
 * random game from there, and records who won. With `useValueNet`, games that run long are
 * cut off early and judged by the value network instead of played to the end, which lets
 * the search run more iterations in the same time.
 */
import { BLACK, Position, opponent } from '../engine/go';
import { evaluate, supportsSize } from './valueNet';

export interface SearchOptions {
  timeMs: number;
  /** UCT exploration constant. The final agent uses 1; plain MCTS uses √2. */
  c: number;
  useValueNet: boolean;
  onProgress?: (s: SearchStats) => void;
}

export interface SearchStats {
  bestMove: number;
  simulations: number;
  /** Estimated chance the player to move wins, 0–1. */
  winRate: number;
  /** Visits per point (pass at index size²), for the heat map. */
  visits: number[];
  /** Win rate per point for the player to move, or -1 when unvisited. */
  values: number[];
  elapsedMs: number;
}

class Node {
  children: Node[] = [];
  untried: number[];
  visits = 0;
  /** Wins for the player who made `move` (i.e. the player NOT to move at this node). */
  wins = 0;
  constructor(
    public pos: Position,
    public move: number,
    public parent: Node | null,
  ) {
    this.untried = rolloutMoves(pos, true);
  }
}

/** Legal moves minus eye-filling; pass only when nothing else is reasonable. */
function rolloutMoves(pos: Position, allowPass: boolean): number[] {
  const me = pos.toPlay;
  const moves: number[] = [];
  for (let p = 0; p < pos.board.length; p++) {
    if (pos.board[p] === 0 && !pos.isEyeLike(p, me) && pos.isLegal(p)) moves.push(p);
  }
  if (allowPass || moves.length === 0) moves.push(pos.pass);
  return moves;
}

/** Plays random moves until the game ends (or the cutoff), returning Black's result in [0, 1]. */
function rollout(start: Position, useNet: boolean): number {
  const pos = start.clone();
  const n = pos.size * pos.size;
  const cutoff = useNet ? n : n * 3;
  let steps = 0;
  while (!pos.isOver) {
    if (useNet && steps >= cutoff) return (evaluate(pos) + 1) / 2;
    // Try a few random points before falling back to a full legal-move scan
    let move = -1;
    for (let tries = 0; tries < 8; tries++) {
      const p = Math.floor(Math.random() * n);
      if (pos.board[p] === 0 && !pos.isEyeLike(p, pos.toPlay) && pos.isLegal(p)) { move = p; break; }
    }
    if (move < 0) {
      const moves = rolloutMoves(pos, false);
      move = moves[Math.floor(Math.random() * moves.length)];
    }
    pos.play(move);
    steps++;
  }
  return pos.score().winner === BLACK ? 1 : 0;
}

export function mcts(root: Position, opts: SearchOptions): SearchStats {
  const start = performance.now();
  const deadline = start + opts.timeMs;
  const useNet = opts.useValueNet && supportsSize(root.size);
  const tree = new Node(root.clone(), -1, null);
  let sims = 0;
  let lastReport = start;

  const stats = (): SearchStats => {
    const n = root.size * root.size + 1;
    const visits = new Array(n).fill(0);
    const values = new Array(n).fill(-1);
    let best: Node | null = null;
    for (const ch of tree.children) {
      visits[ch.move] = ch.visits;
      values[ch.move] = ch.visits ? ch.wins / ch.visits : -1;
      if (!best || ch.visits > best.visits) best = ch;
    }
    return {
      bestMove: best ? best.move : root.pass,
      simulations: sims,
      winRate: best && best.visits ? best.wins / best.visits : 0.5,
      visits,
      values,
      elapsedMs: performance.now() - start,
    };
  };

  // A single legal option needs no search
  if (tree.untried.length === 1) return { ...stats(), bestMove: tree.untried[0] };

  while (true) {
    // Check the clock every 32 iterations
    if ((sims & 31) === 0) {
      const now = performance.now();
      if (now >= deadline) break;
      if (opts.onProgress && now - lastReport > 80) {
        opts.onProgress(stats());
        lastReport = now;
      }
    }

    // 1. Selection
    let node = tree;
    while (node.untried.length === 0 && node.children.length > 0) {
      const logN = Math.log(node.visits);
      let best = node.children[0];
      let bestScore = -Infinity;
      for (const ch of node.children) {
        const score = ch.wins / ch.visits + opts.c * Math.sqrt(logN / ch.visits);
        if (score > bestScore) { bestScore = score; best = ch; }
      }
      node = best;
    }

    // 2. Expansion: add one untried move
    if (node.untried.length > 0 && !node.pos.isOver) {
      const i = Math.floor(Math.random() * node.untried.length);
      const move = node.untried[i];
      node.untried[i] = node.untried[node.untried.length - 1];
      node.untried.pop();
      const next = node.pos.clone();
      next.play(move);
      const child = new Node(next, move, node);
      node.children.push(child);
      node = child;
    }

    // 3. Simulation
    const blackResult = node.pos.isOver ? (node.pos.score().winner === BLACK ? 1 : 0) : rollout(node.pos, useNet);

    // 4. Backpropagation: credit each node from the view of the player who moved into it
    for (let n: Node | null = node; n; n = n.parent) {
      n.visits++;
      const mover = opponent(n.pos.toPlay);
      n.wins += mover === BLACK ? blackResult : 1 - blackResult;
    }
    sims++;
  }

  // Children's wins are counted for the player who moved into them, which is the root
  // player, so win rates in the stats are already from the side to move.
  return stats();
}
