/* =====================================================================
 * PMX Video DJ — room.js
 *
 * Host-only client for the /ws/room API (see BackEnd/docs/ws-room-api.md).
 * This TV app always plays the "host" role: it creates a room on load so
 * guests can later join it by code. It never browses or joins other rooms.
 *
 * Note: room membership does not (yet) scope /ws/sync playback traffic —
 * this only makes the room exist and its code visible.
 * ===================================================================== */

/* ===================== Room Code UI ===================== */
function updateRoomCodeUI(room) {
  const valueEl   = document.getElementById('roomCodeValue');
  const membersEl = document.getElementById('roomCodeMembers');
  if (!valueEl || !membersEl) return;

  if (room) {
    valueEl.textContent   = room.id;
    membersEl.textContent = `${room.member_count} connected`;
  } else {
    valueEl.textContent   = '— — — — — —';
    membersEl.textContent = 'Connecting…';
  }
}

/* ===================== Room Client ===================== */
class RoomClient {
  constructor() {
    this.ws                = null;
    this.reconnectAttempts = 0;
    this.pingInterval      = null;
    this.room               = null;
    updateRoomCodeUI(null);
    this.connect();
  }

  connect() {
    const url = resolveWsUrl('/ws/room');
    console.log(`[Room] Connecting to ${url}`);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[Room] Connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.send('create_room', { name: CONFIG.ROOM_NAME });
    };
    this.ws.onmessage = (e) => {
      try { this.handleMessage(JSON.parse(e.data)); }
      catch (err) { console.error('[Room] Parse error:', err); }
    };
    this.ws.onclose = () => {
      console.log('[Room] Disconnected');
      this.stopHeartbeat();
      this.room = null;
      updateRoomCodeUI(null);
      this.retry();
    };
    this.ws.onerror = (err) => { console.error('[Room] Error:', err); };
  }

  startHeartbeat() {
    this.pingInterval = setInterval(() => {
      this.send('ping', {});
    }, CONFIG.ROOM_PING_INTERVAL_MS);
  }

  stopHeartbeat() {
    clearInterval(this.pingInterval);
    this.pingInterval = null;
  }

  retry() {
    const delay = Math.min(
      CONFIG.WS_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      CONFIG.WS_MAX_DELAY_MS
    );
    console.log(`[Room] Reconnecting in ${delay / 1000}s...`);
    setTimeout(() => { this.reconnectAttempts++; this.connect(); }, delay);
  }

  send(type, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  handleMessage({ type, data }) {
    switch (type) {
      case 'room_created':
        this.room = data;
        console.log(`[Room] Created id=${data.id} name="${data.name}"`);
        updateRoomCodeUI(this.room);
        break;

      case 'member_joined':
      case 'member_left':
        if (this.room) {
          this.room.member_count = data.member_count;
          updateRoomCodeUI(this.room);
        }
        break;

      case 'room_closed':
        console.warn(`[Room] Closed: ${data.reason}`);
        this.room = null;
        updateRoomCodeUI(null);
        break;

      case 'error':
        console.error(`[Room] ${data.code}: ${data.message}`);
        break;

      case 'pong':
      case 'rooms_list':
        break;
    }
  }
}

const roomClient = new RoomClient();
