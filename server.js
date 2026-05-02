'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerIndex = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const roomId = generateRoomCode();
      const room = {
        id: roomId,
        players: [{ ws, side: 'x' }],
        moves: [],
        started: false,
        createdAt: Date.now(),
      };
      rooms.set(roomId, room);
      playerRoom = roomId;
      playerIndex = 0;

      ws.send(JSON.stringify({ type: 'created', room: roomId, side: 'x' }));

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

      room.players.push({ ws, side: 'o' });
      playerRoom = roomId;
      playerIndex = 1;
      room.started = true;

      ws.send(JSON.stringify({ type: 'joined', room: roomId, side: 'o' }));

      const host = room.players[0];
      if (host.ws && host.ws.readyState === 1) {
        host.ws.send(JSON.stringify({ type: 'opponent_joined' }));
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ultimate Tic-Tac-Toe server running on http://localhost:${PORT}`);
});
