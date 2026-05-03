'use strict';

const { workerData, parentPort } = require('worker_threads');

global.self = global;
global.performance = require('perf_hooks').performance;

require('./engines/enginev3.js');

const { UTTTState, MCTSSearcher } = self.UTTTEngineV3;

const SELF_PLAY_BUDGET_MS = 300;
const ANALYSIS_BUDGET_MS = 800;
const MIN_MOVES = 8;
const MIN_BEST_WR = 0.70;
const MIN_GAP = 0.15;

function hashState(ser) {
  let h = 0x811c9dc5;
  const str = JSON.stringify(ser);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'p_' + (h >>> 0).toString(36);
}

function analyze(state, budgetMs) {
  const searcher = new MCTSSearcher(state, {
    budgetMs,
    c: 1.8,
    rolloutCap: 52,
    rngSeed: (Date.now() ^ (Math.random() * 0x100000000)) >>> 0,
    maxNodes: 500000,
  });
  while (searcher.step(50)) {}
  return searcher.result(true);
}

function playSelfPlayGame() {
  const st = new UTTTState();
  const positions = [];

  while (st.winner === 0) {
    const legal = st.legalMoves();
    if (legal.length === 0) break;

    if (legal.length === 1) {
      st.applyMove(legal[0]);
      continue;
    }

    const result = analyze(st, SELF_PLAY_BUDGET_MS);
    if (!result || result.bestMove == null) break;

    if (st.moveCount >= MIN_MOVES && legal.length > 1) {
      const clone = UTTTState.deserialize(st.serialize());
      positions.push({ state: clone, moveCount: st.moveCount });
    }

    st.applyMove(result.bestMove);
  }

  return positions;
}

function run() {
  const { target, existingIds } = workerData;
  const seen = new Set(existingIds);
  const puzzles = [];
  let games = 0;

  while (puzzles.length < target) {
    games++;
    const positions = playSelfPlayGame();

    for (const pos of positions) {
      if (puzzles.length >= target) break;

      const result = analyze(pos.state, ANALYSIS_BUDGET_MS);
      if (!result) continue;

      const top = result.topMoves;
      if (!top || top.length < 2) continue;

      const totalVisits = top.reduce((s, m) => s + (m.visits || 0), 0);
      if (totalVisits < 100) continue;

      const sorted = [...top].sort((a, b) => b.winRate - a.winRate);
      const bestWR = sorted[0].winRate;
      const secondWR = sorted.length > 1 ? sorted[1].winRate : 0;
      const gap = bestWR - secondWR;

      if (bestWR >= MIN_BEST_WR && gap >= MIN_GAP) {
        const ser = pos.state.serialize();
        const id = hashState(ser);
        if (seen.has(id)) continue;
        seen.add(id);

        puzzles.push({
          id,
          state: ser,
          toMove: pos.state.toMove,
          bestMove: sorted[0].move,
          bestWinRate: Math.round(bestWR * 1000) / 1000,
          secondWinRate: Math.round(secondWR * 1000) / 1000,
          gap: Math.round(gap * 1000) / 1000,
          moveCount: pos.moveCount,
        });
      }
    }

    if (games % 2 === 0) {
      parentPort.postMessage({ type: 'progress', done: puzzles.length, target });
    }
  }

  parentPort.postMessage({ type: 'puzzles', puzzles });
}

run();
