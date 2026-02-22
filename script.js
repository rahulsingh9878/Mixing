/* =====================================================================
   DJ Crossfader — script.js  (refactored)
   ===================================================================== */

/* ── Fullscreen helpers ─────────────────────────────────────────────── */
const elem = document.documentElement;

function enterFullscreen() {
  const fn =
    elem.requestFullscreen ||
    elem.mozRequestFullScreen ||
    elem.webkitRequestFullscreen ||
    elem.msRequestFullscreen;
  if (fn) fn.call(elem);
}

function exitFullscreen() {
  const fn =
    document.exitFullscreen ||
    document.mozCancelFullScreen ||
    document.webkitExitFullscreen ||
    document.msExitFullscreen;
  if (fn) fn.call(document);
}

function toggleFullscreen() {
  document.fullscreenElement ? exitFullscreen() : enterFullscreen();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    toggleFullscreen();
  }
});

/* ── Centralised application state ─────────────────────────────────── */
const AppState = {
  // Players
  player1: null,
  player2: null,

  // Crossfade
  fadeInterval: null,
  /** true = p1 fades OUT / p2 fades IN; flips after each crossfade */
  direction: true,

  // Volume / mute
  maxVol: 100,
  isMuted: false,

  // Playlist
  playlistMode: false,
  currentPlaylist: [],
  currentPlaylistIndex: 0,
  playlistId: null,
  hasLoadedNext: false,
  nextSong: 'p2EdDiiVHh4',

  // Interval handles
  playlistCheckInterval: null,
  playlistRefreshInterval: null,

  // Defaults
  defaultVideo1: '4rJ9z6IXnb8',
  defaultVideo2: 'p2EdDiiVHh4',

  // Per-player gesture unlock tracking.
  // Each iframe needs its OWN user-gesture-originated playVideo() to unlock audio.
  // player1Unlocked: set after user taps overlay on first load (player1 visible)
  // player2Unlocked: set after user taps overlay after first crossfade (player2 visible)
  player1Unlocked: false,
  player2Unlocked: false,
};

/* ── Utility ─────────────────────────────────────────────────────────── */
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns the currently-visible player based on player1's opacity.
 */
function getActivePlayer() {
  const p1Opacity = parseFloat(
    window.getComputedStyle(document.getElementById('player1')).opacity
  );
  return p1Opacity > 0.5 ? AppState.player1 : AppState.player2;
}

/**
 * Returns the currently-hidden (inactive) player + its DOM element.
 */
function getInactivePlayer() {
  const p1Elem = document.getElementById('player1');
  const p2Elem = document.getElementById('player2');
  const p1Opacity = parseFloat(window.getComputedStyle(p1Elem).opacity);

  if (isNaN(p1Opacity) || p1Opacity === 0) {
    return { player: AppState.player1, elem: p1Elem };
  }
  return { player: AppState.player2, elem: p2Elem };
}

function extractVideoID(text) {
  if (!text) return '';
  text = text.trim();
  const m = text.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/)([0-9A-Za-z_-]{11})/);
  if (m?.[1]) return m[1];
  if (/^[0-9A-Za-z_-]{11}$/.test(text)) return text;
  return '';
}

function extractPlaylistID(text) {
  if (!text) return '';
  text = text.trim();
  const m = text.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (m?.[1]) return m[1];
  if (/^(PL|RD|UU|LL|FL|OL)[a-zA-Z0-9_-]+$/.test(text)) return text;
  return '';
}

/* ── Overlay / notification helpers ────────────────────────────────── */
function updateOverlayInfo() {
  const overlayEl = document.querySelector('.overlay-info');
  const modeEl = document.querySelector('.overlay-info .mode');
  const countEl = document.querySelector('.overlay-info .count');
  overlayEl.style.display = 'block';

  if (AppState.playlistMode) {
    modeEl.textContent = '🎵 Playlist Mode';
    countEl.textContent = `Track ${AppState.currentPlaylistIndex + 1} of ${AppState.currentPlaylist.length}`;
  } else {
    modeEl.textContent = '🎧 Single Mode';
    countEl.textContent = '';
  }

  setTimeout(() => { overlayEl.style.display = 'none'; }, 2000);
}

function startBlinkingSquare() {
  const square = document.createElement('div');
  square.className = 'notification';
  document.body.appendChild(square);
  square.style.display = 'block';
  square.classList.add('blinking');
  setTimeout(() => {
    square.classList.remove('blinking');
    square.remove();
  }, 2000);
}

