'use strict';

(() => {
  const { UTTTState } = self.UTTTEngine;

  // Sentinel budget meaning "run until user commits a move". The worker treats
  // this as effectively infinite; only progress messages will arrive.
  const UNLIMITED_BUDGET_MS = Number.MAX_SAFE_INTEGER;

  // --- Book moves ---
  let bookLines = [];
  const LABEL_TO_IDX = { TL: 0, T: 1, TR: 2, L: 3, C: 4, R: 5, BL: 6, B: 7, BR: 8 };
  function parseMoveLabel(label) {
    const [board, cell] = label.split(':');
    return LABEL_TO_IDX[board] * 9 + LABEL_TO_IDX[cell];
  }
  fetch('bookmoves.json')
    .then(r => r.json())
    .then(data => {
      for (const line of (data.lines || [])) {
        for (const variant of (line.variants || [])) {
          bookLines.push({
            name: line.name,
            description: line.description || '',
            moves: variant.map(parseMoveLabel),
          });
        }
      }
    })
    .catch(() => {});

  function getBookMatch(moveHistory, newMove) {
    const seq = moveHistory.map(h => h.moveInt);
    seq.push(newMove);
    let bestMatch = null;
    for (const line of bookLines) {
      if (seq.length > line.moves.length) continue;
      let ok = true;
      for (let i = 0; i < seq.length; i++) {
        if (seq[i] !== line.moves[i]) { ok = false; break; }
      }
      if (ok && (!bestMatch || line.moves.length >= bestMatch.moves.length)) {
        bestMatch = line;
      }
    }
    return bestMatch;
  }

  // --- DOM refs ---
  const metaBoardEl = document.getElementById('metaBoard');
  const turnMarkEl = document.getElementById('turnMark');
  const resetBtn = document.getElementById('resetBtn');
  const undoBtn = document.getElementById('undoBtn');
  const bookLabelEl = document.getElementById('bookLabel');
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
  let forceShowAnalysis = false;

  const CLASSIFICATION_ICONS = {
    brilliant: 'media/classifications/Brilliant.png',
    great: 'media/classifications/Great.png',
    best: 'media/classifications/Best.png',
    okay: 'media/classifications/Okay.png',
    miss: 'media/classifications/Miss.png',
    inaccuracy: 'media/classifications/Inaccuracy.png',
    mistake: 'media/classifications/Mistake.png',
    blunder: 'media/classifications/Blunder.png',
    book: 'media/classifications/Book.png',
  };

  function classifyMove(preMoveAnalysis, playedMoveInt) {
    if (!preMoveAnalysis) return null;
    if (preMoveAnalysis.forced) return null;
    const top = preMoveAnalysis.topMoves;
    if (!top || top.length < 2) return null;
    const totalVisits = top.reduce((s, m) => s + (m.visits || 0), 0);
    if (totalVisits < 50) return null;

    const bestWR = top[0].winRate;
    const legalCount = preMoveAnalysis.legalMoveCount || top.length;
    const playedIdx = top.findIndex(m => m.move === playedMoveInt);

    if (playedIdx === 0) {
      const gap = bestWR - top[1].winRate;
      if (gap >= 0.10 && legalCount >= 12 && bestWR > 0.25 && bestWR < 0.85) return 'brilliant';
      if (gap >= 0.05 && legalCount >= 5 && bestWR < 0.90) return 'great';
      return 'best';
    }

    const playedWR = playedIdx >= 0 ? top[playedIdx].winRate
      : Math.max(0, (top[top.length - 1]?.winRate || 0) - 0.05);
    const delta = bestWR - playedWR;

    if (delta > 0.20 || (bestWR >= 0.60 && playedWR < 0.40)) return 'blunder';
    if (delta > 0.12) return 'mistake';
    if (delta > 0.06) return 'inaccuracy';
    if (delta > 0.03 && playedWR >= 0.40) return 'miss';
    if (delta > 0.03) return 'inaccuracy';
    return 'okay';
  }

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
    if (shouldShowAnalysisUI()) {
      setEngineStatus('Engine thinking…', '');
    }
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

  // Always analyze so move classification data is available for all positions.
  function shouldAutoAnalyze() {
    if (state.winner !== 0) return false;
    return true;
  }

  function shouldShowAnalysisUI() {
    if (forceShowAnalysis) return true;
    if (mode === 'analysis') return true;
    if (mode === 'eve') return true;
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

  function applyMove(boardIdx, cellIdx, preMoveAnalysis) {
    const player = state.toMove;
    const prevActiveBoard = state.activeBoard;
    const moveInt = boardIdx * 9 + cellIdx;
    const bookMatch = getBookMatch(history, moveInt);
    const classification = bookMatch ? 'book' : classifyMove(preMoveAnalysis, moveInt);
    const bookName = bookMatch ? bookMatch.name : null;
    const bookDesc = bookMatch ? bookMatch.description : null;
    state.applyMove(moveInt);
    history.push({ boardIdx, cellIdx, player, prevActiveBoard, classification, moveInt, bookName, bookDesc });
    lastMove = { boardIdx, cellIdx };
  }

  function onCellClick(e) {
    if (!isHumanTurn()) return;
    const cell = e.currentTarget;
    const boardIdx = Number(cell.dataset.boardIndex);
    const cellIdx = Number(cell.dataset.cellIndex);
    if (!isLegalUserMove(boardIdx, cellIdx)) return;

    const preMoveAnalysis = currentAnalysis;
    abortAnalysis();
    applyMove(boardIdx, cellIdx, preMoveAnalysis);
    afterMoveChanged();
  }

  function afterMoveChanged() {
    hoveredMove = null;
    currentAnalysis = null;
    forceShowAnalysis = false;
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
    }
    if (!shouldShowAnalysisUI()) {
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
        const preMoveAnalysis = currentAnalysis;
        applyMove(b, c, preMoveAnalysis);
        afterMoveChanged();
      }
    }
  }

  // --- Rendering ---
  function render() {
    const turnChar = state.toMove === 1 ? 'X' : 'O';
    turnMarkEl.dataset.mark = turnChar;
    turnMarkEl.innerHTML = `<img src="media/pieces/${turnChar}256x256.png" class="turn-piece" alt="${turnChar}">`;

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
        cell.textContent = '';
        if (xBit) {
          cell.dataset.mark = 'X';
          const img = document.createElement('img');
          img.src = 'media/pieces/X256x256.png';
          img.className = 'piece-img';
          img.alt = 'X';
          img.draggable = false;
          cell.appendChild(img);
        } else if (oBit) {
          cell.dataset.mark = 'O';
          const img = document.createElement('img');
          img.src = 'media/pieces/O256x256.png';
          img.className = 'piece-img';
          img.alt = 'O';
          img.draggable = false;
          cell.appendChild(img);
        } else {
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
    renderClassifications();
    updateBookLabel();
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
    if (!shouldShowAnalysisUI()) return;
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
    const showUI = shouldShowAnalysisUI();
    if (!currentAnalysis) {
      if (showUI) {
        setEval(null);
        clearMovesList();
      }
      applyAnalysisHints();
      updateButtonStates();
      return;
    }
    if (showUI) {
      setEval(currentAnalysis.evaluation, currentAnalysis.forPlayer);
      renderTopMoves(currentAnalysis.topMoves);
    }
    applyAnalysisHints();
    if (showUI && state.winner === 0) {
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
          const preMoveAnalysis = currentAnalysis;
          abortAnalysis();
          applyMove(b, c, preMoveAnalysis);
          afterMoveChanged();
        }
      });

      topMovesListEl.appendChild(li);
    });
  }

  function clearMovesList() {
    topMovesListEl.innerHTML = '';
  }

  function updateBookLabel() {
    let activeName = null;
    let activeDesc = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].bookName) {
        activeName = history[i].bookName;
        activeDesc = history[i].bookDesc;
        break;
      }
      if (history[i].classification !== 'book') break;
    }
    if (activeName) {
      bookLabelEl.innerHTML = `<img src="media/classifications/Book.png" class="book-icon" alt="Book">${activeName}`;
      bookLabelEl.title = activeDesc || '';
      bookLabelEl.classList.remove('hidden');
    } else {
      bookLabelEl.classList.add('hidden');
    }
  }

  function renderClassifications() {
    for (const cell of cellEls) {
      cell.classList.remove('has-classification');
      const old = cell.querySelector('.cell-classification');
      if (old) old.remove();
    }
    for (const entry of history) {
      if (!entry.classification) continue;
      const idx = entry.boardIdx * 9 + entry.cellIdx;
      const cell = cellEls[idx];
      if (!cell) continue;
      cell.classList.add('has-classification');
      const badge = document.createElement('img');
      badge.src = CLASSIFICATION_ICONS[entry.classification];
      badge.className = 'cell-classification';
      badge.alt = entry.classification;
      badge.title = entry.bookName
        ? `Book: ${entry.bookName}`
        : entry.classification.charAt(0).toUpperCase() + entry.classification.slice(1);
      badge.draggable = false;
      cell.appendChild(badge);
    }
  }

  function showWinner(winner) {
    const ch = winner === 1 ? 'X' : winner === 2 ? 'O' : '-';
    if (ch === '-') {
      winnerMarkEl.textContent = 'Tie';
    } else {
      winnerMarkEl.innerHTML = `<img src="media/pieces/${ch}256x256.png" class="winner-piece" alt="${ch}">`;
    }
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
    const oldEntries = history.slice(0, -1);
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
    for (const entry of oldEntries) {
      const player = state.toMove;
      const prevActiveBoard = state.activeBoard;
      state.applyMove(entry.boardIdx * 9 + entry.cellIdx);
      history.push({
        boardIdx: entry.boardIdx, cellIdx: entry.cellIdx, player, prevActiveBoard,
        classification: entry.classification, moveInt: entry.moveInt,
        bookName: entry.bookName, bookDesc: entry.bookDesc,
      });
      lastMove = { boardIdx: entry.boardIdx, cellIdx: entry.cellIdx };
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
    forceShowAnalysis = true;
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
      const preMoveAnalysis = currentAnalysis;
      abortAnalysis();
      applyMove(b, c, preMoveAnalysis);
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
    if (currentAnalysis && currentAnalysis.done && currentAnalysis.bestMove != null && isBotTurn()) {
      render();
      onAnalysisComplete(currentAnalysis);
    } else if (!currentAnalysis) {
      render();
      startAnalysis();
    } else {
      render();
    }
    if (!shouldShowAnalysisUI()) {
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
    forceShowAnalysis = false;
    render();
    if (state.winner !== 0) return;
    startAnalysis();
    if (!shouldShowAnalysisUI()) {
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
