
const elem = document.documentElement; // Request full screen on the entire document

// Function to request full screen
function enterFullscreen() {
  if (elem.requestFullscreen) {
    elem.requestFullscreen();
  } else if (elem.mozRequestFullScreen) { /* Firefox */
    elem.mozRequestFullScreen();
  } else if (elem.webkitRequestFullscreen) { /* Safari */
    elem.webkitRequestFullscreen();
  } else if (elem.msRequestFullscreen) { /* IE11 */
    elem.msRequestFullscreen();
  }
}

// Function to exit full screen
function exitFullscreen() {
  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if (document.mozCancelFullScreen) { /* Firefox */
    document.mozCancelFullScreen();
  } else if (document.webkitExitFullscreen) { /* Safari */
    document.webkitExitFullscreen();
  } else if (document.msExitFullscreen) { /* IE11 */
    document.msExitFullscreen();
  }
}

// Function to toggle based on current state
function toggleFullscreen() {
  if (!document.fullscreenElement) { // If NOT in full screen
    enterFullscreen();
  } else { // If already in full screen
    exitFullscreen();
  }
}

// *** NEW KEY LISTENER ***
document.addEventListener('keydown', function (event) {
  // Check if the pressed key is 'f' (case-insensitive, assuming we want the physical 'F' key)
  if (event.key === 'F' || event.key === 'f') {
    // Prevent the default browser action for 'F' if one exists, although usually F doesn't have a default.
    event.preventDefault();
    toggleFullscreen();
  }
});


// Keep the Escape key handler for easy exiting (good practice)
document.addEventListener('keydown', function (event) {
  if (event.key === "Escape" && document.fullscreenElement) {
    // The browser handles exiting on Escape, but this handler can be useful 
    // if you want to perform other actions when exiting this way.
  }
});



/* ===================== Globals & state ===================== */
let player1 = null, player2 = null;
let fadeInterval = null;
let direction = true; // true: p1 fades OUT -> p2 fades IN ; next click toggles
let videoId = null, timestamp = null; // New declarations to avoid implicit globals

const defaultVideo1 = "4rJ9z6IXnb8";
const defaultVideo2 = "p2EdDiiVHh4";

// Playlist mode variables
let playlistMode = false;
let currentPlaylist = [];
let currentPlaylistIndex = 0;
let playlistId = null;
let playlistRefreshInterval = null;
let hasLoadedNext = false;
let nextSong = "p2EdDiiVHh4";
let maxVol = 100;
let isMuted = false;

/* ===================== Utils ===================== */
function extractVideoID(text) {
  if (!text) return "";
  text = text.trim();
  const reg = /(?:v=|\/embed\/|youtu\.be\/|\/v\/)([0-9A-Za-z_-]{11})/;
  const m = text.match(reg);
  if (m && m[1]) return m[1];
  if (/^[0-9A-Za-z_-]{11}$/.test(text)) return text;
  return "";
}

function extractPlaylistID(text) {
  if (!text) return "";
  text = text.trim();

  // Check for playlist URL patterns
  const plMatch = text.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (plMatch && plMatch[1]) return plMatch[1];

  // Check if it's a direct playlist ID (starts with PL, RD, UU, etc.)
  if (/^(PL|RD|UU|LL|FL|OL)[a-zA-Z0-9_-]+$/.test(text)) return text;

  return "";
}

function updateOverlayInfo() {
  const overlayEl = document.querySelector('.overlay-info');
  const modeEl = document.querySelector('.overlay-info .mode');
  const countEl = document.querySelector('.overlay-info .count');
  overlayEl.style.display = 'block';
  if (playlistMode) {
    modeEl.textContent = '🎵 Playlist Mode';
    countEl.textContent = `Track ${currentPlaylistIndex + 1} of ${currentPlaylist.length}`;
  } else {
    modeEl.textContent = '🎧 Single Mode';
    countEl.textContent = '';
  }
  setTimeout(() => {
    overlayEl.style.display = 'none';      // Hide the square
  }, 2000); // 2000 milliseconds = 2 seconds
}

/* ===================== Blinking system ===================== */

