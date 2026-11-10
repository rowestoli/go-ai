/**
 * Small round-robin to check the agents get stronger in order. Run with `npm run bench`.
 * Skipped in the normal test run because it takes a minute.
 */
import { describe, expect, it } from 'vitest';
import { BLACK, Position } from '../src/engine/go';
import { chooseMove, type AgentId } from '../src/ai/agents';

function playGame(black: AgentId, white: AgentId, timeMs: number): typeof BLACK | 2 {
  const pos = new Position(5);
  while (!pos.isOver) {
    const agent = pos.toPlay === BLACK ? black : white;
    pos.play(chooseMove(agent, pos, timeMs).move);
  }
  return pos.score().winner;
}

function match(a: AgentId, b: AgentId, games: number, timeMs: number) {
  let aWins = 0;
  for (let g = 0; g < games; g++) {
    const aIsBlack = g % 2 === 0;
    const winner = aIsBlack ? playGame(a, b, timeMs) : playGame(b, a, timeMs);
    if ((winner === BLACK) === aIsBlack) aWins++;
  }
  return aWins;
}

const run = process.env.BENCH ? describe : describe.skip;

run('agent strength', () => {
  const GAMES = Number(process.env.GAMES ?? 10);
  const MS = Number(process.env.MS ?? 200);
  for (const [a, b] of [
    ['alphabeta', 'random'],
    ['mcts', 'greedy'],
    ['mcts', 'alphabeta'],
    ['final', 'mcts'],
  ] as [AgentId, AgentId][]) {
    it(`${a} beats ${b}`, () => {
      const wins = match(a, b, GAMES, MS);
      console.log(`${a} vs ${b}: ${wins}-${GAMES - wins}`);
      expect(wins).toBeGreaterThanOrEqual(GAMES / 2);
    }, 600_000);
  }
});
