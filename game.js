'use strict';

(() => {
  const { UTTTState } = self.UTTTEngine;

  // Sentinel budget meaning "run until user commits a move". The worker treats
  // this as effectively infinite; only progress messages will arrive.
  const UNLIMITED_BUDGET_MS = Number.MAX_SAFE_INTEGER;

  // --- DOM refs ---
  const metaBoardEl = document.getElementById('metaBoard');
  const turnMarkEl = document.getElementById('turnMark');
  const resetBtn = document.getElementById('resetBtn');
  const undoBtn = document.getElementById('undoBtn');
  const winnerOverlay = document.getElementById('winnerOverlay');
  const winnerMarkEl = document.getElementById('winnerMark');
  const winnerTextEl = document.getElementById('winnerText');
  const playAgainBtn = document.getElementById('playAgainBtn');

  const modePickerEl = document.getElementById('modePicker');
  const sidePickerEl = document.getElementById('sidePicker');
  const sidePickerSection = document.getElementById('sidePickerSection');
  const budgetPickerEl = document.getElementById('budgetPicker');
  const budgetPickerSection = document.getElementById('budgetPickerSection');
  const eveBudgetsSection = document.getElementById('eveBudgetsSection');
  const eveBudgetEls = {
    x: eveBudgetsSection.querySelector('[data-eve-side="x"]'),
    o: eveBudgetsSection.querySelector('[data-eve-side="o"]'),
  };
  const evalFill = document.getElementById('evalFill');
  const evalValueEl = document.getElementById('evalValue');
  const engineStatusEl = document.getElementById('engineStatus');
  const engineStatsEl = document.getElementById('engineStats');
  const topMovesListEl = document.getElementById('topMovesList');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const botMoveBtn = document.getElementById('botMoveBtn');

  // --- Game state ---
  const state = new UTTTState();
  const history = []; // stack of { boardIdx, cellIdx, player, prevActiveBoard }
  let lastMove = null; // {boardIdx, cellIdx}
  let cellEls = []; // 81 cells, indexed by board*9 + cell
  let smallEls = []; // 9 small board elements

  let mode = 'play'; // 'play' | 'analysis' | 'eve' (engine vs engine)
  let humanSide = 'x'; // 'x' = play X (first), 'o' = play O (second). Used in 'play' mode only.
  let thinkingBudgetMs = 5000; // analysis mode budget
  let eveBudgetX = 5000;
  let eveBudgetO = 5000;
  const PLAY_MODE_BUDGET_MS = 5000;

  function getCurrentBudgetMs() {
    if (mode === 'play') return PLAY_MODE_BUDGET_MS;
    if (mode === 'eve') return state.toMove === 1 ? eveBudgetX : eveBudgetO;
    return thinkingBudgetMs;
  }
  let currentAnalysis = null; // latest analysis result
  let analysisRequestId = 0;
  let hoveredMove = null; // move int currently being previewed

  function isUnlimited() { return getCurrentBudgetMs() >= 1e12; }

  // --- Worker ---
  const worker = new Worker('worker.js');
  worker.addEventListener('message', onWorkerMessage);

  function onWorkerMessage(e) {
    const msg = e.data;
    if (!msg) return;
    if (msg.requestId !== analysisRequestId) return;

    if (msg.type === 'progress') {
      currentAnalysis = msg.result;
      renderAnalysis(false);
    } else if (msg.type === 'result') {
      currentAnalysis = msg.result;
      renderAnalysis(true);
      onAnalysisComplete(msg.result);
    }
  }

  function startAnalysis(budgetMs) {
    analysisRequestId++;
    worker.postMessage({
      type: 'analyze',
      requestId: analysisRequestId,
      state: state.serialize(),
      budgetMs: budgetMs != null ? budgetMs : getCurrentBudgetMs(),
    });
    setEngineStatus('Engine thinking…', '');
  }

  function abortAnalysis() {
    analysisRequestId++;
    worker.postMessage({ type: 'abort' });
  }

  // --- Build the DOM board ---
  function buildBoard() {
    metaBoardEl.innerHTML = '';
    cellEls = new Array(81);
    smallEls = new Array(9);
    for (let b = 0; b < 9; b++) {
      const small = document.createElement('div');
      small.className = 'small-board';
      small.dataset.boardIndex = String(b);
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.dataset.boardIndex = String(b);
        cell.dataset.cellIndex = String(c);
        cell.addEventListener('click', onCellClick);
        small.appendChild(cell);
        cellEls[b * 9 + c] = cell;
      }
      metaBoardEl.appendChild(small);
      smallEls[b] = small;
    }
  }

  // --- Move handling ---
  function isHumanTurn() {
    if (state.winner !== 0) return false;
    if (mode === 'analysis') return true;
    if (mode === 'eve') return false;
    if (humanSide === 'x' && state.toMove === 1) return true;
    if (humanSide === 'o' && state.toMove === 2) return true;
    return false;
  }

  function isBotTurn() {
    if (state.winner !== 0) return false;
    if (mode === 'analysis') return false;
    if (mode === 'eve') return true;
    if (humanSide === 'x' && state.toMove === 2) return true;
    if (humanSide === 'o' && state.toMove === 1) return true;
    return false;
  }

  // Whether the engine should analyze the current position automatically.
  // - Analysis mode: always yes (so the user sees engine analysis for every position).
  // - Play mode: only when it's the engine's turn — your turn is yours alone.
  function shouldAutoAnalyze() {
    if (state.winner !== 0) return false;
    if (mode === 'analysis') return true;
    return isBotTurn();
  }

  function isLegalUserMove(boardIdx, cellIdx) {
    if (state.winner !== 0) return false;
    if (state.bigSettled & (1 << boardIdx)) return false;
    if ((state.smallX[boardIdx] | state.smallO[boardIdx]) & (1 << cellIdx)) return false;
    if (state.activeBoard !== -1 && state.activeBoard !== boardIdx
        && !(state.bigSettled & (1 << state.activeBoard))) return false;
    return true;
  }

  function applyMove(boardIdx, cellIdx) {
    const player = state.toMove;
    const prevActiveBoard = state.activeBoard;
    state.applyMove(boardIdx * 9 + cellIdx);
    history.push({ boardIdx, cellIdx, player, prevActiveBoard });
    lastMove = { boardIdx, cellIdx };
  }

  function onCellClick(e) {
    if (!isHumanTurn()) return;
    const cell = e.currentTarget;
    const boardIdx = Number(cell.dataset.boardIndex);
    const cellIdx = Number(cell.dataset.cellIndex);
    if (!isLegalUserMove(boardIdx, cellIdx)) return;

    abortAnalysis();
    applyMove(boardIdx, cellIdx);
    afterMoveChanged();
  }

  function afterMoveChanged() {
    hoveredMove = null;
    currentAnalysis = null;
    render();

    if (state.winner !== 0) {
      showWinner(state.winner);
      setEngineStatus('Game over', '');
      clearMovesList();
      const finalEval = state.winner === 1 ? 1 : state.winner === 2 ? -1 : 0;
      setEval(finalEval, 1);
      return;
    }

    if (shouldAutoAnalyze()) {
      startAnalysis();
    } else {
      setEngineStatus('Your move', '');
    }
  }

  function onAnalysisComplete(result) {
    if (state.winner !== 0) return;
    if (isBotTurn() && result.bestMove != null) {
      const m = result.bestMove;
      const b = (m / 9) | 0;
      const c = m - b * 9;
      if (isLegalUserMove(b, c)) {
        applyMove(b, c);
        afterMoveChanged();
      }
    }
    // Otherwise, status is already set correctly by renderAnalysis(true).
  }

  // --- Rendering ---
  function render() {
    turnMarkEl.textContent = state.toMove === 1 ? 'X' : 'O';
    turnMarkEl.dataset.mark = state.toMove === 1 ? 'X' : 'O';

    for (let b = 0; b < 9; b++) {
      const small = smallEls[b];
      const winState = state.bigState[b];
      const winnerChar = winState === 1 ? 'X' : winState === 2 ? 'O' : winState === 3 ? '-' : null;
      small.classList.toggle('won', winnerChar !== null);
      if (winnerChar) small.dataset.winner = winnerChar;
      else delete small.dataset.winner;

      const isActive =
        state.winner === 0 &&
        winnerChar === null &&
        (state.activeBoard === -1
          || state.activeBoard === b
          || (state.bigSettled & (1 << state.activeBoard)));
      small.classList.toggle('active', isActive);

      for (let c = 0; c < 9; c++) {
        const cell = cellEls[b * 9 + c];
        const xBit = state.smallX[b] & (1 << c);
        const oBit = state.smallO[b] & (1 << c);
        if (xBit) {
          cell.textContent = 'X';
          cell.dataset.mark = 'X';
        } else if (oBit) {
          cell.textContent = 'O';
          cell.dataset.mark = 'O';
        } else {
          // strip rank badge if present, restore empty
          cell.textContent = '';
          delete cell.dataset.mark;
        }
        const playable = state.winner === 0 && winnerChar === null && isActive && !xBit && !oBit;
        cell.disabled = !playable || !isHumanTurn();
        cell.classList.remove('hint-best', 'hint-other', 'last-move');
      }
    }

    if (lastMove) {
      const cell = cellEls[lastMove.boardIdx * 9 + lastMove.cellIdx];
      if (cell) cell.classList.add('last-move');
    }

    // Show analysis hints
    applyAnalysisHints();
    renderAnalysis(false);
    updateButtonStates();
  }

  function clearHints() {
    for (const cell of cellEls) {
      cell.classList.remove('hint-best', 'hint-other');
      const badge = cell.querySelector('.hint-rank');
      if (badge) badge.remove();
    }
  }

  function applyAnalysisHints() {
    clearHints();
    if (state.winner !== 0) return;
    if (!currentAnalysis || !currentAnalysis.topMoves) return;

    const top = currentAnalysis.topMoves.slice(0, 5);
    top.forEach((cand, idx) => {
      const cell = cellEls[cand.move];
      if (!cell) return;
      cell.classList.add(idx === 0 ? 'hint-best' : 'hint-other');
      const badge = document.createElement('span');
      badge.className = 'hint-rank';
      badge.textContent = String(idx + 1);
      cell.appendChild(badge);
    });

    if (hoveredMove != null) {
      const cell = cellEls[hoveredMove];
      if (cell) {
        cell.classList.add('hint-best');
      }
    }
  }

  function renderAnalysis(final) {
    if (!currentAnalysis) {
      setEval(null);
      clearMovesList();
      applyAnalysisHints();
      updateButtonStates();
      return;
    }
    setEval(currentAnalysis.evaluation, currentAnalysis.forPlayer);
    renderTopMoves(currentAnalysis.topMoves);
    applyAnalysisHints();
    if (state.winner === 0) {
      let label;
      if (final) {
        if (mode === 'analysis') {
          label = `${state.toMove === 1 ? 'X' : 'O'} to move`;
        } else {
          label = isHumanTurn() ? 'Your move' : 'Engine ready';
        }
      } else if (isUnlimited() && isBotTurn()) {
        label = 'Engine thinking… click Engine move to commit';
      } else {
        label = 'Engine thinking…';
      }
      setEngineStatus(label, formatStats(currentAnalysis));
    }
    updateButtonStates();
  }

  function updateButtonStates() {
    undoBtn.disabled = history.length === 0;
    analyzeBtn.disabled = state.winner !== 0;
    botMoveBtn.disabled =
      state.winner !== 0 ||
      !currentAnalysis ||
      currentAnalysis.bestMove == null;
  }

  function setEngineStatus(label, stats) {
    engineStatusEl.textContent = label;
    engineStatsEl.textContent = stats || '—';
  }

  function formatStats(result) {
    if (!result) return '—';
    const sims = result.simulations || 0;
    const ms = result.elapsedMs || 0;
    const sps = ms > 0 ? Math.round(sims / (ms / 1000)) : 0;
    if (result.openingBook) return 'opening book';
    if (result.forced) return 'forced move';
    return `${formatNum(sims)} sims · ${(ms / 1000).toFixed(1)}s · ${formatNum(sps)}/s`;
  }

  function formatNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  function setEval(evalVal, forPlayer) {
    if (evalVal == null) {
      evalFill.style.width = '50%';
      evalValueEl.textContent = '—';
      return;
    }
    // evalVal is in [-1, 1] from the side-to-move's perspective.
    // Convert to a fixed X-perspective: positive = X advantage.
    const fromX = forPlayer === 1 ? evalVal : -evalVal;
    const xWin = (fromX + 1) / 2; // 0..1, 1 = X winning
    evalFill.style.width = (xWin * 100) + '%';
    const xPct = Math.round(xWin * 100);
    evalValueEl.textContent = `X ${xPct}% · O ${100 - xPct}%`;
  }

  function moveCoord(move) {
    const b = (move / 9) | 0;
    const c = move - b * 9;
    const labels = ['TL', 'T', 'TR', 'L', 'C', 'R', 'BL', 'B', 'BR'];
    return `${labels[b]} · ${labels[c]}`;
  }

  function renderTopMoves(top) {
    topMovesListEl.innerHTML = '';
    if (!top || top.length === 0) return;
    const totalVisits = top.reduce((s, m) => s + (m.visits || 0), 0);
    top.slice(0, 5).forEach((cand, idx) => {
      const li = document.createElement('li');
      li.className = 'move-item' + (idx === 0 ? ' is-best' : '');
      li.dataset.move = String(cand.move);

      const rank = document.createElement('span');
      rank.className = 'move-rank';
      rank.textContent = '#' + (idx + 1);

      const coord = document.createElement('span');
      coord.className = 'move-coord';
      coord.textContent = moveCoord(cand.move);

      const meta = document.createElement('span');
      meta.className = 'move-meta';
      const wr = (cand.winRate * 100).toFixed(1);
      const visitShare = totalVisits > 0 ? ((cand.visits / totalVisits) * 100).toFixed(0) : '0';
      meta.innerHTML = `<span class="move-winrate">${wr}%</span>${formatNum(cand.visits)} (${visitShare}%)`;

      li.append(rank, coord, meta);

      li.addEventListener('mouseenter', () => {
        hoveredMove = cand.move;
        applyAnalysisHints();
      });
      li.addEventListener('mouseleave', () => {
        hoveredMove = null;
        applyAnalysisHints();
      });
      li.addEventListener('click', () => {
        if (!isHumanTurn()) return;
        const b = (cand.move / 9) | 0;
        const c = cand.move - b * 9;
        if (isLegalUserMove(b, c)) {
          abortAnalysis();
          applyMove(b, c);
          afterMoveChanged();
        }
      });

      topMovesListEl.appendChild(li);
    });
  }

  function clearMovesList() {
    topMovesListEl.innerHTML = '';
  }

  function showWinner(winner) {
    const ch = winner === 1 ? 'X' : winner === 2 ? 'O' : '-';
    winnerMarkEl.textContent = ch === '-' ? 'Tie' : ch;
    winnerMarkEl.dataset.mark = ch;
    winnerTextEl.textContent = ch === '-' ? "It's a tie!" : `Player ${ch} wins!`;
    winnerOverlay.classList.remove('hidden');
  }

  function reset() {
    abortAnalysis();
    state.smallX.fill(0);
    state.smallO.fill(0);
    state.bigState.fill(0);
    state.bigX = 0;
    state.bigO = 0;
    state.bigSettled = 0;
    state.activeBoard = -1;
    state.toMove = 1;
    state.winner = 0;
    state.moveCount = 0;
    history.length = 0;
    lastMove = null;
    currentAnalysis = null;
    hoveredMove = null;
    winnerOverlay.classList.add('hidden');
    afterMoveChanged();
  }

  function undo() {
    if (history.length === 0) return;
    abortAnalysis();
    // Easiest robust undo: replay history minus one move.
    const moves = history.slice(0, -1);
    state.smallX.fill(0);
    state.smallO.fill(0);
    state.bigState.fill(0);
    state.bigX = 0;
    state.bigO = 0;
    state.bigSettled = 0;
    state.activeBoard = -1;
    state.toMove = 1;
    state.winner = 0;
    state.moveCount = 0;
    history.length = 0;
    lastMove = null;
    for (const mv of moves) {
      const player = state.toMove;
      const prevActiveBoard = state.activeBoard;
      state.applyMove(mv.boardIdx * 9 + mv.cellIdx);
      history.push({ boardIdx: mv.boardIdx, cellIdx: mv.cellIdx, player, prevActiveBoard });
      lastMove = { boardIdx: mv.boardIdx, cellIdx: mv.cellIdx };
    }
    winnerOverlay.classList.add('hidden');
    afterMoveChanged();
  }

  // --- Event handlers ---
  resetBtn.addEventListener('click', reset);
  playAgainBtn.addEventListener('click', reset);
  undoBtn.addEventListener('click', undo);

  analyzeBtn.addEventListener('click', () => {
    if (state.winner !== 0) return;
    abortAnalysis();
    startAnalysis();
  });

  botMoveBtn.addEventListener('click', () => {
    if (state.winner !== 0) return;
    if (!currentAnalysis || currentAnalysis.bestMove == null) return;
    const m = currentAnalysis.bestMove;
    const b = (m / 9) | 0;
    const c = m - b * 9;
    if (isLegalUserMove(b, c)) {
      abortAnalysis();
      applyMove(b, c);
      afterMoveChanged();
    }
  });

  // --- Side picker (segmented control) ---
  function setHumanSide(side) {
    if (side === humanSide) return;
    humanSide = side;
    for (const btn of sidePickerEl.querySelectorAll('.seg-btn')) {
      const active = btn.dataset.side === humanSide;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    }
    if (state.winner !== 0) {
      render();
      return;
    }
    if (shouldAutoAnalyze()) {
      // If it's now the engine's turn, make sure it's thinking (or commit a finished one).
      if (currentAnalysis && currentAnalysis.done && currentAnalysis.bestMove != null) {
        render();
        onAnalysisComplete(currentAnalysis);
      } else if (!currentAnalysis) {
        render();
        startAnalysis();
      } else {
        render();
      }
    } else {
      // Now it's the human's turn in play mode — clear any analysis and idle.
      abortAnalysis();
      currentAnalysis = null;
      render();
      setEngineStatus('Your move', '');
    }
  }

  sidePickerEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const side = btn.dataset.side;
    if (side === 'x' || side === 'o') {
      setHumanSide(side);
    }
  });

  // --- Thinking-time picker ---
  function setBudget(rawBudget) {
    const next = rawBudget === -1 ? UNLIMITED_BUDGET_MS : rawBudget;
    if (next === thinkingBudgetMs) return;
    thinkingBudgetMs = next;
    for (const btn of budgetPickerEl.querySelectorAll('.seg-btn')) {
      const v = parseInt(btn.dataset.budget, 10);
      const matches = (v === -1 ? UNLIMITED_BUDGET_MS : v) === thinkingBudgetMs;
      btn.classList.toggle('is-active', matches);
      btn.setAttribute('aria-checked', matches ? 'true' : 'false');
    }
    if (state.winner !== 0) return;
    // Restart the search with the new budget so the change takes effect immediately.
    abortAnalysis();
    if (shouldAutoAnalyze()) startAnalysis();
  }

  budgetPickerEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const v = parseInt(btn.dataset.budget, 10);
    if (Number.isFinite(v) || v === -1) {
      setBudget(v);
    }
  });

  // --- Per-engine thinking-time pickers (Engine vs Engine mode) ---
  function setEveBudget(side, rawBudget) {
    const next = rawBudget === -1 ? UNLIMITED_BUDGET_MS : rawBudget;
    if (side === 'x') {
      if (next === eveBudgetX) return;
      eveBudgetX = next;
    } else {
      if (next === eveBudgetO) return;
      eveBudgetO = next;
    }
    const picker = eveBudgetEls[side];
    for (const btn of picker.querySelectorAll('.seg-btn')) {
      const v = parseInt(btn.dataset.budget, 10);
      const matches = (v === -1 ? UNLIMITED_BUDGET_MS : v) === next;
      btn.classList.toggle('is-active', matches);
      btn.setAttribute('aria-checked', matches ? 'true' : 'false');
    }
    // Restart analysis only if the side currently to move is the one whose budget changed.
    if (mode !== 'eve' || state.winner !== 0) return;
    const currentSide = state.toMove === 1 ? 'x' : 'o';
    if (currentSide === side) {
      abortAnalysis();
      if (shouldAutoAnalyze()) startAnalysis();
    }
  }

  for (const side of ['x', 'o']) {
    eveBudgetEls[side].addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      const v = parseInt(btn.dataset.budget, 10);
      if (Number.isFinite(v) || v === -1) {
        setEveBudget(side, v);
      }
    });
  }

  // --- Mode picker ---
  function setMode(newMode) {
    if (mode === newMode) return;
    mode = newMode;
    for (const btn of modePickerEl.querySelectorAll('.seg-btn')) {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    }
    sidePickerSection.hidden = (mode !== 'play');
    budgetPickerSection.hidden = (mode !== 'analysis');
    eveBudgetsSection.hidden = (mode !== 'eve');

    // Play mode is always 5s; reset the analysis-mode budget UI so it's consistent on next switch.
    if (mode === 'play' && thinkingBudgetMs !== PLAY_MODE_BUDGET_MS) {
      thinkingBudgetMs = PLAY_MODE_BUDGET_MS;
      for (const btn of budgetPickerEl.querySelectorAll('.seg-btn')) {
        const v = parseInt(btn.dataset.budget, 10);
        const matches = v === PLAY_MODE_BUDGET_MS;
        btn.classList.toggle('is-active', matches);
        btn.setAttribute('aria-checked', matches ? 'true' : 'false');
      }
    }

    abortAnalysis();
    currentAnalysis = null;
    render();
    if (state.winner !== 0) return;
    if (shouldAutoAnalyze()) {
      startAnalysis();
    } else {
      setEngineStatus('Your move', '');
    }
  }

  modePickerEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const m = btn.dataset.mode;
    if (m === 'play' || m === 'analysis' || m === 'eve') setMode(m);
  });

  // --- Init ---
  buildBoard();
  reset();
})();
