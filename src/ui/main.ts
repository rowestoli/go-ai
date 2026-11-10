import './style.css';
import { BLACK, EMPTY, Position, WHITE, type Color } from '../engine/go';
import { AGENTS, type AgentId } from '../ai/agentInfo';
import type { SearchStats } from '../ai/mcts';
import type { ThinkRequest, WorkerMessage } from '../ai/worker';

const SIZE = 5;
const CELL = 100;
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- state ----------
let pos = new Position(SIZE);
let history: Position[] = [];
let human: Color = BLACK;
let agent: AgentId = 'final';
let timeMs = 1000;
let showHeat = true;
let thinking = false;
let requestId = 0;
let lastStats: SearchStats | null = null;
let lastCaptured: number[] = [];

let worker = makeWorker();
function makeWorker(): Worker {
  const w = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<WorkerMessage>) => onWorker(e.data);
  return w;
}

// ---------- board drawing ----------
const svg = $('board') as unknown as SVGSVGElement;
const span = (SIZE + 1) * CELL;
svg.setAttribute('viewBox', `0 0 ${span} ${span}`);
const xy = (p: number) => ({ x: ((p % SIZE) + 1) * CELL, y: (Math.floor(p / SIZE) + 1) * CELL });

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

const layers = {
  grid: el('g', { class: 'grid' }, svg),
  heat: el('g', { class: 'heat' }, svg),
  stones: el('g', { class: 'stones' }, svg),
  ghosts: el('g', { class: 'ghosts' }, svg),
  hits: el('g', { class: 'hits' }, svg),
};

function drawGrid() {
  const defs = el('defs', {}, svg);
  const grad = (id: string, a: string, b: string) => {
    const g = el('radialGradient', { id, cx: '35%', cy: '30%', r: '70%' }, defs);
    el('stop', { offset: '0%', 'stop-color': a }, g);
    el('stop', { offset: '100%', 'stop-color': b }, g);
  };
  grad('g-black', '#4a4a4a', '#0d0d0d');
  grad('g-white', '#ffffff', '#cfcdc4');
  svg.prepend(defs);

  el('rect', { x: CELL / 2, y: CELL / 2, width: span - CELL, height: span - CELL, rx: 18, class: 'wood' }, layers.grid);
  for (let i = 1; i <= SIZE; i++) {
    el('line', { x1: CELL, y1: i * CELL, x2: SIZE * CELL, y2: i * CELL, class: 'line' }, layers.grid);
    el('line', { x1: i * CELL, y1: CELL, x2: i * CELL, y2: SIZE * CELL, class: 'line' }, layers.grid);
  }
  const mid = Math.floor((SIZE * SIZE) / 2);
  el('circle', { cx: xy(mid).x, cy: xy(mid).y, r: 7, class: 'star' }, layers.grid);

  // Invisible hit targets, also keyboard focusable
  for (let p = 0; p < SIZE * SIZE; p++) {
    const { x, y } = xy(p);
    const hit = el('rect', {
      x: x - CELL / 2, y: y - CELL / 2, width: CELL, height: CELL,
      class: 'hit', tabindex: 0, role: 'gridcell', 'aria-label': pos.pointToLabel(p),
    }, layers.hits);
    hit.addEventListener('click', () => humanMove(p));
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); humanMove(p); }
    });
    hit.addEventListener('pointerenter', () => showGhost(p));
    hit.addEventListener('pointerleave', () => layers.ghosts.replaceChildren());
  }
}

function showGhost(p: number) {
  layers.ghosts.replaceChildren();
  if (!isHumanTurn() || !pos.isLegal(p) || pos.board[p] !== EMPTY) return;
  const { x, y } = xy(p);
  el('circle', { cx: x, cy: y, r: CELL * 0.44, class: `ghost ghost--${human === BLACK ? 'b' : 'w'}` }, layers.ghosts);
}

