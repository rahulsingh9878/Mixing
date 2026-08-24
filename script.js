/* =====================================================================
 * PMX Video DJ — script.js
 * ===================================================================== */

/* ===================== Configuration ===================== */
const CONFIG = Object.freeze({
  FADE_DURATION_MS:              5000,
  PLAYLIST_PRELOAD_THRESHOLD_S:  30,
  PLAYLIST_REFRESH_INTERVAL_MS:  2000,
  CROSSFADE_LOCK_MS:             15000,
  OVERLAY_DISPLAY_MS:            2000,
  HEARTBEAT_INTERVAL_MS:         5000,
  DEFAULT_START_SECONDS:         12,
  MIN_START_SECONDS:             10,
  CURSOR_HIDE_MS:                5000,
  QR_FADE_MS:                    400,
  WS_BASE_DELAY_MS:              3000,
  WS_MAX_DELAY_MS:               30000,
  ROOM_PING_INTERVAL_MS:         30000,
  ROOM_NAME:        'PMX Video DJ Session',
  NGROK_WS_URL:     'wss://unappendaged-aretha-unwaning.ngrok-free.dev',
  QR_LOCAL_URL:     'http://0.0.0.0:8045/qr/',
  QR_REMOTE_URL:    'https://unappendaged-aretha-unwaning.ngrok-free.dev/qr/',
  DEFAULT_VIDEO_1:  '4rJ9z6IXnb8',
  DEFAULT_VIDEO_2:  'p2EdDiiVHh4',
});

/* ===================== Utilities ===================== */
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Safely invoke a method on a YouTube IFrame player, suppressing API errors.
 * @returns {*} Return value of the method, or undefined on failure.
 */
function safeCall(player, method, ...args) {
  try {
    if (player && typeof player[method] === 'function') {
      return player[method](...args);
    }
  } catch (_) { /* suppress YouTube IFrame API errors */ }
  return undefined;
}

/** Invoke a player method on both player1 and player2. */
function forBothPlayers(method, ...args) {
  safeCall(player1, method, ...args);
  safeCall(player2, method, ...args);
}

/** Poll a condition every `intervalMs` up to `maxAttempts` times, then resolve. */
function pollUntil(conditionFn, intervalMs, maxAttempts) {
  return new Promise(resolve => {
    let attempts = 0;
    const id = setInterval(() => {
      attempts++;
      if (conditionFn() || attempts >= maxAttempts) {
        clearInterval(id);
        resolve();
      }
    }, intervalMs);
  });
}

/** Build a ws(s):// URL for `path`, auto-detecting local vs. remote (ngrok) host. */
function resolveWsUrl(path, query = '') {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    || window.location.hostname.startsWith('192.168.');

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = isLocal ? `${protocol}//${window.location.host}` : CONFIG.NGROK_WS_URL;

  return `${base}${path}${query ? `?${query}` : ''}`;
}

function extractVideoID(text) {
  if (!text) return '';
  text = text.trim();
  const match = text.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/)([0-9A-Za-z_-]{11})/);
  if (match) return match[1];
  return /^[0-9A-Za-z_-]{11}$/.test(text) ? text : '';
}

function extractPlaylistID(text) {
  if (!text) return '';
  text = text.trim();
  const match = text.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return /^(PL|RD|UU|LL|FL|OL)[a-zA-Z0-9_-]+$/.test(text) ? text : '';
}

/* ===================== Fullscreen ===================== */
function enterFullscreen() {
  const el = document.documentElement;
  (el.requestFullscreen || el.mozRequestFullScreen || el.webkitRequestFullscreen || el.msRequestFullscreen)?.call(el);
}

function exitFullscreen() {
  (document.exitFullscreen || document.mozCancelFullScreen || document.webkitExitFullscreen || document.msExitFullscreen)?.call(document);
}

function toggleFullscreen() {
  document.fullscreenElement ? exitFullscreen() : enterFullscreen();
}

/* ===================== Global State ===================== */
let player1 = null;
let player2 = null;
let fadeInterval = null;
let direction = true; // true: p1 fades OUT → p2 fades IN; flips after each crossfade
let maxVol = 100;
let isMuted = false;