/* ── YouTube player initialisation ─────────────────────────────────── */
function onYouTubeIframeAPIReady() {
  const origin = window.location.origin || 'http://localhost';

  // Browser autoplay policy: audio autoplay is blocked until the user
  // interacts with the page. Muted autoplay is always allowed.
  // Strategy:
  //   1. Start player1 muted + autoplay=1 so video loads & plays silently.
  //   2. Show a fullscreen "Tap to start" overlay.
  //   3. On first tap/click, unmute and dismiss the overlay.
  //   4. All subsequent playback works with sound because the browser now
  //      considers the domain "interacted with".

  // Both players start MUTED so the browser allows autoplay immediately.
  // Sound is unlocked by the user tapping the overlay shown after the
  // first crossfade completes and player2 is fully visible.
  AppState.player1 = new YT.Player('player1', {
    videoId: AppState.defaultVideo1,
    playerVars: {
      autoplay: 1,
      start: 12,
      controls: 0,
      rel: 0,
      mute: 1,
      showinfo: 0,
      modestbranding: 1,
      enablejsapi: 1,
      origin,
    },
    events: {
      onReady: onPlayer1Ready,
      onStateChange: onPlayerStateChange,
    },
  });

  // player2 is NOT created here — we create it lazily the first time
  // loadIntoInactiveAndCrossfade() needs it. This avoids the YouTube
  // iframe showing "Video unavailable" for an empty / unembeddable default.
}

// Called once player1 iframe is ready — player1 is now visible and playing muted.
// Show the unmute overlay immediately so the user's tap gesture unlocks player1's iframe.
function onPlayer1Ready() {
  patchIframeAttributes();
  showUnmuteOverlay('player1');
}

// Called once player2 iframe is ready (created lazily on first crossfade).
function onPlayer2Ready(event) {
  patchIframeAttributes();
  console.log('[Player2] Ready — iframe unlocked for gesture');
}

/**
 * Adds required attributes to both YouTube iframes after the IFrame API
 * creates them. Without these, mobile browsers (iOS Safari, Chrome Android)
 * block autoplay even after a user gesture:
 *
 *   allow="autoplay"        — explicit iframe-level autoplay permission
 *   allow="...encrypted-media" — required for DRM / some video formats
 *   playsinline             — iOS Safari: prevents forced fullscreen on play
 *   webkit-playsinline      — older iOS WebKit compatibility
 */
function patchIframeAttributes() {
  ['player1', 'player2'].forEach((id) => {
    // The IFrame API replaces the div with an <iframe>; query by id directly
    const iframe = document.getElementById(id);
    if (!iframe || iframe.tagName !== 'IFRAME') return;

    // Build / merge the allow attribute without clobbering existing values
    const existing = iframe.getAttribute('allow') || '';
    const needed   = ['autoplay', 'encrypted-media', 'picture-in-picture'];
    const merged   = [...new Set([...existing.split(';').map(s => s.trim()).filter(Boolean), ...needed])].join('; ');
    iframe.setAttribute('allow', merged);

    // iOS Safari requires playsinline to avoid forcing fullscreen
    iframe.setAttribute('playsinline', '');
    iframe.setAttribute('webkit-playsinline', '');

    // Ensure allowfullscreen is set (needed for the F-key fullscreen toggle)
    iframe.setAttribute('allowfullscreen', '');

    console.log(`[Iframe] Patched attributes on #${id}`);
  });
}

/**
 * showUnmuteOverlay(playerKey)
 *
 * Called exactly twice in the lifetime of the page:
 *   1. 'player1' — immediately when player1 is ready (it's visible, playing muted)
 *   2. 'player2' — after the first crossfade completes (player2 is now fully visible)
 *
 * Each call gives the user a tap gesture that the browser credits to that
 * specific iframe, unlocking audio for it permanently.
 * After both are unlocked the overlay is never shown again.
 */