function drawStones(placed = -1) {
  layers.stones.replaceChildren();
  for (let p = 0; p < pos.board.length; p++) {
    const v = pos.board[p];
    if (v === EMPTY) continue;
    const { x, y } = xy(p);
    const g = el('g', { class: `stone${p === placed ? ' stone--new' : ''}`, style: `transform-origin: ${x}px ${y}px` }, layers.stones);
    el('circle', { cx: x, cy: y, r: CELL * 0.45, fill: `url(#g-${v === BLACK ? 'black' : 'white'})`, class: v === BLACK ? 'b' : 'w' }, g);
    if (p === pos.lastMove) el('circle', { cx: x, cy: y, r: 9, class: 'last' }, g);
  }
  // Captured stones fade out where they stood
  for (const p of lastCaptured) {
    const { x, y } = xy(p);
    el('circle', { cx: x, cy: y, r: CELL * 0.45, class: 'captured' }, layers.stones);
  }
}

function drawHeat(stats: SearchStats | null, stale = false) {
  layers.heat.replaceChildren();
  // After the AI moves, its search stays visible but dimmed until you play
  layers.heat.classList.toggle('is-stale', stale);
  if (!showHeat || !stats) return;
  const max = Math.max(1, ...stats.visits.slice(0, SIZE * SIZE));
  stats.visits.slice(0, SIZE * SIZE).forEach((v, p) => {
    if (!v || pos.board[p] !== EMPTY) return;
    const { x, y } = xy(p);
    const share = v / max;
    el('circle', { cx: x, cy: y, r: 8 + 34 * Math.sqrt(share), class: `heat-dot${p === stats.bestMove ? ' heat-dot--best' : ''}`, style: `opacity:${0.25 + 0.6 * share}` }, layers.heat);
    if (share > 0.3 && stats.values[p] >= 0) {
      const t = el('text', { x, y, class: 'heat-label' }, layers.heat);
      t.textContent = `${Math.round(stats.values[p] * 100)}%`;
    }
  });
}

// ---------- game flow ----------
const isHumanTurn = () => !thinking && !pos.isOver && pos.toPlay === human;

function humanMove(p: number) {
  if (!isHumanTurn() || !pos.isLegal(p)) return;
  history.push(pos.clone());
  apply(p);
}

function apply(move: number) {
  lastCaptured = pos.play(move);
  layers.ghosts.replaceChildren();
  drawStones(move);
  setTimeout(() => { lastCaptured = []; }, 0);
  update();
  if (!pos.isOver && pos.toPlay !== human) aiMove();
}

function aiMove() {
  thinking = true;
  lastStats = null;
  drawHeat(null);
  update();
  const req: ThinkRequest = {
    id: ++requestId,
    agent,
    timeMs,
    state: {
      size: pos.size, komi: pos.komi, board: Array.from(pos.board), toPlay: pos.toPlay,
      koPoint: pos.koPoint, consecutivePasses: pos.consecutivePasses, moveCount: pos.moveCount,
    },
  };
  worker.postMessage(req);
}

function onWorker(msg: WorkerMessage) {
  if (msg.id !== requestId) return; // stale reply from a cancelled search
  if (msg.type === 'progress') {
    lastStats = msg.stats;
    drawHeat(msg.stats);
    updateMeter();
    return;
  }
  thinking = false;
  if (msg.stats) lastStats = msg.stats;
  drawHeat(lastStats, true);
  apply(msg.move);
  if (msg.move === pos.pass && !pos.isOver) setStatus('The AI passed. Pass too to end the game, or keep playing.');
}

function cancelThinking() {
  if (!thinking) return;
  worker.terminate();
  worker = makeWorker();
  thinking = false;
  requestId++;
}

function newGame() {
  cancelThinking();
  pos = new Position(SIZE);
  history = [];
  lastStats = null;
  lastCaptured = [];
  drawStones();
  drawHeat(null);
  update();
  if (human === WHITE) aiMove();
}

