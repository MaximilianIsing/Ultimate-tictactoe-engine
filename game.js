'use strict';

(() => {
  const UNLIMITED_BUDGET_MS = Number.MAX_SAFE_INTEGER;

  const REVIEW_CLASSIFY_BUDGET_SEC_KEY = 'uttt-review-classify-budget-sec';

  function getReviewClassifyBudgetMs() {
    try {
      const v = parseFloat(localStorage.getItem(REVIEW_CLASSIFY_BUDGET_SEC_KEY));
      if (Number.isFinite(v) && v >= 0.5 && v <= 5) {
        return Math.round(v * 1000);
      }
    } catch { /* ignore */ }
    return 2000;
  }

  function stateCtor(version) {
    if (version === 'v1') return self.UTTTEngine.UTTTState;
    if (version === 'v3') return self.UTTTEngineV3.UTTTState;
    return self.UTTTEngineV2.UTTTState;
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

  /** JSON-serialize engine analysis for review persistence (localStorage). */
  function serializeReviewAnalysisForStorage(analysis) {
    if (!analysis || !Array.isArray(analysis.topMoves) || analysis.topMoves.length === 0) return null;
    return {
      evaluation: analysis.evaluation != null ? Number(analysis.evaluation) : 0,
      forPlayer: analysis.forPlayer === 2 ? 2 : 1,
      bestMove: analysis.bestMove != null ? analysis.bestMove : null,
      topMoves: analysis.topMoves.slice(0, 10).map(tm => ({
        move: tm.move,
        visits: tm.visits != null ? tm.visits | 0 : 0,
        winRate: tm.winRate != null ? Number(tm.winRate) : 0,
      })),
      simulations: analysis.simulations != null ? analysis.simulations | 0 : 0,
      elapsedMs: analysis.elapsedMs != null ? analysis.elapsedMs | 0 : 0,
      legalMoveCount: analysis.legalMoveCount != null ? analysis.legalMoveCount | 0 : analysis.topMoves.length,
      parallelWorkers: analysis.parallelWorkers != null ? analysis.parallelWorkers | 0 : undefined,
    };
  }

  function parseReviewAnalysisFromStorage(snap) {
    if (!snap || typeof snap !== 'object' || !Array.isArray(snap.topMoves) || snap.topMoves.length === 0) {
      return null;
    }
    return {
      evaluation: snap.evaluation != null ? Number(snap.evaluation) : 0,
      forPlayer: snap.forPlayer === 2 ? 2 : 1,
      bestMove: snap.bestMove != null ? snap.bestMove : null,
      topMoves: snap.topMoves.map(tm => ({
        move: tm.move,
        visits: tm.visits != null ? tm.visits | 0 : 0,
        winRate: tm.winRate != null ? Number(tm.winRate) : 0,
      })),
      simulations: snap.simulations != null ? snap.simulations | 0 : 0,
      elapsedMs: snap.elapsedMs != null ? snap.elapsedMs | 0 : 0,
      legalMoveCount: snap.legalMoveCount != null ? snap.legalMoveCount | 0 : snap.topMoves.length,
      parallelWorkers: snap.parallelWorkers != null ? snap.parallelWorkers | 0 : undefined,
      done: true,
    };
  }

  /** Skip auto-classify only when real top lines exist (book/classified moves must still run MCTS). */
  function reviewEntryHasEngineLines(entry) {
    const a = entry && entry._analysis;
    return !!(a && Array.isArray(a.topMoves) && a.topMoves.length > 0);
  }

  const TIME_CONTROL_PRESETS = {
    bullet: { id: 'bullet', msPerSide: 120000, label: 'Bullet', desc: '2 min each' },
    blitz: { id: 'blitz', msPerSide: 300000, label: 'Blitz', desc: '5 min each' },
    rapid: { id: 'rapid', msPerSide: 600000, label: 'Rapid', desc: '10 min each' },
    unlimited: { id: 'unlimited', msPerSide: 0, label: 'Unlimited', desc: 'No clock' },
  };

  function normalizeTimeControlId(raw) {
    const k = String(raw || '').toLowerCase();
    return TIME_CONTROL_PRESETS[k] ? k : 'unlimited';
  }

  function formatClockMs(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const LABEL_TO_IDX = { TL: 0, T: 1, TR: 2, L: 3, C: 4, R: 5, BL: 6, B: 7, BR: 8 };
  const IDX_TO_LABEL = ['TL', 'T', 'TR', 'L', 'C', 'R', 'BL', 'B', 'BR'];

  function parseMoveLabel(label) {
    const [board, cell] = label.split(':');
    return LABEL_TO_IDX[board] * 9 + LABEL_TO_IDX[cell];
  }

  /** Bots config; edit bots.json (openingMoves use META:LOCAL like "C:C", same as opening book notation). */
  function parseBotsPayload(data) {
    const rows = Array.isArray(data?.bots) ? data.bots : Array.isArray(data) ? data : [];
    return rows.map(row => ({
      id: String(row.id || ''),
      name: String(row.name || ''),
      tier: String(row.tier || ''),
      tierIcon: String(row.tierIcon || ''),
      budgetMs: Number(row.budgetMs) || 0,
      pickFromTop: Math.max(1, Number(row.pickFromTop) || 1),
      blunderChance: Number(row.blunderChance) || 0,
      uniformPick: !!row.uniformPick,
      avatar: String(row.avatar || ''),
      openingMoves: Array.isArray(row.openingMoves)
        ? row.openingMoves.map(m =>
            typeof m === 'number' && Number.isFinite(m) ? (m | 0) : parseMoveLabel(String(m).trim()))
        : [],
    }));
  }

  function loadBotsSync() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'bots.json', false);
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
        const parsed = parseBotsPayload(JSON.parse(xhr.responseText));
        if (parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return null;
  }

  let BOTS = loadBotsSync();
  if (!BOTS || BOTS.length === 0) {
    console.warn('[UTTT] bots.json missing or invalid; using fallback bot list.');
    BOTS = parseBotsPayload({
      bots: [
        {
          id: 'adrian',
          name: 'Adrian',
          tier: 'Hard',
          tierIcon: 'media/difficulties/Hard.png',
          budgetMs: 250,
          pickFromTop: 3,
          avatar: 'media/bots/Adrian.png',
          openingMoves: ['BR:R', 'BL:L'],
        },
      ],
    });
  }

  const BOT_MAP = {};
  for (const b of BOTS) BOT_MAP[b.id] = b;

  function moveCoord(move) {
    const b = (move / 9) | 0;
    const c = move - b * 9;
    return `${IDX_TO_LABEL[b]} \u00B7 ${IDX_TO_LABEL[c]}`;
  }

  const FIRST_MOVE_ANALYSIS = {
    bestMove: 40,
    evaluation: 0.15,
    forPlayer: 1,
    done: true,
    simulations: 17760000,
    elapsedMs: 34500,
    parallelWorkers: 4,
    legalMoveCount: 81,
    topMoves: [
      { move: 40, visits: 17360000, winRate: 0.575 },
      { move: 42, visits: 15400,    winRate: 0.553 },
      { move: 37, visits: 14600,    winRate: 0.564 },
      { move: 38, visits: 12900,    winRate: 0.558 },
      { move: 44, visits: 12100,    winRate: 0.558 },
    ],
  };

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
      if (ok && (!bestMatch || line.moves.length < bestMatch.moves.length)) {
        bestMatch = line;
      }
    }
    return bestMatch;
  }

  const CLASSIFICATION_ICONS = {
    brilliant: 'media/classifications/Brilliant.png',
    great: 'media/classifications/Great.png',
    best: 'media/classifications/Best.png',
    forced: 'media/classifications/Forced.png',
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
    if (preMoveAnalysis.forced) return 'forced';
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
    if (result.restored && (!result.topMoves || result.topMoves.length === 0)) return 'Saved review';
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
      this.botConfig = BOT_MAP[options.botId] || BOT_MAP['adrian'];
      this.onBotChanged = typeof options.onBotChanged === 'function' ? options.onBotChanged : null;
      this.onlineManager = options.onlineManager || null;
      this.onGameOver = options.onGameOver || null;
      this.onMoveApplied = options.onMoveApplied || null;
      this.onReviewClassifyComplete = options.onReviewClassifyComplete || null;
      this.reviewStorageRecordId = options.reviewStorageRecordId != null ? options.reviewStorageRecordId : null;
      this.reviewSkipAutoClassify = options.reviewSkipAutoClassify === true;
      this.reviewFastMode = options.reviewFastMode !== false;
      this.reviewMoveHistory = options.reviewHistory || null;
      this.reviewInitialIndex = options.reviewInitialIndex != null ? options.reviewInitialIndex | 0 : 0;
      this.onReviewPersist = typeof options.onReviewPersist === 'function' ? options.onReviewPersist : null;
      this.initialAnalysisHistory = options.initialAnalysisHistory || null;
      this.initialAnalysisState = options.initialAnalysisState || null;
      this.engineVersion = 'v3';

      const Ctor = stateCtor(this.engineVersion);
      this.state = new Ctor();
      this.history = [];
      this.analysisFreePlayBaseline = null;
      this.lastMove = null;
      this.cellEls = [];
      this.smallEls = [];
      this.currentAnalysis = null;
      this.analysisRequestId = 0;
      this.hoveredMove = null;
      this.forceShowAnalysis = false;
      this.thinkingBudgetMs = 5000;
      this.destroyed = false;
      this._aiWaitingToStart = this.mode === 'ai';
      this.reviewIndex = 0;
      this.onlineReady = this.mode !== 'online';
      this.timeControlId = normalizeTimeControlId(options.timeControl);
      const tcp = TIME_CONTROL_PRESETS[this.timeControlId] || TIME_CONTROL_PRESETS.unlimited;
      this._clockMsPerSide = tcp.msPerSide;
      this._clockBankX = 0;
      this._clockBankO = 0;
      this._clockActiveSide = 1;
      this._clockAnchorTime = 0;
      this._clockRafId = null;
      this.workersV2 = [];
      this.workersV3 = [];

      loadBookMoves();
      this._buildDOM();
      this._setupWorker();
      this._setupEvents();

      if (this.mode === 'online' && this.onlineManager) {
        this._setupOnline();
      }

      if (this.mode === 'local' || this.mode === 'online') {
        this._onVisibilityChange = () => {
          if (this.destroyed || document.visibilityState !== 'visible') return;
          if (!this._clockEnabled() || this.state.winner !== 0) return;
          if (!this._shouldRunClock()) {
            this._updateClockDisplay();
            return;
          }
          const cur = this._remainingMsActivePlayer();
          if (cur <= 0) {
            this._commitActiveClockBank();
            this._updateClockDisplay();
            this._onTimeForfeit(this._clockActiveSide);
          } else {
            this._updateClockDisplay();
          }
        };
        document.addEventListener('visibilitychange', this._onVisibilityChange);
      }

      if (this.mode === 'review' && this.reviewMoveHistory) {
        this._initReview();
      } else if (this.mode === 'analysis' && this.initialAnalysisHistory && this.initialAnalysisHistory.length > 0) {
        this._bootstrapAnalysisFromHistory(this.initialAnalysisHistory);
      } else if (this.mode === 'analysis' && this.initialAnalysisState) {
        this._loadAnalysisState(this.initialAnalysisState);
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
          <div class="clock-row hidden" aria-live="polite">
            <div class="clock-preset-label">
              <span class="clock-preset-icon time-icon time-icon--unlimited time-icon--clock" aria-hidden="true"></span>
              <span class="clock-preset-details"></span>
            </div>
            <div class="clock-pair">
              <div class="game-clock" data-clock-player="1">
                <span class="game-clock-mark">X</span>
                <span class="game-clock-time">\u2014</span>
              </div>
              <div class="game-clock" data-clock-player="2">
                <span class="game-clock-mark">O</span>
                <span class="game-clock-time">\u2014</span>
              </div>
            </div>
          </div>
          <div class="game-status-main">
            <div class="turn-indicator">
              <span class="game-move-num" aria-live="polite"></span>
              <span class="turn-label">Turn:</span>
              <span class="turn-mark" data-mark="X">X</span>
            </div>
            <div class="book-label hidden"></div>
            <div class="status-buttons">
              <button class="btn-secondary btn-undo" title="Undo last move">Undo</button>
              <button class="btn-secondary btn-reset">New Game</button>
            </div>
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
        clockRow: boardCol.querySelector('.clock-row'),
        clockPresetIcon: boardCol.querySelector('.clock-preset-icon'),
        clockPresetDetails: boardCol.querySelector('.clock-preset-details'),
        turnMark: boardCol.querySelector('.turn-mark'),
        moveNumEl: boardCol.querySelector('.game-move-num'),
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

    _buildPanel(panel) {
      panel.innerHTML = '';

      if (this.mode === 'ai') {
        const botCards = BOTS.map(b => `
          <button class="bot-card${b.id === this.botConfig.id ? ' is-active' : ''}" data-bot="${b.id}">
            <img class="bot-avatar" src="${b.avatar}" alt="${b.name}" draggable="false">
            <span class="bot-name">${b.name}</span>
            <span class="bot-tier"><img class="bot-tier-icon" src="${b.tierIcon}" alt="" draggable="false">${b.tier}</span>
          </button>`).join('');
        panel.innerHTML += `
          <div class="panel-section">
            <div class="panel-section-title">Opponent</div>
            <div class="bot-grid">${botCards}</div>
          </div>
          <div class="panel-section side-picker-section">
            <div class="panel-section-title">Play as</div>
            <div class="segmented cols-2 side-picker" role="radiogroup">
              <button class="seg-btn${this.humanSide === 'x' ? ' is-active' : ''}" data-side="x" data-mark="X" role="radio">X \u2014 first</button>
              <button class="seg-btn${this.humanSide === 'o' ? ' is-active' : ''}" data-side="o" data-mark="O" role="radio">O \u2014 second</button>
            </div>
          </div>
          <div class="panel-section ai-start-section">
            <button class="btn-primary ai-start-btn">Start</button>
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
            <div class="bot-status-header">
              <img class="bot-status-avatar" src="${this.botConfig.avatar}" alt="${this.botConfig.name}" draggable="false">
              <span class="bot-status-name">${this.botConfig.name}</span>
            </div>
            <div class="status-line">Your move</div>
            <div class="status-stats">\u2014</div>
          </div>`;
      }

      if (this.mode === 'local') {
        const tcCards = ['bullet', 'blitz', 'rapid', 'unlimited'].map(id => {
          const p = TIME_CONTROL_PRESETS[id];
          const active = id === this.timeControlId ? ' is-active' : '';
          return `
            <button type="button" class="time-control-card${active}" data-time="${id}">
              <span class="time-icon time-icon--${id} time-icon--panel" aria-hidden="true"></span>
              <span class="time-control-card-name">${p.label}</span>
              <span class="time-control-card-desc">${p.desc}</span>
            </button>`;
        }).join('');
        panel.innerHTML += `
          <div class="panel-section">
            <div class="panel-section-title">Time control</div>
            <div class="time-control-cards">
              ${tcCards}
            </div>
          </div>
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
          const w = new Worker('engines/workerv2.js');
          w.addEventListener('message', (e) => this._onWorkerMessageParallel(e));
          this.workersV2.push(w);
        }
      };

      const attachV3Pool = () => {
        for (let i = 0; i < nParallel; i++) {
          const w = new Worker('engines/workerv3.js');
          w.addEventListener('message', (e) => this._onWorkerMessageParallel(e));
          this.workersV3.push(w);
        }
      };

      if (this.mode === 'review') {
        attachV3Pool();
      } else if (this.engineVersion === 'v3') {
        attachV3Pool();
      } else if (this.engineVersion === 'v2') {
        attachV2Pool();
      } else {
        this.worker = new Worker('engines/worker.js');
        this.worker.addEventListener('message', (e) => this._onWorkerMessage(e));
      }
    }

    _parallelEngineForTurn() {
      const side = this.engineVersion;
      return side === 'v2' || side === 'v3' ? side : null;
    }

    _parallelPoolForKind(kind) {
      return kind === 'v3' ? this.workersV3 : this.workersV2;
    }

    _onWorkerMessageParallel(e) {
      const msg = e.data;
      if (!msg || this.destroyed) return;

      // Fast pipeline: worker pairs per move
      if (this.mode === 'review' && this._isAutoClassify && this.reviewFastMode && this._workerMoveMap && this._workerMoveMap.size > 0) {
        if (msg.requestId !== this.analysisRequestId) return;
        if (msg.type === 'progress') {
          if (this._isAutoClassifyLive && this._workerMoveMap.get(msg.workerIndex) === this.reviewIndex) {
            this.currentAnalysis = msg.result;
            this._renderAnalysis(false);
          }
          return;
        }
        if (msg.type === 'result') {
          this._onPipelineWorkerResult(msg.workerIndex, msg.result);
        }
        return;
      }

      // Thorough mode: all workers on one move — merge and advance
      if (this.mode === 'review' && this._isAutoClassify && !this.reviewFastMode) {
        if (msg.requestId !== this.analysisRequestId) return;
        const poolLen = this._parallelProgress.length;
        if (poolLen === 0 || msg.workerIndex < 0 || msg.workerIndex >= poolLen) return;

        if (msg.type === 'progress') {
          this._parallelProgress[msg.workerIndex] = msg.result;
          if (this._isAutoClassifyLive) {
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
          if (this._isAutoClassifyLive) {
            this.currentAnalysis = merged;
            this._renderAnalysis(true);
          }
          this._onThoroughResult(merged);
          return;
        }
        return;
      }

      // Deep analysis after classification
      if (this.mode === 'review' && this._reviewDeepIdx != null) {
        if (msg.requestId !== this.analysisRequestId) return;
        const poolLen = this._parallelProgress.length;
        if (poolLen === 0 || msg.workerIndex < 0 || msg.workerIndex >= poolLen) return;
        const baseSims = this._reviewDeepBaseSims || 0;

        if (msg.type === 'progress') {
          this._parallelProgress[msg.workerIndex] = msg.result;
          const merged = mergeParallelProgress(this._parallelProgress);
          if (merged && (merged.simulations || 0) > baseSims) {
            this.currentAnalysis = merged;
            this._renderAnalysis(false);
            this._setEngineStatus('Deep analysis\u2026', formatStats(merged));
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
          if (merged && (merged.simulations || 0) > baseSims) {
            this.currentAnalysis = merged;
            this._renderAnalysis(true);
            const idx = this._reviewDeepIdx;
            const entry = this.reviewMoveHistory[idx];
            const mark = entry ? (entry.player === 1 ? 'X' : 'O') : '';
            const cls = entry && entry.classification
              ? entry.classification.charAt(0).toUpperCase() + entry.classification.slice(1) : '';
            const moveLabel = cls ? `Move ${idx + 1}: ${mark} ${cls}` : `Move ${idx + 1}`;
            this._setEngineStatus(moveLabel, formatStats(merged));
          }
          this._reviewDeepIdx = null;
          return;
        }
        return;
      }

      if (msg.requestId !== this.analysisRequestId) return;
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
      if (this.mode === 'ai') return this.botConfig.budgetMs || 500;
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

      if (this.mode === 'ai') {
        const botCards = this.els.panel.querySelectorAll('.bot-card');
        botCards.forEach(card => {
          card.addEventListener('click', () => {
            const newBot = BOT_MAP[card.dataset.bot];
            if (!newBot || newBot.id === this.botConfig.id) return;
            this.botConfig = newBot;
            botCards.forEach(c => c.classList.toggle('is-active', c === card));
            const avatarEl = this.els.panel.querySelector('.bot-status-avatar');
            const nameEl = this.els.panel.querySelector('.bot-status-name');
            if (avatarEl) { avatarEl.src = newBot.avatar; avatarEl.alt = newBot.name; }
            if (nameEl) nameEl.textContent = newBot.name;
            if (this.onBotChanged) this.onBotChanged(newBot.id);
            this.reset();
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

        const startBtn = this.els.panel.querySelector('.ai-start-btn');
        if (startBtn) {
          startBtn.addEventListener('click', () => {
            if (!this._aiWaitingToStart) return;
            this._aiWaitingToStart = false;
            const startSection = this.els.panel.querySelector('.ai-start-section');
            if (startSection) startSection.style.display = 'none';
            this._afterMove();
          });
        }
      }

      if (this.mode === 'local') {
        const tcCards = this.els.panel.querySelectorAll('.time-control-card');
        tcCards.forEach(card => {
          card.addEventListener('click', () => {
            const tc = card.dataset.time;
            if (!tc || tc === this.timeControlId) return;
            this.timeControlId = normalizeTimeControlId(tc);
            this._clockMsPerSide = (TIME_CONTROL_PRESETS[this.timeControlId] || TIME_CONTROL_PRESETS.unlimited).msPerSide;
            tcCards.forEach(c => c.classList.toggle('is-active', c.dataset.time === this.timeControlId));
            this.reset();
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

    _remainingMsForSide(side) {
      if (!this._clockMsPerSide) return 0;
      let ms = side === 1 ? this._clockBankX : this._clockBankO;
      if (this._shouldRunClock() && side === this._clockActiveSide) {
        const elapsed = performance.now() - this._clockAnchorTime;
        ms = Math.max(0, ms - elapsed);
      }
      return ms;
    }

    _remainingMsActivePlayer() {
      return this._remainingMsForSide(this._clockActiveSide);
    }

    _commitActiveClockBank() {
      if (!this._clockMsPerSide || !this._clockEnabled()) return;
      const now = performance.now();
      const elapsed = now - this._clockAnchorTime;
      if (this._clockActiveSide === 1) this._clockBankX = Math.max(0, this._clockBankX - elapsed);
      else if (this._clockActiveSide === 2) this._clockBankO = Math.max(0, this._clockBankO - elapsed);
      this._clockAnchorTime = now;
    }

    // ── Clocks ──

    _clockEnabled() {
      return (this.mode === 'local' || this.mode === 'online') && this._clockMsPerSide > 0;
    }

    _shouldRunClock() {
      return this._clockEnabled() && this.state.winner === 0 &&
        (this.mode === 'local' || (this.mode === 'online' && this.onlineReady)) &&
        (this.mode !== 'online' || this.history.length > 0);
    }

    _refreshClockRow() {
      const row = this.els.clockRow;
      if (!row) return;
      const show = this._clockEnabled();
      row.classList.toggle('hidden', !show);
      if (!show) {
        this._stopClockLoop();
        return;
      }
      const preset = TIME_CONTROL_PRESETS[this.timeControlId] || TIME_CONTROL_PRESETS.unlimited;
      if (this.els.clockPresetIcon) {
        const id = normalizeTimeControlId(this.timeControlId);
        this.els.clockPresetIcon.className =
          `clock-preset-icon time-icon time-icon--${id} time-icon--clock`;
      }
      if (this.els.clockPresetDetails) {
        this.els.clockPresetDetails.textContent = `${preset.label} \u00B7 ${preset.desc}`;
      }
      this._updateClockDisplay();
    }

    _updateClockActiveClass() {
      if (!this.els.clockRow) return;
      for (const el of this.els.clockRow.querySelectorAll('.game-clock')) {
        const p = Number(el.dataset.clockPlayer);
        el.classList.toggle(
          'clock-active',
          this._shouldRunClock() && p === this._clockActiveSide,
        );
      }
    }

    _updateClockDisplay() {
      if (!this._clockEnabled()) return;
      const xEl = this.els.clockRow.querySelector('.game-clock[data-clock-player="1"] .game-clock-time');
      const oEl = this.els.clockRow.querySelector('.game-clock[data-clock-player="2"] .game-clock-time');
      if (xEl) xEl.textContent = formatClockMs(this._remainingMsForSide(1));
      if (oEl) oEl.textContent = formatClockMs(this._remainingMsForSide(2));
      this._updateClockActiveClass();
    }

    _resetClockTimesFromPreset() {
      if (!this._clockMsPerSide) return;
      this._clockBankX = this._clockMsPerSide;
      this._clockBankO = this._clockMsPerSide;
      this._clockActiveSide = this.state.toMove;
      this._clockAnchorTime = performance.now();
      this._updateClockDisplay();
    }

    _syncClockActiveSide() {
      if (!this._clockEnabled()) return;
      const next = this.state.toMove;
      if (next !== this._clockActiveSide) {
        const skipBurn =
          this.mode === 'online' &&
          this.history.length === 1 &&
          this.state.moveCount === 1;
        if (!skipBurn) this._commitActiveClockBank();
        this._clockActiveSide = next;
        this._clockAnchorTime = performance.now();
      }
      this._updateClockActiveClass();
    }

    _stopClockLoop() {
      if (this._clockRafId != null) {
        cancelAnimationFrame(this._clockRafId);
        this._clockRafId = null;
      }
    }

    _startClockLoop() {
      if (this.destroyed || !this._shouldRunClock()) return;
      if (this._clockRafId != null) return;
      const tick = () => {
        this._clockRafId = null;
        if (this.destroyed || !this._shouldRunClock()) return;
        const cur = this._remainingMsActivePlayer();
        if (cur <= 0) {
          this._commitActiveClockBank();
          this._updateClockDisplay();
          this._onTimeForfeit(this._clockActiveSide);
          return;
        }
        this._updateClockDisplay();
        this._clockRafId = requestAnimationFrame(tick);
      };
      this._clockRafId = requestAnimationFrame(tick);
    }

    _onTimeForfeit(loserPlayer) {
      this._stopClockLoop();
      if (this.state.winner !== 0) return;
      const winner = loserPlayer === 1 ? 2 : 1;
      this.state.winner = winner;
      this.render();
      this._showWinner(winner);
      this._setEngineStatus('Game over', '');
      this._clearMovesList();
      const finalEval = winner === 1 ? 1 : winner === 2 ? -1 : 0;
      this._setEval(finalEval, 1);
      if (this.onGameOver) this.onGameOver(this.state.winner, this.history);
    }

    applyOnlineTimeControl(id) {
      this.timeControlId = normalizeTimeControlId(id);
      this._clockMsPerSide = (TIME_CONTROL_PRESETS[this.timeControlId] || TIME_CONTROL_PRESETS.unlimited).msPerSide;
      this._resetClockTimesFromPreset();
      this._refreshClockRow();
      this._stopClockLoop();
      if (this._shouldRunClock()) this._startClockLoop();
    }

    // ── Online ──

    _setupOnline() {
      const om = this.onlineManager;
      const dot = this.els.panel.querySelector('.connection-dot');
      const text = this.els.panel.querySelector('.connection-text');
      const codeDisplay = this.els.panel.querySelector('.room-code-display');
      const linkInput = this.els.panel.querySelector('.share-link-input');

      om.onRoomCreated = (room, side, timeControl) => {
        if (side === 'x' || side === 'o') {
          this.humanSide = side;
        }
        if (timeControl != null && String(timeControl).trim() !== '') {
          this.applyOnlineTimeControl(timeControl);
        } else {
          this._refreshClockRow();
        }
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

      om.onJoined = (room, side, timeControl) => {
        this.humanSide = side;
        this.onlineReady = true;
        if (dot) { dot.className = 'connection-dot connected'; }
        if (text) { text.textContent = `Joined as ${side.toUpperCase()}`; }
        this.applyOnlineTimeControl(
          timeControl != null && String(timeControl).trim() !== '' ? timeControl : 'unlimited',
        );
        this.render();
        if (this._shouldRunClock()) this._startClockLoop();
      };

      om.onOpponentJoined = (sideFromServer) => {
        if (sideFromServer === 'x' || sideFromServer === 'o') {
          this.humanSide = sideFromServer;
        }
        this.onlineReady = true;
        if (this._clockMsPerSide > 0) this._clockAnchorTime = performance.now();
        if (dot) { dot.className = 'connection-dot connected'; }
        if (text) {
          const mark = this.humanSide === 'x' ? 'X' : 'O';
          text.textContent = `Opponent connected! You are ${mark}.`;
        }
        this.render();
        if (this._shouldRunClock()) this._startClockLoop();
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
        this._stopClockLoop();
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
      if (this._aiWaitingToStart) return false;
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
      if (this.mode === 'ai') return this._isBotTurn();
      return false;
    }

    _shouldShowAnalysisUI() {
      if (this.forceShowAnalysis) return true;
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
      this._stopClockLoop();
      this.hoveredMove = null;
      this.currentAnalysis = null;
      this.forceShowAnalysis = false;
      this.render();

      if (this.onMoveApplied) this.onMoveApplied(this.history);

      if (this.state.winner !== 0) {
        if (this._clockEnabled()) this._commitActiveClockBank();
        this._showWinner(this.state.winner);
        this._setEngineStatus('Game over', '');
        this._clearMovesList();
        const finalEval = this.state.winner === 1 ? 1 : this.state.winner === 2 ? -1 : 0;
        this._setEval(finalEval, 1);
        if (this.onGameOver) this.onGameOver(this.state.winner, this.history);
        return;
      }

      this._syncClockActiveSide();
      if (this._shouldRunClock()) this._startClockLoop();

      if (this.mode === 'ai' && this._aiWaitingToStart) {
        this._setEngineStatus('Waiting to start', '');
        return;
      }

      if (this.mode === 'ai' && this._isBotTurn()) {
        const bot = this.botConfig;
        const botName = bot ? bot.name : 'Bot';

        if (bot && bot.budgetMs === 0) {
          const legal = this.state.legalMoves();
          if (legal.length > 0) {
            const m = legal[Math.floor(Math.random() * legal.length)];
            setTimeout(() => {
              if (this.destroyed || this.state.winner !== 0) return;
              const bb = (m / 9) | 0, cc = m - bb * 9;
              if (this._isLegalMove(bb, cc)) {
                this._applyMove(bb, cc, null);
                this._afterMove();
              }
            }, 800);
            this._setEngineStatus(`${botName} is thinking\u2026`, '');
          }
          return;
        }

        if (bot && bot.openingMoves.length > 0 && this.history.length === 0 && this.humanSide === 'o') {
          const picks = bot.openingMoves;
          const m = picks[Math.floor(Math.random() * picks.length)];
          setTimeout(() => {
            if (this.destroyed || this.state.winner !== 0) return;
            const bb = (m / 9) | 0, cc = m - bb * 9;
            if (this._isLegalMove(bb, cc)) {
              this._applyMove(bb, cc, null);
              this._afterMove();
            }
          }, 800);
          this._setEngineStatus(`${botName} is thinking\u2026`, '');
          return;
        }

        this._botThinkStart = performance.now();
        this._setEngineStatus(`${botName} is thinking\u2026`, '');
      } else if (!this._shouldShowAnalysisUI()) {
        this._setEngineStatus('Your move', '');
      }

      if (this._shouldAutoAnalyze()) {
        this._startAnalysis();
      }
    }

    _afterSideChange() {
      if (this.state.winner !== 0) {
        this.render();
        return;
      }
      this.render();
      if (this._isBotTurn()) {
        this._abortAnalysis();
        this.currentAnalysis = null;
        this._afterMove();
      } else {
        if (!this._shouldShowAnalysisUI()) {
          this._setEngineStatus('Your move', '');
        }
      }
    }

    _onAnalysisComplete(result) {
      if (this.mode === 'review' && this.reviewMoveHistory && this._isAutoClassify) {
        return;
      }

      if (this.state.winner !== 0) return;

      if (this._isBotTurn() && result.bestMove != null) {
        const m = this._pickBotMove(result);
        const b = (m / 9) | 0;
        const c = m - b * 9;
        const MIN_BOT_DELAY = 800;
        const elapsed = this._botThinkStart ? performance.now() - this._botThinkStart : Infinity;
        const remaining = Math.max(0, MIN_BOT_DELAY - elapsed);
        const playMove = () => {
          if (this.destroyed || this.state.winner !== 0) return;
          if (this._isLegalMove(b, c)) {
            const preMoveAnalysis = this.currentAnalysis;
            this._applyMove(b, c, preMoveAnalysis);
            this._afterMove();
          }
        };
        if (remaining > 0) {
          setTimeout(playMove, remaining);
        } else {
          playMove();
        }
      }
    }

    _pickBotMove(result) {
      const bot = this.botConfig;
      if (!bot || bot.pickFromTop <= 1) return result.bestMove;
      const top = result.topMoves;
      if (!top || top.length <= 1) return result.bestMove;

      // Blunder: pick a completely random legal move from the full list
      if (bot.blunderChance && Math.random() < bot.blunderChance) {
        const allMoves = top.length > 0 ? top : [{ move: result.bestMove }];
        return allMoves[Math.floor(Math.random() * allMoves.length)].move;
      }

      const candidates = top.slice(0, Math.min(bot.pickFromTop, top.length));

      // Uniform weighting: pick equally among top-N (ignores visit counts)
      if (bot.uniformPick) {
        return candidates[Math.floor(Math.random() * candidates.length)].move;
      }

      const totalVisits = candidates.reduce((s, m) => s + (m.visits || 0), 0);
      if (totalVisits <= 0) return result.bestMove;
      const r = Math.random() * totalVisits;
      let acc = 0;
      for (const c of candidates) {
        acc += c.visits || 0;
        if (r < acc) return c.move;
      }
      return result.bestMove;
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
      if (this.onReviewPersist && this.reviewMoveHistory && !this.reviewSkipAutoClassify) {
        try {
          this.onReviewPersist(this.reviewIndex, this.reviewMoveHistory, true);
        } catch { /* ignore */ }
      }
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

      if (this.els.moveNumEl) {
        if (this.mode === 'review') {
          this.els.moveNumEl.textContent = '';
          this.els.moveNumEl.hidden = true;
        } else {
          this.els.moveNumEl.hidden = false;
          const n = this.state.winner === 0 ? this.state.moveCount + 1 : this.state.moveCount;
          this.els.moveNumEl.textContent = `Move ${n}`;
        }
      }

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

      if (this.els.clockRow && (this.mode === 'local' || this.mode === 'online')) {
        this.els.clockRow.classList.toggle('hidden', !this._clockEnabled());
      }
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
          } else {
            label = this._isHumanTurn() ? 'Your move' : 'Engine ready';
          }
        } else if (this.mode === 'review' && this._isAutoClassifyLive) {
          label = `Analyzing move ${(this._autoClassifyIdx || 0) + 1}\u2026`;
        } else {
          label = 'Engine thinking\u2026';
        }
        this._setEngineStatus(label, formatStats(this.currentAnalysis));
      }
      this._updateButtonStates();
    }

    _updateButtonStates() {
      this.els.undoBtn.disabled = this.history.length === 0 || this.mode === 'review';
      this.els.resetBtn.disabled = this.mode === 'review';

      const analyzeBtn = this.els.panel.querySelector('.btn-analyze');
      const engineMoveBtn = this.els.panel.querySelector('.btn-engine-move');
      if (analyzeBtn) analyzeBtn.disabled = this.state.winner !== 0;
      if (engineMoveBtn) {
        engineMoveBtn.disabled = this.state.winner !== 0 || !this.currentAnalysis || this.currentAnalysis.bestMove == null;
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
      if (!this._classifyFinished && this._classifyStarted && total > 0) {
        section.style.display = '';
        let done = 0;
        for (let i = 0; i < total; i++) {
          if (reviewEntryHasEngineLines(this.reviewMoveHistory[i]) || this.reviewMoveHistory[i].classification) done++;
        }
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
      const aiPlayer = this.mode === 'ai'
        ? (this.humanSide === 'x' ? 2 : 1)
        : null;
      for (const entry of this.history) {
        if (!entry.classification) continue;
        if (entry.classification === 'book' && this.mode !== 'review' && this.mode !== 'analysis') continue;
        if (aiPlayer != null && entry.player === aiPlayer) continue;
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

    _isTiebreakWin(winner) {
      if (winner !== 1 && winner !== 2) return false;
      const bigMask = winner === 1 ? this.state.bigX : this.state.bigO;
      const lines = [0b000000111, 0b000111000, 0b111000000,
                     0b001001001, 0b010010010, 0b100100100,
                     0b100010001, 0b001010100];
      for (const line of lines) {
        if ((bigMask & line) === line) return false;
      }
      return true;
    }

    _showWinner(winner) {
      const ch = winner === 1 ? 'X' : winner === 2 ? 'O' : '-';
      const tiebreak = this._isTiebreakWin(winner);
      if (ch === '-') {
        this.els.winnerMark.textContent = 'Tie';
      } else {
        this.els.winnerMark.innerHTML = `<img src="media/pieces/${ch}256x256.png" class="winner-piece" alt="${ch}">`;
      }
      this.els.winnerMark.dataset.mark = ch;
      if (ch === '-') {
        this.els.winnerText.textContent = "It's a tie!";
      } else if (tiebreak) {
        this.els.winnerText.textContent = `Player ${ch} wins by tiebreak!`;
      } else {
        this.els.winnerText.textContent = `Player ${ch} wins!`;
      }

      this.els.winnerButtons.innerHTML = '';
      const playAgainBtn = document.createElement('button');
      playAgainBtn.className = 'btn-secondary';
      playAgainBtn.textContent = 'Play Again';
      playAgainBtn.addEventListener('click', () => this.reset());
      this.els.winnerButtons.appendChild(playAgainBtn);

      if (this.mode === 'ai' || this.mode === 'local' || this.mode === 'online') {
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
      this.analysisFreePlayBaseline = null;
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

    _loadAnalysisState(serialized) {
      this._abortAnalysis();
      const Ctor = stateCtor(this.engineVersion);
      this.state = Ctor.deserialize(serialized);
      this.analysisFreePlayBaseline = JSON.parse(JSON.stringify(serialized));
      this.history.length = 0;
      this.lastMove = null;
      this.currentAnalysis = null;
      this.hoveredMove = null;
      this.forceShowAnalysis = false;
      this.els.winnerOverlay.classList.add('hidden');
      this.render();
      this._afterMove();
    }

    reset() {
      this._abortAnalysis();
      this.analysisFreePlayBaseline = null;
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
      if (this.mode === 'ai') {
        this._aiWaitingToStart = true;
        const startSection = this.els.panel.querySelector('.ai-start-section');
        if (startSection) startSection.style.display = '';
      }
      this._refreshClockRow();
      this._resetClockTimesFromPreset();
      this._afterMove();
    }

    undo() {
      if (this.history.length === 0) return;
      if (this.mode === 'online' || this.mode === 'review') return;
      if (this.mode === 'local' && this._clockMsPerSide > 0) return;
      this._abortAnalysis();
      const oldEntries = this.history.slice(0, -1);
      const Ctor = stateCtor(this.engineVersion);

      if (this.mode === 'analysis' && this.analysisFreePlayBaseline != null) {
        this.state = Ctor.deserialize(JSON.parse(JSON.stringify(this.analysisFreePlayBaseline)));
      } else {
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
      }

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
      this.reviewIndex = -1;
      this._autoClassifyIdx = -1;
      this._classifyStarted = false;
      this._classifyFinished = false;
      this._isAutoClassify = false;
      this._isAutoClassifyLive = false;
      this._reviewCompleteCallbackDone = false;

      const wantIdx = Math.max(0, Math.min(this.reviewInitialIndex | 0,
        this.reviewMoveHistory ? this.reviewMoveHistory.length : 0));

      if (this.reviewSkipAutoClassify) {
        this._classifyStarted = true;
        this._classifyFinished = true;
        this._reviewGoTo(wantIdx);
        this._showReviewSummary();
        this._renderEvalGraph();
        this._updateClassifyProgress();
        this._showCachedReviewAnalysis();
        return;
      }

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
      this._reviewGoTo(wantIdx);
      this._showReviewSummary();
      this._renderEvalGraph();
      this._updateClassifyProgress();
    }

    _fireReviewCompleteCallbackIfNeeded() {
      if (!this.onReviewClassifyComplete || this._reviewCompleteCallbackDone) return;
      if (!this.reviewMoveHistory || this.reviewMoveHistory.length === 0) return;
      this._reviewCompleteCallbackDone = true;
      const snap = this.reviewMoveHistory.map(e => {
        const row = {
          boardIdx: e.boardIdx,
          cellIdx: e.cellIdx,
          player: e.player,
          prevActiveBoard: e.prevActiveBoard,
          classification: e.classification != null ? e.classification : null,
          moveInt: e.moveInt != null ? e.moveInt : e.boardIdx * 9 + e.cellIdx,
          bookName: e.bookName != null ? e.bookName : null,
          bookDesc: e.bookDesc != null ? e.bookDesc : null,
        };
        const ra = serializeReviewAnalysisForStorage(e._analysis);
        if (ra) row.reviewAnalysis = ra;
        return row;
      });
      try {
        this.onReviewClassifyComplete(snap, this.reviewStorageRecordId);
      } catch { /* ignore */ }
    }

    _startReviewAutoClassify() {
      this._classifyStarted = true;
      this._isAutoClassify = true;
      this._classifyQueue = [];
      this._classifyHighWater = 0;
      this._workerMoveMap = new Map();

      const Ctor = stateCtor('v3');
      const st = new Ctor();
      this._precomputedStates = [];
      for (let i = 0; i < this.reviewMoveHistory.length; i++) {
        this._precomputedStates.push(st.serialize());
        const e = this.reviewMoveHistory[i];
        st.applyMove(e.boardIdx * 9 + e.cellIdx);
      }

      for (let i = 0; i < this.reviewMoveHistory.length; i++) {
        const entry = this.reviewMoveHistory[i];
        if (reviewEntryHasEngineLines(entry)) continue;

        const pre = this._precomputedStates[i];
        const tmpSt = Ctor.deserialize(pre);
        const legal = tmpSt.legalMoves();
        if (tmpSt.winner !== 0 || legal.length === 0) continue;

        if (i === 0 && tmpSt.moveCount === 0) {
          this._classifyAtIndex(i, FIRST_MOVE_ANALYSIS);
          continue;
        }

        if (legal.length === 1) {
          const forced = {
            bestMove: legal[0],
            topMoves: [{ move: legal[0], visits: 1, winRate: 0.5 }],
            evaluation: 0, forced: true, legalMoveCount: 1,
            simulations: 0, elapsedMs: 0, forPlayer: tmpSt.toMove, done: true,
          };
          this._classifyAtIndex(i, forced);
          continue;
        }

        this._classifyQueue.push(i);
      }

      if (this._classifyQueue.length === 0) {
        this._finishAutoClassify();
        return;
      }

      this._classifyQueuePtr = 0;

      if (this.reviewFastMode) {
        this._pipelineDispatchBatch();
      } else {
        this._thoroughDispatchNext();
      }
    }

    // ── Fast mode: worker pairs per move, parallel pipeline ──

    _pipelineDispatchBatch() {
      const pool = this.workersV3;
      if (pool.length === 0) return;
      this.analysisRequestId++;
      this._pipelinePairSize = Math.max(1, Math.min(2, pool.length));
      this._pipelinePairResults = new Map();

      const pairCount = Math.floor(pool.length / this._pipelinePairSize);
      for (let p = 0; p < pairCount; p++) {
        this._dispatchNextPair(p);
      }
    }

    _dispatchNextPair(pairIdx) {
      const pool = this.workersV3;
      const ps = this._pipelinePairSize;
      const baseW = pairIdx * ps;
      if (baseW >= pool.length) return;

      while (this._classifyQueuePtr < this._classifyQueue.length) {
        const moveIdx = this._classifyQueue[this._classifyQueuePtr];
        this._classifyQueuePtr++;

        if (reviewEntryHasEngineLines(this.reviewMoveHistory[moveIdx])) continue;

        const budgetMs = getReviewClassifyBudgetMs();
        const seedBase = (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
        const maxNodesPerWorker = Math.floor(500000 / Math.max(ps, 1));

        for (let j = 0; j < ps && baseW + j < pool.length; j++) {
          const wIdx = baseW + j;
          this._workerMoveMap.set(wIdx, moveIdx);
          pool[wIdx].postMessage({
            type: 'analyze',
            requestId: this.analysisRequestId,
            state: this._precomputedStates[moveIdx],
            budgetMs,
            workerIndex: wIdx,
            rngSeed: (seedBase + Math.imul(wIdx, 0x9e3779b1)) >>> 0,
            rolloutCap: 52,
            maxNodes: maxNodesPerWorker,
            earlyStop: true,
          });
        }

        this._pipelinePairResults.set(pairIdx, []);
        if (moveIdx >= this._classifyHighWater) this._classifyHighWater = moveIdx + 1;
        this._autoClassifyIdx = this._classifyHighWater;
        this._isAutoClassifyLive = (moveIdx === this.reviewIndex);
        this._updateClassifyProgress();
        return;
      }

      for (let j = 0; j < ps && baseW + j < pool.length; j++) {
        this._workerMoveMap.delete(baseW + j);
      }
      this._pipelinePairResults.delete(pairIdx);
    }

    _onPipelineWorkerResult(workerIdx, result) {
      const moveIdx = this._workerMoveMap.get(workerIdx);
      if (moveIdx == null) return;

      const ps = this._pipelinePairSize;
      const pairIdx = Math.floor(workerIdx / ps);
      const pairResults = this._pipelinePairResults.get(pairIdx);
      if (!pairResults) return;

      pairResults.push(result);

      if (pairResults.length < ps) {
        const baseW = pairIdx * ps;
        let allSameMove = true;
        for (let j = 0; j < ps && baseW + j < this.workersV3.length; j++) {
          if (this._workerMoveMap.get(baseW + j) !== moveIdx) { allSameMove = false; break; }
        }
        if (allSameMove) return;
      }

      const merged = pairResults.length > 1 ? mergeParallelMCTSResults(pairResults) : pairResults[0];

      const baseW = pairIdx * ps;
      for (let j = 0; j < ps && baseW + j < this.workersV3.length; j++) {
        this._workerMoveMap.delete(baseW + j);
      }
      this._pipelinePairResults.delete(pairIdx);

      this._classifyAtIndex(moveIdx, merged);
      if (moveIdx === this.reviewIndex) {
        this._showCachedReviewAnalysis();
      }

      this._dispatchNextPair(pairIdx);

      let anyActive = false;
      for (const v of this._workerMoveMap.values()) { anyActive = true; break; }
      if (!anyActive) {
        this._finishAutoClassify();
      }
    }

    // ── Thorough mode: all workers on one move at a time, sequential ──

    _thoroughDispatchNext() {
      if (!this.reviewMoveHistory || this._classifyQueuePtr >= this._classifyQueue.length) {
        this._finishAutoClassify();
        return;
      }

      const moveIdx = this._classifyQueue[this._classifyQueuePtr];
      this._autoClassifyIdx = moveIdx;
      this._isAutoClassify = true;
      this.analysisRequestId++;

      const pool = this.workersV3;
      if (pool.length === 0) return;

      this._parallelProgress = new Array(pool.length);
      this._parallelFinal = new Array(pool.length);
      const payload = {
        type: 'analyze',
        requestId: this.analysisRequestId,
        state: this._precomputedStates[moveIdx],
        budgetMs: getReviewClassifyBudgetMs(),
      };
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
      this._isAutoClassifyLive = (moveIdx === this.reviewIndex);
    }

    _onThoroughResult(merged) {
      const moveIdx = this._classifyQueue[this._classifyQueuePtr];
      this._classifyQueuePtr++;

      this._classifyAtIndex(moveIdx, merged);
      if (moveIdx === this.reviewIndex) {
        this._showCachedReviewAnalysis();
      }
      this._thoroughDispatchNext();
    }

    _finishAutoClassify() {
      this._autoClassifyIdx = -1;
      this._isAutoClassify = false;
      this._isAutoClassifyLive = false;
      this._classifyFinished = true;
      this._precomputedStates = null;
      this._classifyQueue = null;
      this._workerMoveMap = null;
      this._pipelinePairResults = null;
      this._pipelinePairSize = 0;
      this._updateClassifyProgress();
      this._showReviewSummary();
      this._showCachedReviewAnalysis();
      this._fireReviewCompleteCallbackIfNeeded();
      this._startReviewDeepAnalysis();
    }

    _startReviewDeepAnalysis() {
      if (this.mode !== 'review' || !this._classifyFinished) return;
      if (this.state.winner !== 0) return;
      const idx = this.reviewIndex;
      if (idx >= this.reviewMoveHistory.length) return;

      this._reviewDeepIdx = idx;
      const entry = this.reviewMoveHistory[idx];
      this._reviewDeepBaseSims = (entry._analysis && entry._analysis.simulations) || 0;

      this._isAutoClassify = false;
      this.analysisRequestId++;
      const pool = this.workersV3;
      if (pool.length === 0) return;

      this._parallelProgress = new Array(pool.length);
      this._parallelFinal = new Array(pool.length);
      const payload = {
        type: 'analyze',
        requestId: this.analysisRequestId,
        state: this.state.serialize(),
        budgetMs: 10000,
      };
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
    }

    _abortReviewDeepAnalysis() {
      if (this._reviewDeepIdx == null) return;
      this._reviewDeepIdx = null;
      this._reviewDeepBaseSims = 0;
      this.analysisRequestId++;
      this._parallelProgress = [];
      this._parallelFinal = [];
      for (const w of this.workersV3) {
        w.postMessage({ type: 'abort' });
      }
    }

    _advanceAutoClassify() {
      // kept for compatibility — pipeline drives itself via _onPipelineWorkerResult
    }

    _runAutoClassifyAt(_idx) {
      // kept for compatibility — pipeline drives itself
    }

    _reviewClassifiedMax() {
      if (!this.reviewMoveHistory) return 0;
      return this.reviewMoveHistory.length;
    }

    _reviewGoTo(idx) {
      const max = this._reviewClassifiedMax();
      idx = Math.max(0, Math.min(idx, max));
      if (idx === this.reviewIndex) return;
      this.reviewIndex = idx;
      if (this._isAutoClassify) {
        if (this.reviewFastMode && this._workerMoveMap) {
          let liveNow = false;
          for (const mi of this._workerMoveMap.values()) {
            if (mi === idx) { liveNow = true; break; }
          }
          this._isAutoClassifyLive = liveNow;
        } else if (!this.reviewFastMode) {
          this._isAutoClassifyLive = (this._autoClassifyIdx === idx);
        }
      }
      if (this._reviewDeepIdx != null) {
        this._abortReviewDeepAnalysis();
      }
      this._replayToIndex(idx);
      this.render();
      this._updateReviewUI();
      this._showCachedReviewAnalysis();
      if (this._classifyFinished) {
        this._startReviewDeepAnalysis();
      }
      if (this.onReviewPersist && this.reviewMoveHistory && !this.reviewSkipAutoClassify) {
        try {
          this.onReviewPersist(this.reviewIndex, this.reviewMoveHistory, false);
        } catch { /* ignore */ }
      }
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
      const order = ['brilliant', 'great', 'best', 'book', 'forced', 'okay', 'miss', 'inaccuracy', 'mistake', 'blunder'];
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
      this._stopClockLoop();
      this._reviewDeepIdx = null;
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
      if (this._onVisibilityChange) {
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        this._onVisibilityChange = null;
      }
      if (this.mode === 'review' && this.onReviewPersist && this.reviewMoveHistory && !this.reviewSkipAutoClassify && !this._classifyFinished) {
        try {
          this.onReviewPersist(this.reviewIndex, this.reviewMoveHistory, true);
        } catch { /* ignore */ }
      }
      this.container.innerHTML = '';
    }
  }

  window.GameController = GameController;
  window.UTTT_BOTS = BOTS;
  window.UTTTReviewAnalysisStorage = {
    serialize: serializeReviewAnalysisForStorage,
    parse: parseReviewAnalysisFromStorage,
  };
})();