/** Consolidated playlist state — avoids scattered top-level variables. */
const playlist = {
  active:        false,
  id:            null,
  items:         [],
  index:         0,
  hasLoadedNext: false,
  nextVideoId:   CONFIG.DEFAULT_VIDEO_2,
  monitorInterval: null,
  refreshInterval: null,
};

/* ===================== Player Queries ===================== */
function getActivePlayer() {
  const p1Elem = document.getElementById('player1');
  if (!p1Elem) return null;
  return parseFloat(window.getComputedStyle(p1Elem).opacity) > 0.5 ? player1 : player2;
}

function getInactivePlayer() {
  const active = getActivePlayer();
  if (!active) return null;
  return active === player1 ? player2 : player1;
}

function getPlayerElement(player) {
  return document.getElementById(player === player1 ? 'player1' : 'player2');
}

/* ===================== Notification Dot ===================== */
let _notificationEl = null;

function getNotificationEl() {
  if (!_notificationEl) {
    _notificationEl = document.createElement('div');
    _notificationEl.className = 'notification';
    document.body.appendChild(_notificationEl);
  }
  return _notificationEl;
}

function startBlinkingSquare() {
  const square = getNotificationEl();
  square.style.display = 'block';
  square.classList.add('blinking');
  setTimeout(() => {
    square.classList.remove('blinking');
    square.style.display = 'none';
  }, CONFIG.OVERLAY_DISPLAY_MS);
}

/* ===================== Overlay Info ===================== */
function updateOverlayInfo() {
  const overlayEl = document.querySelector('.overlay-info');
  const modeEl    = document.querySelector('.overlay-info .mode');
  const countEl   = document.querySelector('.overlay-info .count');

  overlayEl.style.display = 'block';

  if (playlist.active) {
    modeEl.textContent  = '🎵 Playlist Mode';
    countEl.textContent = `Track ${playlist.index + 1} of ${playlist.items.length}`;
  } else {
    modeEl.textContent  = '🎧 Single Mode';
    countEl.textContent = '';
  }

  setTimeout(() => { overlayEl.style.display = 'none'; }, CONFIG.OVERLAY_DISPLAY_MS);
}

/* ===================== YouTube Player Setup ===================== */
function onYouTubeIframeAPIReady() {
  const sharedVars = {
    controls:        0,
    rel:             0,
    showinfo:        0,
    modestbranding:  1,
    enablejsapi:     1,
    origin:          window.location.origin || 'http://localhost',
  };

  player1 = new YT.Player('player1', {
    videoId:     CONFIG.DEFAULT_VIDEO_1,
    playerVars:  { ...sharedVars, autoplay: 1, start: 12, mute: 0 },
    events:      { onStateChange: onPlayerStateChange },
  });

  player2 = new YT.Player('player2', {
    videoId:     CONFIG.DEFAULT_VIDEO_2,
    playerVars:  { ...sharedVars, autoplay: 0, start: 12 },
    events:      { onStateChange: onPlayerStateChange },
  });
}

/* ===================== Player State Handler ===================== */
function onPlayerStateChange(event) {
  switch (event.data) {
    case YT.PlayerState.PLAYING:
      syncClient?.send('control', { action: 'stateChange', state: 'playing' });
      if (playlist.active) startPlaylistMonitoring();
      break;
    case YT.PlayerState.PAUSED:
      syncClient?.send('control', { action: 'stateChange', state: 'paused' });
      break;
    case YT.PlayerState.ENDED:
      if (playlist.active && playlist.items.length > 0) {
        setTimeout(loadNextFromPlaylist, 1000);
      }
      break;
  }
}