function startBlinkingSquare() {
  const square = document.createElement('div');
  square.className = 'notification';
  document.body.appendChild(square);

  // Make sure the square exists
  if (square) {
    // Show the square
    square.style.display = 'block';
    // Add the blinking class to start the animation
    square.classList.add('blinking');

    // Set a timeout to stop blinking and hide the square after 2 seconds
    setTimeout(() => {
      square.classList.remove('blinking'); // Stop the animation
      square.style.display = 'none';      // Hide the square
    }, 2000); // 2000 milliseconds = 2 seconds
  }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensurePlayerReady(player, attempts = 12, interval = 300) {
  return new Promise((resolve) => {
    let tries = 0;
    const checker = setInterval(() => {
      tries++;
      let state = -1;
      try { state = player.getPlayerState(); } catch (e) { }
      if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING || tries >= attempts) {
        clearInterval(checker);
        resolve();
      }
    }, interval);
  });
}

/* ===================== YouTube players setup ===================== */
function onYouTubeIframeAPIReady() {
  player1 = new YT.Player('player1', {
    videoId: defaultVideo1,
    playerVars: {
      'autoplay': 1,
      'start': 12,
      'controls': 0,
      'rel': 0,
      'mute': 0,
      'showinfo': 0,
      'modestbranding': 1,
      'enablejsapi': 1,
      'origin': window.location.origin || 'http://localhost'
    },
    events: {
      'onStateChange': onPlayerStateChange
    }
  });

  player2 = new YT.Player('player2', {
    videoId: defaultVideo2,
    playerVars: {
      'autoplay': 0,
      'start': 12,
      'controls': 0,
      'rel': 0,
      'showinfo': 0,
      'modestbranding': 1,
      'enablejsapi': 1,
      'origin': window.location.origin || 'http://localhost'
    },
    events: {
      'onStateChange': onPlayerStateChange
    }
  });
}

/* ===================== Time monitoring for playlist ===================== */
let playlistCheckInterval = null;

function startPlaylistMonitoring() {
  // Clear any existing interval
  if (playlistCheckInterval) {
    clearInterval(playlistCheckInterval);
  }

  // Check every 500ms
  playlistCheckInterval = setInterval(() => {
    if (!playlistMode || currentPlaylist.length === 0) {
      clearInterval(playlistCheckInterval);
      return;
    }

    // Get the currently playing player
    const p1Opacity = parseFloat(window.getComputedStyle(document.getElementById('player1')).opacity);
    const activePlayer = p1Opacity > 0.5 ? player1 : player2;

    try {
      const currentTime = activePlayer.getCurrentTime();
      const duration = activePlayer.getDuration();
      const timeRemaining = duration - currentTime;

      // When 15 seconds remaining, start loading next track
      if (timeRemaining <= 30 && timeRemaining > 25) {
        console.log('30 seconds remaining, loading next track...');
        loadNextFromPlaylist();
      }
    } catch (e) {
      // Player might not be ready, ignore
    }
  }, 500);
}

function stopPlaylistMonitoring() {
  if (playlistCheckInterval) {
    clearInterval(playlistCheckInterval);
    playlistCheckInterval = null;
  }
}

/* ===================== Playlist refresh checker ===================== */
function startPlaylistRefreshChecker() {
  // Clear any existing interval
  if (playlistRefreshInterval) {
    clearInterval(playlistRefreshInterval);
  }

  // Check for new songs every 30 seconds
  playlistRefreshInterval = setInterval(async () => {
    if (!playlistMode || !playlistId) {
      clearInterval(playlistRefreshInterval);
      return;
    }

    console.log('Checking playlist for new songs...');
    console.log(hasLoadedNext);
    if (hasLoadedNext == false) {
      refreshPlaylistCheck();

    }
  }, 2000); // Check every 2 seconds
}

function stopPlaylistRefreshChecker() {
  if (playlistRefreshInterval) {
    clearInterval(playlistRefreshInterval);
    playlistRefreshInterval = null;
  }
}

