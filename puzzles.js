'use strict';

(() => {
  const STREAK_KEY = 'uttt-puzzle-streak';
  const BEST_STREAK_KEY = 'uttt-puzzle-best-streak';
  const UID_KEY = 'uttt-puzzle-uid';

  function getUTTTState() {
    return self.UTTTEngineV3?.UTTTState
      || self.UTTTEngineV2?.UTTTState
      || self.UTTTEngine?.UTTTState;
  }

  function getUid() {
    let uid = null;
    try { uid = localStorage.getItem(UID_KEY); } catch { /* ignore */ }
    if (!uid) {
      uid = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem(UID_KEY, uid); } catch { /* ignore */ }
    }
    return uid;
  }

  // ── PuzzleManager ──

  class PuzzleManager {
    constructor() {
      this.uid = getUid();
      this.streak = this._loadInt(STREAK_KEY, 0);
      this.bestStreak = this._loadInt(BEST_STREAK_KEY, 0);
      this.generating = false;
    }

    _loadInt(key, fallback) {
      try {
        const v = parseInt(localStorage.getItem(key), 10);
        return Number.isFinite(v) ? v : fallback;
      } catch { return fallback; }
    }

    _saveStreak() {
      try {
        localStorage.setItem(STREAK_KEY, String(this.streak));
        localStorage.setItem(BEST_STREAK_KEY, String(this.bestStreak));
      } catch { /* ignore */ }
    }

    async fetchNext() {
      const res = await fetch(`/api/puzzles/next?uid=${encodeURIComponent(this.uid)}`);
      const data = await res.json();
      this.generating = data.generating || false;
      return data.puzzle || null;
    }

    async fetchStatus() {
      const res = await fetch('/api/puzzles/status');
      const data = await res.json();
      this.generating = data.generating || false;
      return data;
    }

    checkAnswer(puzzle, moveInt) {
      const correct = moveInt === puzzle.bestMove;

      if (correct) {
        this.streak++;
        if (this.streak > this.bestStreak) this.bestStreak = this.streak;
      } else {
        this.streak = 0;
      }
      this._saveStreak();
      return correct;
    }

    getStreak() {
      return { current: this.streak, best: this.bestStreak };
    }
  }

  // ── PuzzleBoard ──

  class PuzzleBoard {
    constructor(containerEl, options = {}) {
      this.container = containerEl;
      this.onCellClick = options.onCellClick || null;
      this.state = null;
      this.cellEls = new Array(81);
      this.smallEls = new Array(9);
      this.locked = false;
      this._build();
    }

    _build() {
      this.container.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'board-wrapper puzzle-board-wrapper';

      const metaBoard = document.createElement('div');
      metaBoard.className = 'meta-board';
      this.metaBoard = metaBoard;

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
          cell.addEventListener('click', () => this._handleClick(b, c));
          small.appendChild(cell);
          this.cellEls[b * 9 + c] = cell;
        }
        metaBoard.appendChild(small);
        this.smallEls[b] = small;
      }

      wrapper.appendChild(metaBoard);
      this.container.appendChild(wrapper);
    }

    _handleClick(boardIdx, cellIdx) {
      if (this.locked) return;
      if (!this.state || this.state.winner !== 0) return;
      if (!this._isLegal(boardIdx, cellIdx)) return;
      if (this.onCellClick) {
        this.onCellClick(boardIdx * 9 + cellIdx, boardIdx, cellIdx);
      }
    }

    _isLegal(boardIdx, cellIdx) {
      const s = this.state;
      if (!s || s.winner !== 0) return false;
      if (s.bigSettled & (1 << boardIdx)) return false;
      if ((s.smallX[boardIdx] | s.smallO[boardIdx]) & (1 << cellIdx)) return false;
      if (s.activeBoard !== -1 && s.activeBoard !== boardIdx
          && !(s.bigSettled & (1 << s.activeBoard))) return false;
      return true;
    }

    loadState(serialized) {
      const State = getUTTTState();
      if (!State) return;
      this.state = State.deserialize(serialized);
      this.locked = false;
      this.render();
    }

    render() {
      const s = this.state;
      if (!s) return;

      for (let b = 0; b < 9; b++) {
        const small = this.smallEls[b];
        const winState = s.bigState[b];
        const winnerChar = winState === 1 ? 'X' : winState === 2 ? 'O' : winState === 3 ? '-' : null;
        small.classList.toggle('won', winnerChar !== null);
        if (winnerChar) small.dataset.winner = winnerChar;
        else delete small.dataset.winner;

        const isActive =
          s.winner === 0 &&
          winnerChar === null &&
          (s.activeBoard === -1
            || s.activeBoard === b
            || (s.bigSettled & (1 << s.activeBoard)));
        small.classList.toggle('active', isActive);

        for (let c = 0; c < 9; c++) {
          const cell = this.cellEls[b * 9 + c];
          const xBit = s.smallX[b] & (1 << c);
          const oBit = s.smallO[b] & (1 << c);
          cell.textContent = '';
          cell.classList.remove('puzzle-correct', 'puzzle-wrong', 'puzzle-reveal', 'last-move', 'hint-best', 'hint-other');
          const oldBadge = cell.querySelector('.hint-rank');
          if (oldBadge) oldBadge.remove();

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
          const playable = s.winner === 0 && winnerChar === null && isActive && !xBit && !oBit;
          cell.disabled = !playable || this.locked;
        }
      }
    }

    showCorrect(moveInt) {
      const cell = this.cellEls[moveInt];
      if (cell) cell.classList.add('puzzle-correct');
    }

    showWrong(moveInt) {
      const cell = this.cellEls[moveInt];
      if (cell) cell.classList.add('puzzle-wrong');
    }

    revealBest(moveInt) {
      const cell = this.cellEls[moveInt];
      if (cell) cell.classList.add('puzzle-reveal');
    }

    lock() {
      this.locked = true;
      for (const cell of this.cellEls) cell.disabled = true;
    }

    destroy() {
      this.container.innerHTML = '';
    }
  }

  // ── Expose globally ──

  self.UTTTPuzzles = {
    PuzzleManager,
    PuzzleBoard,
  };
})();
