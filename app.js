'use strict';

(() => {
  const contentEl = document.getElementById('content');
  const navItems = document.querySelectorAll('.nav-item');

  let currentGame = null;
  let currentOnline = null;
  let currentCleanup = null;

  const SVG_ICONS = {
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
    puzzle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/></svg>',
  };

  const LOBBY_TIME_OPTIONS = [
    { id: 'bullet', label: 'Bullet', desc: '2 min each' },
    { id: 'blitz', label: 'Blitz', desc: '5 min each' },
    { id: 'rapid', label: 'Rapid', desc: '10 min each' },
    { id: 'unlimited', label: 'Unlimited', desc: 'No clock' },
  ];

  function getSelectedLobbyTimeControl(root) {
    const el = root.querySelector('.lobby-time-opt:not(.lobby-host-side-opt).is-active');
    const v = el && el.dataset.time;
    return v === 'bullet' || v === 'blitz' || v === 'rapid' || v === 'unlimited' ? v : 'unlimited';
  }

  function getSelectedLobbyHostSide(root) {
    const el = root.querySelector('.lobby-host-side-opt.is-active');
    const v = el && el.dataset.hostSide;
    if (v === 'o') return 'o';
    if (v === 'random') return 'random';
    return 'x';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatOpeningVariantLine(variant) {
    return variant.map((m, i) => {
      const player = i % 2 === 0 ? 'X' : 'O';
      return `<span class="opening-move opening-variant-chip" data-player="${player}">${escapeHtml(m)}</span>`;
    }).join('<span class="opening-arrow">\u2192</span>');
  }

  const OPENING_LABEL_TO_IDX = { TL: 0, T: 1, TR: 2, L: 3, C: 4, R: 5, BL: 6, B: 7, BR: 8 };

  function parseOpeningMoveInt(label) {
    const [boardLabel, cellLabel] = label.split(':');
    return OPENING_LABEL_TO_IDX[boardLabel] * 9 + OPENING_LABEL_TO_IDX[cellLabel];
  }

  /** @param {object} st board state @param {number} lastMove play -1 for none @param {{ forcedBoard?: number, wrapClass?: string }} [opts] */
  function buildStatePreview(st, lastMove, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'opening-preview' + (opts.wrapClass ? ` ${opts.wrapClass}` : '');
    const meta = document.createElement('div');
    meta.className = 'opening-preview-meta';
    meta.setAttribute('aria-hidden', 'true');

    for (let b = 0; b < 9; b++) {
      const mini = document.createElement('div');
      mini.className = 'opening-preview-mini';
      const bs = st.bigState[b];
      if (bs === 1) mini.classList.add('opening-preview-mini--x');
      else if (bs === 2) mini.classList.add('opening-preview-mini--o');
      else if (bs === 3) mini.classList.add('opening-preview-mini--tie');
      if (opts.forcedBoard != null && opts.forcedBoard === b) {
        mini.classList.add('help-forced-board');
      }

      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div');
        cell.className = 'opening-preview-cell';
        const bit = 1 << c;
        const hasX = (st.smallX[b] & bit) !== 0;
        const hasO = (st.smallO[b] & bit) !== 0;
        if (hasX) {
          cell.classList.add('opening-preview-cell--x');
          const img = document.createElement('img');
          img.src = 'media/pieces/X256x256.png';
          img.alt = '';
          img.draggable = false;
          cell.appendChild(img);
        } else if (hasO) {
          cell.classList.add('opening-preview-cell--o');
          const img = document.createElement('img');
          img.src = 'media/pieces/O256x256.png';
          img.alt = '';
          img.draggable = false;
          cell.appendChild(img);
        }
        if (b * 9 + c === lastMove) cell.classList.add('opening-preview-cell--last');
        mini.appendChild(cell);
      }
      meta.appendChild(mini);
    }
    wrap.appendChild(meta);
    return wrap;
  }

  function buildOpeningPreview(line) {
    const moves = (line.variants && line.variants[0]) || [];
    const State = self.UTTTEngineV3?.UTTTState || self.UTTTEngineV2?.UTTTState || self.UTTTEngine?.UTTTState;
    if (!State || moves.length === 0) {
      const wrap = document.createElement('div');
      wrap.className = 'opening-preview opening-preview--empty';
      wrap.innerHTML = '<span class="opening-preview-placeholder">No moves</span>';
      return wrap;
    }

    const st = new State();
    let lastMove = -1;
    for (let i = 0; i < moves.length; i++) {
      const mi = parseOpeningMoveInt(moves[i]);
      st.applyMove(mi);
      lastMove = mi;
    }
    return buildStatePreview(st, lastMove, {});
  }

  /** Final position thumbnail for a finished game (replay stored moves). */
  function buildHistoryEndPositionPreview(moves, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'history-end-preview-wrap';
    const State = self.UTTTEngineV3?.UTTTState || self.UTTTEngineV2?.UTTTState || self.UTTTEngine?.UTTTState;
    if (!State || !Array.isArray(moves) || moves.length === 0) {
      wrap.innerHTML = '<span class="history-end-preview-empty" aria-hidden="true">\u2014</span>';
      return wrap;
    }
    const norm = normalizeStoredMoves(moves);
    const st = new State();
    let lastMove = -1;
    for (const e of norm) {
      const mi = e.moveInt != null ? e.moveInt : e.boardIdx * 9 + e.cellIdx;
      st.applyMove(mi);
      lastMove = mi;
    }
    const compact = opts.compact === true;
    const diagram = buildStatePreview(st, lastMove, {
      wrapClass: 'history-end-preview' + (compact ? ' history-end-preview--compact' : ''),
    });
    wrap.appendChild(diagram);
    wrap.setAttribute('aria-hidden', 'true');
    return wrap;
  }

  function getHelpStateCtor() {
    return self.UTTTEngineV3?.UTTTState || self.UTTTEngineV2?.UTTTState || self.UTTTEngine?.UTTTState;
  }

  /** @param {number[]} movesInts legal moves in order @param {{ forcedBoard?: number }} [opts] */
  function buildHelpExampleBoard(movesInts, opts = {}) {
    const State = getHelpStateCtor();
    const wrap = document.createElement('div');
    wrap.className = 'help-diagram-wrap';
    if (!State) {
      wrap.innerHTML = '<p class="help-diagram-fallback">Board preview needs scripts loaded.</p>';
      return wrap;
    }
    const st = new State();
    for (const m of movesInts) {
      st.applyMove(m);
    }
    const lastMove = movesInts.length ? movesInts[movesInts.length - 1] : -1;
    const diagram = buildStatePreview(st, lastMove, {
      ...opts,
      wrapClass: 'help-diagram',
    });
    wrap.appendChild(diagram);
    return wrap;
  }

  /** Mini-board cell index → which meta (big) sub-board the opponent must play in. */
  function buildHelpSteeringGrid() {
    const cells = [
      { local: 'TL', meta: 'TL' },
      { local: 'T', meta: 'T' },
      { local: 'TR', meta: 'TR' },
      { local: 'L', meta: 'L' },
      { local: 'C', meta: 'C' },
      { local: 'R', meta: 'R' },
      { local: 'BL', meta: 'BL' },
      { local: 'B', meta: 'B' },
      { local: 'BR', meta: 'BR' },
    ];
    const wrap = document.createElement('div');
    wrap.className = 'help-steer-wrap';
    const cap = document.createElement('p');
    cap.className = 'help-steer-caption';
    cap.innerHTML = 'Labels follow the opening book: <strong>TL</strong> = top-left, <strong>T</strong> = top edge, <strong>TR</strong> = top-right, <strong>L</strong>/<strong>C</strong>/<strong>R</strong> = middle row, <strong>BL</strong>/<strong>B</strong>/<strong>BR</strong> = bottom row. A move is written <strong>META:LOCAL</strong> (e.g. <strong>C:C</strong> = center cell of the center meta-board).';
    wrap.appendChild(cap);
    const grid = document.createElement('div');
    grid.className = 'help-steer-grid';
    grid.setAttribute('role', 'img');
    grid.setAttribute('aria-label', 'Local cell label maps to required meta-board label');
    for (const c of cells) {
      const cell = document.createElement('div');
      cell.className = 'help-steer-cell';
      cell.innerHTML = `<span class="help-steer-local">Play local <strong>${c.local}</strong></span><span class="help-steer-arrow" aria-hidden="true">\u2192</span><span class="help-steer-dest">Next position: meta <strong>${c.meta}</strong></span>`;
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function cleanup() {
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }
    flushPersistReviewTimer();
    if (currentOnline) {
      currentOnline.disconnect();
      currentOnline = null;
    }
    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }
    contentEl.innerHTML = '';
  }

  function setActiveNav(page) {
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
  }

  const RECENT_GAMES_KEY = 'uttt-recent-games-v1';
  const RECENT_GAMES_MAX = 10;

  let lastFinishedGameRecordId = null;
  let pendingReviewHistory = null;
  let pendingReviewSkipAutoClassify = false;
  let pendingReviewStorageRecordId = null;
  let pendingReviewFromHistory = false;
  let pendingReviewInitialIndex = 0;

  function newRecentGameId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function cloneMovesForStorage(history) {
    return history.map((e, i) => ({
      boardIdx: e.boardIdx,
      cellIdx: e.cellIdx,
      player: e.player != null ? e.player : (i % 2 === 0 ? 1 : 2),
      prevActiveBoard: e.prevActiveBoard != null ? e.prevActiveBoard : null,
      classification: e.classification != null ? e.classification : null,
      moveInt: e.moveInt != null ? e.moveInt : e.boardIdx * 9 + e.cellIdx,
      bookName: e.bookName != null ? e.bookName : null,
      bookDesc: e.bookDesc != null ? e.bookDesc : null,
    }));
  }

  function normalizeStoredMoves(moves) {
    if (!Array.isArray(moves)) return [];
    return moves.map((e, i) => {
      const base = {
        boardIdx: e.boardIdx,
        cellIdx: e.cellIdx,
        player: e.player != null ? e.player : (i % 2 === 0 ? 1 : 2),
        prevActiveBoard: e.prevActiveBoard != null ? e.prevActiveBoard : null,
        classification: e.classification != null ? e.classification : null,
        moveInt: e.moveInt != null ? e.moveInt : e.boardIdx * 9 + e.cellIdx,
        bookName: e.bookName != null ? e.bookName : null,
        bookDesc: e.bookDesc != null ? e.bookDesc : null,
      };
      const ra = e.reviewAnalysis;
      if (ra && typeof ra === 'object' && Array.isArray(ra.topMoves) && ra.topMoves.length > 0) {
        base.reviewAnalysis = ra;
      }
      return base;
    });
  }

  function buildReviewSummaryFromMoves(moves) {
    const counts = {};
    for (const m of moves) {
      if (!m.classification) continue;
      counts[m.classification] = (counts[m.classification] || 0) + 1;
    }
    const bad = (counts.blunder || 0) + (counts.mistake || 0) + (counts.inaccuracy || 0);
    const shine = (counts.brilliant || 0) + (counts.great || 0);
    return { counts, bad, shine, moveCount: moves.length };
  }

  function formatHistoryReviewSummaryLine(summary) {
    if (!summary || !summary.counts) return '';
    const parts = [];
    if (summary.shine > 0) parts.push(`${summary.shine} great+`);
    if (summary.bad > 0) parts.push(`${summary.bad} inaccuracies+`);
    if (parts.length === 0) return `${summary.moveCount} moves`;
    return `${parts.join(' \u00B7 ')} \u00B7 ${summary.moveCount} moves`;
  }

  /** Same paths as game.js CLASSIFICATION_ICONS (history list runs outside GameView). */
  const HISTORY_CLASS_ICONS = {
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

  const REVIEW_ACCURACY_ORDER = ['brilliant', 'great', 'best', 'book', 'okay', 'miss', 'inaccuracy', 'mistake', 'blunder'];
  const REVIEW_ACCURACY_WEIGHTS = { brilliant: 1, great: 1, best: 1, book: 1, okay: 0.6, miss: 0.4, inaccuracy: 0.2, mistake: 0.1, blunder: 0 };

  /** Per-player accuracy matching GameView._showReviewSummary (classified moves only). */
  function computeReviewPlayerAccuracies(moves) {
    const calc = (counts) => {
      let total = 0;
      let score = 0;
      for (const cls of REVIEW_ACCURACY_ORDER) {
        const n = counts[cls] || 0;
        if (n > 0 && REVIEW_ACCURACY_WEIGHTS[cls] !== undefined) {
          total += n;
          score += n * REVIEW_ACCURACY_WEIGHTS[cls];
        }
      }
      return total > 0 ? Math.round((score / total) * 100) : null;
    };
    const xCounts = {};
    const oCounts = {};
    for (const e of moves) {
      if (!e.classification) continue;
      const bucket = e.player === 1 ? xCounts : oCounts;
      bucket[e.classification] = (bucket[e.classification] || 0) + 1;
    }
    return { x: calc(xCounts), o: calc(oCounts) };
  }

  function buildHistoryClassificationStrip(moves) {
    const wrap = document.createElement('div');
    wrap.className = 'history-row-class-strip';
    wrap.setAttribute('aria-label', 'Move classifications in order');
    for (const m of moves) {
      const slot = document.createElement('span');
      slot.className = 'history-rating-slot';
      const cls = m.classification;
      const src = cls && HISTORY_CLASS_ICONS[cls];
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = cls;
        img.className = 'history-rating-icon';
        img.draggable = false;
        slot.appendChild(img);
      } else {
        slot.classList.add('history-rating-slot--empty');
        slot.textContent = '\u00B7';
        slot.setAttribute('aria-hidden', 'true');
      }
      wrap.appendChild(slot);
    }
    return wrap;
  }

  function buildHistoryAccuracyRow(moves) {
    const { x, o } = computeReviewPlayerAccuracies(moves);
    const el = document.createElement('div');
    el.className = 'history-row-accuracy';
    const fmt = pct => (pct != null ? `${pct}%` : '\u2014');
    el.innerHTML = `
      <span class="history-acc-side history-acc-side--x">
        <img src="media/pieces/X256x256.png" alt="" class="history-acc-piece" draggable="false"/>
        <span class="history-acc-val">${escapeHtml(fmt(x))}</span>
      </span>
      <span class="history-acc-sep" aria-hidden="true">\u00B7</span>
      <span class="history-acc-side history-acc-side--o">
        <img src="media/pieces/O256x256.png" alt="" class="history-acc-piece" draggable="false"/>
        <span class="history-acc-val">${escapeHtml(fmt(o))}</span>
      </span>
    `;
    return el;
  }

  function loadRecentGames() {
    try {
      const raw = localStorage.getItem(RECENT_GAMES_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(g => g && g.id && Array.isArray(g.moves));
    } catch {
      return [];
    }
  }

  function saveRecentGames(list) {
    try {
      localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(list.slice(0, RECENT_GAMES_MAX)));
    } catch { /* ignore */ }
  }

  function recordFinishedGame(mode, winner, movesClone) {
    const list = loadRecentGames();
    const rec = {
      id: newRecentGameId(),
      finishedAt: Date.now(),
      mode: mode === 'online' ? 'online' : mode === 'ai' ? 'ai' : 'local',
      winner: winner === 1 || winner === 2 || winner === 3 ? winner : 3,
      moves: movesClone,
      reviewDone: false,
    };
    list.unshift(rec);
    saveRecentGames(list);
    return rec.id;
  }

  function mergeReviewIntoRecentGame(recordId, movesSnapshot) {
    if (recordId == null || !movesSnapshot || movesSnapshot.length === 0) return;
    const list = loadRecentGames();
    const idx = list.findIndex(g => g.id === recordId);
    if (idx < 0) return;
    const normalized = normalizeStoredMoves(movesSnapshot);
    list[idx].moves = normalized;
    list[idx].reviewDone = true;
    list[idx].reviewCompletedAt = Date.now();
    list[idx].reviewSummary = buildReviewSummaryFromMoves(normalized);
    delete list[idx].reviewResumeIndex;
    saveRecentGames(list);
  }

  /** Serialize in-progress review (position + labels completed so far). */
  function persistReviewSession(recordId, reviewIndex, movesSource) {
    if (recordId == null || !movesSource || movesSource.length === 0) return;
    const list = loadRecentGames();
    const gi = list.findIndex(g => g.id === recordId);
    if (gi < 0) return;
    const rec = list[gi];
    if (rec.reviewDone) return;
    const n = movesSource.length;
    rec.reviewResumeIndex = Math.max(0, Math.min(reviewIndex | 0, n));
    const RAS = typeof window !== 'undefined' ? window.UTTTReviewAnalysisStorage : null;
    rec.moves = movesSource.map((e, i) => {
      const row = {
        boardIdx: e.boardIdx,
        cellIdx: e.cellIdx,
        player: e.player != null ? e.player : (i % 2 === 0 ? 1 : 2),
        prevActiveBoard: e.prevActiveBoard != null ? e.prevActiveBoard : null,
        classification: e.classification != null ? e.classification : null,
        moveInt: e.moveInt != null ? e.moveInt : e.boardIdx * 9 + e.cellIdx,
        bookName: e.bookName != null ? e.bookName : null,
        bookDesc: e.bookDesc != null ? e.bookDesc : null,
      };
      let ra = null;
      if (RAS && RAS.serialize && e._analysis) {
        ra = RAS.serialize(e._analysis);
      }
      if (!ra && e.reviewAnalysis && typeof e.reviewAnalysis === 'object') {
        ra = e.reviewAnalysis;
      }
      if (ra && Array.isArray(ra.topMoves) && ra.topMoves.length > 0) {
        row.reviewAnalysis = ra;
      }
      return row;
    });
    saveRecentGames(list);
  }

  let reviewPersistDebounceTimer = null;
  function flushPersistReviewTimer() {
    if (reviewPersistDebounceTimer) {
      clearTimeout(reviewPersistDebounceTimer);
      reviewPersistDebounceTimer = null;
    }
  }

  function schedulePersistReviewSession(recordId, reviewIndex, movesSource) {
    flushPersistReviewTimer();
    reviewPersistDebounceTimer = setTimeout(() => {
      reviewPersistDebounceTimer = null;
      persistReviewSession(recordId, reviewIndex, movesSource);
    }, 350);
  }

  function attachRestoredReviewAnalysisStubs(moves) {
    for (const e of moves) {
      if (e._analysis) continue;
      e._analysis = {
        evaluation: 0,
        forPlayer: e.player != null ? e.player : 1,
        done: true,
        restored: true,
        topMoves: [],
        simulations: 0,
        elapsedMs: 0,
      };
    }
  }

  function hydrateMovesWithStoredReviewAnalysis(moves) {
    const RAS = typeof window !== 'undefined' ? window.UTTTReviewAnalysisStorage : null;
    if (!RAS || !RAS.parse) return;
    for (const e of moves) {
      const snap = e.reviewAnalysis;
      if (!snap || typeof snap !== 'object') continue;
      const a = RAS.parse(snap);
      if (a) e._analysis = a;
    }
  }

  /** HTML fragment: piece icon + " wins", or escaped "Draw". */
  function winnerWinsHtml(w) {
    if (w === 1) {
      return '<span class="winner-inline-wins"><img class="winner-inline-piece" src="media/pieces/X256x256.png" alt="X" draggable="false"> wins</span>';
    }
    if (w === 2) {
      return '<span class="winner-inline-wins"><img class="winner-inline-piece" src="media/pieces/O256x256.png" alt="O" draggable="false"> wins</span>';
    }
    return escapeHtml('Draw');
  }

  function modeShortLabel(mode) {
    if (mode === 'online') return 'Online';
    if (mode === 'ai') return 'vs AI';
    return 'Local';
  }

  function formatFinishedAt(ts) {
    try {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now - d;
      if (diffMs < 60_000) return 'Just now';
      if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
      if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  function openReviewFromHistory(recordId) {
    const list = loadRecentGames();
    const rec = list.find(g => g.id === recordId);
    if (!rec) return;
    const hist = normalizeStoredMoves(rec.moves).map(m => ({ ...m }));
    hydrateMovesWithStoredReviewAnalysis(hist);
    let skipAuto = false;
    if (rec.reviewDone) {
      attachRestoredReviewAnalysisStubs(hist);
      skipAuto = true;
    }
    pendingReviewHistory = hist;
    pendingReviewSkipAutoClassify = skipAuto;
    pendingReviewStorageRecordId = recordId;
    pendingReviewFromHistory = true;
    const n = hist.length;
    const ri = rec.reviewResumeIndex;
    pendingReviewInitialIndex = (!rec.reviewDone && ri != null && Number.isFinite(ri))
      ? Math.max(0, Math.min(Number(ri), n))
      : 0;
    navigate('#/review');
  }

  // ── Home page ──

  function renderHome() {
    cleanup();
    setActiveNav('home');

    const page = document.createElement('div');
    page.className = 'home-page';
    page.innerHTML = `
      <div class="hero">
        <img src="media/logo/logo256x256.png" class="hero-logo" alt="Ultimate Tic-Tac-Toe" />
        <h1>Ultimate Tic-Tac-Toe</h1>
        <p class="hero-subtitle">The classic game, elevated. Play locally, challenge AI, or compete online—all in your browser.</p>
        <div class="hero-tags" aria-label="Highlights">
          <span class="hero-tag">9 mini-boards</span>
          <span class="hero-tag">MCTS engine</span>
          <span class="hero-tag">Opening book</span>
          <span class="hero-tag">Move review</span>
        </div>
      </div>

      <div class="home-recent-anchor"></div>

      <h2 class="home-section-title">Start playing</h2>
      <div class="play-cards">
        <div class="play-card" data-action="local">
          <div class="card-icon">${SVG_ICONS.users}</div>
          <h2>Play Local</h2>
          <p>Two players, one device—pass and play.</p>
        </div>
        <div class="play-card" data-action="online">
          <div class="card-icon">${SVG_ICONS.globe}</div>
          <h2>Play Online</h2>
          <p>Create a room or join with a code.</p>
        </div>
        <div class="play-card" data-action="ai">
          <div class="card-icon">${SVG_ICONS.cpu}</div>
          <h2>Play vs AI</h2>
          <p>MCTS thinks while you pick your side.</p>
        </div>
      </div>

      <h2 class="home-section-title">More on this site</h2>
      <div class="play-cards home-more-cards">
        <div class="play-card" data-action="analysis">
          <div class="card-icon">${SVG_ICONS.search}</div>
          <h2>Analysis board</h2>
          <p>Walk moves, run the engine, see eval &amp; top lines.</p>
        </div>
        <div class="play-card" data-action="openings">
          <div class="card-icon">${SVG_ICONS.book}</div>
          <h2>Opening book</h2>
          <p>Browse named lines and jump into analysis.</p>
        </div>
        <div class="play-card" data-action="settings">
          <div class="card-icon">${SVG_ICONS.settings}</div>
          <h2>Settings</h2>
          <p>Theme, layout, highlights &amp; engine version.</p>
        </div>
      </div>

      <details class="home-rules">
        <summary>Rules at a glance</summary>
        <ol>
          <li>The board is nine smaller tic-tac-toe boards in a 3\u00D73 meta-grid.</li>
          <li>Win a small board with three in a row inside it.</li>
          <li>The local cell you take sends your opponent to that same position on the meta-scale for their next turn.</li>
          <li>If sent to a board already won or full, they may play anywhere open.</li>
          <li>Win three small boards in a row on the meta-board to win the game.</li>
        </ol>
        <p class="rules-engine">Monte Carlo Tree Search powers AI and analysis (parallel workers + tunable strength). See Help for diagrams and notation.</p>
      </details>

      <nav class="home-bottom-nav" aria-label="Shortcuts">
        <a href="#/help" class="home-bottom-link">${SVG_ICONS.help}<span>Full help &amp; diagrams</span></a>
        <a href="#/openings" class="home-bottom-link">${SVG_ICONS.book}<span>Openings library</span></a>
        <a href="#/analysis" class="home-bottom-link">${SVG_ICONS.search}<span>Open analysis</span></a>
        <a href="#/settings" class="home-bottom-link">${SVG_ICONS.settings}<span>Preferences</span></a>
      </nav>
    `;

    page.querySelectorAll('[data-action]').forEach((card) => {
      card.addEventListener('click', () => {
        const action = card.dataset.action;
        if (action === 'local') navigate('#/play/local');
        else if (action === 'online') navigate('#/play/online');
        else if (action === 'ai') navigate('#/play/ai');
        else if (action === 'analysis') navigate('#/analysis');
        else if (action === 'openings') navigate('#/openings');
        else if (action === 'settings') navigate('#/settings');
      });
    });

    const recentAnchor = page.querySelector('.home-recent-anchor');
    const recentAll = loadRecentGames();
    if (recentAnchor && recentAll.length > 0) {
      const rec = recentAll[0];
      const section = document.createElement('section');
      section.className = 'home-recent-section';
      section.innerHTML = `
        <div class="home-recent-head">
          <h2 class="home-section-title home-recent-title">Last Game</h2>
          <a href="#/history" class="home-recent-viewall">View all</a>
        </div>
        <div class="home-recent-preview"></div>
      `;
      const listEl = section.querySelector('.home-recent-preview');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'home-recent-row';
      row.dataset.recordId = rec.id;
      const sumLine = rec.reviewDone ? formatHistoryReviewSummaryLine(rec.reviewSummary) : `${rec.moves.length} moves`;
      row.appendChild(buildHistoryEndPositionPreview(rec.moves, { compact: true }));
      const textCol = document.createElement('div');
      textCol.className = 'home-recent-row-text';
      textCol.innerHTML = `
        <div class="home-recent-row-head">
          <span class="home-recent-meta">${escapeHtml(modeShortLabel(rec.mode))} · ${winnerWinsHtml(rec.winner)}</span>
          ${rec.reviewDone ? '<span class="history-badge history-badge--compact">Reviewed</span>' : ''}
        </div>
        <span class="home-recent-sub">${escapeHtml(formatFinishedAt(rec.finishedAt))}${sumLine ? ` · ${escapeHtml(sumLine)}` : ''}</span>
      `;
      row.appendChild(textCol);
      row.addEventListener('click', () => openReviewFromHistory(rec.id));
      listEl.appendChild(row);
      recentAnchor.replaceWith(section);
    } else if (recentAnchor) {
      recentAnchor.remove();
    }

    contentEl.appendChild(page);
  }

  function renderHistory() {
    cleanup();
    setActiveNav('history');

    const page = document.createElement('div');
    page.className = 'history-page';

    const header = document.createElement('div');
    header.className = 'game-page-header';
    header.innerHTML = `
      <button class="back-btn" title="Back to home" type="button">${SVG_ICONS.back}</button>
      <span class="game-page-title">Game history</span>
    `;
    header.querySelector('.back-btn').addEventListener('click', () => navigate('#/'));
    page.appendChild(header);

    const listWrap = document.createElement('div');
    listWrap.className = 'history-list-wrap';

    const games = loadRecentGames();
    if (games.length === 0) {
      listWrap.innerHTML = '<p class="history-empty">No finished games yet. Play a match and it will appear here (last ten).</p>';
    } else {
      const ul = document.createElement('div');
      ul.className = 'history-list';
      ul.setAttribute('role', 'list');
      for (const rec of games) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'history-row';
        row.dataset.recordId = rec.id;
        row.setAttribute('role', 'listitem');
        const normMoves = normalizeStoredMoves(rec.moves);
        row.appendChild(buildHistoryEndPositionPreview(rec.moves, { compact: false }));
        const main = document.createElement('span');
        main.className = 'history-row-main';
        if (rec.reviewDone) {
          main.innerHTML = `
            <span class="history-row-title">${escapeHtml(modeShortLabel(rec.mode))} · ${winnerWinsHtml(rec.winner)}</span>
            <span class="history-row-sub">${escapeHtml(formatFinishedAt(rec.finishedAt))} · ${normMoves.length} moves \u00B7 Reviewed</span>
          `;
          main.appendChild(buildHistoryClassificationStrip(normMoves));
          main.appendChild(buildHistoryAccuracyRow(normMoves));
        } else {
          const sumLine = `${normMoves.length} moves · Review pending`;
          main.innerHTML = `
            <span class="history-row-title">${escapeHtml(modeShortLabel(rec.mode))} · ${winnerWinsHtml(rec.winner)}</span>
            <span class="history-row-sub">${escapeHtml(formatFinishedAt(rec.finishedAt))} · ${escapeHtml(sumLine)}</span>
          `;
        }
        row.appendChild(main);
        row.addEventListener('click', () => openReviewFromHistory(rec.id));
        ul.appendChild(row);
      }
      listWrap.appendChild(ul);
    }

    page.appendChild(listWrap);
    contentEl.appendChild(page);
  }

  function renderHelp() {
    cleanup();
    setActiveNav('help');

    const page = document.createElement('div');
    page.className = 'help-page';

    const header = document.createElement('div');
    header.className = 'game-page-header';
    header.innerHTML = `
      <button class="back-btn" title="Back to home" type="button">${SVG_ICONS.back}</button>
      <span class="game-page-title">Help</span>
    `;
    header.querySelector('.back-btn').addEventListener('click', () => navigate('#/'));
    page.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'help-intro';
    intro.innerHTML = 'The field is nine ordinary 3\u00D73 boards arranged in a 3\u00D73 <strong>meta-board</strong>. Local play follows standard tic-tac-toe. After every move, the <strong>local cell</strong> you take\u2014its corner, edge, or center\u2014names the <strong>meta-board</strong> where the opponent must play next. The same nine labels apply on both scales (see notation below).';
    page.appendChild(intro);

    const keyNote = document.createElement('p');
    keyNote.className = 'help-visual-key';
    keyNote.innerHTML = '<strong>Diagram key</strong> \u2014 <span class="help-key-gold">Gold</span>: last move (local cell). <span class="help-key-green">Green</span>: meta-board the next player is confined to when a single destination is forced. Sample positions are from legal games.';
    page.appendChild(keyNote);

    const sections = document.createElement('div');
    sections.className = 'help-sections';

    function addSection(title, bodyParas, diagramSpec, extraEl) {
      const sec = document.createElement('section');
      sec.className = 'help-section';
      const h = document.createElement('h2');
      h.textContent = title;
      sec.appendChild(h);
      for (const para of bodyParas) {
        const p = document.createElement('p');
        if (para && typeof para === 'object' && para.html != null) {
          p.innerHTML = para.html;
        } else {
          p.textContent = typeof para === 'string' ? para : '';
        }
        sec.appendChild(p);
      }
      if (extraEl) sec.appendChild(extraEl);
      if (diagramSpec) {
        sec.appendChild(buildHelpExampleBoard(diagramSpec.moves, diagramSpec.opts || {}));
      }
      sections.appendChild(sec);
    }

    const SEQ_WIN_TOP_LEFT = [1, 9, 2, 18, 0];

    addSection(
      'The big board',
      [
        'Nine local 3\u00D73 boards occupy the nine cells of the meta-board. Winning a local board marks the corresponding meta-cell for that side. The match is decided by three meta-cells in a row (row, column, or diagonal), same geometry as ordinary tic-tac-toe one level up.',
      ],
      { moves: [], opts: {} }
    );

    addSection(
      'Meta-board routing (META:LOCAL)',
      [
        {
          html: 'Within whichever <strong>meta-board</strong> the rules force you into, only the <strong>local</strong> square you take matters for the next restriction. That square\u2019s label (<strong>TL</strong> \u2026 <strong>BR</strong>) is the meta-board the opponent must enter next. The labels use the same 3\u00D73 layout for both layers.',
        },
      ],
      null,
      buildHelpSteeringGrid()
    );

    addSection(
      'Sample: C:C',
      [
        {
          html: 'X opens with <strong class="help-mono">C:C</strong> (center square of the center meta-board). O\u2019s next ply is confined to meta-board <strong>C</strong> (green outline).',
        },
      ],
      { moves: [40], opts: { forcedBoard: 4 } }
    );

    addSection(
      'Sample: TL row won; closed-meta free move',
      [
        {
          html: 'Plies (alternating X, O): <strong class="help-mono">TL:T</strong>, <strong class="help-mono">T:TL</strong>, <strong class="help-mono">TL:TR</strong>, <strong class="help-mono">TR:TL</strong>, <strong class="help-mono">TL:TL</strong>. X completes the top row of local board <strong>TL</strong>; that meta-cell is scored for X.',
        },
        {
          html: 'It is O to move. The last ply <strong class="help-mono">TL:TL</strong> (gold) uses local square <strong>TL</strong>, which would normally require meta-board <strong>TL</strong>. That board is already finished, so the next turn is a <strong>free move</strong>: any legal cell in any unfinished meta-board.',
        },
      ],
      { moves: SEQ_WIN_TOP_LEFT, opts: {} }
    );

    addSection(
      'Outcome',
      [
        'Three meta-cells in a row wins. A drawn local board still claims its meta-cell and can block a meta-line.',
        'Game review labels moves using an engine; adjust per-move search time under Settings.',
      ],
      null
    );

    page.appendChild(sections);
    contentEl.appendChild(page);
  }

  // ── Play page ──

  function renderPlay(mode, roomCode) {
    cleanup();
    setActiveNav('play');

    const page = document.createElement('div');
    page.className = 'game-page';

    const modeLabels = {
      local: 'Local Game',
      online: 'Online Game',
      ai: 'Play vs AI',
    };

    page.innerHTML = `
      <div class="game-page-header">
        <button class="back-btn" title="Back to home">${SVG_ICONS.back}</button>
        <div class="mode-tabs">
          <button class="mode-tab${mode === 'local' ? ' active' : ''}" data-mode="local">
            ${SVG_ICONS.users} Local
          </button>
          <button class="mode-tab${mode === 'online' ? ' active' : ''}" data-mode="online">
            ${SVG_ICONS.globe} Online
          </button>
          <button class="mode-tab${mode === 'ai' ? ' active' : ''}" data-mode="ai">
            ${SVG_ICONS.cpu} vs AI
          </button>
        </div>
      </div>
      <div class="game-container"></div>
    `;

    const backBtn = page.querySelector('.back-btn');
    backBtn.addEventListener('click', () => navigate('#/'));

    page.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const m = tab.dataset.mode;
        navigate(`#/play/${m}`);
      });
    });

    contentEl.appendChild(page);

    const gameContainer = page.querySelector('.game-container');

    if (mode === 'online') {
      _initOnlineGame(gameContainer, roomCode);
    } else {
      currentGame = new GameController(gameContainer, {
        mode: mode,
        difficulty: 'hard',
        humanSide: 'x',
        onGameOver: (winner, history) => {
          lastFinishedGameRecordId = recordFinishedGame(mode, winner, cloneMovesForStorage(history));
        },
      });
    }
  }

  async function _initOnlineGame(container, roomCode) {
    if (roomCode) {
      _startOnlineGame(container, roomCode, null);
    } else {
      _showOnlineLobby(container);
    }
  }

  function _showOnlineLobby(container) {
    const timeOptsHtml = LOBBY_TIME_OPTIONS.map((o) => {
      const active = o.id === 'unlimited';
      return `
      <button type="button" class="lobby-time-opt${active ? ' is-active' : ''}" data-time="${o.id}" role="radio" aria-checked="${active ? 'true' : 'false'}">
        <span class="time-icon time-icon--${o.id} time-icon--lobby" aria-hidden="true"></span>
        <span class="lobby-time-opt-label">${escapeHtml(o.label)}</span>
        <span class="lobby-time-opt-desc">${escapeHtml(o.desc)}</span>
      </button>`;
    }).join('');

    container.innerHTML = `
      <div class="online-lobby">
        <div class="lobby-time-section">
          <h3 class="lobby-time-heading">Time control</h3>
          <div class="lobby-time-options" role="radiogroup" aria-label="Time control">
            ${timeOptsHtml}
          </div>
          <p class="lobby-lead-note">Used when you create a room. Guests inherit the host&apos;s clock.</p>
        </div>
        <div class="lobby-host-side-section lobby-time-section">
          <h3 class="lobby-time-heading">Your side</h3>
          <div class="lobby-host-side-options" role="radiogroup" aria-label="Side when hosting">
            <button type="button" class="lobby-time-opt lobby-host-side-opt is-active" data-host-side="x" role="radio" aria-checked="true">
              <span class="lobby-time-opt-label">X — first</span>
              <span class="lobby-time-opt-desc">You take the first move when it is X&apos;s turn.</span>
            </button>
            <button type="button" class="lobby-time-opt lobby-host-side-opt" data-host-side="o" role="radio" aria-checked="false">
              <span class="lobby-time-opt-label">O — second</span>
              <span class="lobby-time-opt-desc">Guest opens; you play O.</span>
            </button>
            <button type="button" class="lobby-time-opt lobby-host-side-opt" data-host-side="random" role="radio" aria-checked="false">
              <span class="lobby-time-opt-label">Random</span>
              <span class="lobby-time-opt-desc">Sides flip a coin when someone joins.</span>
            </button>
          </div>
          <p class="lobby-lead-note">Only applies when you create a room; joiners keep their assigned side.</p>
        </div>
        <div class="lobby-divider"><span>or</span></div>
        <div class="lobby-card">
          <div class="card-icon">${SVG_ICONS.globe}</div>
          <h2>Play Online</h2>
          <p class="lobby-lead">Create a game and share the link, or join with a room code.</p>
          <button class="btn-primary btn-lg create-room-btn">Create Game</button>
        </div>
        <div class="lobby-divider"><span>or</span></div>
        <div class="lobby-card">
          <h3 class="join-card-heading">Join a Game</h3>
          <input class="join-input" placeholder="Room code" maxlength="6" />
          <button class="btn-secondary btn-lg join-room-btn join-room-submit" disabled>Join</button>
        </div>
      </div>
    `;

    const createBtn = container.querySelector('.create-room-btn');
    const joinInput = container.querySelector('.join-input');
    const joinBtn = container.querySelector('.join-room-btn');

    container.querySelectorAll('.lobby-time-opt:not(.lobby-host-side-opt)').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.lobby-time-opt:not(.lobby-host-side-opt)').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      });
    });

    container.querySelectorAll('.lobby-host-side-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.lobby-host-side-opt').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      });
    });

    createBtn.addEventListener('click', () => {
      const tc = getSelectedLobbyTimeControl(container);
      const hostSide = getSelectedLobbyHostSide(container);
      container.innerHTML = '';
      _startOnlineGame(container, null, tc, hostSide);
    });

    joinInput.addEventListener('input', () => {
      joinBtn.disabled = joinInput.value.trim().length < 4;
    });

    joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && joinInput.value.trim().length >= 4) {
        container.innerHTML = '';
        _startOnlineGame(container, joinInput.value.trim().toUpperCase(), null);
      }
    });

    joinBtn.addEventListener('click', () => {
      const code = joinInput.value.trim().toUpperCase();
      if (code.length >= 4) {
        container.innerHTML = '';
        _startOnlineGame(container, code, null);
      }
    });
  }

  async function _startOnlineGame(container, roomCode, hostTimeControl, hostSide) {
    currentOnline = new OnlineManager();

    currentGame = new GameController(container, {
      mode: 'online',
      onlineManager: currentOnline,
      timeControl: roomCode ? 'unlimited' : (hostTimeControl || 'unlimited'),
      onGameOver: (winner, history) => {
        lastFinishedGameRecordId = recordFinishedGame('online', winner, cloneMovesForStorage(history));
      },
    });

    try {
      await currentOnline.connect();
    } catch {
      const text = container.querySelector('.connection-text');
      if (text) text.textContent = 'Failed to connect to server';
      return;
    }

    if (roomCode) {
      currentOnline.joinRoom(roomCode);
    } else {
      currentOnline.createRoom(hostTimeControl || 'unlimited', hostSide || 'x');
    }
  }

  // ── Analysis page ──

  function renderAnalysis(reviewHistory, analysisInitialHistory, reviewOpts = {}) {
    cleanup();
    const nav =
      reviewHistory && reviewOpts.navActivePage === 'history'
        ? 'history'
        : 'analysis';
    setActiveNav(nav);

    const page = document.createElement('div');
    page.className = 'game-page';

    const title = reviewHistory ? 'Game Review' : 'Analysis Board';

    page.innerHTML = `
      <div class="game-page-header">
        <button class="back-btn" title="Back to home">${SVG_ICONS.back}</button>
        <span class="game-page-title">${title}</span>
      </div>
      <div class="game-container"></div>
    `;

    const backBtn = page.querySelector('.back-btn');
    backBtn.addEventListener('click', () => navigate('#/'));

    contentEl.appendChild(page);

    const gameContainer = page.querySelector('.game-container');

    if (reviewHistory) {
      const storageId = reviewOpts.storageRecordId != null ? reviewOpts.storageRecordId : null;
      const initIdx = reviewOpts.reviewInitialIndex != null ? reviewOpts.reviewInitialIndex : 0;
      const onReviewComplete =
        storageId != null
          ? (snap, rid) => mergeReviewIntoRecentGame(rid, snap)
          : null;
      const onReviewPersist =
        storageId != null
          ? (idx, hist, immediate) => {
              if (immediate) {
                flushPersistReviewTimer();
                persistReviewSession(storageId, idx, hist);
              } else {
                schedulePersistReviewSession(storageId, idx, hist);
              }
            }
          : null;
      currentGame = new GameController(gameContainer, {
        mode: 'review',
        reviewHistory: reviewHistory,
        reviewSkipAutoClassify: reviewOpts.skipAutoClassify === true,
        reviewStorageRecordId: storageId,
        onReviewClassifyComplete: onReviewComplete,
        reviewInitialIndex: initIdx,
        onReviewPersist,
      });
    } else {
      const opts = { mode: 'analysis' };
      if (analysisInitialHistory && analysisInitialHistory.length > 0) {
        opts.initialAnalysisHistory = analysisInitialHistory;
      }
      if (reviewOpts.initialState) {
        opts.initialAnalysisState = reviewOpts.initialState;
      }
      currentGame = new GameController(gameContainer, opts);
    }
  }

  const REVIEW_CLASSIFY_BUDGET_SEC_KEY = 'uttt-review-classify-budget-sec';
  const REVIEW_BUDGET_SEC_MIN = 0.5;
  const REVIEW_BUDGET_SEC_MAX = 5;
  const REVIEW_BUDGET_SEC_DEFAULT = 2;

  function getStoredReviewClassifyBudgetSec() {
    try {
      const v = parseFloat(localStorage.getItem(REVIEW_CLASSIFY_BUDGET_SEC_KEY));
      if (Number.isFinite(v) && v >= REVIEW_BUDGET_SEC_MIN && v <= REVIEW_BUDGET_SEC_MAX) {
        return Math.round(v * 2) / 2;
      }
    } catch { /* ignore */ }
    return REVIEW_BUDGET_SEC_DEFAULT;
  }

  function setStoredReviewClassifyBudgetSec(sec) {
    try {
      const x = Math.min(REVIEW_BUDGET_SEC_MAX, Math.max(REVIEW_BUDGET_SEC_MIN, sec));
      localStorage.setItem(REVIEW_CLASSIFY_BUDGET_SEC_KEY, String(x));
    } catch { /* ignore */ }
  }

  // ── UI preferences (stored in localStorage, applied on <html>) ──

  const UI_KEYS = {
    theme: 'uttt-ui-theme',
    boardScale: 'uttt-ui-board-scale',
    uiDensity: 'uttt-ui-ui-density',
    reduceMotion: 'uttt-ui-reduce-motion',
    hideLastMove: 'uttt-ui-hide-last-move',
    noPieceGlow: 'uttt-ui-no-piece-glow',
    hideMoveBadges: 'uttt-ui-hide-move-badges',
    hideAnalysisHints: 'uttt-ui-hide-analysis-hints',
  };

  function defaultUiSettings() {
    return {
      theme: 'dark',
      boardScale: 'default',
      uiDensity: 'comfortable',
      reduceMotion: false,
      highlightLastMove: true,
      pieceGlow: true,
      showMoveBadges: true,
      showAnalysisHints: true,
    };
  }

  function loadUiSettings() {
    const s = defaultUiSettings();
    try {
      const bs = localStorage.getItem(UI_KEYS.boardScale);
      if (bs === 'compact' || bs === 'large') s.boardScale = bs;
      const ud = localStorage.getItem(UI_KEYS.uiDensity);
      if (ud === 'compact' || ud === 'cozy') s.uiDensity = ud;
      if (localStorage.getItem(UI_KEYS.theme) === 'light') s.theme = 'light';
      if (localStorage.getItem(UI_KEYS.reduceMotion) === '1') s.reduceMotion = true;
      if (localStorage.getItem(UI_KEYS.hideLastMove) === '1') s.highlightLastMove = false;
      if (localStorage.getItem(UI_KEYS.noPieceGlow) === '1') s.pieceGlow = false;
      if (localStorage.getItem(UI_KEYS.hideMoveBadges) === '1') s.showMoveBadges = false;
      if (localStorage.getItem(UI_KEYS.hideAnalysisHints) === '1') s.showAnalysisHints = false;
    } catch { /* ignore */ }
    return s;
  }

  function persistUiSettings(s) {
    try {
      if (s.theme === 'dark') localStorage.removeItem(UI_KEYS.theme);
      else localStorage.setItem(UI_KEYS.theme, s.theme);
      if (s.boardScale === 'default') localStorage.removeItem(UI_KEYS.boardScale);
      else localStorage.setItem(UI_KEYS.boardScale, s.boardScale);
      if (s.uiDensity === 'comfortable') localStorage.removeItem(UI_KEYS.uiDensity);
      else localStorage.setItem(UI_KEYS.uiDensity, s.uiDensity);
      if (s.reduceMotion) localStorage.setItem(UI_KEYS.reduceMotion, '1');
      else localStorage.removeItem(UI_KEYS.reduceMotion);
      if (!s.highlightLastMove) localStorage.setItem(UI_KEYS.hideLastMove, '1');
      else localStorage.removeItem(UI_KEYS.hideLastMove);
      if (!s.pieceGlow) localStorage.setItem(UI_KEYS.noPieceGlow, '1');
      else localStorage.removeItem(UI_KEYS.noPieceGlow);
      if (!s.showMoveBadges) localStorage.setItem(UI_KEYS.hideMoveBadges, '1');
      else localStorage.removeItem(UI_KEYS.hideMoveBadges);
      if (!s.showAnalysisHints) localStorage.setItem(UI_KEYS.hideAnalysisHints, '1');
      else localStorage.removeItem(UI_KEYS.hideAnalysisHints);
    } catch { /* ignore */ }
  }

  function applyUiSettings(s) {
    const root = document.documentElement;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (s.theme === 'light') {
      root.setAttribute('data-theme', 'light');
      if (themeMeta) themeMeta.content = '#f4f2ef';
    } else {
      root.removeAttribute('data-theme');
      if (themeMeta) themeMeta.content = '#312e2b';
    }
    const setOrClear = (attr, condition) => {
      if (condition) root.setAttribute(attr, '1');
      else root.removeAttribute(attr);
    };
    if (s.boardScale === 'default') root.removeAttribute('data-uttt-board-scale');
    else root.setAttribute('data-uttt-board-scale', s.boardScale);
    if (s.uiDensity === 'comfortable') root.removeAttribute('data-uttt-ui-density');
    else root.setAttribute('data-uttt-ui-density', s.uiDensity);
    setOrClear('data-uttt-reduce-motion', s.reduceMotion);
    setOrClear('data-uttt-hide-last-move', !s.highlightLastMove);
    setOrClear('data-uttt-no-piece-glow', !s.pieceGlow);
    setOrClear('data-uttt-hide-move-badges', !s.showMoveBadges);
    setOrClear('data-uttt-hide-analysis-hints', !s.showAnalysisHints);
  }

  function bindUiSettingsControls(page) {
    page.querySelectorAll('[data-set-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.setTheme;
        const s = loadUiSettings();
        s.theme = v === 'light' ? 'light' : 'dark';
        persistUiSettings(s);
        applyUiSettings(s);
        page.querySelectorAll('[data-set-theme]').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.setTheme === s.theme);
        });
      });
    });

    page.querySelectorAll('[data-set-board-scale]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.setBoardScale;
        const s = loadUiSettings();
        s.boardScale = v || 'default';
        persistUiSettings(s);
        applyUiSettings(s);
        page.querySelectorAll('[data-set-board-scale]').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.setBoardScale === s.boardScale);
        });
      });
    });

    page.querySelectorAll('[data-set-ui-density]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.setUiDensity;
        const s = loadUiSettings();
        s.uiDensity = v || 'comfortable';
        persistUiSettings(s);
        applyUiSettings(s);
        page.querySelectorAll('[data-set-ui-density]').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.setUiDensity === s.uiDensity);
        });
      });
    });

    page.querySelectorAll('input[data-ui-bool]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const field = inp.dataset.uiBool;
        const s = loadUiSettings();
        if (field && Object.prototype.hasOwnProperty.call(s, field)) {
          s[field] = inp.checked;
          persistUiSettings(s);
          applyUiSettings(s);
        }
      });
    });
  }

  // ── Settings page ──

  function renderSettings() {
    cleanup();
    setActiveNav('settings');

    const reviewBudgetSec = getStoredReviewClassifyBudgetSec();
    const ui = loadUiSettings();

    const page = document.createElement('div');
    page.className = 'settings-page';
    page.innerHTML = `
      <div class="game-page-header">
        <button class="back-btn" title="Back to home">${SVG_ICONS.back}</button>
        <span class="game-page-title">Settings</span>
      </div>

      <div class="settings-section">
        <h3 class="settings-section-title">Layout &amp; text</h3>
        <p class="settings-hint">These options apply across the whole site and are saved in this browser.</p>

        <div class="settings-option">
          <div class="settings-option-header">
            <span class="settings-option-title">Color theme</span>
            <span class="settings-option-desc">Dark uses warm charcoal; light uses soft paper tones.</span>
          </div>
          <div class="segmented cols-2 settings-segmented">
            <button type="button" class="seg-btn${ui.theme === 'dark' ? ' is-active' : ''}" data-set-theme="dark">Dark</button>
            <button type="button" class="seg-btn${ui.theme === 'light' ? ' is-active' : ''}" data-set-theme="light">Light</button>
          </div>
        </div>

        <div class="settings-option">
          <div class="settings-option-header">
            <span class="settings-option-title">Interface size</span>
            <span class="settings-option-desc">Text and control scale (the board size option below is separate).</span>
          </div>
          <div class="segmented cols-3 settings-segmented">
            <button type="button" class="seg-btn${ui.uiDensity === 'compact' ? ' is-active' : ''}" data-set-ui-density="compact">Compact</button>
            <button type="button" class="seg-btn${ui.uiDensity === 'comfortable' ? ' is-active' : ''}" data-set-ui-density="comfortable">Standard</button>
            <button type="button" class="seg-btn${ui.uiDensity === 'cozy' ? ' is-active' : ''}" data-set-ui-density="cozy">Cozy</button>
          </div>
        </div>

        <div class="settings-option">
          <div class="settings-option-header">
            <span class="settings-option-title">Board size</span>
            <span class="settings-option-desc">How large the main game board appears on the board page.</span>
          </div>
          <div class="segmented cols-3 settings-segmented">
            <button type="button" class="seg-btn${ui.boardScale === 'compact' ? ' is-active' : ''}" data-set-board-scale="compact">Compact</button>
            <button type="button" class="seg-btn${ui.boardScale === 'default' ? ' is-active' : ''}" data-set-board-scale="default">Default</button>
            <button type="button" class="seg-btn${ui.boardScale === 'large' ? ' is-active' : ''}" data-set-board-scale="large">Large</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3 class="settings-section-title">Board &amp; highlights</h3>
        <p class="settings-hint">Tweak on-board visuals and motion. Engine and move list behavior is unchanged.</p>

        ${['highlightLastMove', 'pieceGlow', 'showMoveBadges', 'showAnalysisHints', 'reduceMotion'].map((field) => {
          const meta = {
            highlightLastMove: {
              title: 'Last move highlight',
              desc: 'Outline the cell that was just played.',
            },
            pieceGlow: {
              title: 'Piece glow',
              desc: 'Soft glow on X and O marks, turn indicator, and winner text.',
            },
            showMoveBadges: {
              title: 'Move quality icons',
              desc: 'Small icons on reviewed or analyzed moves (best, blunder, book, etc.).',
            },
            showAnalysisHints: {
              title: 'Analysis shading on cells',
              desc: 'Yellow highlight and ranks when the engine shows top moves on the board.',
            },
            reduceMotion: {
              title: 'Reduce motion',
              desc: 'Shorten or turn off animations (page transitions, piece pop, overlays).',
            },
          };
          const m = meta[field];
          const checked = ui[field] ? ' checked' : '';
          const id = `ui-${field}`;
          return `
        <div class="settings-option settings-option-row">
          <div class="settings-option-header">
            <label class="settings-option-title" for="${id}">${m.title}</label>
            <span class="settings-option-desc">${m.desc}</span>
          </div>
          <label class="settings-switch">
            <input type="checkbox" id="${id}" data-ui-bool="${field}"${checked} />
            <span class="settings-switch-slider" aria-hidden="true"></span>
          </label>
        </div>`;
        }).join('')}
      </div>

      <div class="settings-section">
        <h3 class="settings-section-title">Game review</h3>
        <p class="settings-hint">When you open a finished game in review, the app runs a quick engine search on every move to label quality (brilliant, inaccuracy, etc.). This control sets how many <strong>seconds</strong> the engine may think per move for that pass. More time usually means stabler labels; lower values finish faster.</p>
        <div class="settings-option settings-review-budget">
          <div class="settings-option-header">
            <span class="settings-option-title">Time per move when classifying review</span>
            <span class="settings-option-desc">Applies the next time review classifies moves (re-open review or start a new review).</span>
          </div>
          <div class="settings-range-row">
            <input type="range" class="settings-range" id="review-classify-budget" min="0.5" max="5" step="0.5" value="${reviewBudgetSec}" aria-valuemin="0.5" aria-valuemax="5" aria-describedby="review-classify-budget-hint" />
            <span class="settings-range-value" id="review-classify-budget-value" aria-live="polite"></span>
          </div>
          <p class="settings-hint settings-hint-tight" id="review-classify-budget-hint">Range 0.5\u20135 s. Default 2 s.</p>
        </div>
      </div>
    `;

    page.querySelector('.back-btn').addEventListener('click', () => navigate('#/'));

    bindUiSettingsControls(page);

    const range = page.querySelector('#review-classify-budget');
    const rangeVal = page.querySelector('#review-classify-budget-value');
    if (range && rangeVal) {
      const syncLabel = () => {
        const v = parseFloat(range.value);
        const show = Number.isFinite(v) ? v.toFixed(1) : '2.0';
        rangeVal.textContent = `${show} s`;
        range.setAttribute('aria-valuenow', show);
      };
      range.addEventListener('input', () => {
        syncLabel();
        setStoredReviewClassifyBudgetSec(parseFloat(range.value));
      });
      syncLabel();
    }

    contentEl.appendChild(page);
  }

  // ── Openings page ──

  function renderOpenings() {
    cleanup();
    setActiveNav('openings');

    const page = document.createElement('div');
    page.className = 'openings-page';
    page.innerHTML = `
      <div class="game-page-header">
        <button class="back-btn" title="Back to home">${SVG_ICONS.back}</button>
        <span class="game-page-title">Opening Book</span>
      </div>
      <p class="openings-intro">Named opening lines for Ultimate Tic-Tac-Toe. Click any opening to load it on the analysis board.</p>
      <div class="openings-list" id="openingsList">
        <div class="openings-loading">Loading openings\u2026</div>
      </div>
    `;

    const backBtn = page.querySelector('.back-btn');
    backBtn.addEventListener('click', () => navigate('#/'));

    contentEl.appendChild(page);

    const listEl = page.querySelector('#openingsList');

    fetch('bookmoves.json')
      .then(r => r.json())
      .then(data => {
        listEl.innerHTML = '';
        for (const line of (data.lines || [])) {
          const card = document.createElement('div');
          card.className = 'opening-card';

          const preview = buildOpeningPreview(line);

          const variants = line.variants || [];
          const first = variants[0] || [];
          const showVariantsHelp =
            line.showVariantsHelp === true ||
            variants.length > 1 ||
            (variants.length === 1 && first.length > 1);
          const variantsPopoverTitle = variants.length > 1 ? 'All variants' : 'Moves';
          const variantsPopover = showVariantsHelp
            ? `
            <div class="opening-variants-help" tabindex="0">
              <span class="opening-variants-help-icon" aria-label="Show move sequence">?</span>
              <div class="opening-variants-popover" role="tooltip">
                <div class="opening-variants-popover-title">${variantsPopoverTitle}</div>
                <div class="opening-variants-popover-list">
                  ${variants.map((v, vi) => `
                    <div class="opening-variant-row">
                      <span class="opening-variant-num">${vi + 1}.</span>
                      <div class="opening-variant-moves">${formatOpeningVariantLine(v)}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>`
            : '';

          const inner = document.createElement('div');
          inner.className = 'opening-card-inner';
          inner.appendChild(preview);

          const main = document.createElement('div');
          main.className = 'opening-card-main';
          main.innerHTML = `
            <div class="opening-card-header">
              <img src="media/classifications/Book.png" class="opening-book-icon" alt="" />
              <h3 class="opening-name">${escapeHtml(line.name)}</h3>
            </div>
            <p class="opening-desc">${escapeHtml(line.description || '')}</p>
            <div class="opening-footer">
              <div class="opening-footer-left">${variantsPopover}</div>
              <button type="button" class="btn-ghost opening-explore-btn">Explore in analysis \u2192</button>
            </div>
          `;
          inner.appendChild(main);
          card.appendChild(inner);

          const helpWrap = main.querySelector('.opening-variants-help');
          if (helpWrap) {
            helpWrap.addEventListener('click', (e) => e.stopPropagation());
          }

          const exploreBtn = card.querySelector('.opening-explore-btn');
          exploreBtn.addEventListener('click', () => {
            _loadOpeningInAnalysis(line);
          });

          card.addEventListener('click', (e) => {
            if (e.target.closest('.opening-explore-btn')) return;
            _loadOpeningInAnalysis(line);
          });

          listEl.appendChild(card);
        }
      })
      .catch(() => {
        listEl.innerHTML = '<p style="color: var(--muted);">Failed to load openings.</p>';
      });
  }

  function _loadOpeningInAnalysis(line) {
    const moves = (line.variants && line.variants[0]) || [];

    const history = moves.map((label, i) => {
      const moveInt = parseOpeningMoveInt(label);
      const boardIdx = (moveInt / 9) | 0;
      const cellIdx = moveInt - boardIdx * 9;
      return {
        boardIdx,
        cellIdx,
        player: i % 2 === 0 ? 1 : 2,
        prevActiveBoard: -1,
        classification: 'book',
        moveInt,
        bookName: line.name,
        bookDesc: line.description,
      };
    });

    window.UTTT_APP.startAnalysisFromMoves(history);
  }

  // ── Puzzles ──

  let _puzzleManager = null;
  let _puzzleBoard = null;
  let _puzzlePageActive = false;

  function renderPuzzles() {
    cleanup();
    setActiveNav('puzzles');
    _puzzlePageActive = true;

    contentEl.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'puzzle-page';

    page.innerHTML = `
      <div class="page-header">
        <h2>Puzzles</h2>
      </div>
      <div class="puzzle-streak-bar">
        <div class="puzzle-streak-item">
          <span class="puzzle-streak-label">Streak</span>
          <span class="puzzle-streak-value" data-streak="current">0</span>
        </div>
        <div class="puzzle-streak-item">
          <span class="puzzle-streak-label">Best</span>
          <span class="puzzle-streak-value" data-streak="best">0</span>
        </div>
      </div>
      <div class="puzzle-id"></div>
      <div class="puzzle-prompt"></div>
      <div class="puzzle-board-container"></div>
      <div class="puzzle-controls"></div>
      <div class="puzzle-analyze">
        <button class="btn-ghost puzzle-analyze-btn" type="button">${SVG_ICONS.search} Analyze this position</button>
      </div>
    `;

    contentEl.appendChild(page);

    const analyzeBtn = page.querySelector('.puzzle-analyze-btn');
    analyzeBtn.addEventListener('click', () => {
      if (_currentPuzzle) {
        window.UTTT_APP.startAnalysisFromState(_currentPuzzle.state);
      }
    });

    if (!_puzzleManager) {
      _puzzleManager = new self.UTTTPuzzles.PuzzleManager();
    }

    const boardContainer = page.querySelector('.puzzle-board-container');
    const promptEl = page.querySelector('.puzzle-prompt');
    const controlsEl = page.querySelector('.puzzle-controls');

    _puzzleBoard = new self.UTTTPuzzles.PuzzleBoard(boardContainer, {
      onCellClick: (moveInt) => onPuzzleCellClick(moveInt),
    });

    _updateStreakDisplay(page);
    _loadNextPuzzle(page, promptEl, controlsEl);

    currentCleanup = () => {
      _puzzlePageActive = false;
      if (_puzzleBoard) { _puzzleBoard.destroy(); _puzzleBoard = null; }
    };
  }

  function _updateStreakDisplay(page) {
    if (!_puzzleManager) return;
    const s = _puzzleManager.getStreak();
    const cur = page.querySelector('[data-streak="current"]');
    const best = page.querySelector('[data-streak="best"]');
    if (cur) cur.textContent = String(s.current);
    if (best) best.textContent = String(s.best);
  }

  let _currentPuzzle = null;
  let _puzzlePollTimer = null;

  async function _loadNextPuzzle(page, promptEl, controlsEl) {
    controlsEl.innerHTML = '';
    _currentPuzzle = null;
    if (_puzzlePollTimer) { clearTimeout(_puzzlePollTimer); _puzzlePollTimer = null; }

    promptEl.innerHTML = '<span class="puzzle-generating"><span class="puzzle-spinner"></span> Loading\u2026</span>';
    if (_puzzleBoard) _puzzleBoard.lock();

    try {
      const puzzle = await _puzzleManager.fetchNext();
      if (!_puzzlePageActive) return;

      if (!puzzle) {
        promptEl.innerHTML = '<span class="puzzle-generating"><span class="puzzle-spinner"></span> Generating puzzles\u2026 check back shortly.</span>';
        _puzzlePollTimer = setTimeout(() => {
          if (_puzzlePageActive) _loadNextPuzzle(page, promptEl, controlsEl);
        }, 3000);
        return;
      }

      _currentPuzzle = puzzle;
      const idEl = page.querySelector('.puzzle-id');
      if (idEl) idEl.textContent = puzzle.id;

      const turnChar = puzzle.toMove === 1 ? 'X' : 'O';
      promptEl.innerHTML = `<img src="media/pieces/${turnChar}256x256.png" class="puzzle-prompt-piece" alt="${turnChar}"> <strong>${turnChar} to move</strong> \u2014 find the best move.`;

      _puzzleBoard.loadState(puzzle.state);
    } catch {
      if (!_puzzlePageActive) return;
      promptEl.textContent = 'Failed to load puzzle. Retrying\u2026';
      _puzzlePollTimer = setTimeout(() => {
        if (_puzzlePageActive) _loadNextPuzzle(page, promptEl, controlsEl);
      }, 3000);
    }
  }

  function onPuzzleCellClick(moveInt) {
    if (!_currentPuzzle || !_puzzleBoard || !_puzzleManager) return;
    const puzzle = _currentPuzzle;
    _puzzleBoard.lock();

    const correct = _puzzleManager.checkAnswer(puzzle, moveInt);
    const page = document.querySelector('.puzzle-page');
    if (!page) return;
    const promptEl = page.querySelector('.puzzle-prompt');
    const controlsEl = page.querySelector('.puzzle-controls');

    if (correct) {
      _puzzleBoard.showCorrect(moveInt);
      promptEl.innerHTML = '<span class="puzzle-result-correct">Correct!</span>';
      _updateStreakDisplay(page);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn-primary puzzle-next-btn';
      nextBtn.textContent = 'Next';
      nextBtn.addEventListener('click', () => {
        if (!_puzzlePageActive) return;
        _loadNextPuzzle(page, promptEl, controlsEl);
      });
      controlsEl.innerHTML = '';
      controlsEl.appendChild(nextBtn);
    } else {
      _puzzleBoard.showWrong(moveInt);
      _puzzleBoard.revealBest(puzzle.bestMove);
      promptEl.innerHTML = '<span class="puzzle-result-wrong">Wrong.</span> The best move is highlighted.';
      _updateStreakDisplay(page);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn-primary puzzle-next-btn';
      nextBtn.textContent = 'Next';
      nextBtn.addEventListener('click', () => {
        if (!_puzzlePageActive) return;
        _loadNextPuzzle(page, promptEl, controlsEl);
      });
      controlsEl.innerHTML = '';
      controlsEl.appendChild(nextBtn);
    }
  }

  // ── Router ──

  let pendingAnalysisHistory = null;
  let pendingAnalysisState = null;

  function navigate(hash) {
    if (location.hash !== hash) {
      location.hash = hash;
    } else {
      route();
    }
  }

  function route() {
    const hash = location.hash || '#/';
    const parts = hash.replace('#/', '').split('/');

    if (parts[0] === 'play') {
      const mode = parts[1] || 'local';
      if (mode === 'online') {
        const roomCode = parts[2] || null;
        renderPlay('online', roomCode);
      } else if (mode === 'ai') {
        renderPlay('ai');
      } else {
        renderPlay('local');
      }
    } else if (parts[0] === 'puzzles') {
      renderPuzzles();
    } else if (parts[0] === 'help') {
      renderHelp();
    } else if (parts[0] === 'openings') {
      renderOpenings();
    } else if (parts[0] === 'settings') {
      renderSettings();
    } else if (parts[0] === 'analysis') {
      const initial = pendingAnalysisHistory;
      const initialState = pendingAnalysisState;
      pendingAnalysisHistory = null;
      pendingAnalysisState = null;
      renderAnalysis(null, initial, { initialState });
    } else if (parts[0] === 'history') {
      renderHistory();
    } else if (parts[0] === 'review') {
      const hist = pendingReviewHistory;
      const skipAuto = pendingReviewSkipAutoClassify;
      const sid = pendingReviewStorageRecordId;
      const fromHist = pendingReviewFromHistory;
      const initIdx = pendingReviewInitialIndex;
      pendingReviewHistory = null;
      pendingReviewSkipAutoClassify = false;
      pendingReviewStorageRecordId = null;
      pendingReviewFromHistory = false;
      pendingReviewInitialIndex = 0;
      if (!hist || hist.length === 0) {
        renderHome();
        return;
      }
      renderAnalysis(hist, null, {
        skipAutoClassify: skipAuto,
        storageRecordId: sid,
        navActivePage: fromHist ? 'history' : 'analysis',
        reviewInitialIndex: initIdx,
      });
    } else {
      renderHome();
    }
  }

  // ── Global API for cross-component communication ──

  window.UTTT_APP = {
    navigate: navigate,
    reloadUiPreferences: () => applyUiSettings(loadUiSettings()),
    startReview: (history) => {
      pendingReviewHistory = cloneMovesForStorage(history);
      pendingReviewSkipAutoClassify = false;
      pendingReviewStorageRecordId = lastFinishedGameRecordId;
      pendingReviewFromHistory = false;
      pendingReviewInitialIndex = 0;
      navigate('#/review');
    },
    startAnalysisFromMoves: (history) => {
      pendingAnalysisHistory = history;
      navigate('#/analysis');
    },
    startAnalysisFromState: (serializedState) => {
      pendingAnalysisState = serializedState;
      navigate('#/analysis');
    },
  };

  // ── Init ──

  window.addEventListener('hashchange', route);

  applyUiSettings(loadUiSettings());
  route();
})();
