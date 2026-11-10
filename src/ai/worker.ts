/// <reference lib="webworker" />
/**
 * Runs the agents off the main thread so the page stays smooth while they think.
 * Receives a serialized position, streams search progress, then posts the chosen move.
 */
import { Position, type Color } from '../engine/go';
import { chooseMove, type AgentId } from './agents';
import type { SearchStats } from './mcts';

export interface ThinkRequest {
  id: number;
  agent: AgentId;
  timeMs: number;
  state: {
    size: number;
    komi: number;
    board: number[];
    toPlay: Color;
    koPoint: number;
    consecutivePasses: number;
    moveCount: number;
  };
}

export type WorkerMessage =
  | { type: 'progress'; id: number; stats: SearchStats }
  | { type: 'move'; id: number; move: number; stats?: SearchStats };

self.onmessage = (e: MessageEvent<ThinkRequest>) => {
  const { id, agent, timeMs, state } = e.data;
  const pos = new Position(state.size, state.komi);
  pos.board.set(state.board);
  pos.toPlay = state.toPlay;
  pos.koPoint = state.koPoint;
  pos.consecutivePasses = state.consecutivePasses;
  pos.moveCount = state.moveCount;

  const started = performance.now();
  const result = chooseMove(agent, pos, timeMs, (stats) => {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'progress', id, stats } satisfies WorkerMessage);
  });
  // Instant agents still pause briefly so their moves don't feel abrupt
  const wait = Math.max(0, 350 - (performance.now() - started));
  setTimeout(() => {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'move', id, move: result.move, stats: result.stats } satisfies WorkerMessage);
  }, wait);
};
