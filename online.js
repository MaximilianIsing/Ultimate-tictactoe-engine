'use strict';

class OnlineManager {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.side = null;
    this.onRoomCreated = null;
    this.onOpponentJoined = null;
    this.onJoined = null;
    this.onOpponentMove = null;
    this.onOpponentDisconnected = null;
    this.onRematchRequested = null;
    this.onRematchAccepted = null;
    this.onError = null;
    this.onConnectionChange = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState <= 1) {
        resolve();
        return;
      }

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${location.host}`;

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }

      this.ws.onopen = () => {
        if (this.onConnectionChange) this.onConnectionChange('connected');
        resolve();
      };

      this.ws.onclose = () => {
        if (this.onConnectionChange) this.onConnectionChange('disconnected');
      };

      this.ws.onerror = () => {
        if (this.onConnectionChange) this.onConnectionChange('error');
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this._handleMessage(msg);
      };
    });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'created':
        this.roomId = msg.room;
        this.side = msg.side === 'x' || msg.side === 'o' ? msg.side : null;
        // Preserve undefined when absent so the host client keeps lobby time control (older servers).
        this.timeControl = msg.timeControl != null ? msg.timeControl : null;
        if (this.onRoomCreated) {
          const sd = msg.side === 'x' || msg.side === 'o' ? msg.side : null;
          this.onRoomCreated(msg.room, sd, msg.timeControl);
        }
        break;
      case 'joined':
        this.roomId = msg.room;
        this.side = msg.side;
        this.timeControl = msg.timeControl != null ? msg.timeControl : null;
        if (this.onJoined) this.onJoined(msg.room, msg.side, msg.timeControl);
        break;
      case 'opponent_joined': {
        const sd = msg.side === 'x' || msg.side === 'o' ? msg.side : null;
        if (sd) this.side = sd;
        if (this.onOpponentJoined) this.onOpponentJoined(sd);
        break;
      }
      case 'opponent_move':
        if (this.onOpponentMove) this.onOpponentMove(msg.move);
        break;
      case 'opponent_disconnected':
        if (this.onOpponentDisconnected) this.onOpponentDisconnected();
        break;
      case 'rematch_requested':
        if (this.onRematchRequested) this.onRematchRequested();
        break;
      case 'rematch_accepted':
        this.side = msg.side;
        if (this.onRematchAccepted) this.onRematchAccepted(msg.side);
        break;
      case 'error':
        if (this.onError) this.onError(msg.message);
        break;
    }
  }

  createRoom(timeControl, hostSide) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const tc = timeControl != null ? String(timeControl) : 'unlimited';
    const hsRaw = hostSide != null ? String(hostSide).toLowerCase() : 'x';
    const hs = hsRaw === 'o' ? 'o' : hsRaw === 'random' ? 'random' : 'x';
    this.ws.send(JSON.stringify({ type: 'create', timeControl: tc, hostSide: hs }));
  }

  joinRoom(roomId) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'join', room: roomId }));
  }

  sendMove(move) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'move', move }));
  }

  requestRematch() {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'rematch' }));
  }

  disconnect() {
    this.roomId = null;
    this.side = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

if (typeof window !== 'undefined') {
  window.OnlineManager = OnlineManager;
}
