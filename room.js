/* =====================================================================
 * PMX Video DJ — room.js
 *
 * Host-only client for the /ws/room API (see BackEnd/docs/ws-room-api.md).
 * This TV app plays two roles on one page: it creates the room (host, via
 * RoomClient below) and then plays inside that same room (via the
 * room-scoped DJSyncClient in script.js). It never browses or joins other
 * rooms — that belongs to the guest/controller webapp.
 *
 * Each time RoomClient obtains a room id, it hands it to script.js's
 * startPlayerSync() to (re)open the room-scoped /ws/sync connection. When
 * the room goes away, it calls stopPlayerSync() so playback doesn't keep
 * talking to a dead room.
 * ===================================================================== */

/* ===================== Room Code UI ===================== */
function updateRoomCodeUI(room, statusOverride) {
  const valueEl   = document.getElementById('roomCodeValue');
  const membersEl = document.getElementById('roomCodeMembers');
  if (!valueEl || !membersEl) return;

  if (room) {
    valueEl.textContent   = room.id;
    membersEl.textContent = `${room.member_count} connected`;
  } else {
    valueEl.textContent   = '— — — — — —';
    membersEl.textContent = statusOverride || 'Connecting…';
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
      stopPlayerSync();
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
        startPlayerSync(this.room.id);
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
        stopPlayerSync();
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
