'use strict';

// Ultimate Tic-Tac-Toe engine v2.
// MCTS with: cached ln() for UCT, early rollout cutoff + eval outcome,
// seeded RNG for reproducibility per worker (root-parallel diversity).
// Wrapped in an IIFE so re-evaluation (e.g. worker recreation, hot reload) is safe.

(function () {
  if (typeof self !== 'undefined' && self.UTTTEngineV2) return; // already loaded

const WIN_LINES = [
  0b000000111, 0b000111000, 0b111000000,
  0b001001001, 0b010010010, 0b100100100,
  0b100010001, 0b001010100,
];

const FULL_MASK = 0b111111111;

const IS_WIN = new Uint8Array(512);
for (let m = 0; m < 512; m++) {
  for (const line of WIN_LINES) {
    if ((m & line) === line) { IS_WIN[m] = 1; break; }
  }
}

// WIN_COMPLETIONS[mask] = bitmask of cells which, if added to mask, complete a win.
const WIN_COMPLETIONS = new Uint16Array(512);
for (let m = 0; m < 512; m++) {
  let bits = 0;
  for (let c = 0; c < 9; c++) {
    const bit = 1 << c;
    if (!(m & bit) && IS_WIN[m | bit]) bits |= bit;
  }
  WIN_COMPLETIONS[m] = bits;
}

// COUNT_BITS[mask] = popcount of mask (9-bit)
const COUNT_BITS = new Uint8Array(512);
for (let m = 0; m < 512; m++) {
  let c = 0, x = m;
  while (x) { c += x & 1; x >>>= 1; }
  COUNT_BITS[m] = c;
}

// Strategic value of each cell within a 3x3 board:
// center = 4, corners = 3, edges = 2.
const CELL_VALUE = [3, 2, 3, 2, 4, 2, 3, 2, 3];
// Same weighting for small boards on the meta-board.
const BOARD_VALUE = [3, 2, 3, 2, 4, 2, 3, 2, 3];

class UTTTState {
  constructor() {
    this.smallX = new Uint16Array(9);
    this.smallO = new Uint16Array(9);
    this.bigState = new Uint8Array(9); // 0=open,1=X,2=O,3=draw
    this.bigX = 0;
    this.bigO = 0;
    this.bigSettled = 0;
    this.activeBoard = -1;
    this.toMove = 1; // 1=X, 2=O
    this.winner = 0; // 0=ongoing,1=X,2=O,3=draw
    this.moveCount = 0;
  }

  copyFrom(s) {
    this.smallX.set(s.smallX);
    this.smallO.set(s.smallO);
    this.bigState.set(s.bigState);
    this.bigX = s.bigX;
    this.bigO = s.bigO;
    this.bigSettled = s.bigSettled;
    this.activeBoard = s.activeBoard;
    this.toMove = s.toMove;
    this.winner = s.winner;
    this.moveCount = s.moveCount;
  }

  clone() {
    const s = new UTTTState();
    s.copyFrom(this);
    return s;
  }

  serialize() {
    return {
      smallX: Array.from(this.smallX),
      smallO: Array.from(this.smallO),
      bigState: Array.from(this.bigState),
      toMove: this.toMove,
      activeBoard: this.activeBoard,
    };
  }

  static deserialize(data) {
    const s = new UTTTState();
    s.smallX.set(data.smallX);
    s.smallO.set(data.smallO);
    s.bigState.set(data.bigState);
    for (let b = 0; b < 9; b++) {
      const w = data.bigState[b];
      if (w === 1) { s.bigX |= 1 << b; s.bigSettled |= 1 << b; }
      else if (w === 2) { s.bigO |= 1 << b; s.bigSettled |= 1 << b; }
      else if (w === 3) { s.bigSettled |= 1 << b; }
    }
    s.toMove = data.toMove;
    s.activeBoard = data.activeBoard;
    if (IS_WIN[s.bigX]) s.winner = 1;
    else if (IS_WIN[s.bigO]) s.winner = 2;
    else if (s.bigSettled === FULL_MASK) s.winner = 3;
    let cnt = 0;
    for (let b = 0; b < 9; b++) cnt += COUNT_BITS[s.smallX[b] | s.smallO[b]];
    s.moveCount = cnt;
    return s;
  }

  legalMoves(out) {
    const moves = out || [];
    moves.length = 0;
    if (this.winner !== 0) return moves;
    const ab = this.activeBoard;
    if (ab === -1 || (this.bigSettled & (1 << ab))) {
      for (let b = 0; b < 9; b++) {
        if (this.bigSettled & (1 << b)) continue;
        const occ = this.smallX[b] | this.smallO[b];
        const empty = ~occ & FULL_MASK;
        let e = empty;
        while (e) {
          const lsb = e & -e;
          const c = LOG2[lsb];
          moves.push(b * 9 + c);
          e ^= lsb;
        }
      }
    } else {
      const b = ab;
      const occ = this.smallX[b] | this.smallO[b];
      const empty = ~occ & FULL_MASK;
      let e = empty;
      while (e) {
        const lsb = e & -e;
        const c = LOG2[lsb];
        moves.push(b * 9 + c);
        e ^= lsb;
      }
    }
    return moves;
  }

  applyMove(move) {
    const b = (move / 9) | 0;
    const c = move - b * 9;
    const bit = 1 << c;
    if (this.toMove === 1) {
      const newMask = this.smallX[b] | bit;
      this.smallX[b] = newMask;
      if (IS_WIN[newMask]) {
        this.bigState[b] = 1;
        this.bigX |= 1 << b;
        this.bigSettled |= 1 << b;
        if (IS_WIN[this.bigX]) this.winner = 1;
      } else if (((newMask | this.smallO[b]) & FULL_MASK) === FULL_MASK) {
        this.bigState[b] = 3;
        this.bigSettled |= 1 << b;
      }
    } else {
      const newMask = this.smallO[b] | bit;
      this.smallO[b] = newMask;
      if (IS_WIN[newMask]) {
        this.bigState[b] = 2;
        this.bigO |= 1 << b;
        this.bigSettled |= 1 << b;
        if (IS_WIN[this.bigO]) this.winner = 2;
      } else if (((this.smallX[b] | newMask) & FULL_MASK) === FULL_MASK) {
        this.bigState[b] = 3;
        this.bigSettled |= 1 << b;
      }
    }
    if (this.winner === 0 && this.bigSettled === FULL_MASK) {
      // Meta board full with no winner: tally won small boards to break tie
      const xCount = COUNT_BITS[this.bigX];
      const oCount = COUNT_BITS[this.bigO];
      if (xCount > oCount) this.winner = 1;
      else if (oCount > xCount) this.winner = 2;
      else this.winner = 3;
    }
    this.activeBoard = c;
    this.toMove = 3 - this.toMove;
    this.moveCount++;
  }
}

const LOG2 = new Int8Array(513);
for (let i = 0; i < 9; i++) LOG2[1 << i] = i;

// Precomputed ln(n) for UCT — avoids Math.log hot path (falls back for huge visit counts).
const LN_CACHE_MAX = 1 << 18;
const LN_CACHE = new Float64Array(LN_CACHE_MAX);
for (let i = 1; i < LN_CACHE_MAX; i++) LN_CACHE[i] = Math.log(i);
function fastLn(n) {
  return n > 0 && n < LN_CACHE_MAX ? LN_CACHE[n] : Math.log(Math.max(n, 1));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// When rollout hits depth cap, decide outcome from static eval (side-to-move perspective → winner 1|2|3).
function rolloutOutcomeFromEval(state) {
  const ev = staticEval(state);
  const forMover = state.toMove === 1 ? ev : -ev;
  if (forMover > 0.1) return state.toMove;
  if (forMover < -0.1) return 3 - state.toMove;
  return 3;
}

// --- MCTS ---

class MCTSNode {
  constructor(parent, move, untried, toMove) {
    this.parent = parent;
    this.move = move;
    this.children = [];
    this.untried = untried;
    this.toMove = toMove;
    this.visits = 0;
    this.wins = 0; // value from perspective of player who moved INTO this node
  }
}

function uctSelect(node, c) {
  let best = null, bestScore = -Infinity;
  const lnN = fastLn(node.visits);
  const children = node.children;
  for (let i = 0, n = children.length; i < n; i++) {
    const ch = children[i];
    const exploit = ch.wins / ch.visits;
    const explore = c * Math.sqrt(lnN / ch.visits);
    const score = exploit + explore;
    if (score > bestScore) { bestScore = score; best = ch; }
  }
  return best;
}

// Heuristic move chooser used during rollouts.
// Strategy:
//   1. If we can immediately win the meta-game (win a small board that completes meta-line), do it.
//   2. If we can win any small board, do it.
//   3. Block opponent's immediate small-board win in the active board.
//   4. Filter out moves that send opponent where they immediately win a small board
//      (unless it would complete their meta-game already? we keep it simple: just avoid).
//   5. Among remaining, weighted random toward strategic cells/boards.
function pickRolloutMove(state, moves, rng) {
  const rnd = rng || Math.random;
  const me = state.toMove;
  const myArr = me === 1 ? state.smallX : state.smallO;
  const opArr = me === 1 ? state.smallO : state.smallX;
  const myBig = me === 1 ? state.bigX : state.bigO;
  const opBig = me === 1 ? state.bigO : state.bigX;

  // 1. Immediate meta-win: a move that wins a small board AND that small board completes meta.
  // 2. Immediate small-board win: a move that wins any small board.
  let smallWinMove = -1;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const b = (m / 9) | 0;
    const c = m - b * 9;
    if (WIN_COMPLETIONS[myArr[b]] & (1 << c)) {
      const newBig = myBig | (1 << b);
      if (IS_WIN[newBig]) return m; // game-winning move
      if (smallWinMove === -1) smallWinMove = m;
    }
  }
  if (smallWinMove !== -1) return smallWinMove;

  // 3. Block opponent's immediate win in the board we'd play in.
  // (Only applies when we're constrained to a single board.)
  let blockMove = -1;
  if (state.activeBoard !== -1 && !(state.bigSettled & (1 << state.activeBoard))) {
    const b = state.activeBoard;
    const opMask = opArr[b];
    const occ = state.smallX[b] | state.smallO[b];
    const threatBits = WIN_COMPLETIONS[opMask] & ~occ & FULL_MASK;
    if (threatBits) {
      // Pick a move that occupies a threat cell.
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const c = m - ((m / 9) | 0) * 9;
        if (threatBits & (1 << c)) { blockMove = m; break; }
      }
    }
  }
  if (blockMove !== -1) return blockMove;

  // 4-5. Score each move; pick weighted random.
  // Build weights with a budget (cheap heuristics only).
  let total = 0;
  const weights = WEIGHT_BUF;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const b = (m / 9) | 0;
    const c = m - b * 9;
    let w = CELL_VALUE[c] * BOARD_VALUE[b];

    // Penalize sending opponent to a board where they can immediately win that small board.
    const tb = c;
    if (!(state.bigSettled & (1 << tb))) {
      const opMask = opArr[tb];
      const occ = state.smallX[tb] | state.smallO[tb];
      if ((WIN_COMPLETIONS[opMask] & ~occ & FULL_MASK) !== 0) {
        // Only really bad if winning that board would give them meta-line / be on line with their existing wins.
        const wouldGiveLine = IS_WIN[opBig | (1 << tb)] ? 1 : 0;
        w = wouldGiveLine ? 1 : Math.max(1, (w * 0.2) | 0);
      }
    } else {
      // Sending to dead board lets opponent pick anywhere — usually OK, slight penalty.
      w = Math.max(1, (w * 0.7) | 0);
    }
    weights[i] = w;
    total += w;
  }

  let r = rnd() * total;
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i];
    if (r <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}