async function refreshPlaylistCheck() {
  if (!playlistMode || !playlistId) return;

  try {
    // Use the inactive player to fetch updated playlist
    const p1Opacity = parseFloat(window.getComputedStyle(document.getElementById('player1')).opacity);
    const checkPlayer = p1Opacity > 0.5 ? player2 : player1;

    // Temporarily load playlist to check
    checkPlayer.loadPlaylist({
      listType: 'playlist',
      list: playlistId,
      index: 0
    });

    // Wait for playlist to load
    await wait(1000);

    // Get the updated playlist
    const updatedPlaylist = checkPlayer.getPlaylist();

    if (updatedPlaylist && updatedPlaylist.length > 0) {
      const oldLength = currentPlaylist.length;
      const newLength = updatedPlaylist.length;

      if (newLength > oldLength) {
        console.log(`New songs detected! Old: ${oldLength}, New: ${newLength}`);

        // Check if the new songs are different from existing ones
        const newSongs = updatedPlaylist.slice(oldLength);
        const hasNewUniqueSongs = newSongs.some(songId => !currentPlaylist.includes(songId));

        if (hasNewUniqueSongs) {
          // Update playlist
          currentPlaylist = updatedPlaylist;
          updateOverlayInfo();
          startBlinkingSquare();

          // Immediately switch to the first new song
          // currentPlaylistIndex = oldLength; // Index of first new song
          const newSongId = currentPlaylist[oldLength];

          console.log(`Switching to new song at index ${currentPlaylistIndex}: ${newSongId}`);

          // Reset the hasLoadedNext flag to allow immediate load
          // hasLoadedNext = false;

          // Load and crossfade to the new song
          console.log("1");
          hasLoadedNext = true;
          nextSong = newSongId
          loadIntoInactiveAndCrossfade(newSongId);
          setTimeout(() => {
            hasLoadedNext = false;
          }, 15000);

        } else {
          // Just update the playlist without switching
          currentPlaylist = updatedPlaylist;
          updateOverlayInfo();
        }
      }
    }

    // Stop the check player
    try { checkPlayer.stopVideo(); } catch (e) { }

  } catch (error) {
    console.error('Error refreshing playlist:', error);
  }
}

/* ===================== Player state change handler ===================== */
function onPlayerStateChange(event) {
  // Broadcast state to controllers
  if (event.data === YT.PlayerState.PLAYING) {
    syncClient.send('control', { action: 'stateChange', state: 'playing' });
  } else if (event.data === YT.PlayerState.PAUSED) {
    syncClient.send('control', { action: 'stateChange', state: 'paused' });
  }

  // When video starts playing in playlist mode, start monitoring
  if (event.data === 1 && playlistMode) {
    startPlaylistMonitoring();
  }

  // Backup: When video ends (state 0) and we're in playlist mode, load next track
  if (event.data === 0 && playlistMode && currentPlaylist.length > 0) {
    console.log('Video ended, loading next in playlist...');
    setTimeout(() => {
      loadNextFromPlaylist();
    }, 1000);
  }
}

/* ===================== Playlist functionality ===================== */
// Flag to prevent multiple loads

function loadNextFromPlaylist() {
  if (!playlistMode || currentPlaylist.length === 0 || hasLoadedNext) return;

  hasLoadedNext = true; // Set flag to prevent duplicate loads

  currentPlaylistIndex = (currentPlaylistIndex + 1) % currentPlaylist.length;
  const nextVideoId = currentPlaylist[currentPlaylistIndex];

  console.log(`Loading track ${currentPlaylistIndex + 1}/${currentPlaylist.length}: ${nextVideoId}`);
  updateOverlayInfo();
  nextSong = nextVideoId;
  loadIntoInactiveAndCrossfade(nextVideoId);

  // Reset flag after crossfade completes
  setTimeout(() => {
    hasLoadedNext = false;
  }, 15000);
}

