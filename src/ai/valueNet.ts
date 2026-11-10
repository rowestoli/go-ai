/**
 * The value network from the original project, running in plain TypeScript.
 *
 * It's a small fully connected network (55 → 128 → 64 → 1, ReLU, tanh output) trained on
 * 5×5 games to predict the winner from Black's point of view: +1 means Black wins, −1 White.
 * Weights were exported from the PyTorch checkpoint by scripts/export_weights.py.
 */
import { BLACK, WHITE, neighbors, type Position } from '../engine/go';
import weights from './value-net.json';

type Layer = { w: Float32Array; b: Float32Array; inSize: number; outSize: number };

function layer(name: string): Layer {
  const w = (weights as Record<string, { shape: number[]; data: number[] }>)[`${name}.weight`];
  const b = (weights as Record<string, { shape: number[]; data: number[] }>)[`${name}.bias`];
  return { w: Float32Array.from(w.data), b: Float32Array.from(b.data), outSize: w.shape[0], inSize: w.shape[1] };
}

const L1 = layer('network.0');
const L2 = layer('network.2');
const L3 = layer('network.4');
export const FEATURE_SIZE = L1.inSize; // 55

// Scratch buffers reused across calls; inference runs thousands of times per second in MCTS
const h1 = new Float32Array(L1.outSize);
const h2 = new Float32Array(L2.outSize);
const feats = new Float32Array(FEATURE_SIZE);

function dense(l: Layer, input: Float32Array, out: Float32Array, relu: boolean) {
  for (let o = 0; o < l.outSize; o++) {
    let sum = l.b[o];
    const row = o * l.inSize;
    for (let i = 0; i < l.inSize; i++) sum += l.w[row + i] * input[i];
    out[o] = relu && sum < 0 ? 0 : sum;
  }
}

/**
 * Features, matching the training code: Black stones (25), White stones (25), player to move,
 * then each side's distinct liberties and stone count, normalized by board area.
 */
export function features(pos: Position, out: Float32Array = feats): Float32Array {
  const n = pos.size * pos.size;
  const nbrs = neighbors(pos.size);
  const libB = new Uint8Array(n);
  const libW = new Uint8Array(n);
  let blackCount = 0;
  let whiteCount = 0;
  let blackLibs = 0;
  let whiteLibs = 0;
  for (let p = 0; p < n; p++) {
    const v = pos.board[p];
    out[p] = v === BLACK ? 1 : 0;
    out[n + p] = v === WHITE ? 1 : 0;
    if (v === BLACK) blackCount++;
    else if (v === WHITE) whiteCount++;
    else continue;
    for (const q of nbrs[p]) {
      if (pos.board[q] !== 0) continue;
      if (v === BLACK && !libB[q]) { libB[q] = 1; blackLibs++; }
      if (v === WHITE && !libW[q]) { libW[q] = 1; whiteLibs++; }
    }
  }
  out[2 * n] = pos.toPlay === WHITE ? 1 : 0;
  out[2 * n + 1] = blackLibs / n;
  out[2 * n + 2] = whiteLibs / n;
  out[2 * n + 3] = blackCount / n;
  out[2 * n + 4] = whiteCount / n;
  return out;
}

/** The network was trained on 5×5 boards only. */
export const supportsSize = (size: number) => size * size * 2 + 5 === FEATURE_SIZE;

/** Predicted outcome in [−1, 1] from Black's point of view. */
export function evaluate(pos: Position): number {
  const x = features(pos);
  dense(L1, x, h1, true);
  dense(L2, h1, h2, true);
  let s = L3.b[0];
  for (let i = 0; i < L3.inSize; i++) s += L3.w[i] * h2[i];
  return Math.tanh(s);
}