/* ===================== Playlist Monitoring ===================== */
function startPlaylistMonitoring() {
  stopPlaylistMonitoring();
  playlist.monitorInterval = setInterval(() => {
    if (!playlist.active || playlist.items.length === 0) {
      stopPlaylistMonitoring();
      return;
    }
    try {
      const activePlayer = getActivePlayer();
      const remaining = activePlayer.getDuration() - activePlayer.getCurrentTime();
      // Preload next track when approaching the end
      if (remaining <= CONFIG.PLAYLIST_PRELOAD_THRESHOLD_S && remaining > CONFIG.PLAYLIST_PRELOAD_THRESHOLD_S - 5) {
        loadNextFromPlaylist();
      }
    } catch (_) { /* player not yet ready */ }
  }, 500);
}

function stopPlaylistMonitoring() {
  clearInterval(playlist.monitorInterval);
  playlist.monitorInterval = null;
}

/* ===================== Playlist Refresh Checker ===================== */
function startPlaylistRefreshChecker() {
  stopPlaylistRefreshChecker();
  playlist.refreshInterval = setInterval(async () => {
    if (!playlist.active || !playlist.id) {
      stopPlaylistRefreshChecker();
      return;
    }
    if (!playlist.hasLoadedNext) {
      await refreshPlaylistCheck();
    }
  }, CONFIG.PLAYLIST_REFRESH_INTERVAL_MS);
}

function stopPlaylistRefreshChecker() {
  clearInterval(playlist.refreshInterval);
  playlist.refreshInterval = null;
}

async function refreshPlaylistCheck() {
  if (!playlist.active || !playlist.id) return;

  try {
    const checkPlayer = getInactivePlayer();
    checkPlayer.loadPlaylist({ listType: 'playlist', list: playlist.id, index: 0 });
    await wait(1000);

    const updated = checkPlayer.getPlaylist();
    if (!updated || updated.length <= playlist.items.length) {
      safeCall(checkPlayer, 'stopVideo');
      return;
    }

    const newSongs       = updated.slice(playlist.items.length);
    const hasUniqueSongs = newSongs.some(id => !playlist.items.includes(id));

    if (hasUniqueSongs) {
      playlist.items = updated;
      updateOverlayInfo();
      startBlinkingSquare();

      const newSongId          = playlist.items[playlist.items.length - newSongs.length];
      playlist.hasLoadedNext   = true;
      playlist.nextVideoId     = newSongId;
      loadIntoInactiveAndCrossfade(newSongId);
      setTimeout(() => { playlist.hasLoadedNext = false; }, CONFIG.CROSSFADE_LOCK_MS);
    } else {
      playlist.items = updated;
      updateOverlayInfo();
    }

    safeCall(checkPlayer, 'stopVideo');
  } catch (error) {
    console.error('[PMX] Playlist refresh error:', error);
  }
}

/* ===================== Playlist Navigation ===================== */
function loadNextFromPlaylist() {
  if (!playlist.active || playlist.items.length === 0 || playlist.hasLoadedNext) return;

  playlist.hasLoadedNext = true;
  playlist.index         = (playlist.index + 1) % playlist.items.length;
  const nextVideoId      = playlist.items[playlist.index];

  console.log(`[PMX] Next track ${playlist.index + 1}/${playlist.items.length}: ${nextVideoId}`);
  updateOverlayInfo();
  playlist.nextVideoId = nextVideoId;
  loadIntoInactiveAndCrossfade(nextVideoId);
  setTimeout(() => { playlist.hasLoadedNext = false; }, CONFIG.CROSSFADE_LOCK_MS);
}

function loadPrevFromPlaylist() {
  if (!playlist.active || playlist.items.length === 0 || playlist.hasLoadedNext) return;

  playlist.hasLoadedNext = true;
  playlist.index         = (playlist.index - 1 + playlist.items.length) % playlist.items.length;
  const prevVideoId      = playlist.items[playlist.index];

  console.log(`[PMX] Prev track ${playlist.index + 1}/${playlist.items.length}: ${prevVideoId}`);
  updateOverlayInfo();
  playlist.nextVideoId = prevVideoId;
  loadIntoInactiveAndCrossfade(prevVideoId);
  setTimeout(() => { playlist.hasLoadedNext = false; }, CONFIG.CROSSFADE_LOCK_MS);
}

