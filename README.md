# Go AI

Play 5×5 Go in your browser against five agents, from random moves up to Monte Carlo tree search guided by a neural network. Turn on **Show its thinking** to watch the search weigh every move in real time.

**Live demo:** https://rowestoli-go-ai.netlify.app

## What's inside

| Part | What it does |
| --- | --- |
| `src/engine/go.ts` | Go rules: captures, suicide, simple ko, two-pass ending, area scoring with komi |
| `src/ai/mcts.ts` | Monte Carlo tree search (UCT) with time-limited search and live statistics |
| `src/ai/valueNet.ts` | The trained value network (55 → 128 → 64 → 1) running in plain TypeScript |
| `src/ai/agents.ts` | Random, greedy, alpha-beta, Monte Carlo and the final agent |
| `src/ai/worker.ts` | Runs the search in a Web Worker so the page never freezes |
| `src/ui/` | SVG board, heat map of the search, controls |
| `scripts/export_weights.py` | Converts the PyTorch checkpoint to JSON without needing PyTorch installed |

## The agents

1. **Random** plays any legal move.
2. **Greedy** picks the move that leaves it the most stones ahead.
3. **Alpha-beta** searches three moves deep, scoring positions by stone count.
4. **Monte Carlo** plays thousands of random games from each candidate move and picks the one that wins most often, using the UCT formula to balance strong moves against unexplored ones.
5. **Final agent** adds three things on top of Monte Carlo:
   - an opening book (the center point on an empty board),
   - a value network that judges games that run long instead of playing them to the end, so the search covers more positions in the same time,
   - a lower exploration constant (1 instead of √2), which converges faster on a small board.

## Results

10-game matches at 200 ms per move, alternating colors (`npm run bench`):

| Match | Result |
| --- | --- |
| Monte Carlo vs Greedy | 10–0 |
| Monte Carlo vs Alpha-beta | 10–0 |
| Final agent vs Monte Carlo | 7–3 |

These line up with the original project, where the final agent beat plain Monte Carlo 8–2.

## What I learned

- **Volume beats quality in rollouts.** Using the value network to choose every rollout move made the rollouts more realistic, but it cut the number of simulations so much that the agent got weaker. Using the network once, to judge where a rollout stops, kept the speed and added the knowledge.
- **Stone count is a weak heuristic for Go.** Alpha-beta search lost every game to Monte Carlo, because counting stones says little about who controls territory.
- **Tie-breaking matters.** With a coarse heuristic, many moves tie. Breaking ties randomly made the greedy agent noticeably stronger than always taking the first one.

## Run it locally

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # rules and value-network tests
npm run bench   # agent round-robin (about 2 minutes)
```

## Background

This started as my final project for CSCI 0410 (Artificial Intelligence) at Brown, written in Python. This repository is a from-scratch rebuild in TypeScript so anyone can play it without installing anything. The value network weights come from the network I trained for that project.