function loadPrevFromPlaylist() {
  if (!playlistMode || currentPlaylist.length === 0 || hasLoadedNext) return;

  hasLoadedNext = true;

  currentPlaylistIndex = (currentPlaylistIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
  const prevVideoId = currentPlaylist[currentPlaylistIndex];

  console.log(`Loading previous track ${currentPlaylistIndex + 1}/${currentPlaylist.length}: ${prevVideoId}`);
  updateOverlayInfo();
  nextSong = prevVideoId;
  loadIntoInactiveAndCrossfade(prevVideoId);

  setTimeout(() => {
    hasLoadedNext = false;
  }, 15000);
}

async function loadPlaylistVideos(plId) {
  console.log('Loading playlist:', plId);
  playlistMode = true;
  playlistId = plId;

  // We'll use a temporary player to get the playlist
  const tempPlayer = direction ? player2 : player1;

  try {
    // Load playlist into the inactive player
    tempPlayer.loadPlaylist({
      listType: 'playlist',
      list: plId,
      index: 0
    });

    // Wait a bit for the playlist to load
    await wait(1000);

    // Get the playlist
    const playlist = tempPlayer.getPlaylist();

    if (playlist && playlist.length > 0) {
      currentPlaylist = playlist;
      currentPlaylistIndex = 0;

      console.log('Playlist loaded with', currentPlaylist.length, 'videos');
      updateOverlayInfo();

      // Stop the temp player
      try { tempPlayer.stopVideo(); } catch (e) { }

      // Start playlist refresh checker
      startPlaylistRefreshChecker();

      // Load the first video
      newSong = currentPlaylist[0]
      loadIntoInactiveAndCrossfade(currentPlaylist[0]);
    } else {
      alert('Could not load playlist. Please try again.');
      playlistMode = false;
      updateOverlayInfo();
    }
  } catch (error) {
    console.error('Error loading playlist:', error);
    alert('Error loading playlist. Please check the playlist ID.');
    playlistMode = false;
    updateOverlayInfo();
  }
}


function loadIntoInactiveAndCrossfade(videoId, startSeconds = 12) {
  const p1Elem = document.getElementById('player1');
  const p2Elem = document.getElementById('player2');
  const p1Opacity = parseFloat(window.getComputedStyle(p1Elem).opacity);
  const p2Opacity = parseFloat(window.getComputedStyle(p2Elem).opacity);

  let targetPlayer, targetElem;
  if (isNaN(p1Opacity) || p1Opacity === 0) {
    targetPlayer = player1; targetElem = p1Elem;
  } else if (isNaN(p2Opacity) || p2Opacity === 0) {
    targetPlayer = player2; targetElem = p2Elem;
  } else {
    targetPlayer = player2; targetElem = p2Elem;
  }

  if (!targetPlayer || typeof targetPlayer.cueVideoById !== 'function') {
    alert('Player is not ready yet — wait a moment and try again.');
    return;
  }

  // Sanitize startSeconds - ensure it's a valid positive number
  startSeconds = Math.max(0, parseFloat(startSeconds) || 0);
  console.log(`Sanitized start time: ${startSeconds}s`);

  // reset target
  try { targetPlayer.pauseVideo(); } catch (e) { }
  try { targetPlayer.setVolume(0); } catch (e) { }
  targetElem.style.opacity = 0;

  // Cue video at position 0 first
  try {
    targetPlayer.cueVideoById(videoId, 0);
  } catch (err) {
    console.error("Error cueing video:", err);
    try { targetPlayer.cueVideoById(videoId); } catch (e) { }
  }

  // Wait for video to be cued
  let attempts = 0;
  console.log("Cueing track...");
  const readyCheck = setInterval(() => {
    attempts++;
    let state = -1;
    try { state = targetPlayer.getPlayerState(); } catch (e) { }

    // State 5: CUED
    if (state === 5 || attempts > 25) {
      clearInterval(readyCheck);
      console.log(`Track cued (state: ${state}). Seeking to ${startSeconds}s...`);

      // Custom seek logic: play briefly to enable seeking, then seek
      try {
        targetPlayer.setVolume(0);
        targetPlayer.playVideo();
      } catch (e) { }

      // Wait for playback to actually start before seeking
      let seekAttempts = 0;
      const seekCheck = setInterval(() => {
        seekAttempts++;
        let playState = -1;
        try { playState = targetPlayer.getPlayerState(); } catch (e) { }

        // State 1: PLAYING or State 3: BUFFERING means we can seek
        if (playState === 1 || playState === 3 || seekAttempts > 15) {
          clearInterval(seekCheck);
          console.log(`Player started (state: ${playState}). Performing seek to ${startSeconds}s...`);

          // Only seek if startSeconds > 0, otherwise we're already at the start
          if (startSeconds > 0) {
            try {
              targetPlayer.seekTo(startSeconds, true);
            } catch (e) {
              console.error("Seek failed:", e);
            }

            // Wait for seek to complete and buffer
            setTimeout(() => {
              // Verify we're at the right position
              let currentTime = 0;
              try { currentTime = targetPlayer.getCurrentTime(); } catch (e) { }
              console.log(`Seek complete. Current position: ${currentTime}s (target: ${startSeconds}s)`);

              // Ensure still muted and playing
              try {
                targetPlayer.setVolume(0);
                if (targetPlayer.getPlayerState() !== 1) {
                  targetPlayer.playVideo();
                }
              } catch (e) { }

              // Start crossfade
              setTimeout(() => startCrossfade(), 800);
            }, 600);
          } else {
            // No seek needed, already at start
            console.log(`Starting from beginning (0s)`);

            try {
              targetPlayer.setVolume(0);
              if (targetPlayer.getPlayerState() !== 1) {
                targetPlayer.playVideo();
              }
            } catch (e) { }

            // Start crossfade
            setTimeout(() => startCrossfade(), 800);
          }
        }
      }, 200);
    }
  }, 400);
}


/* ===================== Crossfade logic ===================== */
function startCrossfade() {
  if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }

  let vol1 = direction ? maxVol : 0;
  let vol2 = direction ? 0 : maxVol;
  console.log("3");
  try { player1.setVolume(vol1); } catch (e) { }
  try { player2.setVolume(vol2); } catch (e) { }
  document.getElementById('player1').style.opacity = (vol1 / maxVol).toString();
  document.getElementById('player2').style.opacity = (vol2 / maxVol).toString();

  try { if (vol1 > 0) player1.playVideo(); } catch (e) { }
  try { if (vol2 > 0) player2.playVideo(); } catch (e) { }

  const totalFadeTime = 5000;
  const stepMs = totalFadeTime / 100;
  const volStep = Number((maxVol / 100).toFixed(2));
  const startTimeMs = new Date().getTime();
  console.log(`Start Time (ms): ${startTimeMs}`);

  fadeInterval = setInterval(() => {
    if (direction) {
      if (vol1 > 0) vol1 = Number((vol1 - volStep).toFixed(2));
      if (vol2 < maxVol) vol2 = Number((vol2 + volStep).toFixed(2));
    } else {
      if (vol1 < maxVol) vol1 = Number((vol1 + volStep).toFixed(2));
      if (vol2 > 0) vol2 = Number((vol2 - volStep).toFixed(2));
    }
    // console.log("Vol1:-", vol1, vol2, "maxVol:-", maxVol, "volStep:-", volStep, "stepMs:-", stepMs);
    try { player1.setVolume(Math.round(vol1)); } catch (e) { }
    try { player2.setVolume(Math.round(vol2)); } catch (e) { }
    document.getElementById('player1').style.opacity = (vol1 / maxVol).toString();
    document.getElementById('player2').style.opacity = (vol2 / maxVol).toString();

    if (vol1 === 0) { try { player1.pauseVideo(); } catch (e) { } }
    if (vol2 === 0) { try { player2.pauseVideo(); } catch (e) { } }

    if ((direction && vol1 <= 0 && vol2 >= maxVol) || (!direction && vol1 >= maxVol && vol2 <= 0)) {
      clearInterval(fadeInterval);
      fadeInterval = null;
      if (direction) {
        player1.pauseVideo();
        player1.setVolume(0);
        player2.setVolume(maxVol);
      }
      else {
        player2.pauseVideo();
        player2.setVolume(0);
        player1.setVolume(maxVol);
      }
      direction = !direction;
      console.log("Faderue", direction,);
      const endTimeMs = new Date().getTime();
      // Difference is in milliseconds (ms)
      const differenceMs = endTimeMs - startTimeMs;

      // Convert milliseconds to seconds (divide by 1000)
      const differenceSec = differenceMs / 1000;
      console.log(`Time difference: **${differenceSec.toFixed(1)} seconds**`);
    }
  }, stepMs);
}