const WEIGHT_BUF = new Int32Array(81);

// --- Static evaluation (used as a lightweight value when we want a fast eval, not per-rollout) ---
// Returns value in [-1, +1] from X's perspective.
function staticEval(state) {
  if (state.winner === 1) return 1;
  if (state.winner === 2) return -1;
  if (state.winner === 3) return 0;

  let score = 0;
  // Big board control
  for (let b = 0; b < 9; b++) {
    if (state.bigState[b] === 1) score += 5 * BOARD_VALUE[b];
    else if (state.bigState[b] === 2) score -= 5 * BOARD_VALUE[b];
    else {
      // count threats inside this small board
      const xMask = state.smallX[b];
      const oMask = state.smallO[b];
      const occ = xMask | oMask;
      const xThreats = COUNT_BITS[WIN_COMPLETIONS[xMask] & ~occ & FULL_MASK];
      const oThreats = COUNT_BITS[WIN_COMPLETIONS[oMask] & ~occ & FULL_MASK];
      score += (xThreats - oThreats) * BOARD_VALUE[b] * 0.5;
    }
  }
  // Big-board threats
  const xBigOcc = state.bigX | state.bigO; // settled boards with X or O winner; drawn boards don't help either
  // Actually for meta, drawn boards block both — count settled-as-blockers
  const blocked = state.bigSettled & ~state.bigX & ~state.bigO; // drawn small boards
  const xPotential = state.bigX | (FULL_MASK & ~(state.bigO | blocked));
  const oPotential = state.bigO | (FULL_MASK & ~(state.bigX | blocked));
  // Count meta lines still open for each side
  let xLines = 0, oLines = 0;
  for (const line of WIN_LINES) {
    if ((xPotential & line) === line) xLines++;
    if ((oPotential & line) === line) oLines++;
  }
  score += (xLines - oLines) * 2;
  // Normalize roughly to [-1, 1]
  return Math.max(-0.99, Math.min(0.99, score / 80));
}