function showUnmuteOverlay(playerKey) {
  if (document.getElementById('unmuteOverlay')) return; // already showing
  if (AppState[`${playerKey}Unlocked`]) return;          // already unlocked

  const targetPlayer = AppState[playerKey]; // e.g. AppState.player1

  const overlay = document.createElement('div');
  overlay.id = 'unmuteOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(0,0,0,0.75);
    color: #fff; font-family: sans-serif;
    cursor: pointer; user-select: none;
    transition: opacity 0.4s ease;
  `;
  overlay.innerHTML = `
    <div style="font-size:3.5rem;margin-bottom:1rem;">🔊</div>
    <div style="font-size:1.5rem;font-weight:600;letter-spacing:.05em;">Tap to unmute</div>
    <div style="font-size:.9rem;margin-top:.5rem;opacity:.6;">Music is playing silently</div>
  `;

  const unlock = () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 400);

    // Mark this specific player as unlocked
    AppState[`${playerKey}Unlocked`] = true;

    // Unmute the target player and resume playback.
    // This tap gesture is credited by the browser to this iframe.
    try {
      targetPlayer.unMute();
      targetPlayer.setVolume(AppState.maxVol);
      targetPlayer.playVideo();
    } catch (_) {}

    AppState.isMuted = false;
    console.log(`[Unmute] ${playerKey} iframe unlocked by user gesture`);
  };

  overlay.addEventListener('click',     unlock, { once: true });
  overlay.addEventListener('touchstart', unlock, { once: true, passive: true });

  document.body.appendChild(overlay);
}

/* ── Player state change handler ────────────────────────────────────── */
function onPlayerStateChange(event) {
  // Only broadcast state from the ACTIVE (visible) player.
  // The inactive player is paused/played silently during crossfade prep —
  // broadcasting those state changes causes the controller to send back
  // a toggle command that pauses the active player.
  const isActivePlayer = (event.target === getActivePlayer());

  if (event.data === YT.PlayerState.PLAYING) {
    if (isActivePlayer) syncClient.send('control', { action: 'stateChange', state: 'playing' });
    if (AppState.playlistMode) startPlaylistMonitoring();
  } else if (event.data === YT.PlayerState.PAUSED) {
    if (isActivePlayer) syncClient.send('control', { action: 'stateChange', state: 'paused' });
  } else if (event.data === YT.PlayerState.ENDED && AppState.playlistMode) {
    console.log('[Playlist] Video ended — loading next track');
    setTimeout(loadNextFromPlaylist, 1000);
  }
}

/* ── Playlist monitoring (time-based auto-advance) ───────────────────── */
function startPlaylistMonitoring() {
  stopPlaylistMonitoring();
  AppState.playlistCheckInterval = setInterval(() => {
    if (!AppState.playlistMode || !AppState.currentPlaylist.length) {
      stopPlaylistMonitoring();
      return;
    }
    try {
      const active = getActivePlayer();
      const timeRemaining = active.getDuration() - active.getCurrentTime();
      if (timeRemaining <= 30 && timeRemaining > 25) {
        console.log('[Playlist] 30 s remaining — pre-loading next track');
        loadNextFromPlaylist();
      }
    } catch (_) { /* player not ready */ }
  }, 500);
}

function stopPlaylistMonitoring() {
  if (AppState.playlistCheckInterval) {
    clearInterval(AppState.playlistCheckInterval);
    AppState.playlistCheckInterval = null;
  }
}

/* ── Playlist refresh checker (detects new songs added to playlist) ── */
function startPlaylistRefreshChecker() {
  stopPlaylistRefreshChecker();
  AppState.playlistRefreshInterval = setInterval(() => {
    if (!AppState.playlistMode || !AppState.playlistId) {
      stopPlaylistRefreshChecker();
      return;
    }
    if (!AppState.hasLoadedNext) refreshPlaylistCheck();
  }, 2000);
}

function stopPlaylistRefreshChecker() {
  if (AppState.playlistRefreshInterval) {
    clearInterval(AppState.playlistRefreshInterval);
    AppState.playlistRefreshInterval = null;
  }
}

async function refreshPlaylistCheck() {
  if (!AppState.playlistMode || !AppState.playlistId) return;

  const { player: checkPlayer } = getInactivePlayer();

  try {
    checkPlayer.loadPlaylist({ listType: 'playlist', list: AppState.playlistId, index: 0 });
    await wait(1000);

    const updatedPlaylist = checkPlayer.getPlaylist();
    if (!updatedPlaylist?.length) return;

    const oldLength = AppState.currentPlaylist.length;

    if (updatedPlaylist.length > oldLength) {
      const newSongs = updatedPlaylist.slice(oldLength);
      const hasNew = newSongs.some((id) => !AppState.currentPlaylist.includes(id));

      if (hasNew) {
        console.log(`[Playlist] New songs detected — was ${oldLength}, now ${updatedPlaylist.length}`);
        AppState.currentPlaylist = updatedPlaylist;
        updateOverlayInfo();
        startBlinkingSquare();

        AppState.hasLoadedNext = true;
        AppState.nextSong = AppState.currentPlaylist[oldLength];
        loadIntoInactiveAndCrossfade(AppState.nextSong);
        setTimeout(() => { AppState.hasLoadedNext = false; }, 15_000);
      } else {
        AppState.currentPlaylist = updatedPlaylist;
        updateOverlayInfo();
      }
    }
  } catch (err) {
    console.error('[Playlist] Error refreshing playlist:', err);
  } finally {
    try { checkPlayer.stopVideo(); } catch (_) { }
  }
}

/* ── Playlist navigation ────────────────────────────────────────────── */
function loadNextFromPlaylist() {
  if (!AppState.playlistMode || !AppState.currentPlaylist.length || AppState.hasLoadedNext) return;
  AppState.hasLoadedNext = true;
  AppState.currentPlaylistIndex = (AppState.currentPlaylistIndex + 1) % AppState.currentPlaylist.length;
  _loadPlaylistTrack();
}

function loadPrevFromPlaylist() {
  if (!AppState.playlistMode || !AppState.currentPlaylist.length || AppState.hasLoadedNext) return;
  AppState.hasLoadedNext = true;
  AppState.currentPlaylistIndex =
    (AppState.currentPlaylistIndex - 1 + AppState.currentPlaylist.length) % AppState.currentPlaylist.length;
  _loadPlaylistTrack();
}

function _loadPlaylistTrack() {
  const videoId = AppState.currentPlaylist[AppState.currentPlaylistIndex];
  console.log(`[Playlist] Track ${AppState.currentPlaylistIndex + 1}/${AppState.currentPlaylist.length}: ${videoId}`);
  updateOverlayInfo();
  AppState.nextSong = videoId;
  loadIntoInactiveAndCrossfade(videoId);
  setTimeout(() => { AppState.hasLoadedNext = false; }, 15_000);
}

async function loadPlaylistVideos(plId) {
  console.log('[Playlist] Loading playlist:', plId);
  AppState.playlistMode = true;
  AppState.playlistId = plId;

  const { player: tempPlayer } = getInactivePlayer();

  try {
    tempPlayer.loadPlaylist({ listType: 'playlist', list: plId, index: 0 });
    await wait(1000);

    const playlist = tempPlayer.getPlaylist();
    if (!playlist?.length) {
      alert('Could not load playlist. Please try again.');
      AppState.playlistMode = false;
      updateOverlayInfo();
      return;
    }

    AppState.currentPlaylist = playlist;
    AppState.currentPlaylistIndex = 0;
    console.log(`[Playlist] Loaded ${playlist.length} tracks`);
    updateOverlayInfo();

    try { tempPlayer.stopVideo(); } catch (_) { }

    startPlaylistRefreshChecker();
    AppState.nextSong = AppState.currentPlaylist[0];
    loadIntoInactiveAndCrossfade(AppState.currentPlaylist[0]);
  } catch (err) {
    console.error('[Playlist] Error loading playlist:', err);
    alert('Error loading playlist. Please check the playlist ID.');
    AppState.playlistMode = false;
    updateOverlayInfo();
  }
}

/* ── Lazy player2 creation ──────────────────────────────────────────── */
/**
 * Creates player2 iframe on first use. Returns a Promise that resolves
 * once the player is ready (onReady fires). Subsequent calls resolve
 * immediately since player2 already exists.
 */
function createPlayer2IfNeeded() {
  return new Promise((resolve) => {
    if (AppState.player2 && typeof AppState.player2.cueVideoById === 'function') {
      resolve(); // already created and ready
      return;
    }

    const origin = window.location.origin || 'http://localhost';
    console.log('[Player2] Creating iframe lazily...');

    AppState.player2 = new YT.Player('player2', {
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        mute: 1,
        showinfo: 0,
        modestbranding: 1,
        enablejsapi: 1,
        origin,
      },
      events: {
        onReady: (event) => {
          onPlayer2Ready(event);
          resolve(); // unblock loadIntoInactiveAndCrossfade
        },
        onStateChange: onPlayerStateChange,
      },
    });
  });
}

/* ── Core: load video into inactive player then crossfade ───────────── */
async function loadIntoInactiveAndCrossfade(videoId, startSeconds = 12) {
  // Ensure player2 iframe exists before we try to use it
  await createPlayer2IfNeeded();

  const { player: targetPlayer, elem: targetElem } = getInactivePlayer();

  if (!targetPlayer || typeof targetPlayer.cueVideoById !== 'function') {
    alert('Player is not ready yet — wait a moment and try again.');
    return;
  }

  startSeconds = Math.max(0, parseFloat(startSeconds) || 0);
  console.log(`[Load] Video ${videoId} starting at ${startSeconds}s`);

  // Reset inactive player
  try { targetPlayer.pauseVideo(); } catch (_) { }
  try { targetPlayer.setVolume(0); } catch (_) { }
  targetElem.style.opacity = '0';

  // Cue video
  try { targetPlayer.cueVideoById(videoId, 0); } catch (err) {
    console.error('[Load] cueVideoById failed:', err);
    return;
  }

  // Wait for CUED state (5) with up to 10 s timeout
  await waitForPlayerState(targetPlayer, [YT.PlayerState.CUED], 10_000);
  console.log('[Load] Track cued — initiating silent playback for seek');

  try { targetPlayer.setVolume(0); targetPlayer.playVideo(); } catch (_) { }

  // Wait for PLAYING or BUFFERING
  await waitForPlayerState(targetPlayer, [YT.PlayerState.PLAYING, YT.PlayerState.BUFFERING], 5_000);

  // Seek if needed
  if (startSeconds > 0) {
    try { targetPlayer.seekTo(startSeconds, true); } catch (err) {
      console.error('[Load] seekTo failed:', err);
    }
    await wait(600); // allow seek + buffer
    console.log(`[Load] Seeked to ${startSeconds}s (actual: ${_safeCurrentTime(targetPlayer)}s)`);
  }

  await wait(800);
  startCrossfade();
}

/** Resolve when `player` enters one of the given states, or after `timeout` ms. */
function waitForPlayerState(player, states, timeout = 5_000) {
  return new Promise((resolve) => {
    const deadline = setTimeout(resolve, timeout);
    const interval = setInterval(() => {
      let state = -1;
      try { state = player.getPlayerState(); } catch (_) { }
      if (states.includes(state)) {
        clearTimeout(deadline);
        clearInterval(interval);
        resolve();
      }
    }, 200);
  });
}

function _safeCurrentTime(player) {
  try { return player.getCurrentTime().toFixed(1); } catch (_) { return '?'; }
}

/* ── Crossfade logic ────────────────────────────────────────────────── */
function startCrossfade() {
  if (AppState.fadeInterval) { clearInterval(AppState.fadeInterval); AppState.fadeInterval = null; }

  // Snapshot direction NOW into a local const — the interval must never read
  // AppState.direction because it gets flipped at completion, which would
  // corrupt any subsequent fade that starts before the current one ends.
  const fadeDir = AppState.direction;
  const maxVol  = AppState.maxVol;

  // fadeDir=true  → p1 OUT (maxVol→0), p2 IN (0→maxVol)
  // fadeDir=false → p1 IN  (0→maxVol), p2 OUT (maxVol→0)
  let vol1 = fadeDir ? maxVol : 0;
  let vol2 = fadeDir ? 0      : maxVol;

  const p1Elem = document.getElementById('player1');
  const p2Elem = document.getElementById('player2');

  const setVols = (v1, v2) => {
    try { AppState.player1.setVolume(Math.round(v1)); } catch (_) { }
    try { AppState.player2.setVolume(Math.round(v2)); } catch (_) { }
    p1Elem.style.opacity = maxVol > 0 ? (v1 / maxVol).toString() : '0';
    p2Elem.style.opacity = maxVol > 0 ? (v2 / maxVol).toString() : '0';
  };

  setVols(vol1, vol2);

  // CRITICAL FIX: play BOTH players unconditionally before the fade starts.
  // The outgoing player is already playing; the incoming player was playing
  // silently during the seek phase but may have buffered-stalled and paused.
  // If we only call playVideo() when vol > 0 the incoming player stays silent.
  try { AppState.player1.playVideo(); } catch (_) { }
  try { AppState.player2.playVideo(); } catch (_) { }

  console.log(`[Crossfade] Start — fadeDir:${fadeDir} p1:${vol1}→${fadeDir?0:maxVol} p2:${vol2}→${fadeDir?maxVol:0}`);

  const FADE_DURATION = 5_000;
  const STEP_MS       = FADE_DURATION / 100;
  const volStep       = +(maxVol / 100).toFixed(2);
  const started       = Date.now();

  AppState.fadeInterval = setInterval(() => {
    // Use LOCAL fadeDir — never AppState.direction
    if (fadeDir) {
      vol1 = Math.max(0,      +(vol1 - volStep).toFixed(2));
      vol2 = Math.min(maxVol, +(vol2 + volStep).toFixed(2));
    } else {
      vol1 = Math.min(maxVol, +(vol1 + volStep).toFixed(2));
      vol2 = Math.max(0,      +(vol2 - volStep).toFixed(2));
    }

    setVols(vol1, vol2);

    // Pause whichever player just hit zero (saves resources)
    if (vol1 === 0) try { AppState.player1.pauseVideo(); } catch (_) { }
    if (vol2 === 0) try { AppState.player2.pauseVideo(); } catch (_) { }

    const done = fadeDir
      ? vol1 <= 0 && vol2 >= maxVol
      : vol1 >= maxVol && vol2 <= 0;

    if (done) {
      clearInterval(AppState.fadeInterval);
      AppState.fadeInterval = null;

      // Hard-clamp final state to eliminate floating-point drift
      if (fadeDir) {
        try { AppState.player1.pauseVideo(); AppState.player1.setVolume(0); } catch (_) { }
        try { AppState.player2.setVolume(maxVol); }                          catch (_) { }
        p1Elem.style.opacity = '0';
        p2Elem.style.opacity = '1';
      } else {
        try { AppState.player2.pauseVideo(); AppState.player2.setVolume(0); } catch (_) { }
        try { AppState.player1.setVolume(maxVol); }                          catch (_) { }
        p1Elem.style.opacity = '1';
        p2Elem.style.opacity = '0';
      }

      // Flip global direction only AFTER the fade fully completes
      AppState.direction = !AppState.direction;
      console.log(`[Crossfade] Done in ${((Date.now() - started) / 1000).toFixed(1)}s — next dir: ${AppState.direction}`);

      // After each crossfade, check if the newly-active player still needs
      // its iframe gesture-unlocked. Only fires for player2 (first crossfade)
      // and never again once both players are unlocked.
      const justActivated = AppState.direction === false ? 'player2' : 'player1';
      if (!AppState[`${justActivated}Unlocked`]) {
        showUnmuteOverlay(justActivated);
      }
    }
  }, STEP_MS);
}

/* ── Volume / mute ──────────────────────────────────────────────────── */
function changeVol(vol) {
  try {
    AppState.maxVol = vol;

    if (vol > 0 && AppState.isMuted) {
      AppState.isMuted = false;
      applyMute(false);
      syncClient.send('mute', { isMuted: false });
    }

    const apply = (p) => {
      if (!p || typeof p.setVolume !== 'function') return;
      p.setVolume(vol);
      if (vol > 0) try { p.unMute(); } catch (_) { }
    };
    apply(AppState.player1);
    apply(AppState.player2);
  } catch (err) {
    console.error('[Vol] Error setting volume:', err);
  }
}

function applyMute(muted) {
  const muteOrUnmute = (p) => {
    if (!p) return;
    try {
      if (muted && typeof p.mute === 'function') {
        p.mute();
      } else if (!muted && typeof p.unMute === 'function') {
        p.unMute();
        // unMute() does NOT resume a paused player — explicitly resume
        // the active player so unmuting actually produces sound.
        const active = getActivePlayer();
        if (p === active) {
          try { p.playVideo(); } catch (_) { }
        }
      }
    } catch (_) { }
  };
  muteOrUnmute(AppState.player1);
  muteOrUnmute(AppState.player2);

  const indicator = document.getElementById('muteIndicator');
  if (indicator) indicator.style.display = muted ? 'flex' : 'none';
}

function toggleMute() {
  AppState.isMuted = !AppState.isMuted;
  applyMute(AppState.isMuted);
  syncClient.send('mute', { isMuted: AppState.isMuted });
}

/* ── Next-song handler (called by sync client) ──────────────────────── */
async function getNextSong(data) {
  const { title, videoId, timestamp } = data;
  console.log(`[NextSong] "${title}" (${videoId}@${timestamp}s) — hasLoadedNext: ${AppState.hasLoadedNext}`);

  if (videoId === AppState.nextSong || AppState.hasLoadedNext) return;

  AppState.hasLoadedNext = true;
  AppState.nextSong = videoId;

  const startPosition = Math.max(10, timestamp);
  console.log(`[NextSong] Loading at ${startPosition}s`);

  loadIntoInactiveAndCrossfade(videoId, startPosition);
  setTimeout(() => { AppState.hasLoadedNext = false; }, 10_000);
}

/* ── WebSocket sync client ──────────────────────────────────────────── */
class DJSyncClient {
  constructor(role = 'player') {
    this.role          = role;
    this.ws            = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30_000;
    this.baseDelay     = 3_000;
    this.pingInterval  = null;
    this.intentionalClose = false;   // prevents retry on deliberate disconnect
    this.messageQueue  = [];         // buffer messages sent before connection is open

    // Don't connect until DOM is ready so players are initialised first
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.connect());
    } else {
      this.connect();
    }

    // Cleanly close on page unload so the server knows immediately
    window.addEventListener('beforeunload', () => this.destroy());
  }

  get wsUrl() {
    // Re-use the module-level isLocal flag (single source of truth)
    if (isLocal) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//192.168.1.8:8045/ws/sync?role=${this.role}`;
    }
    // ngrok: wss is required; the skip-browser-warning header cannot be set on
    // a native WebSocket, but ngrok respects a query-param alternative instead
    return `wss://unappendaged-aretha-unwaning.ngrok-free.dev/ws/sync?role=${this.role}&ngrok-skip-browser-warning=true`;
  }

  connect() {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return; // already connecting/open

    this.intentionalClose = false;
    console.log(`[Sync] Connecting to ${this.wsUrl}…`);

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err) {
      console.error('[Sync] WebSocket constructor threw:', err);
      this._scheduleRetry();
      return;
    }

    this.ws.onopen = () => {
      console.log('[Sync] ✅ Connected');
      this.reconnectAttempts = 0;
      this._startHeartbeat();
      this._flushQueue();
    };

    this.ws.onmessage = (e) => {
      try { this.handleMessage(JSON.parse(e.data)); }
      catch (err) { console.error('[Sync] Message parse error:', err, '| raw:', e.data); }
    };

    this.ws.onclose = (event) => {
      console.log(`[Sync] 🔌 Disconnected (code ${event.code}, reason: "${event.reason || 'none'}")`);
      this._stopHeartbeat();
      if (!this.intentionalClose) this._scheduleRetry();
    };

    this.ws.onerror = () => {
      // onerror always fires just before onclose; log it but let onclose drive retry
      console.error(`[Sync] ❌ WebSocket error on ${this.wsUrl}`);
    };
  }

  _startHeartbeat() {
    this._stopHeartbeat(); // clear any previous interval first
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send('ping', { ts: Date.now() });
      }
    }, 10_000);
  }

  _stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  _scheduleRetry() {
    this.reconnectAttempts++;
    const delay = Math.min(this.baseDelay * 2 ** (this.reconnectAttempts - 1), this.maxReconnectDelay);
    console.log(`[Sync] Retry #${this.reconnectAttempts} in ${delay / 1000}s…`);
    setTimeout(() => this.connect(), delay);
  }

  /** Queue a message if not yet connected; flush on open. */
  _flushQueue() {
    while (this.messageQueue.length) {
      const { type, data } = this.messageQueue.shift();
      this._rawSend(type, data);
    }
  }

  _rawSend(type, data) {
    try {
      this.ws.send(JSON.stringify({ type, data }));
    } catch (err) {
      console.error('[Sync] Send failed:', err);
    }
  }

  send(type, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._rawSend(type, data);
    } else {
      // Buffer non-ping messages so they're delivered once connection opens
      if (type !== 'ping') {
        this.messageQueue.push({ type, data });
        console.warn(`[Sync] Not connected — queued "${type}" (queue size: ${this.messageQueue.length})`);
      }
    }
  }

  /** Intentionally close without triggering reconnect. */
  destroy() {
    this.intentionalClose = true;
    this._stopHeartbeat();
    if (this.ws) this.ws.close(1000, 'Page unloading');
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
          try { active.playVideo(); } catch (_) { }
        } else if (data.state === 'paused') {
          try { active.pauseVideo(); } catch (_) { }
        } else {
          const playing = active.getPlayerState() === YT.PlayerState.PLAYING;
          try { playing ? active.pauseVideo() : active.playVideo(); } catch (_) { }
        }
        break;
      }
      case 'next': loadNextFromPlaylist(); break;
      case 'prev': loadPrevFromPlaylist(); break;
    }
  }

  handleMessage({ type, data }) {
    switch (type) {
      case 'play':
        getNextSong(data);
        break;
      case 'vol': {
        const v = parseInt(data?.volume);
        if (!isNaN(v)) changeVol(v);
        break;
      }
      case 'control':
        this.handleControl(data);
        break;
      case 'mute':
        if (data && 'isMuted' in data) {
          AppState.isMuted = data.isMuted;
          applyMute(AppState.isMuted);
        }
        break;
      case 'pong':
        // Server acknowledged our ping — connection is healthy
        break;
      default:
        console.log(`[Sync] Unknown message type: "${type}"`, data);
    }
  }
}