/* ===================== UI wiring: Enter submit and clearing ===================== */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('videoForm');
  const input = document.getElementById('videoInput');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value;

    // First check if it's a playlist
    const plId = extractPlaylistID(raw);
    if (plId) {
      console.log('Detected playlist:', plId);
      input.value = '';
      input.blur();
      loadPlaylistVideos(plId);
      return;
    }

    // Otherwise treat as video ID
    const videoId = extractVideoID(raw);
    if (!videoId) {
      alert('Please paste a valid YouTube video ID, URL, or Playlist ID.');
      return;
    }

    // Switch to single mode if we were in playlist mode
    if (playlistMode) {
      playlistMode = false;
      currentPlaylist = [];
      currentPlaylistIndex = 0;
      hasLoadedNext = false;
      stopPlaylistMonitoring();
      stopPlaylistRefreshChecker();
      updateOverlayInfo();
    }

    input.value = '';
    input.blur();

    loadIntoInactiveAndCrossfade(videoId);
  });

  document.body.addEventListener('click', () => input.focus());

  // Initialize overlay
  updateOverlayInfo();
});


document.addEventListener('DOMContentLoaded', () => {
  const inputWrapper = document.querySelector('.input-wrapper');
  const inputElement = document.getElementById('videoInput');
  let typingTimer; // Timer for hiding after no typing
  const hideAfterTypingDelay = 2000; // 2 seconds

  // Function to hide the input wrapper (by setting its opacity to 0)
  function hideInputWrapper() {
    if (!inputElement.value.trim()) { // Only hide if the input is empty
      inputWrapper.style.opacity = '0';
      // Optional: blur the input if it's still focused, so it also loses focus styling
      if (document.activeElement === inputElement) {
        inputElement.blur();
      }
    }
  }

  // Function to show the input wrapper (by setting its opacity to 1)
  function showInputWrapper() {
    inputWrapper.style.opacity = '1';
  }

  // --- Event Listeners ---
  // When the input receives focus
  inputElement.addEventListener('focus', () => {
    showInputWrapper(); // Ensure it's visible on focus
    clearTimeout(typingTimer); // Clear any pending hide timer
    typingTimer = setTimeout(hideInputWrapper, hideAfterTypingDelay);
  });

  // When the input loses focus (blurs)
  inputElement.addEventListener('blur', () => {
    // If the input is empty, hide it immediately or after a short delay
    if (inputElement.value.trim() === '') {
      // Give a tiny delay in case focus is moving to another related element
      setTimeout(hideInputWrapper, 100);
    }
  });

  // When the user types in the input
  inputElement.addEventListener('input', () => {
    showInputWrapper(); // Ensure it's visible while typing
    clearTimeout(typingTimer); // Reset the hide timer every time they type
    typingTimer = setTimeout(hideInputWrapper, hideAfterTypingDelay); // Start a new timer
  });

  if (inputElement.value.trim() !== '') {
    showInputWrapper();
  }
});


