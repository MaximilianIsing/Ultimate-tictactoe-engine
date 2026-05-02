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
    aiVsAi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="5" width="9" height="12" rx="2"/><rect x="14" y="5" width="9" height="12" rx="2"/><rect x="4" y="9" width="3" height="4"/><rect x="17" y="9" width="3" height="4"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  };

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

  function buildOpeningPreview(line) {
    const moves = (line.variants && line.variants[0]) || [];
    const State = self.UTTTEngineV3?.UTTTState || self.UTTTEngineV2?.UTTTState || self.UTTTEngine?.UTTTState;
    const wrap = document.createElement('div');
    wrap.className = 'opening-preview';
    if (!State || moves.length === 0) {
      wrap.classList.add('opening-preview--empty');
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

  function cleanup() {
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }
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
        <p class="hero-subtitle">The classic game, elevated. Play locally, challenge AI, or compete online.</p>
      </div>

      <div class="play-cards">
        <div class="play-card" data-action="local">
          <div class="card-icon">${SVG_ICONS.users}</div>
          <h2>Play Local</h2>
          <p>Two players, one device</p>
        </div>
        <div class="play-card" data-action="online">
          <div class="card-icon">${SVG_ICONS.globe}</div>
          <h2>Play Online</h2>
          <p>Share a link, play a friend</p>
        </div>
        <div class="play-card" data-action="ai">
          <div class="card-icon">${SVG_ICONS.cpu}</div>
          <h2>Play vs AI</h2>
          <p>Challenge the MCTS engine</p>
        </div>
      </div>

      <div class="play-cards secondary">
        <div class="play-card" data-action="aivai">
          <div class="card-icon">${SVG_ICONS.aiVsAi}</div>
          <h2>AI vs AI</h2>
          <p>Watch two engines play (pick classic, balanced, or strong per side)</p>
        </div>
        <div class="play-card" data-action="analysis">
          <div class="card-icon">${SVG_ICONS.search}</div>
          <h2>Analysis Board</h2>
          <p>Explore positions with engine assistance</p>
        </div>
      </div>

      <section class="home-rules">
        <details>
          <summary>How to play Ultimate Tic-Tac-Toe</summary>
          <ol>
            <li>The board consists of nine smaller tic-tac-toe boards arranged in a 3\u00D73 grid.</li>
            <li>Win a small board by getting three in a row.</li>
            <li>The cell you play in determines which small board your opponent must play in next.</li>
            <li>If sent to a board that\u2019s already won or full, you may play in any open board.</li>
            <li>Win three small boards in a row on the meta-board to win the game.</li>
          </ol>
          <p class="rules-engine">
            The engine uses Monte Carlo Tree Search (MCTS) with heuristic-guided rollouts,
            running in a Web Worker for smooth performance.
          </p>
        </details>
      </section>
    `;

    page.querySelectorAll('.play-card').forEach(card => {
      card.addEventListener('click', () => {
        const action = card.dataset.action;
        if (action === 'local') navigate('#/play/local');
        else if (action === 'online') navigate('#/play/online');
        else if (action === 'ai') navigate('#/play/ai');
        else if (action === 'aivai') navigate('#/aivai');
        else if (action === 'analysis') navigate('#/analysis');
      });
    });

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
        onGameOver: (winner, history) => {},
      });
    }
  }

  async function _initOnlineGame(container, roomCode) {
    if (roomCode) {
      _startOnlineGame(container, roomCode);
    } else {
      _showOnlineLobby(container);
    }
  }

  function _showOnlineLobby(container) {
    container.innerHTML = `
      <div class="online-lobby">
        <div class="lobby-card">
          <div class="card-icon">${SVG_ICONS.globe}</div>
          <h2>Play Online</h2>
          <p style="color: var(--muted); margin-bottom: 16px;">Create a game and share the link, or join with a room code.</p>
          <button class="btn-primary btn-lg create-room-btn">Create Game</button>
        </div>
        <div class="lobby-divider"><span>or</span></div>
        <div class="lobby-card">
          <h3 style="margin-bottom: 12px;">Join a Game</h3>
          <input class="join-input" placeholder="Room code" maxlength="6" />
          <button class="btn-secondary btn-lg join-room-btn" style="margin-top: 10px;" disabled>Join</button>
        </div>
      </div>
    `;

    const createBtn = container.querySelector('.create-room-btn');
    const joinInput = container.querySelector('.join-input');
    const joinBtn = container.querySelector('.join-room-btn');

    createBtn.addEventListener('click', () => {
      container.innerHTML = '';
      _startOnlineGame(container, null);
    });

    joinInput.addEventListener('input', () => {
      joinBtn.disabled = joinInput.value.trim().length < 4;
    });

    joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && joinInput.value.trim().length >= 4) {
        container.innerHTML = '';
        _startOnlineGame(container, joinInput.value.trim().toUpperCase());
      }
    });

    joinBtn.addEventListener('click', () => {
      const code = joinInput.value.trim().toUpperCase();
      if (code.length >= 4) {
        container.innerHTML = '';
        _startOnlineGame(container, code);
      }
    });
  }

  async function _startOnlineGame(container, roomCode) {
    currentOnline = new OnlineManager();

    currentGame = new GameController(container, {
      mode: 'online',
      onlineManager: currentOnline,
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
      currentOnline.createRoom();
    }
  }

  // ── AI vs AI page ──

  function renderAivai() {
    cleanup();
    setActiveNav('aivai');

    const page = document.createElement('div');
    page.className = 'game-page';
    page.innerHTML = `
      <div class="game-page-header">
        <button class="back-btn" title="Back to home">${SVG_ICONS.back}</button>
        <span class="game-page-title">AI vs AI</span>
      </div>
      <div class="game-container"></div>
    `;

    page.querySelector('.back-btn').addEventListener('click', () => navigate('#/'));

    contentEl.appendChild(page);

    const gameContainer = page.querySelector('.game-container');
    currentGame = new GameController(gameContainer, {
      mode: 'aivai',
    });
  }

  // ── Analysis page ──

  function renderAnalysis(reviewHistory, analysisInitialHistory) {
    cleanup();
    setActiveNav('analysis');

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
      currentGame = new GameController(gameContainer, {
        mode: 'review',
        reviewHistory: reviewHistory,
      });
    } else {
      const opts = { mode: 'analysis' };
      if (analysisInitialHistory && analysisInitialHistory.length > 0) {
        opts.initialAnalysisHistory = analysisInitialHistory;
      }
      currentGame = new GameController(gameContainer, opts);
    }
  }

  const ENGINE_STORAGE_KEY = 'uttt-engine-version';

  function getStoredEngineVersion() {
    try {
      const v = localStorage.getItem(ENGINE_STORAGE_KEY);
      if (v === 'v1' || v === 'v2' || v === 'v3') return v;
      return 'v3';
    } catch {
      return 'v3';
    }
  }

  function setStoredEngineVersion(v) {
    try {
      const x = v === 'v1' ? 'v1' : v === 'v2' ? 'v2' : 'v3';
      localStorage.setItem(ENGINE_STORAGE_KEY, x);
    } catch { /* ignore */ }
  }

  // ── Settings page ──

  function renderSettings() {
    cleanup();
    setActiveNav('settings');

    const current = getStoredEngineVersion();

    const page = document.createElement('div');
    page.className = 'settings-page';
    page.innerHTML = `
      <div class="game-page-header">
        <button class="back-btn" title="Back to home">${SVG_ICONS.back}</button>
        <span class="game-page-title">Settings</span>
      </div>
      <div class="settings-section">
        <h3 class="settings-section-title">Analysis engine</h3>
        <p class="settings-hint">Used for AI moves, analysis board, and game review. Reload or start a new game after changing.</p>
        <div class="engine-picker">
          <button class="engine-card${current === 'v1' ? ' is-active' : ''}" data-engine="v1" type="button">
            <span class="engine-card-title">Version 1 (classic)</span>
            <span class="engine-card-desc">Original MCTS: full rollouts to the end of the game, single Web Worker.</span>
          </button>
          <button class="engine-card${current === 'v2' ? ' is-active' : ''}" data-engine="v2" type="button">
            <span class="engine-card-title">Version 2 (balanced)</span>
            <span class="engine-card-desc">Fast rollouts with early eval cutoff, cached UCT, parallel workers (root-parallel MCTS).</span>
          </button>
          <button class="engine-card${current === 'v3' ? ' is-active' : ''}" data-engine="v3" type="button">
            <span class="engine-card-title">Version 3 (strong)</span>
            <span class="engine-card-desc">PUCT-style priors, transposition stats, eval cache, richer heuristics, same parallel worker model as v2.</span>
          </button>
        </div>
      </div>
    `;

    page.querySelector('.back-btn').addEventListener('click', () => navigate('#/'));

    page.querySelectorAll('.engine-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const eng = btn.dataset.engine;
        setStoredEngineVersion(eng);
        page.querySelectorAll('.engine-card').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.engine === eng);
        });
      });
    });

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
          const variantsPopover = variants.length > 1
            ? `
            <div class="opening-variants-help" tabindex="0">
              <span class="opening-variants-help-icon" aria-label="Show all variants">?</span>
              <div class="opening-variants-popover" role="tooltip">
                <div class="opening-variants-popover-title">All variants</div>
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

  // ── Router ──

  let pendingReviewHistory = null;
  let pendingAnalysisHistory = null;

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
    } else if (parts[0] === 'openings') {
      renderOpenings();
    } else if (parts[0] === 'aivai') {
      renderAivai();
    } else if (parts[0] === 'settings') {
      renderSettings();
    } else if (parts[0] === 'analysis') {
      const initial = pendingAnalysisHistory;
      pendingAnalysisHistory = null;
      renderAnalysis(null, initial);
    } else if (parts[0] === 'review') {
      renderAnalysis(pendingReviewHistory);
      pendingReviewHistory = null;
    } else {
      renderHome();
    }
  }

  // ── Global API for cross-component communication ──

  window.UTTT_APP = {
    navigate: navigate,
    startReview: (history) => {
      pendingReviewHistory = history;
      navigate('#/review');
    },
    startAnalysisFromMoves: (history) => {
      pendingAnalysisHistory = history;
      navigate('#/analysis');
    },
  };

  // ── Init ──

  window.addEventListener('hashchange', route);

  route();
})();
