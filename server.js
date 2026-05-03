'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Room management ──

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  } while (rooms.has(code));
  return code;
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const p of room.players) {
    if (p.ws && p.ws.readyState <= 1) {
      p.ws.close();
    }
  }
  rooms.delete(roomId);
}

const ROOM_TIMEOUT_MS = 30 * 60 * 1000;

function normalizeTimeControl(raw) {
  const allowed = new Set(['bullet', 'blitz', 'rapid', 'unlimited']);
  const v = String(raw || '').toLowerCase();
  return allowed.has(v) ? v : 'unlimited';
}

function normalizeHostSide(raw) {
  const v = String(raw ?? 'x').toLowerCase();
  if (v === 'o' || v === 'second') return 'o';
  if (v === 'random' || v === 'rand' || v === '?') return 'random';
  return 'x';
}

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerIndex = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const roomId = generateRoomCode();
      const timeControl = normalizeTimeControl(msg.timeControl);
      const hostPref = normalizeHostSide(msg.hostSide);
      const hostSide = hostPref === 'random' ? null : hostPref;
      const room = {
        id: roomId,
        players: [{ ws, side: hostSide }],
        moves: [],
        started: false,
        createdAt: Date.now(),
        timeControl,
        hostSidePref: hostPref,
      };
      rooms.set(roomId, room);
      playerRoom = roomId;
      playerIndex = 0;

      ws.send(JSON.stringify({
        type: 'created',
        room: roomId,
        side: hostSide,
        sidePending: hostSide == null,
        timeControl,
      }));

      room.timeout = setTimeout(() => cleanupRoom(roomId), ROOM_TIMEOUT_MS);
    }

    else if (msg.type === 'join') {
      const roomId = (msg.room || '').toUpperCase();
      const room = rooms.get(roomId);

      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
        return;
      }
      if (room.players.length >= 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
        return;
      }

      let hostSide = room.players[0].side;
      let guestSide;
      if (hostSide == null) {
        const hostIsX = crypto.randomInt(2) === 0;
        hostSide = hostIsX ? 'x' : 'o';
        guestSide = hostIsX ? 'o' : 'x';
        room.players[0].side = hostSide;
      } else {
        guestSide = hostSide === 'x' ? 'o' : 'x';
      }

      room.players.push({ ws, side: guestSide });
      playerRoom = roomId;
      playerIndex = 1;
      room.started = true;

      ws.send(JSON.stringify({
        type: 'joined',
        room: roomId,
        side: guestSide,
        timeControl: room.timeControl || 'unlimited',
      }));

      const host = room.players[0];
      if (host.ws && host.ws.readyState === 1) {
        host.ws.send(JSON.stringify({ type: 'opponent_joined', side: hostSide }));
      }
    }

    else if (msg.type === 'move') {
      if (!playerRoom) return;
      const room = rooms.get(playerRoom);
      if (!room || !room.started) return;

      const expectedSide = room.moves.length % 2 === 0 ? 'x' : 'o';
      const mySide = room.players[playerIndex]?.side;
      if (mySide !== expectedSide) return;

      room.moves.push(msg.move);

      const opponent = room.players[1 - playerIndex];
      if (opponent?.ws?.readyState === 1) {
        opponent.ws.send(JSON.stringify({ type: 'opponent_move', move: msg.move }));
      }
    }

    else if (msg.type === 'rematch') {
      if (!playerRoom) return;
      const room = rooms.get(playerRoom);
      if (!room) return;

      if (!room.rematchVotes) room.rematchVotes = new Set();
      room.rematchVotes.add(playerIndex);

      if (room.rematchVotes.size >= 2) {
        room.moves = [];
        room.rematchVotes = null;
        for (const p of room.players) {
          p.side = p.side === 'x' ? 'o' : 'x';
          if (p.ws?.readyState === 1) {
            p.ws.send(JSON.stringify({ type: 'rematch_accepted', side: p.side }));
          }
        }
      } else {
        const opponent = room.players[1 - playerIndex];
        if (opponent?.ws?.readyState === 1) {
          opponent.ws.send(JSON.stringify({ type: 'rematch_requested' }));
        }
      }
    }
  });

  ws.on('close', () => {
    if (!playerRoom) return;
    const room = rooms.get(playerRoom);
    if (!room) return;

    const opponent = room.players[1 - playerIndex];
    if (opponent?.ws?.readyState === 1) {
      opponent.ws.send(JSON.stringify({ type: 'opponent_disconnected' }));
    }

    cleanupRoom(playerRoom);
    playerRoom = null;
  });
});