function undo() {
  if (!history.length) return;
  cancelThinking();
  pos = history.pop()!;
  lastStats = null;
  drawStones();
  drawHeat(null);
  update();
}

// ---------- panel ----------
function setStatus(text: string) {
  $('status').textContent = text;
}

function updateMeter() {
  const usesSearch = AGENTS.find((a) => a.id === agent)!.usesTime;
  const value = $('meter-value');
  const fill = $('meter-fill');
  const sims = $('sims');
  $('meter').classList.toggle('is-off', !usesSearch);
  if (!usesSearch) {
    value.textContent = '–';
    fill.style.width = '0%';
    sims.textContent = 'This opponent doesn’t estimate its chances.';
    return;
  }
  if (!lastStats) {
    value.textContent = '–';
    fill.style.width = '0%';
    sims.textContent = ' ';
    return;
  }
  const pct = Math.round(lastStats.winRate * 100);
  value.textContent = `${pct}%`;
  fill.style.width = `${pct}%`;
  sims.textContent = `${lastStats.simulations.toLocaleString()} games simulated in ${(lastStats.elapsedMs / 1000).toFixed(1)}s`;
}

function update() {
  const you = human === BLACK ? 'Black' : 'White';
  const s = pos.score();
  $('score').textContent = `If the game ended now: Black ${s.black}, White ${s.white} (includes ${pos.komi} komi)`;
  ($('pass') as HTMLButtonElement).disabled = !isHumanTurn();
  ($('undo') as HTMLButtonElement).disabled = history.length === 0;

  const banner = $('banner');
  if (pos.isOver) {
    const youWon = s.winner === human;
    const margin = Math.abs(s.black - s.white);
    banner.hidden = false;
    banner.className = `banner ${youWon ? 'banner--win' : 'banner--loss'}`;
    banner.innerHTML = `<strong>${youWon ? 'You won' : 'The AI won'}</strong><span>by ${margin} point${margin === 1 ? '' : 's'}</span><button class="btn" type="button" id="again">Play again</button>`;
    $('again').addEventListener('click', newGame);
    setStatus(`Game over. ${s.winner === BLACK ? 'Black' : 'White'} wins ${s.black} to ${s.white}.`);
  } else {
    banner.hidden = true;
    if (thinking) setStatus(`${AGENTS.find((a) => a.id === agent)!.name} is thinking…`);
    else if (pos.consecutivePasses === 0 || pos.toPlay !== human) setStatus(`Your move. You're ${you}.`);
  }
  updateMeter();
}

function renderAgents() {
  const wrap = $('agents');
  for (const a of AGENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.name;
    b.dataset.agent = a.id;
    b.setAttribute('aria-pressed', String(a.id === agent));
    b.addEventListener('click', () => {
      agent = a.id;
      wrap.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('agent-blurb').textContent = a.blurb;
      $('time-field').classList.toggle('is-off', !a.usesTime);
      updateMeter();
    });
    wrap.appendChild(b);
  }
  $('agent-blurb').textContent = AGENTS.find((a) => a.id === agent)!.blurb;
}

function segmented(id: string, onPick: (b: HTMLButtonElement) => void) {
  const wrap = $(id);
  wrap.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onPick(b);
    }),
  );
}

// ---------- wire up ----------
drawGrid();
renderAgents();
segmented('time', (b) => { timeMs = Number(b.dataset.ms); });
segmented('side', (b) => {
  human = Number(b.dataset.side) as Color;
  newGame();
});
$('heat').addEventListener('change', (e) => {
  showHeat = (e.target as HTMLInputElement).checked;
  drawHeat(lastStats, !thinking);
});
$('pass').addEventListener('click', () => {
  if (!isHumanTurn()) return;
  history.push(pos.clone());
  apply(pos.pass);
});
$('undo').addEventListener('click', undo);
$('new').addEventListener('click', newGame);

drawStones();
update();
