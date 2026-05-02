'use strict';

(() => {
  const UNLIMITED_BUDGET_MS = Number.MAX_SAFE_INTEGER;

  const STORAGE_ENGINE_KEY = 'uttt-engine-version';

  function getEngineVersion() {
    try {
      const v = localStorage.getItem(STORAGE_ENGINE_KEY);
      if (v === 'v1') return 'v1';
      if (v === 'v2') return 'v2';
      if (v === 'v3') return 'v3';
      return 'v3';
    } catch {
      return 'v3';
    }
  }

  function stateCtor(version) {
    if (version === 'v1') return self.UTTTEngine.UTTTState;
    if (version === 'v3') return self.UTTTEngineV3.UTTTState;
    return self.UTTTEngineV2.UTTTState;
  }

  function engineVersionLabel(v) {
    if (v === 'v1') return 'Classic';
    if (v === 'v3') return 'Strong';
    return 'Balanced';
  }

  function mergeParallelMCTSResults(results) {
    if (!results || results.length === 0) return null;
    const forPlayer = results[0].forPlayer;
    const agg = new Map();
    let totalSims = 0;
    let maxElapsed = 0;
    for (const r of results) {
      totalSims += r.simulations || 0;
      maxElapsed = Math.max(maxElapsed, r.elapsedMs || 0);
      for (const tm of r.topMoves || []) {
        const v = tm.visits || 0;
        const w = (tm.winRate || 0) * v;
        if (!agg.has(tm.move)) agg.set(tm.move, { visits: 0, winSum: 0 });
        const o = agg.get(tm.move);
        o.visits += v;
        o.winSum += w;
      }
    }
    const candidates = [...agg.entries()].map(([move, x]) => ({
      move,
      visits: x.visits,
      winRate: x.visits > 0 ? x.winSum / x.visits : 0,
    }));
    candidates.sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      return b.winRate - a.winRate;
    });
    const bestMove = candidates.length > 0 ? candidates[0].move : null;
    const evaluation = candidates.length > 0 ? 2 * candidates[0].winRate - 1 : 0;
    return {
      bestMove,
      topMoves: candidates.slice(0, 10),
      simulations: totalSims,
      elapsedMs: maxElapsed,
      evaluation,
      forPlayer,
      done: true,
      legalMoveCount: candidates.length,
      parallelWorkers: results.length,
    };
  }

  function mergeParallelProgress(partialList) {
    const valid = partialList.filter(Boolean);
    if (valid.length === 0) return null;
    const merged = mergeParallelMCTSResults(valid);
    if (!merged) return null;
    return { ...merged, done: false };
  }

  const LABEL_TO_IDX = { TL: 0, T: 1, TR: 2, L: 3, C: 4, R: 5, BL: 6, B: 7, BR: 8 };
  const IDX_TO_LABEL = ['TL', 'T', 'TR', 'L', 'C', 'R', 'BL', 'B', 'BR'];

  function parseMoveLabel(label) {
    const [board, cell] = label.split(':');
    return LABEL_TO_IDX[board] * 9 + LABEL_TO_IDX[cell];
  }

  function moveCoord(move) {
    const b = (move / 9) | 0;
    const c = move - b * 9;
    return `${IDX_TO_LABEL[b]} \u00B7 ${IDX_TO_LABEL[c]}`;
  }

  let bookLines = [];
  let bookLoaded = false;

  function loadBookMoves() {
    if (bookLoaded) return;
    bookLoaded = true;
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
  }

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

  const AI_BUDGETS = {
    easy: 500,
    medium: 2000,
    hard: 5000,
    max: 30000,
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

  function formatNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  function formatStats(result) {
    if (!result) return '\u2014';
    const sims = result.simulations || 0;
    const ms = result.elapsedMs || 0;
    const sps = ms > 0 ? Math.round(sims / (ms / 1000)) : 0;
    if (result.openingBook) return 'opening book';
    if (result.forced) return 'forced move';
    let line = `${formatNum(sims)} sims \u00B7 ${(ms / 1000).toFixed(1)}s \u00B7 ${formatNum(sps)}/s`;
    if (result.parallelWorkers && result.parallelWorkers > 1) {
      line += ` \u00B7 ${result.parallelWorkers}\u00D7 parallel`;
    }
    return line;
  }

  class GameController {
    constructor(containerEl, options = {}) {
      this.container = containerEl;
      this.mode = options.mode || 'local';
      this.difficulty = options.difficulty || 'hard';
      this.humanSide = options.humanSide || 'x';
      this.onlineManager = options.onlineManager || null;
      this.onGameOver = options.onGameOver || null;
      this.onMoveApplied = options.onMoveApplied || null;
      this.reviewMoveHistory = options.reviewHistory || null;
      this.initialAnalysisHistory = options.initialAnalysisHistory || null;
      this.engineVersion = options.engineVersion || getEngineVersion();
      this.engineVersionX = options.engineVersionX || 'v3';
      this.engineVersionO = options.engineVersionO || 'v3';

      const stateEng = this.mode === 'aivai' ? 'v1' : this.engineVersion;
      const Ctor = stateCtor(stateEng);
      this.state = new Ctor();
      this.history = [];
      this.lastMove = null;
      this.cellEls = [];
      this.smallEls = [];
      this.currentAnalysis = null;
      this.analysisRequestId = 0;
      this.hoveredMove = null;
      this.forceShowAnalysis = false;
      this.thinkingBudgetMs = 5000;
      this.aivaiBudgetMsX = 5000;
      this.aivaiBudgetMsO = 5000;
      this.aivaiRunning = false;
      this.destroyed = false;
      this.reviewIndex = 0;
      this.onlineReady = this.mode !== 'online';
      this.workersV2 = [];
      this.workersV3 = [];

      loadBookMoves();
      this._buildDOM();
      this._setupWorker();
      this._setupEvents();

      if (this.mode === 'online' && this.onlineManager) {
        this._setupOnline();
      }

      if (this.mode === 'review' && this.reviewMoveHistory) {
        this._initReview();
      } else if (this.mode === 'analysis' && this.initialAnalysisHistory && this.initialAnalysisHistory.length > 0) {
        this._bootstrapAnalysisFromHistory(this.initialAnalysisHistory);
      } else {
        this.reset();
      }
    }

    // ── DOM construction ──

    _buildDOM() {
      this.container.innerHTML = '';

      const layout = document.createElement('div');
      layout.className = 'game-layout';

      const boardCol = document.createElement('div');
      boardCol.className = 'board-column';

      boardCol.innerHTML = `
        <div class="game-status">
          <div class="turn-indicator">
            <span class="turn-label">Turn:</span>
            <span class="turn-mark" data-mark="X">X</span>
          </div>
          <div class="book-label hidden"></div>
          <div class="status-buttons">
            <button class="btn-secondary btn-undo" title="Undo last move">Undo</button>
            <button class="btn-secondary btn-reset">New Game</button>
          </div>
        </div>
        <div class="board-wrapper">
          <div class="meta-board"></div>
          <div class="winner-overlay hidden">
            <div class="winner-card">
              <div class="winner-mark"></div>
              <div class="winner-text"></div>
              <div class="winner-buttons"></div>
            </div>
          </div>
        </div>
      `;

      const panel = document.createElement('aside');
      panel.className = 'game-panel';
      this._buildPanel(panel);

      layout.appendChild(boardCol);
      layout.appendChild(panel);
      this.container.appendChild(layout);

      this.els = {
        metaBoard: boardCol.querySelector('.meta-board'),
        turnMark: boardCol.querySelector('.turn-mark'),
        bookLabel: boardCol.querySelector('.book-label'),
        undoBtn: boardCol.querySelector('.btn-undo'),
        resetBtn: boardCol.querySelector('.btn-reset'),
        winnerOverlay: boardCol.querySelector('.winner-overlay'),
        winnerMark: boardCol.querySelector('.winner-mark'),
        winnerText: boardCol.querySelector('.winner-text'),
        winnerButtons: boardCol.querySelector('.winner-buttons'),
        panel: panel,
      };

      this._buildBoard();
    }

    _aivaiBudgetSegHtml(currentMs) {
      const rows = [
        { v: 2000, label: '2s' },
        { v: 5000, label: '5s' },
        { v: 30000, label: '30s' },
        { v: -1, label: '\u221E', title: 'Unlimited' },
      ];
      return rows.map(r => {
        const ms = r.v === -1 ? UNLIMITED_BUDGET_MS : r.v;
        const active = currentMs === ms;
        const title = r.title ? ` title="${r.title}"` : '';
        return `<button class="seg-btn${active ? ' is-active' : ''}" type="button" data-budget="${r.v}" role="radio"${title}>${r.label}</button>`;
      }).join('');
    }

    _buildPanel(panel) {
      panel.innerHTML = '';

      if (this.mode === 'aivai') {
        panel.innerHTML += `
          <div class="panel-section">
            <div class="panel-section-title">X (first) \u2014 model</div>
            <div class="segmented cols-3 aivai-engine-x" role="radiogroup" aria-label="Engine for X">
              <button class="seg-btn${this.engineVersionX === 'v1' ? ' is-active' : ''}" type="button" data-aivai-side="x" data-engine="v1" role="radio">Classic</button>
              <button class="seg-btn${this.engineVersionX === 'v2' ? ' is-active' : ''}" type="button" data-aivai-side="x" data-engine="v2" role="radio">Balanced</button>
              <button class="seg-btn${this.engineVersionX === 'v3' ? ' is-active' : ''}" type="button" data-aivai-side="x" data-engine="v3" role="radio">Strong</button>
            </div>
            <div class="panel-section-title is-follow">X \u2014 thinking time</div>
            <div class="segmented cols-4 aivai-budget-picker-x" role="radiogroup" aria-label="Thinking time for X">
              ${this._aivaiBudgetSegHtml(this.aivaiBudgetMsX)}
            </div>
          </div>
          <div class="panel-section">
            <div class="panel-section-title">O (second) \u2014 model</div>
            <div class="segmented cols-3 aivai-engine-o" role="radiogroup" aria-label="Engine for O">
              <button class="seg-btn${this.engineVersionO === 'v1' ? ' is-active' : ''}" type="button" data-aivai-side="o" data-engine="v1" role="radio">Classic</button>
              <button class="seg-btn${this.engineVersionO === 'v2' ? ' is-active' : ''}" type="button" data-aivai-side="o" data-engine="v2" role="radio">Balanced</button>
              <button class="seg-btn${this.engineVersionO === 'v3' ? ' is-active' : ''}" type="button" data-aivai-side="o" data-engine="v3" role="radio">Strong</button>
            </div>
            <div class="panel-section-title is-follow">O \u2014 thinking time</div>
            <div class="segmented cols-4 aivai-budget-picker-o" role="radiogroup" aria-label="Thinking time for O">
              ${this._aivaiBudgetSegHtml(this.aivaiBudgetMsO)}
            </div>
          </div>
          <div class="panel-section">
            <button class="btn-primary btn-aivai-start" type="button">Start</button>
            <p class="settings-hint aivai-start-hint">Engines run only after you press Start.</p>
          </div>`;
      }

      if (this.mode === 'ai') {
        panel.innerHTML += `
          <div class="panel-section">
            <div class="panel-section-title">Difficulty</div>
            <div class="difficulty-cards">
              <button class="difficulty-card${this.difficulty === 'easy' ? ' is-active' : ''}" data-diff="easy">
                <span class="diff-name">Easy</span>
                <span class="diff-desc">0.5s think</span>
              </button>
              <button class="difficulty-card${this.difficulty === 'medium' ? ' is-active' : ''}" data-diff="medium">
                <span class="diff-name">Medium</span>
                <span class="diff-desc">2s think</span>
              </button>
              <button class="difficulty-card${this.difficulty === 'hard' ? ' is-active' : ''}" data-diff="hard">
                <span class="diff-name">Hard</span>
                <span class="diff-desc">5s think</span>
              </button>
              <button class="difficulty-card${this.difficulty === 'max' ? ' is-active' : ''}" data-diff="max">
                <span class="diff-name">Max</span>
                <span class="diff-desc">30s think</span>
              </button>
            </div>
          </div>
          <div class="panel-section side-picker-section">
            <div class="panel-section-title">Play as</div>
            <div class="segmented cols-2 side-picker" role="radiogroup">
              <button class="seg-btn${this.humanSide === 'x' ? ' is-active' : ''}" data-side="x" data-mark="X" role="radio">X \u2014 first</button>
              <button class="seg-btn${this.humanSide === 'o' ? ' is-active' : ''}" data-side="o" data-mark="O" role="radio">O \u2014 second</button>
            </div>
          </div>`;
      }

      if (this.mode === 'online') {
        panel.innerHTML += `
          <div class="panel-section online-panel">
            <div class="panel-section-title">Online Game</div>
            <div class="online-status">
              <span class="connection-dot waiting"></span>
              <span class="connection-text">Connecting...</span>
            </div>
            <div class="room-code-display" style="display:none"></div>
            <input class="share-link-input" readonly style="display:none" />
          </div>`;
      }

      if (this.mode === 'analysis') {
        panel.innerHTML += `
          <div class="panel-section">
            <div class="panel-section-title">Thinking Time</div>
            <div class="segmented cols-4 budget-picker" role="radiogroup">
              <button class="seg-btn" data-budget="2000" role="radio">2s</button>
              <button class="seg-btn is-active" data-budget="5000" role="radio">5s</button>
              <button class="seg-btn" data-budget="30000" role="radio">30s</button>
              <button class="seg-btn" data-budget="-1" role="radio" title="Unlimited">\u221E</button>
            </div>
          </div>`;
      }

      if (this.mode === 'review') {
        panel.innerHTML += `
          <div class="panel-section">
            <div class="panel-section-title">Game Review</div>
            <div class="move-counter">Move 0 / 0</div>
            <div class="review-nav">
              <button class="btn-review-start" title="Start">\u23EE</button>
              <button class="btn-review-prev" title="Previous">\u25C0</button>
              <button class="btn-review-next" title="Next">\u25B6</button>
              <button class="btn-review-end" title="End">\u23ED</button>
            </div>
          </div>
          <div class="panel-section review-summary-section" style="display:none">
            <div class="panel-section-title">Move Quality</div>
            <div class="classification-summary"></div>
          </div>`;
      }

      if (this.mode === 'aivai') {
        panel.innerHTML += `
          <div class="panel-section eval-section">
            <div class="eval-header">
              <span class="eval-label">Evaluation</span>
              <span class="eval-value">\u2014</span>
            </div>
            <div class="eval-bar">
              <div class="eval-fill"></div>
              <div class="eval-center"></div>
            </div>
            <div class="eval-legend">
              <span data-mark="X">X advantage</span>
              <span data-mark="O">O advantage</span>
            </div>
          </div>
          <div class="panel-section engine-status-section">
            <div class="status-line">Ready</div>
            <div class="status-stats">\u2014</div>
          </div>
          <div class="panel-section top-moves-section">
            <div class="section-header">
              <h3>Top moves</h3>
              <span class="section-hint">side to move</span>
            </div>
            <ol class="moves-list"></ol>
          </div>
          <div class="panel-section panel-buttons">
            <button class="btn-secondary btn-analyze">Re-analyze</button>
            <button class="btn-primary btn-engine-move">Step best move</button>
          </div>`;
      }

      if (this.mode === 'analysis' || this.mode === 'review') {
        panel.innerHTML += `
          <div class="panel-section eval-section">
            <div class="eval-header">
              <span class="eval-label">Evaluation</span>
              <span class="eval-value">\u2014</span>
            </div>
            <div class="eval-bar">
              <div class="eval-fill"></div>
              <div class="eval-center"></div>
            </div>
            <div class="eval-legend">
              <span data-mark="X">X advantage</span>
              <span data-mark="O">O advantage</span>
            </div>
          </div>
          ${this.mode === 'review' ? `
          <div class="panel-section classify-progress-section">
            <div class="classify-progress-label">Classifying moves\u2026</div>
            <div class="classify-progress-bar-wrap">
              <div class="classify-progress-bar-fill"></div>
            </div>
          </div>` : ''}
          ${this.mode !== 'review' ? `
          <div class="panel-section engine-status-section">
            <div class="status-line">Engine idle</div>
            <div class="status-stats">\u2014</div>
          </div>` : ''}
          ${this.mode === 'review' ? `
          <div class="panel-section eval-graph-section">
            <canvas class="eval-graph-canvas" height="120"></canvas>
          </div>` : ''}
          ${this.mode === 'review' ? `
          <div class="panel-section played-move-section" style="display:none">
            <div class="played-move-display"></div>
          </div>` : ''}
          <div class="panel-section top-moves-section">
            <div class="section-header">
              <h3>Top moves</h3>
            </div>
            <ol class="moves-list"></ol>
          </div>
          <div class="panel-section panel-buttons">
            <button class="btn-secondary btn-analyze">Re-analyze</button>
            <button class="btn-primary btn-engine-move">Engine move</button>
          </div>`;
      }

      if (this.mode === 'ai') {
        panel.innerHTML += `
          <div class="panel-section engine-status-section">
            <div class="status-line">Your move</div>
            <div class="status-stats">\u2014</div>
          </div>`;
      }

      if (this.mode === 'local') {
        panel.innerHTML += `
          <div class="panel-section">
            <div class="panel-section-title">Local Game</div>
            <p style="color: var(--muted); font-size: 0.88rem; line-height: 1.5;">
              Two players take turns on this device. X goes first.
            </p>
          </div>`;
      }
    }

    _buildBoard() {
      const metaBoard = this.els.metaBoard;
      metaBoard.innerHTML = '';
      this.cellEls = new Array(81);
      this.smallEls = new Array(9);
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
          cell.addEventListener('click', (e) => this._onCellClick(e));
          small.appendChild(cell);
          this.cellEls[b * 9 + c] = cell;
        }
        metaBoard.appendChild(small);
        this.smallEls[b] = small;
      }
    }

    // ── Worker ──

    _setupWorker() {
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      if (this.workersV2 && this.workersV2.length > 0) {
        for (const w of this.workersV2) w.terminate();
      }
      if (this.workersV3 && this.workersV3.length > 0) {
        for (const w of this.workersV3) w.terminate();
      }
      this.workersV2 = [];
      this.workersV3 = [];
      this._parallelProgress = [];
      this._parallelFinal = [];

      const nParallel = Math.min(
        4,
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency
          ? navigator.hardwareConcurrency
          : 4
      );

      const attachV2Pool = () => {
        for (let i = 0; i < nParallel; i++) {
          const w = new Worker('workerv2.js');
          w.addEventListener('message', (e) => this._onWorkerMessageParallel(e));
          this.workersV2.push(w);
        }
      };

      const attachV3Pool = () => {
        for (let i = 0; i < nParallel; i++) {
          const w = new Worker('workerv3.js');
          w.addEventListener('message', (e) => this._onWorkerMessageParallel(e));
          this.workersV3.push(w);
        }
      };

      if (this.mode === 'aivai') {
        if (this.engineVersionX === 'v2' || this.engineVersionO === 'v2') attachV2Pool();
        if (this.engineVersionX === 'v3' || this.engineVersionO === 'v3') attachV3Pool();
        if (this.engineVersionX === 'v1' || this.engineVersionO === 'v1') {
          this.worker = new Worker('worker.js');
          this.worker.addEventListener('message', (e) => this._onWorkerMessage(e));
        }
      } else if (this.mode === 'review') {
        attachV3Pool();
      } else if (this.engineVersion === 'v3') {
        attachV3Pool();
      } else if (this.engineVersion === 'v2') {
        attachV2Pool();
      } else {
        this.worker = new Worker('worker.js');
        this.worker.addEventListener('message', (e) => this._onWorkerMessage(e));
      }
    }

    _parallelEngineForTurn() {
      const side = this.mode === 'aivai'
        ? (this.state.toMove === 1 ? this.engineVersionX : this.engineVersionO)
        : this.engineVersion;
      return side === 'v2' || side === 'v3' ? side : null;
    }

    _parallelPoolForKind(kind) {
      return kind === 'v3' ? this.workersV3 : this.workersV2;
    }

    _onWorkerMessageParallel(e) {
      const msg = e.data;
      if (!msg || msg.requestId !== this.analysisRequestId || this.destroyed) return;
      const poolLen = this._parallelProgress.length;
      if (poolLen === 0 || msg.workerIndex < 0 || msg.workerIndex >= poolLen) return;

      const showLive = !this._isAutoClassify || this._isAutoClassifyLive;

      if (msg.type === 'progress') {
        this._parallelProgress[msg.workerIndex] = msg.result;
        if (showLive) {
          const merged = mergeParallelProgress(this._parallelProgress);
          if (merged) {
            this.currentAnalysis = merged;
            this._renderAnalysis(false);
          }
        }
        return;
      }

      if (msg.type === 'result') {
        this._parallelFinal[msg.workerIndex] = msg.result;
        for (let i = 0; i < poolLen; i++) {
          if (!this._parallelFinal[i]) return;
        }
        const merged = mergeParallelMCTSResults(this._parallelFinal.slice());
        this._parallelProgress = [];
        this._parallelFinal = [];
        if (showLive) {
          this.currentAnalysis = merged;
          this._renderAnalysis(true);
        }
        this._onAnalysisComplete(merged);
      }
    }

    _onWorkerMessage(e) {
      const msg = e.data;
      if (!msg || msg.requestId !== this.analysisRequestId) return;
      if (this.destroyed) return;

      const showLive = !this._isAutoClassify || this._isAutoClassifyLive;

      if (msg.type === 'progress') {
        if (showLive) {
          this.currentAnalysis = msg.result;
          this._renderAnalysis(false);
        }
      } else if (msg.type === 'result') {
        if (showLive) {
          this.currentAnalysis = msg.result;
          this._renderAnalysis(true);
        }
        this._onAnalysisComplete(msg.result);
      }
    }

    _startAnalysis(budgetMs) {
      this.analysisRequestId++;
      const budget = budgetMs != null ? budgetMs : this._getCurrentBudget();
      const payload = {
        type: 'analyze',
        requestId: this.analysisRequestId,
        state: this.state.serialize(),
        budgetMs: budget,
      };

      const parallelKind = this._parallelEngineForTurn();

      if (parallelKind) {
        const pool = this._parallelPoolForKind(parallelKind);
        if (pool.length === 0) return;
        this._parallelProgress = new Array(pool.length);
        this._parallelFinal = new Array(pool.length);
        const seedBase = (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
        const rolloutCap = parallelKind === 'v3' ? 52 : 32;
        const maxNodesPerWorker = Math.floor(500000 / Math.max(pool.length, 1));
        for (let i = 0; i < pool.length; i++) {
          pool[i].postMessage({
            ...payload,
            workerIndex: i,
            rngSeed: (seedBase + Math.imul(i, 0x9e3779b1)) >>> 0,
            rolloutCap,
            maxNodes: maxNodesPerWorker,
          });
        }
      } else {
        if (!this.worker) return;
        this.worker.postMessage(payload);
      }
      if (this._shouldShowAnalysisUI()) {
        this._setEngineStatus('Engine thinking\u2026', '');
      }
    }

    _abortAnalysis() {
      this.analysisRequestId++;
      this._parallelProgress = [];
      this._parallelFinal = [];
      for (const w of this.workersV2) {
        w.postMessage({ type: 'abort' });
      }
      for (const w of this.workersV3) {
        w.postMessage({ type: 'abort' });
      }
      if (this.worker) {
        this.worker.postMessage({ type: 'abort' });
      }
    }

    _getCurrentBudget() {
      if (this.mode === 'ai') return AI_BUDGETS[this.difficulty] || 5000;
      if (this.mode === 'aivai') {
        return this.state.toMove === 1 ? this.aivaiBudgetMsX : this.aivaiBudgetMsO;
      }
      if (this.mode === 'analysis' || this.mode === 'review') {
        return this.thinkingBudgetMs;
      }
      return 5000;
    }

    // ── Event handlers ──

    _setupEvents() {
      this.els.undoBtn.addEventListener('click', () => this.undo());
      this.els.resetBtn.addEventListener('click', () => this.reset());

      if (this.mode === 'online') {
        this.els.undoBtn.style.display = 'none';
        this.els.resetBtn.style.display = 'none';
      }

      if (this.mode === 'review') {
        this.els.undoBtn.style.display = 'none';
        this.els.resetBtn.style.display = 'none';
      }

      if (this.mode === 'aivai') {
        this.els.undoBtn.style.display = 'none';
      }

      if (this.mode === 'ai') {
        const diffCards = this.els.panel.querySelectorAll('.difficulty-card');
        diffCards.forEach(card => {
          card.addEventListener('click', () => {
            this.difficulty = card.dataset.diff;
            diffCards.forEach(c => c.classList.toggle('is-active', c === card));
            if (this.state.winner === 0 && this._isBotTurn()) {
              this._abortAnalysis();
              this._startAnalysis();
            }
          });
        });

        const sideButtons = this.els.panel.querySelectorAll('.side-picker .seg-btn');
        sideButtons.forEach(btn => {
          btn.addEventListener('click', () => {
            const side = btn.dataset.side;
            if (side === this.humanSide) return;
            this.humanSide = side;
            sideButtons.forEach(b => {
              const active = b.dataset.side === this.humanSide;
              b.classList.toggle('is-active', active);
            });
            this._afterSideChange();
          });
        });
      }

      if (this.mode === 'analysis') {
        const budgetBtns = this.els.panel.querySelectorAll('.budget-picker .seg-btn');
        budgetBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const v = parseInt(btn.dataset.budget, 10);
            const next = v === -1 ? UNLIMITED_BUDGET_MS : v;
            if (next === this.thinkingBudgetMs) return;
            this.thinkingBudgetMs = next;
            budgetBtns.forEach(b => {
              const bv = parseInt(b.dataset.budget, 10);
              const matches = (bv === -1 ? UNLIMITED_BUDGET_MS : bv) === this.thinkingBudgetMs;
              b.classList.toggle('is-active', matches);
            });
            if (this.state.winner !== 0) return;
            this._abortAnalysis();
            this._startAnalysis();
          });
        });
      }

      if (this.mode === 'aivai') {
        const startBtn = this.els.panel.querySelector('.btn-aivai-start');
        if (startBtn) {
          startBtn.addEventListener('click', () => {
            if (this.state.winner !== 0 || this.aivaiRunning) return;
            this.aivaiRunning = true;
            this._updateButtonStates();
            this.forceShowAnalysis = true;
            this._abortAnalysis();
            this._startAnalysis();
          });
        }

        const wireSide = side => {
          const prefix = side === 'x' ? 'x' : 'o';
          const wrap = this.els.panel.querySelector(`.aivai-engine-${prefix}`);
          if (!wrap) return;
          wrap.querySelectorAll('.seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const eng = btn.dataset.engine;
              const cur = side === 'x' ? this.engineVersionX : this.engineVersionO;
              if (eng === cur) return;
              if (side === 'x') this.engineVersionX = eng;
              else this.engineVersionO = eng;
              wrap.querySelectorAll('.seg-btn').forEach(b => {
                b.classList.toggle('is-active', b.dataset.engine === eng);
              });
              this._abortAnalysis();
              this._setupWorker();
              if (this.state.winner === 0) {
                this.currentAnalysis = null;
                this.render();
                if (this.aivaiRunning) {
                  this._startAnalysis();
                }
              }
            });
          });
        };
        wireSide('x');
        wireSide('o');

        const wireAivaiBudget = (pickerClass, prop, toMoveWhenX) => {
          const wrap = this.els.panel.querySelector(pickerClass);
          if (!wrap) return;
          const btns = wrap.querySelectorAll('.seg-btn');
          btns.forEach(btn => {
            btn.addEventListener('click', () => {
              const v = parseInt(btn.dataset.budget, 10);
              const next = v === -1 ? UNLIMITED_BUDGET_MS : v;
              if (next === this[prop]) return;
              this[prop] = next;
              btns.forEach(b => {
                const bv = parseInt(b.dataset.budget, 10);
                const ms = bv === -1 ? UNLIMITED_BUDGET_MS : bv;
                b.classList.toggle('is-active', ms === next);
              });
              if (this.state.winner !== 0) return;
              this._abortAnalysis();
              const sideToMove = toMoveWhenX ? 1 : 2;
              if (this.aivaiRunning && this.state.toMove === sideToMove) {
                this._startAnalysis();
              }
            });
          });
        };
        wireAivaiBudget('.aivai-budget-picker-x', 'aivaiBudgetMsX', true);
        wireAivaiBudget('.aivai-budget-picker-o', 'aivaiBudgetMsO', false);
      }

      const analyzeBtn = this.els.panel.querySelector('.btn-analyze');
      if (analyzeBtn) {
        analyzeBtn.addEventListener('click', () => {
          if (this.state.winner !== 0) return;
          this.forceShowAnalysis = true;
          this._abortAnalysis();
          this._startAnalysis();
        });
      }

      const engineMoveBtn = this.els.panel.querySelector('.btn-engine-move');
      if (engineMoveBtn) {
        engineMoveBtn.addEventListener('click', () => {
          if (this.state.winner !== 0) return;
          if (!this.currentAnalysis || this.currentAnalysis.bestMove == null) return;
          const m = this.currentAnalysis.bestMove;
          const b = (m / 9) | 0;
          const c = m - b * 9;
          if (this._isLegalMove(b, c)) {
            const preMoveAnalysis = this.currentAnalysis;
            this._abortAnalysis();
            this._applyMove(b, c, preMoveAnalysis);
            this._afterMove();
          }
        });
      }

      if (this.mode === 'review') {
        this._setupReviewControls();
      }
    }

    _setupReviewControls() {
      const startBtn = this.els.panel.querySelector('.btn-review-start');
      const prevBtn = this.els.panel.querySelector('.btn-review-prev');
      const nextBtn = this.els.panel.querySelector('.btn-review-next');
      const endBtn = this.els.panel.querySelector('.btn-review-end');

      if (startBtn) startBtn.addEventListener('click', () => this._reviewGoTo(0));
      if (prevBtn) prevBtn.addEventListener('click', () => this._reviewGoTo(this.reviewIndex - 1));
      if (nextBtn) nextBtn.addEventListener('click', () => this._reviewGoTo(this.reviewIndex + 1));
      if (endBtn) endBtn.addEventListener('click', () => this._reviewGoTo(this.reviewMoveHistory.length));

      const graphCanvas = this.els.panel.querySelector('.eval-graph-canvas');
      if (graphCanvas) {
        graphCanvas.addEventListener('click', (e) => {
          const rect = graphCanvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const padLeft = 30, padRight = 8;
          const gW = rect.width - padLeft - padRight;
          const totalMoves = this.reviewMoveHistory ? this.reviewMoveHistory.length : 0;
          if (totalMoves <= 0 || gW <= 0) return;
          const frac = (x - padLeft) / gW;
          const moveIdx = Math.round(frac * (totalMoves - 1)) + 1;
          this._reviewGoTo(Math.max(0, Math.min(moveIdx, totalMoves)));
        });
      }

      this._reviewKeyHandler = (e) => {
        if (this.destroyed) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this._reviewGoTo(this.reviewIndex - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this._reviewGoTo(this.reviewIndex + 1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          this._reviewGoTo(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          this._reviewGoTo(this.reviewMoveHistory.length);
        }
      };
      document.addEventListener('keydown', this._reviewKeyHandler);
    }

    // ── Online ──

    _setupOnline() {
      const om = this.onlineManager;
      const dot = this.els.panel.querySelector('.connection-dot');
      const text = this.els.panel.querySelector('.connection-text');
      const codeDisplay = this.els.panel.querySelector('.room-code-display');
      const linkInput = this.els.panel.querySelector('.share-link-input');

      om.onRoomCreated = (room, side) => {
        this.humanSide = side;
        if (dot) { dot.className = 'connection-dot waiting'; }
        if (text) { text.textContent = 'Waiting for opponent...'; }
        if (codeDisplay) {
          codeDisplay.textContent = room;
          codeDisplay.style.display = '';
        }
        if (linkInput) {
          linkInput.value = `${location.origin}${location.pathname}#/play/online/${room}`;
          linkInput.style.display = '';
          linkInput.addEventListener('click', () => {
            linkInput.select();
            navigator.clipboard?.writeText(linkInput.value);
          });
        }
      };

      om.onJoined = (room, side) => {
        this.humanSide = side;
        this.onlineReady = true;
        if (dot) { dot.className = 'connection-dot connected'; }
        if (text) { text.textContent = `Joined as ${side.toUpperCase()}`; }
        this.render();
      };

      om.onOpponentJoined = () => {
        this.onlineReady = true;
        if (dot) { dot.className = 'connection-dot connected'; }
        if (text) { text.textContent = 'Opponent connected!'; }
        this.render();
      };

      om.onOpponentMove = (move) => {
        const b = (move / 9) | 0;
        const c = move - b * 9;
        if (this._isLegalMove(b, c)) {
          this._applyMove(b, c, null);
          this._afterMove();
        }
      };

      om.onOpponentDisconnected = () => {
        if (dot) { dot.className = 'connection-dot disconnected'; }
        if (text) { text.textContent = 'Opponent disconnected'; }
      };

      om.onRematchAccepted = (side) => {
        this.humanSide = side;
        this.reset();
      };

      om.onError = (msg) => {
        if (text) { text.textContent = `Error: ${msg}`; }
        if (dot) { dot.className = 'connection-dot disconnected'; }
      };
    }

    // ── Game logic ──

    _isHumanTurn() {
      if (this.state.winner !== 0) return false;
      if (this.mode === 'aivai') return false;
      if (this.mode === 'analysis') return true;
      if (this.mode === 'review') return false;
      if (this.mode === 'local') return true;
      if (this.mode === 'online') {
        if (!this.onlineManager || !this.onlineReady) return false;
        const mySide = this.humanSide;
        return (mySide === 'x' && this.state.toMove === 1) ||
               (mySide === 'o' && this.state.toMove === 2);
      }
      if (this.mode === 'ai') {
        return (this.humanSide === 'x' && this.state.toMove === 1) ||
               (this.humanSide === 'o' && this.state.toMove === 2);
      }
      return false;
    }

    _isBotTurn() {
      if (this.state.winner !== 0) return false;
      if (this.mode === 'aivai') return this.aivaiRunning;
      if (this.mode === 'ai') {
        return (this.humanSide === 'x' && this.state.toMove === 2) ||
               (this.humanSide === 'o' && this.state.toMove === 1);
      }
      return false;
    }

    _shouldAutoAnalyze() {
      if (this.state.winner !== 0) return false;
      if (this.mode === 'analysis') return true;
      if (this.mode === 'review') return true;
      if (this.mode === 'aivai') return this.aivaiRunning;
      if (this.mode === 'ai') return this._isBotTurn();
      return false;
    }

    _shouldShowAnalysisUI() {
      if (this.forceShowAnalysis) return true;
      if (this.mode === 'aivai') return true;
      if (this.mode === 'analysis') return true;
      if (this.mode === 'review') return true;
      return false;
    }

    _isLegalMove(boardIdx, cellIdx) {
      if (this.state.winner !== 0) return false;
      if (this.state.bigSettled & (1 << boardIdx)) return false;
      if ((this.state.smallX[boardIdx] | this.state.smallO[boardIdx]) & (1 << cellIdx)) return false;
      if (this.state.activeBoard !== -1 && this.state.activeBoard !== boardIdx
          && !(this.state.bigSettled & (1 << this.state.activeBoard))) return false;
      return true;
    }

    _applyMove(boardIdx, cellIdx, preMoveAnalysis) {
      const player = this.state.toMove;
      const prevActiveBoard = this.state.activeBoard;
      const moveInt = boardIdx * 9 + cellIdx;
      const bookMatch = getBookMatch(this.history, moveInt);
      const classification = bookMatch ? 'book' : classifyMove(preMoveAnalysis, moveInt);
      const bookName = bookMatch ? bookMatch.name : null;
      const bookDesc = bookMatch ? bookMatch.description : null;
      this.state.applyMove(moveInt);
      this.history.push({ boardIdx, cellIdx, player, prevActiveBoard, classification, moveInt, bookName, bookDesc });
      this.lastMove = { boardIdx, cellIdx };
    }

    _onCellClick(e) {
      if (!this._isHumanTurn()) return;
      const cell = e.currentTarget;
      const boardIdx = Number(cell.dataset.boardIndex);
      const cellIdx = Number(cell.dataset.cellIndex);
      if (!this._isLegalMove(boardIdx, cellIdx)) return;

      const preMoveAnalysis = this.currentAnalysis;
      this._abortAnalysis();
      this._applyMove(boardIdx, cellIdx, preMoveAnalysis);

      if (this.mode === 'online' && this.onlineManager) {
        this.onlineManager.sendMove(boardIdx * 9 + cellIdx);
      }

      this._afterMove();
    }

    _afterMove() {
      this.hoveredMove = null;
      this.currentAnalysis = null;
      this.forceShowAnalysis = false;
      this.render();

      if (this.onMoveApplied) this.onMoveApplied(this.history);

      if (this.state.winner !== 0) {
        this._showWinner(this.state.winner);
        this._setEngineStatus('Game over', '');
        this._clearMovesList();
        const finalEval = this.state.winner === 1 ? 1 : this.state.winner === 2 ? -1 : 0;
        this._setEval(finalEval, 1);
        if (this.onGameOver) this.onGameOver(this.state.winner, this.history);
        return;
      }

      if (this._shouldAutoAnalyze()) {
        this._startAnalysis();
      }
      if (this.mode === 'ai' && this._isBotTurn()) {
        this._setEngineStatus('Engine thinking\u2026', '');
      } else if (!this._shouldShowAnalysisUI()) {
        this._setEngineStatus('Your move', '');
      }
    }

    _afterSideChange() {
      if (this.state.winner !== 0) {
        this.render();
        return;
      }
      if (this.currentAnalysis && this.currentAnalysis.done && this.currentAnalysis.bestMove != null && this._isBotTurn()) {
        this.render();
        this._onAnalysisComplete(this.currentAnalysis);
      } else if (!this.currentAnalysis) {
        this.render();
        this._startAnalysis();
      } else {
        this.render();
      }
      if (!this._shouldShowAnalysisUI()) {
        this._setEngineStatus('Your move', '');
      }
    }

    _onAnalysisComplete(result) {
      if (this.mode === 'review' && this.reviewMoveHistory) {
        if (this._isAutoClassify && this._autoClassifyIdx >= 0) {
          this._classifyAtIndex(this._autoClassifyIdx, result);
          if (this._autoClassifyIdx === this.reviewIndex) {
            this._showCachedReviewAnalysis();
          }
          this._autoClassifyIdx++;
          this._advanceAutoClassify();
        }
        return;
      }

      if (this.state.winner !== 0) return;

      if (this._isBotTurn() && result.bestMove != null) {
        const m = result.bestMove;
        const b = (m / 9) | 0;
        const c = m - b * 9;
        if (this._isLegalMove(b, c)) {
          const preMoveAnalysis = this.currentAnalysis;
          this._applyMove(b, c, preMoveAnalysis);
          this._afterMove();
        }
      }
    }

    _classifyAtIndex(moveIdx, analysis) {
      if (moveIdx < 0 || moveIdx >= this.reviewMoveHistory.length) return;
      const entry = this.reviewMoveHistory[moveIdx];
      entry._analysis = analysis;
      if (entry.classification !== 'book') {
        const moveInt = entry.boardIdx * 9 + entry.cellIdx;
        const cls = classifyMove(analysis, moveInt);
        if (cls) {
          entry.classification = cls;
          if (moveIdx < this.history.length) {
            this.history[moveIdx].classification = cls;
          }
        }
      }
      this._renderClassifications();
      this._showReviewSummary();
      this._updateReviewUI();
      this._updateClassifyProgress();
      this._renderEvalGraph();
    }

    _renderEvalGraph() {
      const canvas = this.els.panel.querySelector('.eval-graph-canvas');
      if (!canvas || !this.reviewMoveHistory) return;
      const totalMoves = this.reviewMoveHistory.length;
      if (totalMoves === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = 120;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const pad = { top: 16, bottom: 16, left: 30, right: 8 };
      const gW = W - pad.left - pad.right;
      const gH = H - pad.top - pad.bottom;

      ctx.clearRect(0, 0, W, H);

      // Background halves
      ctx.fillStyle = 'rgba(59,130,246,0.08)';
      ctx.fillRect(pad.left, pad.top, gW, gH / 2);
      ctx.fillStyle = 'rgba(239,68,68,0.08)';
      ctx.fillRect(pad.left, pad.top + gH / 2, gW, gH / 2);

      // Center line (50%)
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top + gH / 2);
      ctx.lineTo(pad.left + gW, pad.top + gH / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Y-axis labels
      ctx.fillStyle = '#8a93ad';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('X', pad.left - 4, pad.top + 4);
      ctx.fillText('50', pad.left - 4, pad.top + gH / 2);
      ctx.fillText('O', pad.left - 4, pad.top + gH - 4);

      // Collect data points: evaluation as X win% (0..1)
      const points = [];
      for (let i = 0; i < totalMoves; i++) {
        const entry = this.reviewMoveHistory[i];
        if (!entry._analysis) break;
        const ev = entry._analysis.evaluation != null ? entry._analysis.evaluation : 0;
        const fp = entry._analysis.forPlayer || 1;
        const fromX = fp === 1 ? ev : -ev;
        const xWin = (fromX + 1) / 2;
        points.push(xWin);
      }
      if (points.length === 0) return;

      const xStep = totalMoves > 1 ? gW / (totalMoves - 1) : gW;

      const midY = pad.top + gH / 2;
      const lastX = pad.left + (totalMoves > 1 ? (points.length - 1) * xStep : gW / 2);

      const buildPath = () => {
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const x = pad.left + (totalMoves > 1 ? i * xStep : gW / 2);
          const y = pad.top + (1 - points[i]) * gH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(lastX, midY);
        ctx.lineTo(pad.left, midY);
        ctx.closePath();
      };

      // X advantage (above center = blue)
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.left, pad.top, gW, gH / 2);
      ctx.clip();
      buildPath();
      ctx.fillStyle = 'rgba(59,130,246,0.18)';
      ctx.fill();
      ctx.restore();

      // O advantage (below center = red)
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.left, midY, gW, gH / 2);
      ctx.clip();
      buildPath();
      ctx.fillStyle = 'rgba(239,68,68,0.18)';
      ctx.fill();
      ctx.restore();

      // Main line
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = pad.left + (totalMoves > 1 ? i * xStep : gW / 2);
        const y = pad.top + (1 - points[i]) * gH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Current position indicator
      if (this.reviewIndex >= 0 && this.reviewIndex < points.length) {
        const ci = this.reviewIndex;
        const cx = pad.left + (totalMoves > 1 ? ci * xStep : gW / 2);
        const cy = pad.top + (1 - points[ci]) * gH;
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // ── Rendering ──

    render() {
      if (this.destroyed) return;

      const turnChar = this.state.toMove === 1 ? 'X' : 'O';
      this.els.turnMark.dataset.mark = turnChar;
      this.els.turnMark.innerHTML = `<img src="media/pieces/${turnChar}256x256.png" class="turn-piece" alt="${turnChar}">`;

      for (let b = 0; b < 9; b++) {
        const small = this.smallEls[b];
        const winState = this.state.bigState[b];
        const winnerChar = winState === 1 ? 'X' : winState === 2 ? 'O' : winState === 3 ? '-' : null;
        small.classList.toggle('won', winnerChar !== null);
        if (winnerChar) small.dataset.winner = winnerChar;
        else delete small.dataset.winner;

        const isActive =
          this.state.winner === 0 &&
          winnerChar === null &&
          (this.state.activeBoard === -1
            || this.state.activeBoard === b
            || (this.state.bigSettled & (1 << this.state.activeBoard)));
        small.classList.toggle('active', isActive);

        for (let c = 0; c < 9; c++) {
          const cell = this.cellEls[b * 9 + c];
          const xBit = this.state.smallX[b] & (1 << c);
          const oBit = this.state.smallO[b] & (1 << c);
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
          const playable = this.state.winner === 0 && winnerChar === null && isActive && !xBit && !oBit;
          cell.disabled = !playable || !this._isHumanTurn();
          cell.classList.remove('hint-best', 'hint-other', 'last-move');
        }
      }

      if (this.lastMove) {
        const cell = this.cellEls[this.lastMove.boardIdx * 9 + this.lastMove.cellIdx];
        if (cell) cell.classList.add('last-move');
      }

      this._applyAnalysisHints();
      this._renderAnalysis(false);
      this._renderClassifications();
      this._updateBookLabel();
      this._updateButtonStates();
    }

    _clearHints() {
      for (const cell of this.cellEls) {
        cell.classList.remove('hint-best', 'hint-other');
        const badge = cell.querySelector('.hint-rank');
        if (badge) badge.remove();
      }
    }

    _applyAnalysisHints() {
      this._clearHints();
      if (!this._shouldShowAnalysisUI()) return;
      if (this.state.winner !== 0) return;
      if (!this.currentAnalysis || !this.currentAnalysis.topMoves) return;

      const top = this.currentAnalysis.topMoves.slice(0, 5);
      top.forEach((cand, idx) => {
        const cell = this.cellEls[cand.move];
        if (!cell) return;
        cell.classList.add(idx === 0 ? 'hint-best' : 'hint-other');
        const badge = document.createElement('span');
        badge.className = 'hint-rank';
        badge.textContent = String(idx + 1);
        cell.appendChild(badge);
      });

      if (this.hoveredMove != null) {
        const cell = this.cellEls[this.hoveredMove];
        if (cell) cell.classList.add('hint-best');
      }
    }

    _renderAnalysis(final) {
      const showUI = this._shouldShowAnalysisUI();

      if (!this.currentAnalysis) {
        if (showUI) {
          this._setEval(null);
          this._clearMovesList();
          if (this.mode === 'aivai' && this.state.winner === 0 && !this.aivaiRunning) {
            this._setEngineStatus('Press Start to begin', '');
          }
        }
        this._applyAnalysisHints();
        this._updateButtonStates();
        return;
      }
      if (showUI) {
        this._setEval(this.currentAnalysis.evaluation, this.currentAnalysis.forPlayer);
        this._renderTopMoves(this.currentAnalysis.topMoves);
      }
      this._applyAnalysisHints();
      if (showUI && this.state.winner === 0) {
        let label;
        if (final) {
          if (this.mode === 'analysis' || this.mode === 'review') {
            label = `${this.state.toMove === 1 ? 'X' : 'O'} to move`;
          } else if (this.mode === 'aivai') {
            const mark = this.state.toMove === 1 ? 'X' : 'O';
            const ev = this.state.toMove === 1 ? this.engineVersionX : this.engineVersionO;
            const eng = engineVersionLabel(ev);
            label = `${mark} to move \u00B7 ${eng}`;
          } else {
            label = this._isHumanTurn() ? 'Your move' : 'Engine ready';
          }
        } else if (this.mode === 'review' && this._isAutoClassifyLive) {
          const mark = this.state.toMove === 1 ? 'X' : 'O';
          label = `Analyzing move ${(this._autoClassifyIdx || 0) + 1}\u2026`;
        } else {
          label = 'Engine thinking\u2026';
        }
        this._setEngineStatus(label, formatStats(this.currentAnalysis));
      }
      this._updateButtonStates();
    }

    _updateButtonStates() {
      this.els.undoBtn.disabled = this.history.length === 0 || this.mode === 'review' || this.mode === 'aivai';
      this.els.resetBtn.disabled = this.mode === 'review';

      const analyzeBtn = this.els.panel.querySelector('.btn-analyze');
      const engineMoveBtn = this.els.panel.querySelector('.btn-engine-move');
      if (analyzeBtn) analyzeBtn.disabled = this.state.winner !== 0;
      if (engineMoveBtn) {
        engineMoveBtn.disabled = this.state.winner !== 0 || !this.currentAnalysis || this.currentAnalysis.bestMove == null;
      }

      const aivaiStart = this.els.panel.querySelector('.btn-aivai-start');
      if (aivaiStart) {
        aivaiStart.disabled = this.state.winner !== 0 || this.aivaiRunning;
      }
    }

    _setEngineStatus(label, stats) {
      const statusLine = this.els.panel.querySelector('.status-line');
      const statusStats = this.els.panel.querySelector('.status-stats');
      if (statusLine) statusLine.textContent = label;
      if (statusStats) statusStats.textContent = stats || '\u2014';
    }

    _updateClassifyProgress() {
      const section = this.els.panel.querySelector('.classify-progress-section');
      if (!section) return;
      const label = section.querySelector('.classify-progress-label');
      const fill = section.querySelector('.classify-progress-bar-fill');
      const total = this.reviewMoveHistory ? this.reviewMoveHistory.length : 0;
      if (this._autoClassifyIdx >= 0 && total > 0) {
        section.style.display = '';
        const done = this._autoClassifyIdx;
        label.textContent = `Classifying moves\u2026 ${done}/${total}`;
        fill.style.width = (done / total * 100) + '%';
      } else {
        section.style.display = 'none';
      }
    }

    _setEval(evalVal, forPlayer) {
      const evalFill = this.els.panel.querySelector('.eval-fill');
      const evalValueEl = this.els.panel.querySelector('.eval-value');
      if (!evalFill || !evalValueEl) return;

      if (evalVal == null) {
        evalFill.style.width = '50%';
        evalValueEl.textContent = '\u2014';
        return;
      }
      const fromX = forPlayer === 1 ? evalVal : -evalVal;
      const xWin = (fromX + 1) / 2;
      evalFill.style.width = (xWin * 100) + '%';
      const xPct = Math.round(xWin * 100);
      evalValueEl.textContent = `X ${xPct}% \u00B7 O ${100 - xPct}%`;
    }

    _renderTopMoves(top) {
      const listEl = this.els.panel.querySelector('.moves-list');
      if (!listEl) return;
      listEl.innerHTML = '';
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
          this.hoveredMove = cand.move;
          this._applyAnalysisHints();
        });
        li.addEventListener('mouseleave', () => {
          this.hoveredMove = null;
          this._applyAnalysisHints();
        });
        li.addEventListener('click', () => {
          if (!this._isHumanTurn()) return;
          const b = (cand.move / 9) | 0;
          const c = cand.move - b * 9;
          if (this._isLegalMove(b, c)) {
            const preMoveAnalysis = this.currentAnalysis;
            this._abortAnalysis();
            this._applyMove(b, c, preMoveAnalysis);
            if (this.mode === 'online' && this.onlineManager) {
              this.onlineManager.sendMove(cand.move);
            }
            this._afterMove();
          }
        });

        listEl.appendChild(li);
      });
    }

    _clearMovesList() {
      const listEl = this.els.panel.querySelector('.moves-list');
      if (listEl) listEl.innerHTML = '';
    }

    _updateBookLabel() {
      const label = this.els.bookLabel;
      let activeName = null;
      let activeDesc = null;

      // Check if any book line was fully completed (all opening moves played).
      // If so, keep the label for the rest of the game.
      let bookMovesCount = 0;
      for (let i = 0; i < this.history.length; i++) {
        if (this.history[i].classification === 'book') {
          bookMovesCount++;
          if (this.history[i].bookName) {
            // Check if this is the final move of the book line
            const matchedLine = bookLines.find(bl =>
              bl.name === this.history[i].bookName &&
              bl.moves.length === bookMovesCount
            );
            if (matchedLine) {
              activeName = matchedLine.name;
              activeDesc = matchedLine.description;
            }
          }
        } else {
          break;
        }
      }

      // If no completed line found, fall back: show label only while still in book
      if (!activeName) {
        for (let i = this.history.length - 1; i >= 0; i--) {
          if (this.history[i].bookName) {
            activeName = this.history[i].bookName;
            activeDesc = this.history[i].bookDesc;
            break;
          }
          if (this.history[i].classification !== 'book') break;
        }
      }

      if (activeName) {
        label.innerHTML = `<img src="media/classifications/Book.png" class="book-icon" alt="Book">${activeName}`;
        label.title = activeDesc || '';
        label.classList.remove('hidden');
      } else {
        label.classList.add('hidden');
      }
    }

    _renderClassifications() {
      for (const cell of this.cellEls) {
        const old = cell.querySelector('.cell-classification');
        if (old) old.remove();
      }
      for (const entry of this.history) {
        if (!entry.classification) continue;
        if (entry.classification === 'book' && this.mode !== 'review' && this.mode !== 'analysis') continue;
        const idx = entry.boardIdx * 9 + entry.cellIdx;
        const cell = this.cellEls[idx];
        if (!cell) continue;
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

    _showWinner(winner) {
      const ch = winner === 1 ? 'X' : winner === 2 ? 'O' : '-';
      if (ch === '-') {
        this.els.winnerMark.textContent = 'Tie';
      } else {
        this.els.winnerMark.innerHTML = `<img src="media/pieces/${ch}256x256.png" class="winner-piece" alt="${ch}">`;
      }
      this.els.winnerMark.dataset.mark = ch;
      this.els.winnerText.textContent = ch === '-' ? "It's a tie!" : `Player ${ch} wins!`;

      this.els.winnerButtons.innerHTML = '';
      const playAgainBtn = document.createElement('button');
      playAgainBtn.className = 'btn-secondary';
      playAgainBtn.textContent = 'Play Again';
      playAgainBtn.addEventListener('click', () => this.reset());
      this.els.winnerButtons.appendChild(playAgainBtn);

      if (this.mode === 'ai' || this.mode === 'local' || this.mode === 'online' || this.mode === 'aivai') {
        const reviewBtn = document.createElement('button');
        reviewBtn.className = 'btn-primary';
        reviewBtn.textContent = 'Review Game';
        reviewBtn.addEventListener('click', () => {
          if (window.UTTT_APP && window.UTTT_APP.startReview) {
            window.UTTT_APP.startReview(this.history.slice());
          }
        });
        this.els.winnerButtons.appendChild(reviewBtn);
      }

      this.els.winnerOverlay.classList.remove('hidden');
    }

    // ── Reset / Undo ──

    _bootstrapAnalysisFromHistory(entries) {
      this._abortAnalysis();
      this.state.smallX.fill(0);
      this.state.smallO.fill(0);
      this.state.bigState.fill(0);
      this.state.bigX = 0;
      this.state.bigO = 0;
      this.state.bigSettled = 0;
      this.state.activeBoard = -1;
      this.state.toMove = 1;
      this.state.winner = 0;
      this.state.moveCount = 0;
      this.history.length = 0;
      this.lastMove = null;
      this.currentAnalysis = null;
      this.hoveredMove = null;
      this.forceShowAnalysis = false;
      this.els.winnerOverlay.classList.add('hidden');

      for (const e of entries) {
        const player = this.state.toMove;
        const prevActiveBoard = this.state.activeBoard;
        const moveInt = e.moveInt != null ? e.moveInt : e.boardIdx * 9 + e.cellIdx;
        this.state.applyMove(moveInt);
        this.history.push({
          boardIdx: e.boardIdx,
          cellIdx: e.cellIdx,
          player,
          prevActiveBoard,
          classification: e.classification != null ? e.classification : null,
          moveInt,
          bookName: e.bookName != null ? e.bookName : null,
          bookDesc: e.bookDesc != null ? e.bookDesc : null,
        });
        this.lastMove = { boardIdx: e.boardIdx, cellIdx: e.cellIdx };
      }
      this.render();
      this._updateBookLabel();
      this._afterMove();
    }

    reset() {
      this._abortAnalysis();
      this.state.smallX.fill(0);
      this.state.smallO.fill(0);
      this.state.bigState.fill(0);
      this.state.bigX = 0;
      this.state.bigO = 0;
      this.state.bigSettled = 0;
      this.state.activeBoard = -1;
      this.state.toMove = 1;
      this.state.winner = 0;
      this.state.moveCount = 0;
      this.history.length = 0;
      this.lastMove = null;
      this.currentAnalysis = null;
      this.hoveredMove = null;
      this.forceShowAnalysis = false;
      this.els.winnerOverlay.classList.add('hidden');
      if (this.mode === 'aivai') {
        this.aivaiRunning = false;
      }
      this._afterMove();
    }

    undo() {
      if (this.history.length === 0) return;
      if (this.mode === 'online' || this.mode === 'review' || this.mode === 'aivai') return;
      this._abortAnalysis();
      const oldEntries = this.history.slice(0, -1);
      this.state.smallX.fill(0);
      this.state.smallO.fill(0);
      this.state.bigState.fill(0);
      this.state.bigX = 0;
      this.state.bigO = 0;
      this.state.bigSettled = 0;
      this.state.activeBoard = -1;
      this.state.toMove = 1;
      this.state.winner = 0;
      this.state.moveCount = 0;
      this.history.length = 0;
      this.lastMove = null;
      for (const entry of oldEntries) {
        const player = this.state.toMove;
        const prevActiveBoard = this.state.activeBoard;
        this.state.applyMove(entry.boardIdx * 9 + entry.cellIdx);
        this.history.push({
          boardIdx: entry.boardIdx, cellIdx: entry.cellIdx, player, prevActiveBoard,
          classification: entry.classification, moveInt: entry.moveInt,
          bookName: entry.bookName, bookDesc: entry.bookDesc,
        });
        this.lastMove = { boardIdx: entry.boardIdx, cellIdx: entry.cellIdx };
      }
      this.els.winnerOverlay.classList.add('hidden');
      this._afterMove();
    }

    // ── Review mode ──

    _initReview() {
      this.reviewIndex = 0;
      this._autoClassifyIdx = -1;
      this._classifyStarted = false;
      this._classifyFinished = false;
      this._isAutoClassify = false;
      this._isAutoClassifyLive = false;
      this._replayToIndex(0);
      this.render();
      this._updateReviewUI();
      this._showReviewSummary();
      this._renderEvalGraph();
      this._updateClassifyProgress();
      this._accuracyDotsInterval = setInterval(() => {
        if (this._classifyFinished) {
          clearInterval(this._accuracyDotsInterval);
          this._accuracyDotsInterval = null;
          this._showReviewSummary();
          return;
        }
        const boxes = this.els.panel.querySelectorAll('.accuracy-pending');
        const n = (Math.floor(Date.now() / 1200) % 3) + 1;
        for (const b of boxes) b.textContent = '.'.repeat(n);
      }, 1200);
      this._startReviewAutoClassify();
    }

    _startReviewAutoClassify() {
      this._autoClassifyIdx = 0;
      this._classifyStarted = true;
      this._advanceAutoClassify();
    }

    _advanceAutoClassify() {
      if (!this.reviewMoveHistory || this._autoClassifyIdx < 0) return;
      while (this._autoClassifyIdx < this.reviewMoveHistory.length) {
        const entry = this.reviewMoveHistory[this._autoClassifyIdx];
        if (entry._analysis) { this._autoClassifyIdx++; continue; }
        break;
      }
      if (this._autoClassifyIdx >= this.reviewMoveHistory.length) {
        this._autoClassifyIdx = -1;
        this._isAutoClassify = false;
        this._isAutoClassifyLive = false;
        this._classifyFinished = true;
        this._updateClassifyProgress();
        this._showReviewSummary();
        this._showCachedReviewAnalysis();
        return;
      }
      this._runAutoClassifyAt(this._autoClassifyIdx);
    }

    _runAutoClassifyAt(idx) {
      const Ctor = stateCtor('v3');
      const tmpState = new Ctor();
      for (let i = 0; i < idx; i++) {
        const e = this.reviewMoveHistory[i];
        tmpState.applyMove(e.boardIdx * 9 + e.cellIdx);
      }

      this._isAutoClassify = true;
      this.analysisRequestId++;
      const pool = this.workersV3;
      if (pool.length === 0) return;
      const payload = {
        type: 'analyze',
        requestId: this.analysisRequestId,
        state: tmpState.serialize(),
        budgetMs: 2000,
      };
      this._parallelProgress = new Array(pool.length);
      this._parallelFinal = new Array(pool.length);
      const seedBase = (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
      const maxNodesPerWorker = Math.floor(500000 / Math.max(pool.length, 1));
      for (let i = 0; i < pool.length; i++) {
        pool[i].postMessage({
          ...payload,
          workerIndex: i,
          rngSeed: (seedBase + Math.imul(i, 0x9e3779b1)) >>> 0,
          rolloutCap: 52,
          maxNodes: maxNodesPerWorker,
        });
      }
      this._updateClassifyProgress();

      if (idx === this.reviewIndex) {
        this._isAutoClassifyLive = true;
      } else {
        this._isAutoClassifyLive = false;
      }
    }

    _reviewClassifiedMax() {
      if (!this.reviewMoveHistory) return 0;
      if (this._autoClassifyIdx < 0) return this.reviewMoveHistory.length;
      return this._autoClassifyIdx;
    }

    _reviewGoTo(idx) {
      const max = this._reviewClassifiedMax();
      idx = Math.max(0, Math.min(idx, max));
      if (idx === this.reviewIndex) return;
      this.reviewIndex = idx;
      if (this._isAutoClassify) {
        this._isAutoClassifyLive = (this._autoClassifyIdx === idx);
      }
      this._replayToIndex(idx);
      this.render();
      this._updateReviewUI();
      this._showCachedReviewAnalysis();
    }

    _showCachedReviewAnalysis() {
      const idx = this.reviewIndex;
      if (idx >= this.reviewMoveHistory.length) {
        const w = this.state.winner;
        this.currentAnalysis = null;
        this._renderAnalysis(true);
        if (w !== 0) {
          this._setEval(w === 1 ? 1 : w === 2 ? -1 : 0, 1);
          this._setEngineStatus('Game over', '');
        } else {
          this._setEngineStatus('Waiting\u2026', '');
        }
        this._updatePlayedMove();
        this._renderEvalGraph();
        return;
      }
      const entry = this.reviewMoveHistory[idx];
      if (entry._analysis) {
        this.currentAnalysis = entry._analysis;
        this._renderAnalysis(true);
        const mark = (idx < this.reviewMoveHistory.length)
          ? (this.reviewMoveHistory[idx].player === 1 ? 'X' : 'O') : '';
        const cls = entry.classification
          ? entry.classification.charAt(0).toUpperCase() + entry.classification.slice(1)
          : '';
        const moveLabel = cls ? `Move ${idx + 1}: ${mark} ${cls}` : `Move ${idx + 1}`;
        this._setEngineStatus(moveLabel, formatStats(entry._analysis));
      } else {
        this.currentAnalysis = null;
        this._clearMovesList();
        this._setEval(null);
        this._setEngineStatus('Waiting\u2026', '');
      }
      this._updatePlayedMove();
      this._updateTopMovesVisibility();
      this._renderEvalGraph();
    }

    _updateTopMovesVisibility() {
      const section = this.els.panel.querySelector('.top-moves-section');
      if (!section || this.mode !== 'review') return;
      section.style.display = this.state.winner !== 0 ? 'none' : '';
    }

    _updatePlayedMove() {
      const section = this.els.panel.querySelector('.played-move-section');
      const display = this.els.panel.querySelector('.played-move-display');
      if (!section || !display) return;
      const idx = this.reviewIndex;
      if (idx < 0 || idx >= this.reviewMoveHistory.length) {
        section.style.display = 'none';
        return;
      }
      const entry = this.reviewMoveHistory[idx];
      const coord = moveCoord(entry.boardIdx * 9 + entry.cellIdx);
      const mark = entry.player === 1 ? 'X' : 'O';
      const cls = entry.classification;
      const iconSrc = cls ? CLASSIFICATION_ICONS[cls] : null;
      const clsLabel = cls ? cls.charAt(0).toUpperCase() + cls.slice(1) : '';

      let html = `<div class="played-move-number">Move ${idx + 1}</div>`;
      html += `<div class="played-move-row">`;
      html += `<span class="played-move-label">Played:</span> `;
      html += `<img src="media/pieces/${mark}256x256.png" class="played-move-piece" alt="${mark}">`;
      html += `<span class="played-move-coord">${coord}</span>`;
      if (iconSrc) {
        html += `<img src="${iconSrc}" class="played-move-cls-icon" alt="${clsLabel}">`;
        html += `<span class="played-move-cls">${clsLabel}</span>`;
      }
      html += `</div>`;
      display.innerHTML = html;
      section.style.display = '';
    }

    _replayToIndex(idx) {
      this.state.smallX.fill(0);
      this.state.smallO.fill(0);
      this.state.bigState.fill(0);
      this.state.bigX = 0;
      this.state.bigO = 0;
      this.state.bigSettled = 0;
      this.state.activeBoard = -1;
      this.state.toMove = 1;
      this.state.winner = 0;
      this.state.moveCount = 0;
      this.history.length = 0;
      this.lastMove = null;

      for (let i = 0; i < idx; i++) {
        const entry = this.reviewMoveHistory[i];
        const player = this.state.toMove;
        const prevActiveBoard = this.state.activeBoard;
        this.state.applyMove(entry.boardIdx * 9 + entry.cellIdx);
        this.history.push({
          boardIdx: entry.boardIdx, cellIdx: entry.cellIdx, player, prevActiveBoard,
          classification: entry.classification, moveInt: entry.moveInt,
          bookName: entry.bookName, bookDesc: entry.bookDesc,
        });
        this.lastMove = { boardIdx: entry.boardIdx, cellIdx: entry.cellIdx };
      }
    }

    _updateReviewUI() {
      const counter = this.els.panel.querySelector('.move-counter');
      if (counter) counter.textContent = `Move ${this.reviewIndex} / ${this.reviewMoveHistory.length}`;

      const clMax = this._reviewClassifiedMax();
      const startBtn = this.els.panel.querySelector('.btn-review-start');
      const prevBtn = this.els.panel.querySelector('.btn-review-prev');
      const nextBtn = this.els.panel.querySelector('.btn-review-next');
      const endBtn = this.els.panel.querySelector('.btn-review-end');

      if (startBtn) startBtn.disabled = this.reviewIndex === 0;
      if (prevBtn) prevBtn.disabled = this.reviewIndex === 0;
      if (nextBtn) nextBtn.disabled = this.reviewIndex >= clMax;
      if (endBtn) endBtn.disabled = this.reviewIndex >= clMax;
    }

    _showReviewSummary() {
      const summarySection = this.els.panel.querySelector('.review-summary-section');
      const summaryEl = this.els.panel.querySelector('.classification-summary');
      if (!summarySection || !summaryEl) return;

      const xCounts = {};
      const oCounts = {};
      for (const entry of this.reviewMoveHistory) {
        if (entry.classification) {
          const bucket = entry.player === 1 ? xCounts : oCounts;
          bucket[entry.classification] = (bucket[entry.classification] || 0) + 1;
        }
      }

      const hasAny = Object.keys(xCounts).length > 0 || Object.keys(oCounts).length > 0;
      if (!hasAny) {
        summarySection.style.display = 'none';
        return;
      }

      summarySection.style.display = '';
      const order = ['brilliant', 'great', 'best', 'book', 'okay', 'miss', 'inaccuracy', 'mistake', 'blunder'];
      const classifyDone = this._classifyFinished;

      const accuracyWeights = { brilliant: 1, great: 1, best: 1, book: 1, okay: 0.6, miss: 0.4, inaccuracy: 0.2, mistake: 0.1, blunder: 0 };
      const calcAccuracy = (counts) => {
        let total = 0, score = 0;
        for (const cls of order) {
          const n = counts[cls] || 0;
          if (n > 0 && accuracyWeights[cls] !== undefined) {
            total += n;
            score += n * accuracyWeights[cls];
          }
        }
        return total > 0 ? Math.round((score / total) * 100) : -1;
      };

      const dots = () => {
        const n = (Math.floor(Date.now() / 1200) % 3) + 1;
        return '.'.repeat(n);
      };

      const buildColumn = (label, counts) => {
        let html = `<div class="summary-col-header"><img src="media/pieces/${label}256x256.png" class="summary-piece" alt="${label}">Player ${label}</div>`;
        const acc = calcAccuracy(counts);
        if (classifyDone && acc >= 0) {
          html += `<div class="accuracy-box">${acc}%</div>`;
        } else if (!classifyDone) {
          html += `<div class="accuracy-box accuracy-pending">${dots()}</div>`;
        }
        for (const cls of order) {
          if (!counts[cls]) continue;
          html += `<div class="class-item"><img src="${CLASSIFICATION_ICONS[cls]}" alt="${cls}"><span>${cls.charAt(0).toUpperCase() + cls.slice(1)}</span><span class="class-count">${counts[cls]}</span></div>`;
        }
        return html;
      };

      summaryEl.innerHTML =
        `<div class="summary-col">${buildColumn('X', xCounts)}</div>` +
        `<div class="summary-col">${buildColumn('O', oCounts)}</div>`;
    }

    // ── Cleanup ──

    destroy() {
      this.destroyed = true;
      this._abortAnalysis();
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      if (this.workersV2 && this.workersV2.length > 0) {
        for (const w of this.workersV2) w.terminate();
        this.workersV2 = [];
      }
      if (this.workersV3 && this.workersV3.length > 0) {
        for (const w of this.workersV3) w.terminate();
        this.workersV3 = [];
      }
      if (this._reviewKeyHandler) {
        document.removeEventListener('keydown', this._reviewKeyHandler);
        this._reviewKeyHandler = null;
      }
      if (this._accuracyDotsInterval) {
        clearInterval(this._accuracyDotsInterval);
        this._accuracyDotsInterval = null;
      }
      this.container.innerHTML = '';
    }
  }

  window.GameController = GameController;
})();