/* ── QR code ────────────────────────────────────────────────────────── */
const isLocal =
  ['localhost', '127.0.0.1'].includes(window.location.hostname) ||
  window.location.hostname.startsWith('192.168.');

const QR_API_URL = isLocal
  ? 'http://192.168.1.8:8045/qr/'
  : 'https://unappendaged-aretha-unwaning.ngrok-free.dev/qr/';

let qrVisible = false;

async function fetchQRCode() {
  try {
    const res = await fetch(QR_API_URL, { headers: { 'ngrok-skip-browser-warning': 'true' } });
    if (!res.ok) throw new Error('Failed to fetch QR');
    let base64img = (await res.text()).trim().replace(/^"|"$/g, '');
    const qrImage = document.getElementById('qrImage');
    qrImage.src = base64img.startsWith('data:image') ? base64img : `data:image/png;base64,${base64img}`;
  } catch (err) {
    console.error('[QR] Fetch error:', err);
  }
}

function toggleQROverlay() {
  const overlay = document.getElementById('qrOverlay');
  qrVisible = !qrVisible;

  if (qrVisible) {
    fetchQRCode();
    // CSS keeps the overlay display:flex always — just toggle .visible
    // for the opacity/visibility transition (no display:none flash)
    requestAnimationFrame(() => overlay.classList.add('visible'));
    try { AppState.player1?.pauseVideo(); } catch (_) { }
    try { AppState.player2?.pauseVideo(); } catch (_) { }
  } else {
    overlay.classList.remove('visible');
    // CSS transition handles fade-out; no need to set display:none
    const active = getActivePlayer();
    try { active?.playVideo(); } catch (_) { }
  }
}