// --- MCTS search (chunkable) ---

const NOW = () => (typeof performance !== 'undefined' ? performance : Date).now();

class MCTSSearcher {
  constructor(rootState, options = {}) {
    this.rootState = rootState.clone();
    this.work = rootState.clone();
    this.moveBuf = [];
    this.c = options.c != null ? options.c : 1.4;
    this.budgetMs = options.budgetMs || 1000;
    this.startTime = NOW();
    this.sims = 0;
    this.nodeCount = 0;
    this.maxNodes = options.maxNodes || 600000;
    this.aborted = false;
    this.shortcut = null;

    const rootMoves = rootState.legalMoves();
    if (rootMoves.length === 0) {
      this.shortcut = {
        bestMove: null, topMoves: [], evaluation: 0, legalMoveCount: 0,
      };
      this.root = null;
      return;
    }
    if (rootMoves.length === 1) {
      this.shortcut = {
        bestMove: rootMoves[0],
        topMoves: [{ move: rootMoves[0], visits: 1, winRate: 0.5 }],
        evaluation: 0,
        forced: true,
        legalMoveCount: 1,
      };
      this.root = null;
      return;
    }

    this.root = new MCTSNode(null, null, rootMoves.slice(), rootState.toMove);
    this.nodeCount = 1;
    this.rolloutCap = options.rolloutCap != null ? options.rolloutCap : 32;
    this.rng = mulberry32((options.rngSeed !== undefined ? options.rngSeed : 0xC001D00D) | 0);
  }

