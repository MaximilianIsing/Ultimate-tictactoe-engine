'use strict';

// Ultimate Tic-Tac-Toe engine v3.
// MCTS with PUCT-style selection using heuristic priors, stronger static eval
// (meta-fork pressure, double-threat bonus, near-meta-line scoring),
// improved rollout policy, higher rollout cap. Same parallel-worker model as v2.
// Same wire format as v1/v2 (UTTTState.serialize / deserialize).

(function () {
  if (typeof self !== 'undefined' && self.UTTTEngineV3) return;

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

  const WIN_COMPLETIONS = new Uint16Array(512);
  for (let m = 0; m < 512; m++) {
    let bits = 0;
    for (let c = 0; c < 9; c++) {
      const bit = 1 << c;
      if (!(m & bit) && IS_WIN[m | bit]) bits |= bit;
    }
    WIN_COMPLETIONS[m] = bits;
  }

  const COUNT_BITS = new Uint8Array(512);
  for (let m = 0; m < 512; m++) {
    let c = 0, x = m;
    while (x) { c += x & 1; x >>>= 1; }
    COUNT_BITS[m] = c;
  }

  const CELL_VALUE = [3, 2, 3, 2, 4, 2, 3, 2, 3];
  const BOARD_VALUE = [3, 2, 3, 2, 4, 2, 3, 2, 3];

  const LOG2 = new Int8Array(513);
  for (let i = 0; i < 9; i++) LOG2[1 << i] = i;

  // Cached ln for UCT fallback / logging — same as v2 but larger.
  const LN_CACHE_MAX = 1 << 18;
  const LN_CACHE = new Float64Array(LN_CACHE_MAX);
  for (let i = 1; i < LN_CACHE_MAX; i++) LN_CACHE[i] = Math.log(i);
  function fastLn(n) {
    return n > 0 && n < LN_CACHE_MAX ? LN_CACHE[n] : Math.log(Math.max(n, 1));
  }

  // Cached sqrt for PUCT denominator.
  const SQRT_CACHE_MAX = 1 << 18;
  const SQRT_CACHE = new Float64Array(SQRT_CACHE_MAX);
  for (let i = 0; i < SQRT_CACHE_MAX; i++) SQRT_CACHE[i] = Math.sqrt(i);
  function fastSqrt(n) {
    const ni = n | 0;
    return ni >= 0 && ni < SQRT_CACHE_MAX ? SQRT_CACHE[ni] : Math.sqrt(Math.max(n, 0));
  }

  // ── UTTTState (identical to v1/v2 for wire compat) ──

  class UTTTState {
    constructor() {
      this.smallX = new Uint16Array(9);
      this.smallO = new Uint16Array(9);
      this.bigState = new Uint8Array(9);
      this.bigX = 0;
      this.bigO = 0;
      this.bigSettled = 0;
      this.activeBoard = -1;
      this.toMove = 1;
      this.winner = 0;
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
            moves.push(b * 9 + LOG2[lsb]);
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
          moves.push(b * 9 + LOG2[lsb]);
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

  // ── RNG ──

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

  // ── Move heuristics (shared by tree priors + rollout policy) ──

  const WEIGHT_BUF = new Int32Array(81);

  function moveHeuristicWeight(state, move, me) {
    const myArr = me === 1 ? state.smallX : state.smallO;
    const opArr = me === 1 ? state.smallO : state.smallX;
    const myBig = me === 1 ? state.bigX : state.bigO;
    const opBig = me === 1 ? state.bigO : state.bigX;

    const b = (move / 9) | 0;
    const c = move - b * 9;

    // Immediate meta-game win
    if (WIN_COMPLETIONS[myArr[b]] & (1 << c)) {
      const newBig = myBig | (1 << b);
      if (IS_WIN[newBig]) return 200;
      return 80;
    }

    // Block opponent's immediate small-board win
    if (state.activeBoard !== -1 && !(state.bigSettled & (1 << state.activeBoard))) {
      const ab = state.activeBoard;
      const opMask = opArr[ab];
      const occ = state.smallX[ab] | state.smallO[ab];
      const threatBits = WIN_COMPLETIONS[opMask] & ~occ & FULL_MASK;
      if (threatBits & (1 << c)) return 70;
    }

    // Base positional value
    let w = CELL_VALUE[c] * BOARD_VALUE[b];

    // Penalize sending opponent to a board where they can win it
    const tb = c; // target board = cell index
    if (!(state.bigSettled & (1 << tb))) {
      const opMask = opArr[tb];
      const occ = state.smallX[tb] | state.smallO[tb];
      if ((WIN_COMPLETIONS[opMask] & ~occ & FULL_MASK) !== 0) {
        const wouldGiveLine = IS_WIN[opBig | (1 << tb)] ? 1 : 0;
        w = wouldGiveLine ? 4 : Math.max(2, (w * 0.35) | 0);
      }
    } else {
      // Sending to settled board → opponent picks freely; slight penalty
      w = Math.max(2, (w * 0.75) | 0);
    }
    return w;
  }

  // ── Rollout move picker (heuristic-guided, same logic as v2 but with shared weights) ──

  function pickRolloutMove(state, moves, rng) {
    const me = state.toMove;
    const myArr = me === 1 ? state.smallX : state.smallO;
    const opArr = me === 1 ? state.smallO : state.smallX;
    const myBig = me === 1 ? state.bigX : state.bigO;

    // 1. Immediate meta-win
    let smallWinMove = -1;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const b = (m / 9) | 0;
      const c = m - b * 9;
      if (WIN_COMPLETIONS[myArr[b]] & (1 << c)) {
        const newBig = myBig | (1 << b);
        if (IS_WIN[newBig]) return m;
        if (smallWinMove === -1) smallWinMove = m;
      }
    }
    if (smallWinMove !== -1) return smallWinMove;

    // 2. Block opponent's immediate small-board win
    if (state.activeBoard !== -1 && !(state.bigSettled & (1 << state.activeBoard))) {
      const b = state.activeBoard;
      const opMask = opArr[b];
      const occ = state.smallX[b] | state.smallO[b];
      const threatBits = WIN_COMPLETIONS[opMask] & ~occ & FULL_MASK;
      if (threatBits) {
        for (let i = 0; i < moves.length; i++) {
          const m = moves[i];
          const c = m - ((m / 9) | 0) * 9;
          if (threatBits & (1 << c)) return m;
        }
      }
    }

    // 3. Weighted random by heuristic
    let total = 0;
    for (let i = 0; i < moves.length; i++) {
      const w = moveHeuristicWeight(state, moves[i], me);
      WEIGHT_BUF[i] = w;
      total += w;
    }
    let r = rng() * total;
    for (let i = 0; i < moves.length; i++) {
      r -= WEIGHT_BUF[i];
      if (r <= 0) return moves[i];
    }
    return moves[moves.length - 1];
  }

  // ── Static evaluation (stronger than v2) ──
  // Returns value in [-1, +1] from X's perspective.

  function metaForkPressure(state, forPlayer) {
    const myBig = forPlayer === 1 ? state.bigX : state.bigO;
    const blocked = state.bigSettled & ~state.bigX & ~state.bigO;
    const myPot = myBig | (FULL_MASK & ~((forPlayer === 1 ? state.bigO : state.bigX) | blocked));
    let forks = 0;
    for (let li = 0; li < 8; li++) {
      const line = WIN_LINES[li];
      if ((line & myPot) === line) {
        const owned = COUNT_BITS[line & myBig];
        if (owned === 2) forks++;
      }
    }
    return forks;
  }

  function staticEval(state) {
    if (state.winner === 1) return 1;
    if (state.winner === 2) return -1;
    if (state.winner === 3) return 0;

    let score = 0;

    // Per small-board: ownership + internal threats
    for (let b = 0; b < 9; b++) {
      const bv = BOARD_VALUE[b];
      if (state.bigState[b] === 1) { score += 5.2 * bv; continue; }
      if (state.bigState[b] === 2) { score -= 5.2 * bv; continue; }
      if (state.bigState[b] === 3) continue;

      const xMask = state.smallX[b];
      const oMask = state.smallO[b];
      const occ = xMask | oMask;
      const xThreats = COUNT_BITS[WIN_COMPLETIONS[xMask] & ~occ & FULL_MASK];
      const oThreats = COUNT_BITS[WIN_COMPLETIONS[oMask] & ~occ & FULL_MASK];
      score += (xThreats - oThreats) * bv * 0.58;
      // Double-threat bonus (two+ ways to win this board)
      if (xThreats >= 2) score += bv * 0.35;
      if (oThreats >= 2) score -= bv * 0.35;
    }

    // Meta-board lines
    const blocked = state.bigSettled & ~state.bigX & ~state.bigO;
    const xPot = state.bigX | (FULL_MASK & ~(state.bigO | blocked));
    const oPot = state.bigO | (FULL_MASK & ~(state.bigX | blocked));
    let xLines = 0, oLines = 0;
    let xNear = 0, oNear = 0;
    for (let li = 0; li < 8; li++) {
      const line = WIN_LINES[li];
      if ((xPot & line) === line) xLines++;
      if ((oPot & line) === line) oLines++;
      // "Near" = 2 of 3 owned, third still open
      if (COUNT_BITS[line & state.bigX] === 2 && !(line & state.bigO) && !(line & blocked)) xNear++;
      if (COUNT_BITS[line & state.bigO] === 2 && !(line & state.bigX) && !(line & blocked)) oNear++;
    }
    score += (xLines - oLines) * 2.2;
    score += (xNear - oNear) * 1.1;

    // Meta fork pressure
    score += (metaForkPressure(state, 1) - metaForkPressure(state, 2)) * 0.9;

    return Math.max(-0.99, Math.min(0.99, score / 78));
  }

  function rolloutOutcomeFromEval(state) {
    const ev = staticEval(state);
    const forMover = state.toMove === 1 ? ev : -ev;
    if (forMover > 0.11) return state.toMove;
    if (forMover < -0.11) return 3 - state.toMove;
    return 3;
  }

  // ── MCTS tree ──

  class MCTSNode {
    constructor(parent, move, untried, toMove, prior) {
      this.parent = parent;
      this.move = move;
      this.children = [];
      this.untried = untried;
      this.toMove = toMove;
      this.visits = 0;
      this.wins = 0;
      this.prior = prior;
    }
  }

  // PUCT selection with FPU reduction and visit-share exploration.
  //
  // Standard PUCT's exploration decays to zero at high visit counts, causing
  // 96%+ concentration on the top move even when alternatives are close in Q.
  // We replace the vanishing exploration with a term based on how far each
  // child's visit share is from its "fair share" (prior-weighted). This term
  // never dies — it keeps pulling under-visited children until their share
  // matches their prior proportion, no matter the total sim count.
  const FPU_REDUCTION = 0.25;
  const SHARE_EXPLORE_C = 0.12;

  function puctSelect(node, c) {
    const children = node.children;
    const nch = children.length;
    if (nch === 0) return null;

    let best = children[0];
    let bestScore = -Infinity;
    const parentVisits = Math.max(1, node.visits);
    const sqrtParent = fastSqrt(parentVisits);

    // Parent's mean Q used for FPU baseline
    const parentQ = node.visits > 0 ? node.wins / node.visits : 0.5;
    const fpuValue = Math.max(0.05, parentQ - FPU_REDUCTION);

    // Sum priors for normalization
    let sumP = 0;
    for (let i = 0; i < nch; i++) sumP += children[i].prior;
    if (!(sumP > 0)) sumP = nch;

    for (let i = 0; i < nch; i++) {
      const ch = children[i];
      const q = ch.visits > 0 ? ch.wins / ch.visits : fpuValue;
      const p = ch.prior / sumP;

      // Standard PUCT exploration term (dominant early)
      const puctExplore = c * p * sqrtParent / (1 + ch.visits);

      // Visit-share exploration: measures how much this child is under-visited
      // relative to its prior. targetShare is what the child "deserves" based on
      // prior; actualShare is what it has. The gap drives ongoing exploration.
      // This term is O(1) — it doesn't decay with visit count.
      const actualShare = ch.visits / parentVisits;
      const targetShare = p;
      let shareExplore = 0;
      if (targetShare > actualShare) {
        shareExplore = SHARE_EXPLORE_C * (targetShare - actualShare) / targetShare;
      }

      const score = q + puctExplore + shareExplore;
      if (score > bestScore) {
        bestScore = score;
        best = ch;
      }
    }
    return best;
  }

  // Weighted expansion: pick which untried move to expand first
  function pickExpandIdx(state, untried, rng, me) {
    let total = 0;
    const n = untried.length;
    for (let i = 0; i < n; i++) {
      const w = moveHeuristicWeight(state, untried[i], me) + 2;
      WEIGHT_BUF[i] = w;
      total += w;
    }
    let r = rng() * total;
    for (let i = 0; i < n; i++) {
      r -= WEIGHT_BUF[i];
      if (r <= 0) return i;
    }
    return n - 1;
  }

  const NOW = () => (typeof performance !== 'undefined' ? performance : Date).now();

  // ── Searcher ──

  class MCTSSearcher {
    constructor(rootState, options = {}) {
      this.rootState = rootState.clone();
      this.work = rootState.clone();
      this.moveBuf = [];
      this.c = options.c != null ? options.c : 1.8;
      this.budgetMs = options.budgetMs || 1000;
      this.rolloutCap = options.rolloutCap != null ? options.rolloutCap : 52;
      this.rng = mulberry32((options.rngSeed !== undefined ? options.rngSeed : 0xC001D00D) | 0);
      this.startTime = NOW();
      this.sims = 0;
      this.nodeCount = 0;
      this.maxNodes = options.maxNodes || 600000;
      this.aborted = false;
      this.shortcut = null;

      const rootMoves = rootState.legalMoves();
      if (rootMoves.length === 0) {
        this.shortcut = { bestMove: null, topMoves: [], evaluation: 0, legalMoveCount: 0 };
        this.root = null;
        return;
      }
      if (rootMoves.length === 1) {
        this.shortcut = {
          bestMove: rootMoves[0],
          topMoves: [{ move: rootMoves[0], visits: 1, winRate: 0.5 }],
          evaluation: 0, forced: true, legalMoveCount: 1,
        };
        this.root = null;
        return;
      }

      this.root = new MCTSNode(null, null, rootMoves.slice(), rootState.toMove, 1);
      this.nodeCount = 1;
    }

    abort() { this.aborted = true; }

    isDone() {
      if (this.aborted || this.shortcut) return true;
      return NOW() - this.startTime >= this.budgetMs;
    }

    step(maxMs) {
      if (this.shortcut || this.aborted || !this.root) return false;
      const elapsed = NOW() - this.startTime;
      if (elapsed >= this.budgetMs) return false;

      const sliceEnd = NOW() + Math.min(maxMs, this.budgetMs - elapsed);
      const root = this.root;
      const rootState = this.rootState;
      const work = this.work;
      const moveBuf = this.moveBuf;
      const cVal = this.c;
      const rolloutCap = this.rolloutCap;
      const rng = this.rng;

      let iters = 0;
      while (true) {
        if ((iters & 63) === 0) {
          if (this.aborted) break;
          if (NOW() >= sliceEnd) break;
        }
        iters++;

        work.copyFrom(rootState);
        let node = root;

        // 1. Selection
        while (node.untried.length === 0 && node.children.length > 0) {
          node = puctSelect(node, cVal);
          work.applyMove(node.move);
        }

        // 2. Expansion (weighted by heuristic, capped by maxNodes)
        if (node.untried.length > 0 && work.winner === 0 && this.nodeCount < this.maxNodes) {
          const me = work.toMove;
          const idx = pickExpandIdx(work, node.untried, rng, me);
          const move = node.untried[idx];
          node.untried[idx] = node.untried[node.untried.length - 1];
          node.untried.pop();
          const prior = moveHeuristicWeight(work, move, me) + 6;
          work.applyMove(move);
          const childMoves = work.winner === 0 ? work.legalMoves() : [];
          const child = new MCTSNode(node, move, childMoves, work.toMove, prior);
          node.children.push(child);
          this.nodeCount++;
          node = child;
        }

        // 3. Rollout (capped + eval cutoff)
        let rolloutDepth = 0;
        let winner;
        while (true) {
          if (work.winner !== 0) { winner = work.winner; break; }
          if (rolloutDepth >= rolloutCap) { winner = rolloutOutcomeFromEval(work); break; }
          work.legalMoves(moveBuf);
          if (moveBuf.length === 0) { winner = work.winner || 3; break; }
          work.applyMove(pickRolloutMove(work, moveBuf, rng));
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
    for (const m of root.untried) {
      candidates.push({ move: m, visits: 0, winRate: 0 });
    }
    candidates.sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      return b.winRate - a.winRate;
    });
    const bestMove = candidates.length > 0 ? candidates[0].move : null;
    const evaluation = candidates.length > 0 ? 2 * candidates[0].winRate - 1 : 0;
    return {
      bestMove,
      topMoves: candidates.slice(0, 10).map(x => ({
        move: x.move, visits: x.visits, winRate: x.winRate,
      })),
      simulations: sims,
      elapsedMs,
      evaluation,
      forPlayer,
      done,
      legalMoveCount: candidates.length,
    };
  }

  if (typeof self !== 'undefined') {
    self.UTTTEngineV3 = {
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