async function loadPlaylistVideos(plId) {
  console.log('[PMX] Loading playlist:', plId);
  playlist.active = true;
  playlist.id     = plId;

  const tempPlayer = direction ? player2 : player1;

  try {
    tempPlayer.loadPlaylist({ listType: 'playlist', list: plId, index: 0 });
    await wait(1000);

    const items = tempPlayer.getPlaylist();
    if (!items || items.length === 0) {
      alert('Could not load playlist. Please try again.');
      playlist.active = false;
      updateOverlayInfo();
      return;
    }

    playlist.items = items;
    playlist.index = 0;
    console.log(`[PMX] Playlist loaded: ${playlist.items.length} tracks`);
    updateOverlayInfo();
    safeCall(tempPlayer, 'stopVideo');

    startPlaylistRefreshChecker();
    playlist.nextVideoId = playlist.items[0];
    loadIntoInactiveAndCrossfade(playlist.items[0]);
  } catch (error) {
    console.error('[PMX] Playlist load error:', error);
    alert('Error loading playlist. Please check the playlist ID.');
    playlist.active = false;
    updateOverlayInfo();
  }
}

function resetPlaylistState() {
  playlist.active        = false;
  playlist.items         = [];
  playlist.index         = 0;
  playlist.hasLoadedNext = false;
  stopPlaylistMonitoring();
  stopPlaylistRefreshChecker();
}

/* ===================== Crossfade ===================== */
async function loadIntoInactiveAndCrossfade(videoId, startSeconds = CONFIG.DEFAULT_START_SECONDS) {
  const targetPlayer = getInactivePlayer();

  if (!targetPlayer || typeof targetPlayer.cueVideoById !== 'function') {
    alert('Player is not ready yet — wait a moment and try again.');
    return;
  }

  const targetElem = getPlayerElement(targetPlayer);
  startSeconds = Math.max(0, parseFloat(startSeconds) || 0);

  safeCall(targetPlayer, 'pauseVideo');
  safeCall(targetPlayer, 'setVolume', 0);
  targetElem.style.opacity = '0';

  try { targetPlayer.cueVideoById(videoId, 0); } catch (_) {
    try { targetPlayer.cueVideoById(videoId); } catch (_) { /* ignore */ }
  }

  // Wait for CUED state (5)
  await pollUntil(
    () => { try { return targetPlayer.getPlayerState() === 5; } catch (_) { return false; } },
    400, 25
  );

  safeCall(targetPlayer, 'setVolume', 0);
  safeCall(targetPlayer, 'playVideo');

  // Wait for PLAYING (1) or BUFFERING (3)
  await pollUntil(
    () => { try { const s = targetPlayer.getPlayerState(); return s === 1 || s === 3; } catch (_) { return false; } },
    200, 15
  );

  if (startSeconds > 0) {
    safeCall(targetPlayer, 'seekTo', startSeconds, true);
    await wait(1400);
    safeCall(targetPlayer, 'setVolume', 0);
    if (safeCall(targetPlayer, 'getPlayerState') !== 1) {
      safeCall(targetPlayer, 'playVideo');
    }
  }

  await wait(800);
  startCrossfade();
}

