/** Opponent names and descriptions, kept separate so the page doesn't load the AI code. */
export type AgentId = 'random' | 'greedy' | 'alphabeta' | 'mcts' | 'final';

export interface AgentInfo {
  id: AgentId;
  name: string;
  blurb: string;
  usesTime: boolean;
}

export const AGENTS: AgentInfo[] = [
  { id: 'random', name: 'Random', blurb: 'Plays any legal move. The baseline.', usesTime: false },
  { id: 'greedy', name: 'Greedy', blurb: 'Picks the move that leaves it the most stones ahead. Short-sighted on purpose.', usesTime: false },
  { id: 'alphabeta', name: 'Alpha-beta', blurb: 'Looks three moves ahead, scoring positions by stone count.', usesTime: false },
  { id: 'mcts', name: 'Monte Carlo', blurb: 'Plays thousands of random games from each option and picks the move that wins most often.', usesTime: true },
  { id: 'final', name: 'Final agent', blurb: 'Monte Carlo plus an opening book and a neural network that judges unfinished games.', usesTime: true },
];
