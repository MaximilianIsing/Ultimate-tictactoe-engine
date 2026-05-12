'use strict';

importScripts('enginev3.js');

const { UTTTState, MCTSSearcher } = self.UTTTEngineV3;

let currentSearcher = null;
let currentRequestId = -1;
let lastProgressTime = 0;
let currentWorkerIndex = 0;
let earlyStopEnabled = false;
let prevTopMove = -1;
let prevTopWR = -1;
let stableChecks = 0;
const PROGRESS_INTERVAL_MS = 200;
const CHUNK_MS = 20;

const EARLY_STOP_MIN_FRAC = 0.4;
const EARLY_STOP_MIN_SIMS = 15000;
const EARLY_STOP_MIN_SHARE = 0.45;
const EARLY_STOP_WR_DELTA = 0.006;
const EARLY_STOP_STABLE_COUNT = 4;

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'abort') {
    if (currentSearcher) currentSearcher.abort();
    return;
  }

  if (msg.type === 'analyze') {
    if (currentSearcher) currentSearcher.abort();
    const state = UTTTState.deserialize(msg.state);
    currentSearcher = new MCTSSearcher(state, {
      budgetMs: msg.budgetMs || 5000,
      c: msg.c != null ? msg.c : 1.8,
      rolloutCap: msg.rolloutCap != null ? msg.rolloutCap : 52,
      rngSeed: msg.rngSeed != null ? msg.rngSeed : 0xC001D00D,
      maxNodes: msg.maxNodes || 600000,
    });
    currentRequestId = msg.requestId;
    currentWorkerIndex = msg.workerIndex != null ? msg.workerIndex : 0;
    earlyStopEnabled = !!msg.earlyStop;
    prevTopMove = -1;
    prevTopWR = -1;
    stableChecks = 0;
    lastProgressTime = 0;

    setTimeout(driveSearch, 0);
  }
};

function shouldStopEarly(searcher) {
  if (!earlyStopEnabled) return false;

  const elapsed = Date.now() - searcher.startTime;
  if (elapsed < searcher.budgetMs * EARLY_STOP_MIN_FRAC) return false;
  if (searcher.sims < EARLY_STOP_MIN_SIMS) return false;

  const r = searcher.result(false);
  if (!r.topMoves || r.topMoves.length < 2) return true;

  const top = r.topMoves[0];
  const totalVisits = r.topMoves.reduce((s, m) => s + (m.visits || 0), 0);
  if (totalVisits === 0) return false;

  const share = top.visits / totalVisits;
  if (share < EARLY_STOP_MIN_SHARE) { stableChecks = 0; return false; }

  if (top.move === prevTopMove && Math.abs(top.winRate - prevTopWR) < EARLY_STOP_WR_DELTA) {
    stableChecks++;
  } else {
    stableChecks = 0;
  }
  prevTopMove = top.move;
  prevTopWR = top.winRate;

  return stableChecks >= EARLY_STOP_STABLE_COUNT;
}

function driveSearch() {
  if (!currentSearcher) return;
  const searcher = currentSearcher;
  const requestId = currentRequestId;

  const more = searcher.step(CHUNK_MS);

  if (searcher.aborted) {
    self.postMessage({ type: 'aborted', requestId, workerIndex: currentWorkerIndex });
    if (currentSearcher === searcher) currentSearcher = null;
    return;
  }

  if (!more || shouldStopEarly(searcher)) {
    self.postMessage({
      type: 'result',
      requestId,
      workerIndex: currentWorkerIndex,
      result: searcher.result(true),
    });
    if (currentSearcher === searcher) currentSearcher = null;
    return;
  }

  const now = Date.now();
  if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
    lastProgressTime = now;
    self.postMessage({
      type: 'progress',
      requestId,
      workerIndex: currentWorkerIndex,
      result: searcher.result(false),
    });
  }

  setTimeout(driveSearch, 0);
}