function startCrossfade() {
  if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }

  let vol1 = direction ? maxVol : 0;
  let vol2 = direction ? 0 : maxVol;

  safeCall(player1, 'setVolume', vol1);
  safeCall(player2, 'setVolume', vol2);
  document.getElementById('player1').style.opacity = String(vol1 / maxVol);
  document.getElementById('player2').style.opacity = String(vol2 / maxVol);

  if (vol1 > 0) safeCall(player1, 'playVideo');
  if (vol2 > 0) safeCall(player2, 'playVideo');

  const stepMs  = CONFIG.FADE_DURATION_MS / 100;
  const volStep = Number((maxVol / 100).toFixed(2));

  fadeInterval = setInterval(() => {
    if (direction) {
      if (vol1 > 0)      vol1 = Number((vol1 - volStep).toFixed(2));
      if (vol2 < maxVol) vol2 = Number((vol2 + volStep).toFixed(2));
    } else {
      if (vol1 < maxVol) vol1 = Number((vol1 + volStep).toFixed(2));
      if (vol2 > 0)      vol2 = Number((vol2 - volStep).toFixed(2));
    }

    safeCall(player1, 'setVolume', Math.round(vol1));
    safeCall(player2, 'setVolume', Math.round(vol2));
    document.getElementById('player1').style.opacity = String(vol1 / maxVol);
    document.getElementById('player2').style.opacity = String(vol2 / maxVol);

    if (vol1 <= 0) safeCall(player1, 'pauseVideo');
    if (vol2 <= 0) safeCall(player2, 'pauseVideo');

    const done = direction
      ? (vol1 <= 0 && vol2 >= maxVol)
      : (vol1 >= maxVol && vol2 <= 0);

    if (done) {
      clearInterval(fadeInterval);
      fadeInterval = null;

      if (direction) {
        safeCall(player1, 'pauseVideo');
        safeCall(player1, 'setVolume', 0);
        safeCall(player2, 'setVolume', maxVol);
      } else {
        safeCall(player2, 'pauseVideo');
        safeCall(player2, 'setVolume', 0);
        safeCall(player1, 'setVolume', maxVol);
      }

      direction = !direction;
    }
  }, stepMs);
}

/* ===================== Volume & Mute ===================== */
function changeVol(vol) {
  try {
    maxVol = vol;
    forBothPlayers('setVolume', vol);
    if (vol > 0) forBothPlayers('unMute');
    if (vol > 0 && isMuted) {
      isMuted = false;
      applyMute(false);
      syncClient?.send('mute', { isMuted: false });
    }
  } catch (e) {
    console.error('[PMX] Volume error:', e);
  }
}

function applyMute(muted) {
  try {
    forBothPlayers(muted ? 'mute' : 'unMute');
    const indicator = document.getElementById('muteIndicator');
    if (indicator) indicator.style.display = muted ? 'flex' : 'none';
  } catch (e) {
    console.error('[PMX] Mute error:', e);
  }
}

function toggleMute() {
  isMuted = !isMuted;
  applyMute(isMuted);
  syncClient?.send('mute', { isMuted });
}

/* ===================== Song Request Handler ===================== */
async function getNextSong(data) {
  console.log(`[PMX] Song request — Title: ${data.title} | VideoID: ${data.videoId} | Timestamp: ${data.timestamp}`);

  const requestedId = data.videoId;
  const requestedTs = data.timestamp;

  if (playlist.nextVideoId !== requestedId && !playlist.hasLoadedNext) {
    playlist.hasLoadedNext = true;
    playlist.nextVideoId   = requestedId;

    const startPosition = Math.max(CONFIG.MIN_START_SECONDS, requestedTs);
    loadIntoInactiveAndCrossfade(requestedId, startPosition);
    setTimeout(() => { playlist.hasLoadedNext = false; }, CONFIG.CROSSFADE_LOCK_MS - 5000);
  }
}

/* ===================== Sync Client ===================== */
class DJSyncClient {
  constructor(role = 'player', roomId = null) {
    this.role              = role;
    this.roomId            = roomId;
    this.ws                = null;
    this.reconnectAttempts = 0;
    this.pingInterval      = null;
    this.dead              = false; // true once the room is gone — stop retrying
    this.connect();
  }

  connect() {
    const query = `role=${this.role}` + (this.roomId ? `&room_id=${this.roomId}` : '');
    const url   = resolveWsUrl('/ws/sync', query);

    console.log(`[Sync] Connecting to ${url}`);
    this.ws = new WebSocket(url);

    this.ws.onopen    = () => { console.log('[Sync] Connected'); this.reconnectAttempts = 0; this.startHeartbeat(); };
    this.ws.onmessage = (e) => { try { this.handleMessage(JSON.parse(e.data)); } catch (err) { console.error('[Sync] Parse error:', err); } };
    this.ws.onclose   = (event) => {
      this.stopHeartbeat();

      if (event.code === 4001) {
        console.warn('[Sync] Room not found — waiting for a new room');
        this.dead = true;
        notifyRoomSessionEnded('Room not found');
        return;
      }

      console.log('[Sync] Disconnected');
      if (this.dead) return; // closed intentionally (room_closed / superseded) — don't retry
      this.retry();
    };
    this.ws.onerror   = (err) => { console.error('[Sync] Error:', err); };
  }