  abort() { this.aborted = true; }

  isDone() {
    if (this.aborted) return true;
    if (this.shortcut) return true;
    return NOW() - this.startTime >= this.budgetMs;
  }

  // Run iterations for up to maxMs milliseconds. Returns false if no more work to do.
  step(maxMs) {
    if (this.shortcut || this.aborted || !this.root) return false;
    const elapsed = NOW() - this.startTime;
    if (elapsed >= this.budgetMs) return false;

    const remainingBudget = this.budgetMs - elapsed;
    const sliceMs = Math.min(maxMs, remainingBudget);
    const sliceEnd = NOW() + sliceMs;
    const root = this.root;
    const rootState = this.rootState;
    const work = this.work;
    const moveBuf = this.moveBuf;
    const c = this.c;

    let iters = 0;
    while (true) {
      // Check time every 64 iterations to amortize NOW() calls.
      if ((iters & 63) === 0) {
        if (this.aborted) break;
        if (NOW() >= sliceEnd) break;
      }
      iters++;

      work.copyFrom(rootState);

      // 1. Selection
      let node = root;
      while (node.untried.length === 0 && node.children.length > 0) {
        node = uctSelect(node, c);
        work.applyMove(node.move);
      }

      // 2. Expansion (capped by maxNodes)
      if (node.untried.length > 0 && work.winner === 0 && this.nodeCount < this.maxNodes) {
        const idx = (this.rng() * node.untried.length) | 0;
        const move = node.untried[idx];
        const last = node.untried.length - 1;
        node.untried[idx] = node.untried[last];
        node.untried.pop();
        work.applyMove(move);
        const childMoves = work.winner === 0 ? work.legalMoves() : [];
        const child = new MCTSNode(node, move, childMoves, work.toMove);
        node.children.push(child);
        this.nodeCount++;
        node = child;
      }

      // 3. Rollout (v2: depth cap + eval-based terminal)
      let rolloutDepth = 0;
      let winner;
      while (true) {
        if (work.winner !== 0) {
          winner = work.winner;
          break;
        }
        if (rolloutDepth >= this.rolloutCap) {
          winner = rolloutOutcomeFromEval(work);
          break;
        }
        work.legalMoves(moveBuf);
        if (moveBuf.length === 0) {
          winner = work.winner || 3;
          break;
        }
        const m = pickRolloutMove(work, moveBuf, this.rng);
        work.applyMove(m);
        rolloutDepth++;
      }

      // 4. Backprop
      let n = node;
      while (n) {
        n.visits++;
        if (n.parent !== null) {
          const movedPlayer = 3 - n.toMove;
          if (winner === movedPlayer) n.wins += 1;
          else if (winner === 3) n.wins += 0.5;
        }
        n = n.parent;
      }
    }

    this.sims += iters;
    return !this.isDone();
  }

