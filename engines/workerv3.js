'use strict';

importScripts('enginev3.js');

const { UTTTState, MCTSSearcher } = self.UTTTEngineV3;

let currentSearcher = null;
let currentRequestId = -1;
let lastProgressTime = 0;
let currentWorkerIndex = 0;
const PROGRESS_INTERVAL_MS = 200;
const CHUNK_MS = 20;

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
    lastProgressTime = 0;

    setTimeout(driveSearch, 0);
  }
};

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

  if (!more) {
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