  startHeartbeat() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;

      const payload = { ts: Date.now() };

      if (this.role === 'player') {
        try {
          const active = getActivePlayer();
          if (active) {
            payload.currentTime = active.getCurrentTime?.() ?? 0;
            payload.duration    = active.getDuration?.()    ?? 0;
            payload.videoId     = active.getVideoData?.()?.video_id ?? null;
            payload.state       = active.getPlayerState?.() ?? -1;
          }
        } catch (_) { /* suppress */ }
      }

      this.send('ping', payload);
    }, CONFIG.HEARTBEAT_INTERVAL_MS);
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
    console.log(`[Sync] Reconnecting in ${delay / 1000}s...`);
    setTimeout(() => { this.reconnectAttempts++; this.connect(); }, delay);
  }

  send(type, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  handleMessage({ type, data }) {
    switch (type) {
      case 'play':
        getNextSong(data);
        break;
      case 'vol': {
        const vol = parseInt(data.volume, 10);
        if (!isNaN(vol)) changeVol(vol);
        break;
      }
      case 'control':
        this.handleControl(data);
        break;
      case 'mute':
        if (data && 'isMuted' in data) {
          isMuted = data.isMuted;
          applyMute(isMuted);
        }
        break;
      case 'room_closed':
        console.warn(`[Sync] Room closed (${data?.reason}) — session ended`);
        this.dead = true;
        this.stopHeartbeat();
        try { this.ws.close(); } catch (_) { /* already closing */ }
        notifyRoomSessionEnded('Session ended — scan a new code');
        break;
    }
  }

  handleControl(data) {
    const active = getActivePlayer();
    if (!active || typeof active.getPlayerState !== 'function') {
      console.warn('[Sync] Active player not ready for control');
      return;
    }

    switch (data.action) {
      case 'toggle': {
        if (data.state === 'playing') {
          safeCall(active, 'playVideo');
        } else if (data.state === 'paused') {
          safeCall(active, 'pauseVideo');
        } else {
          const isPlaying = active.getPlayerState() === YT.PlayerState.PLAYING;
          safeCall(active, isPlaying ? 'pauseVideo' : 'playVideo');
        }
        break;
      }
      case 'next': loadNextFromPlaylist(); break;
      case 'prev': loadPrevFromPlaylist(); break;
    }
  }
}

/**
 * The player's /ws/sync connection is room-scoped and therefore doesn't
 * exist until a room is available. `room.js`'s RoomClient owns the room
 * lifecycle and drives these two entry points.
 */
let syncClient = null;

function startPlayerSync(roomId) {
  stopPlayerSync();
  syncClient = new DJSyncClient('player', roomId);
}

function stopPlayerSync() {
  if (!syncClient) return;
  syncClient.dead = true;
  syncClient.stopHeartbeat();
  try { syncClient.ws?.close(); } catch (_) { /* already closing */ }
  syncClient = null;
}

function notifyRoomSessionEnded(reason) {
  console.warn(`[Sync] ${reason}`);
  forBothPlayers('pauseVideo');
  if (typeof updateRoomCodeUI === 'function') updateRoomCodeUI(null, reason);
}

/* ===================== QR Code ===================== */
const QR_API_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? CONFIG.QR_LOCAL_URL
  : CONFIG.QR_REMOTE_URL;

let qrVisible = false;

async function fetchQRCode() {
  try {
    const response = await fetch(QR_API_URL, { headers: { 'ngrok-skip-browser-warning': 'true' } });
    if (!response.ok) throw new Error(`QR fetch failed: ${response.status}`);

    let base64img = (await response.text()).trim().replace(/^"|"$/g, '');
    const qrImage = document.getElementById('qrImage');
    qrImage.src = base64img.startsWith('data:image') ? base64img : `data:image/png;base64,${base64img}`;
  } catch (error) {
    console.error('[PMX] QR fetch error:', error);
  }
}