// ── Puzzle system ──

const PUZZLE_BUFFER = 10;
const INITIAL_POOL_TARGET = 500;
const PUZZLES_FILE = path.join(__dirname, 'data', 'puzzles.json');

const puzzlePool = [];
const userSeen = new Map();
let puzzleGenRunning = false;

function loadPuzzlesFromDisk() {
  try {
    if (fs.existsSync(PUZZLES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PUZZLES_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        puzzlePool.push(...data);
        console.log(`[puzzles] Loaded ${data.length} puzzles from disk`);
      }
    }
  } catch (err) {
    console.error('[puzzles] Failed to load puzzles from disk:', err.message);
  }
}

function savePuzzlesToDisk() {
  try {
    const dir = path.dirname(PUZZLES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PUZZLES_FILE, JSON.stringify(puzzlePool, null, 2));
  } catch (err) {
    console.error('[puzzles] Failed to save puzzles to disk:', err.message);
  }
}

loadPuzzlesFromDisk();

function getUserId(req) {
  return req.query.uid || req.body?.uid || 'anon';
}

function getSeenSet(uid) {
  if (!userSeen.has(uid)) userSeen.set(uid, new Set());
  return userSeen.get(uid);
}

function maxPuzzlesSeen() {
  let mx = 0;
  for (const s of userSeen.values()) mx = Math.max(mx, s.size);
  return mx;
}

function needsMorePuzzles() {
  const needed = maxPuzzlesSeen() + PUZZLE_BUFFER;
  return puzzlePool.length < Math.max(needed, INITIAL_POOL_TARGET);
}

function generateTarget() {
  const needed = maxPuzzlesSeen() + PUZZLE_BUFFER;
  return Math.max(needed, INITIAL_POOL_TARGET) - puzzlePool.length;
}

function triggerGeneration() {
  if (puzzleGenRunning) return;
  if (!needsMorePuzzles()) return;
  puzzleGenRunning = true;
  const target = generateTarget();
  const existingIds = new Set(puzzlePool.map(p => p.id));

  const worker = new Worker(path.join(__dirname, 'puzzle-worker.js'), {
    workerData: { target, existingIds: [...existingIds] },
  });

  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      console.log(`[puzzles] Generation progress: ${msg.done}/${msg.target}`);
    }
    if (msg.type === 'puzzles') {
      for (const p of msg.puzzles) {
        if (!existingIds.has(p.id)) {
          puzzlePool.push(p);
          existingIds.add(p.id);
        }
      }
      console.log(`[puzzles] Pool now has ${puzzlePool.length} puzzles (added ${msg.puzzles.length})`);
      savePuzzlesToDisk();
    }
  });

  worker.on('exit', () => {
    puzzleGenRunning = false;
    if (needsMorePuzzles()) triggerGeneration();
  });

  worker.on('error', (err) => {
    console.error('[puzzles] Worker error:', err);
    puzzleGenRunning = false;
  });

  console.log(`[puzzles] Starting generation of ${target} puzzles...`);
}

app.get('/api/puzzles/next', (req, res) => {
  const uid = getUserId(req);
  const seen = getSeenSet(uid);

  const unseen = [];
  for (let i = 0; i < puzzlePool.length; i++) {
    if (!seen.has(i)) unseen.push(i);
  }

  if (unseen.length === 0) {
    triggerGeneration();
    return res.json({ puzzle: null, poolSize: puzzlePool.length, generating: puzzleGenRunning });
  }

  const idx = unseen[Math.floor(Math.random() * unseen.length)];
  seen.add(idx);
  const puzzle = puzzlePool[idx];

  if (needsMorePuzzles()) triggerGeneration();

  res.json({ puzzle, index: idx, poolSize: puzzlePool.length, generating: puzzleGenRunning });
});

app.get('/api/puzzles/status', (_req, res) => {
  res.json({ poolSize: puzzlePool.length, generating: puzzleGenRunning });
});

triggerGeneration();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ultimate Tic-Tac-Toe server running on http://localhost:${PORT}`);
});