/**
* Calls your specific 'nextsong' API and logs the extracted details.
*/

async function getNextSong(data) {

  // const apiUrl = "https://pythondj.onrender.com/nextsong/";

  // A small log to show it's running
  console.log("Fetching new song...");

  try {
    // Log the extracted values
    console.log("  Title:", data.title);
    console.log("  Video ID:", data.videoId);
    console.log("  Timestamp:", data.timestamp);
    console.log("  nextSong:", nextSong);
    console.log("  hasLoadedNext:", hasLoadedNext);
    videoId = data.videoId;
    timestamp = data.timestamp;
    if (nextSong != videoId && hasLoadedNext == false) {
      hasLoadedNext = true;
      console.log("  Calling:", "True");
      nextSong = videoId;

      // Calculate start position: use timestamp directly, with minimum of 6 seconds
      const startPosition = Math.max(10, timestamp);
      console.log("  Start position:", startPosition);

      loadIntoInactiveAndCrossfade(nextSong, startPosition);
      setTimeout(() => {
        hasLoadedNext = false;
      }, 10000);
    }

  } catch (error) {
    console.error("Error fetching or parsing API:", error);
  }
}


/* ===================== Unified Sync Client (Player Role) ===================== */
class DJSyncClient {
  constructor(role = 'player') {
    this.role = role;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.baseDelay = 3000;
    this.pingInterval = null;
    this.connect();
  }