  result(done) {
    const elapsed = NOW() - this.startTime;
    if (this.shortcut) {
      return {
        bestMove: this.shortcut.bestMove,
        topMoves: this.shortcut.topMoves,
        simulations: 0,
        elapsedMs: elapsed,
        evaluation: this.shortcut.evaluation || 0,
        forPlayer: this.rootState.toMove,
        done: true,
        openingBook: !!this.shortcut.openingBook,
        forced: !!this.shortcut.forced,
        legalMoveCount: this.shortcut.legalMoveCount || 0,
      };
    }
    if (!this.root) {
      return {
        bestMove: null, topMoves: [], simulations: 0,
        elapsedMs: elapsed, evaluation: 0, forPlayer: this.rootState.toMove,
        done: !!done, legalMoveCount: 0,
      };
    }
    return buildResult(this.root, this.sims, elapsed, this.rootState.toMove, !!done);
  }
}

// Synchronous convenience wrapper (still exported for tests / sync use).
function mctsSearch(rootState, options) {
  const opts = options || {};
  const searcher = new MCTSSearcher(rootState, opts);
  const onProgress = opts.onProgress;
  const progressIntervalMs = opts.progressIntervalMs || 250;
  let lastProgress = NOW();
  while (searcher.step(50)) {
    if (opts.shouldAbort && opts.shouldAbort()) { searcher.abort(); break; }
    if (onProgress && NOW() - lastProgress >= progressIntervalMs) {
      lastProgress = NOW();
      onProgress(searcher.result(false));
    }
  }
  return searcher.result(true);
}

function buildResult(root, sims, elapsedMs, forPlayer, done) {
  const candidates = [];
  for (const ch of root.children) {
    candidates.push({
      move: ch.move,
      visits: ch.visits,
      winRate: ch.visits > 0 ? ch.wins / ch.visits : 0,
    });
  }
  // Include unexpanded moves with zero visits for completeness
  for (const m of root.untried) {
    candidates.push({ move: m, visits: 0, winRate: 0 });
  }
  candidates.sort((a, b) => {
    if (b.visits !== a.visits) return b.visits - a.visits;
    return b.winRate - a.winRate;
  });

  // Pick best by robust criterion: most visits, ties broken by win-rate.
  const bestMove = candidates.length > 0 ? candidates[0].move : null;
  // Eval from forPlayer's POV: best child's win-rate (which is for the player who moved = forPlayer).
  const evaluation = candidates.length > 0 ? 2 * candidates[0].winRate - 1 : 0;

  return {
    bestMove,
    topMoves: candidates.slice(0, 10).map(x => ({
      move: x.move,
      visits: x.visits,
      winRate: x.winRate,
    })),
    simulations: sims,
    elapsedMs,
    evaluation,
    forPlayer,
    done,
    legalMoveCount: candidates.length,
  };
}

// Expose for browser & worker contexts
if (typeof self !== 'undefined') {
  self.UTTTEngineV2 = {
    UTTTState,
    MCTSSearcher,
    mctsSearch,
    staticEval,
    IS_WIN,
    WIN_COMPLETIONS,
    FULL_MASK,
  };
}

})();