function toggleQROverlay() {
  const overlay = document.getElementById('qrOverlay');
  qrVisible = !qrVisible;

  if (qrVisible) {
    fetchQRCode();
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('visible'), 10);
    forBothPlayers('pauseVideo');
  } else {
    overlay.classList.remove('visible');
    setTimeout(() => { if (!qrVisible) overlay.style.display = 'none'; }, CONFIG.QR_FADE_MS);
    safeCall(getActivePlayer(), 'playVideo');
  }
}

/* ===================== TV Integration ===================== */
window.addEventListener('tv-fullscreen', toggleFullscreen);
window.addEventListener('tv-show-qr',    toggleQROverlay);
window.addEventListener('tv-play',  () => safeCall(getActivePlayer(), 'playVideo'));
window.addEventListener('tv-pause', () => safeCall(getActivePlayer(), 'pauseVideo'));
window.addEventListener('tv-next',  loadNextFromPlaylist);
window.addEventListener('tv-prev',  loadPrevFromPlaylist);
window.addEventListener('tv-play-pause', () => {
  const active = getActivePlayer();
  if (!active) return;
  const isPlaying = active.getPlayerState() === YT.PlayerState.PLAYING;
  safeCall(active, isPlaying ? 'pauseVideo' : 'playVideo');
});

/* ===================== Inactivity / Cursor Hide ===================== */
let inactivityTimer;

const hideCursor = () => document.body.classList.add('hide-cursor');
const showCursor = () => {
  document.body.classList.remove('hide-cursor');
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(hideCursor, CONFIG.CURSOR_HIDE_MS);
};

['mousemove', 'keydown', 'touchstart'].forEach(evt => document.addEventListener(evt, showCursor));
inactivityTimer = setTimeout(hideCursor, CONFIG.CURSOR_HIDE_MS);

/* ===================== DOM Ready ===================== */
document.addEventListener('DOMContentLoaded', () => {
  fetchQRCode();
  updateOverlayInfo();

  /* ── Video input form ── */
  const form  = document.getElementById('videoForm');
  const input = document.getElementById('videoInput');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value.trim();

    const plId = extractPlaylistID(raw);
    if (plId) {
      input.value = '';
      input.blur();
      loadPlaylistVideos(plId);
      return;
    }

    const vid = extractVideoID(raw);
    if (!vid) {
      alert('Please paste a valid YouTube video ID, URL, or Playlist ID.');
      return;
    }

    if (playlist.active) {
      resetPlaylistState();
      updateOverlayInfo();
    }

    input.value = '';
    input.blur();
    loadIntoInactiveAndCrossfade(vid);
  });

  document.body.addEventListener('click', () => input.focus());

  /* ── Input visibility on typing ── */
  const inputWrapper = document.querySelector('.input-wrapper');
  let typingTimer;
  const HIDE_AFTER_MS = 2000;

  const hideInput = () => {
    if (!input.value.trim()) {
      inputWrapper.style.opacity = '0';
      if (document.activeElement === input) input.blur();
    }
  };

  const showInput = () => {
    inputWrapper.style.opacity = '1';
    clearTimeout(typingTimer);
    typingTimer = setTimeout(hideInput, HIDE_AFTER_MS);
  };

  input.addEventListener('focus', showInput);
  input.addEventListener('blur',  () => { if (!input.value.trim()) setTimeout(hideInput, 100); });
  input.addEventListener('input', showInput);

  if (input.value.trim()) showInput();

  /* ── Keyboard shortcuts ── */
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && qrVisible) { toggleQROverlay(); return; }
    if (document.activeElement.tagName === 'INPUT') return;

    switch (event.key.toLowerCase()) {
      case 'f': event.preventDefault(); toggleFullscreen(); break;
      case 'q': toggleQROverlay(); break;
      case 'm': toggleMute(); break;
    }
  });
});