  connect() {
    const isLocal = window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname.startsWith("192.168.");

    // Ngrok Base URL
    const WBase = "wss://unappendaged-aretha-unwaning.ngrok-free.dev";

    let url;
    if (isLocal) {
      const host = window.location.port ? `${window.location.hostname}:${window.location.port}` : window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url = `${protocol}//${host}/ws/sync?role=${this.role}`;
    } else {
      url = `${WBase}/ws/sync?role=${this.role}`;
    }

    console.log(`[Sync Player] Connecting to ${url}...`);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[Sync Player] ✅ Connected");
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error("[Sync Player] Message parse error:", err);
      }
    };

    this.ws.onclose = () => {
      console.log("[Sync Player] 🔌 Disconnected");
      this.stopHeartbeat();
      this.retry();
    };

    this.ws.onerror = (err) => {
      console.error("[Sync Player] ❌ Error:", err);
    };
  }

  startHeartbeat() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping', { ts: Date.now() });
      }
    }, 10000);
  }

  stopHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  retry() {
    const delay = Math.min(this.baseDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    console.log(`[Sync Player] Retrying in ${delay / 1000}s...`);
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  handleMessage(msg) {
    const { type, data } = msg;
    switch (type) {
      case 'play':
        console.log("[Sync Player] Play request:", data);
        getNextSong(data);
        break;
      case 'vol':
        const vol = parseInt(data.volume);
        if (!isNaN(vol)) {
          console.log("[Sync Player] Volume update:", vol);
          changeVol(vol);
        }
        break;
      case 'control':
        console.log("[Sync Player] Control action:", data.action);
        this.handleControl(data);
        break;
      case 'mute':
        if (data && 'isMuted' in data) {
          isMuted = data.isMuted;
          applyMute(isMuted);
        }
        break;
    }
  }

  handleControl(data) {
    const p1Elem = document.getElementById('player1');
    if (!p1Elem) return;

    const p1Opacity = parseFloat(window.getComputedStyle(p1Elem).opacity);
    const activePlayer = p1Opacity > 0.5 ? player1 : player2;

    if (!activePlayer || typeof activePlayer.getPlayerState !== 'function') {
      console.warn("[Sync Player] Active player not ready for control");
      return;
    }

    switch (data.action) {
      case 'toggle':
        if (data.state === 'playing') {
          try { activePlayer.playVideo(); } catch (e) { }
        } else if (data.state === 'paused') {
          try { activePlayer.pauseVideo(); } catch (e) { }
        } else {
          const state = activePlayer.getPlayerState();
          if (state === YT.PlayerState.PLAYING) {
            try { activePlayer.pauseVideo(); } catch (e) { }
          } else {
            try { activePlayer.playVideo(); } catch (e) { }
          }
        }
        break;
      case 'next':
        loadNextFromPlaylist();
        break;
      case 'prev':
        loadPrevFromPlaylist();
        break;
    }
  }
}


function changeVol(vol) {
  try {
    maxVol = vol;
    if (player1 && typeof player1.setVolume === 'function') {
      player1.setVolume(vol);
      if (vol > 0) player1.unmute();
    }
    if (player2 && typeof player2.setVolume === 'function') {
      player2.setVolume(vol);
      if (vol > 0) player2.unmute();
    }

    // Auto-unmute state sync
    if (vol > 0 && isMuted) {
      isMuted = false;
      applyMute(false);
      syncClient.send('mute', { isMuted: false });
    }
  } catch (e) {
    console.error("Error setting volume:", e);
  }
}

function applyMute(muted) {
  try {
    if (player1 && typeof player1.mute === 'function') {
      muted ? player1.mute() : player1.unmute();
    }
    if (player2 && typeof player2.mute === 'function') {
      muted ? player2.mute() : player2.unmute();
    }

    const muteIndicator = document.getElementById('muteIndicator');
    if (muteIndicator) {
      muteIndicator.style.display = muted ? 'flex' : 'none';
    }
  } catch (e) {
    console.error("Error applying mute:", e);
  }
}

function toggleMute() {
  isMuted = !isMuted;
  applyMute(isMuted);
  syncClient.send('mute', { isMuted: isMuted });
}

// Initialize player sync client
const syncClient = new DJSyncClient('player');


// Fetch QR code on page load
document.addEventListener('DOMContentLoaded', fetchQRCode);


/* ===================== QR Code Manager ===================== */
const QR_API_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ? "http://0.0.0.0:8045/qr/"
  : "https://unappendaged-aretha-unwaning.ngrok-free.dev/qr/";
let qrVisible = false;

async function fetchQRCode() {
  try {
    const response = await fetch(QR_API_URL, {
      headers: {
        "ngrok-skip-browser-warning": "true"
      }
    });
    if (!response.ok) throw new Error("Failed to fetch QR code");

    // The request returns a base64img string
    let base64img = await response.text();

    // Clean up the string: remove quotes, whitespace, or potential JSON wrappers
    base64img = base64img.trim().replace(/^"|"$/g, '');

    const qrImage = document.getElementById('qrImage');
    // If it's already a full data URL, use it directly. Otherwise, prefix it.
    if (base64img.startsWith('data:image')) {
      qrImage.src = base64img;
    } else {
      qrImage.src = `data:image/png;base64,${base64img}`;
    }
  } catch (error) {
    console.error("Error fetching QR code:", error);
  }
}


function toggleQROverlay() {
  const overlay = document.getElementById('qrOverlay');
  qrVisible = !qrVisible;

  if (qrVisible) {
    fetchQRCode();
    overlay.style.display = 'flex';
    // Small delay to allow display: flex to take effect before adding opacity
    setTimeout(() => overlay.classList.add('visible'), 10);

    // Pause both players
    try { if (player1 && player1.pauseVideo) player1.pauseVideo(); } catch (e) { }
    try { if (player2 && player2.pauseVideo) player2.pauseVideo(); } catch (e) { }
  } else {
    overlay.classList.remove('visible');
    // Wait for transition to finish before hiding
    setTimeout(() => {
      if (!qrVisible) overlay.style.display = 'none';
    }, 400);

    // Resume the player that should be active based on opacity
    const p1Opacity = parseFloat(window.getComputedStyle(document.getElementById('player1')).opacity);
    if (p1Opacity > 0.5) {
      try { if (player1 && player1.playVideo) player1.playVideo(); } catch (e) { }
    } else {
      try { if (player2 && player2.playVideo) player2.playVideo(); } catch (e) { }
    }
  }
}


// Key listener for QR code toggle
document.addEventListener('keydown', (event) => {
  if ((event.key === 'q' || event.key === 'Q') && document.activeElement.tagName !== 'INPUT') {
    toggleQROverlay();
  }

  if (event.key === 'Escape' && qrVisible) {
    toggleQROverlay();
  }

  if ((event.key === 'm' || event.key === 'M') && document.activeElement.tagName !== 'INPUT') {
    toggleMute();
  }
});

// In script.js (loaded by index.html)
window.addEventListener('tv-fullscreen', () => {
  toggleFullscreen();
});
window.addEventListener('tv-show-qr', () => {
  toggleQROverlay();
});
window.addEventListener('tv-play-pause', () => {
  const p1Opacity = parseFloat(window.getComputedStyle(document.getElementById('player1')).opacity);
  const activePlayer = p1Opacity > 0.5 ? player1 : player2;
  const state = activePlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    try { activePlayer.pauseVideo(); } catch (e) { }
  } else {
    try { activePlayer.playVideo(); } catch (e) { }
  }
});
window.addEventListener('tv-play', () => {
  const p1Opacity = parseFloat(window.getComputedStyle(document.getElementById('player1')).opacity);
  const activePlayer = p1Opacity > 0.5 ? player1 : player2;
  try { activePlayer.playVideo(); } catch (e) { }
});
window.addEventListener('tv-pause', () => {
  const p1Opacity = parseFloat(window.getComputedStyle(document.getElementById('player1')).opacity);
  const activePlayer = p1Opacity > 0.5 ? player1 : player2;
  try { activePlayer.pauseVideo(); } catch (e) { }
});
window.addEventListener('tv-next', () => {
  loadNextFromPlaylist();
});
window.addEventListener('tv-prev', () => {
  loadPrevFromPlaylist();
});
/* ===================== Inactivity Handler (Hide Cursor) ===================== */
let inactivityTimer;
const hideCursor = () => document.body.classList.add('hide-cursor');
const showCursor = () => {
  document.body.classList.remove('hide-cursor');
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(hideCursor, 5000);
};

document.addEventListener('mousemove', showCursor);
document.addEventListener('keydown', showCursor);
document.addEventListener('touchstart', showCursor);

// Initial start
inactivityTimer = setTimeout(hideCursor, 5000);