/* ── Keyboard shortcuts ─────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  switch (e.key.toLowerCase()) {
    case 'q': toggleQROverlay(); break;
    case 'm': toggleMute(); break;
    case 'escape': if (qrVisible) toggleQROverlay(); break;
  }
});

/* ── window event bridge (TV remote / external controller) ─────────── */
const windowEvents = {
  'tv-fullscreen': toggleFullscreen,
  'tv-show-qr':    toggleQROverlay,
  'tv-play-pause': () => {
    const a = getActivePlayer();
    try { a.getPlayerState() === YT.PlayerState.PLAYING ? a.pauseVideo() : a.playVideo(); } catch (_) { }
  },
  'tv-play':  () => { try { getActivePlayer().playVideo();  } catch (_) { } },
  'tv-pause': () => { try { getActivePlayer().pauseVideo(); } catch (_) { } },
  'tv-next':  loadNextFromPlaylist,
  'tv-prev':  loadPrevFromPlaylist,
};
Object.entries(windowEvents).forEach(([event, handler]) => window.addEventListener(event, handler));

/* ── UI wiring ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  /* -- Video/playlist form -- */
  const form  = document.getElementById('videoForm');
  const input = document.getElementById('videoInput');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value;

    const plId = extractPlaylistID(raw);
    if (plId) {
      input.value = '';
      input.blur();
      loadPlaylistVideos(plId);
      return;
    }

    const vid = extractVideoID(raw);
    if (!vid) { alert('Please paste a valid YouTube video ID, URL, or Playlist ID.'); return; }

    if (AppState.playlistMode) {
      Object.assign(AppState, {
        playlistMode: false, currentPlaylist: [],
        currentPlaylistIndex: 0, hasLoadedNext: false,
      });
      stopPlaylistMonitoring();
      stopPlaylistRefreshChecker();
      updateOverlayInfo();
    }

    input.value = '';
    input.blur();
    loadIntoInactiveAndCrossfade(vid);
  });

  document.body.addEventListener('click', () => input.focus());
  updateOverlayInfo();

  /* -- Auto-hide input wrapper -- */
  const inputWrapper = document.querySelector('.input-wrapper');
  let typingTimer;
  const HIDE_DELAY = 2_000;

  const hideInput = () => {
    if (!input.value.trim()) {
      inputWrapper.style.opacity = '0';
      if (document.activeElement === input) input.blur();
    }
  };
  const showInput = () => inputWrapper.style.opacity = '1';

  input.addEventListener('focus', () => { showInput(); clearTimeout(typingTimer); typingTimer = setTimeout(hideInput, HIDE_DELAY); });
  input.addEventListener('blur',  () => { if (!input.value.trim()) setTimeout(hideInput, 100); });
  input.addEventListener('input', () => { showInput(); clearTimeout(typingTimer); typingTimer = setTimeout(hideInput, HIDE_DELAY); });

  if (input.value.trim()) showInput();

  /* -- QR code -- */
  fetchQRCode();
});

/* ── Cursor inactivity ──────────────────────────────────────────────── */
let inactivityTimer;
const hideCursor = () => document.body.classList.add('hide-cursor');
const showCursor = () => {
  document.body.classList.remove('hide-cursor');
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(hideCursor, 5_000);
};
['mousemove', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, showCursor));
inactivityTimer = setTimeout(hideCursor, 5_000);

/* ── Init sync client ───────────────────────────────────────────────── */
const syncClient = new DJSyncClient('player');
