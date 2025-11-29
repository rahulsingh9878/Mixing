
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

const defaultVideo1 = "8SYPKQMW_2Q";
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
    playerVars: { autoplay: 1, start: 12, controls: 0, rel: 0, mute: 0, enablejsapi: 1 },
    events: {
      'onStateChange': onPlayerStateChange
    }
  });

  player2 = new YT.Player('player2', {
    videoId: defaultVideo2,
    playerVars: { autoplay: 0, start: 12, controls: 0, rel: 0, enablejsapi: 1 },
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
  newSong = nextVideoId
  loadIntoInactiveAndCrossfade(nextVideoId);

  // Reset flag after crossfade completes (about 9 seconds: 3s buffer + 6s fade)
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

/* ===================== Load video into inactive player ===================== */
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

  if (!targetPlayer || typeof targetPlayer.loadVideoById !== 'function') {
    alert('Player is not ready yet — wait a moment and try again.');
    return;
  }

  // reset target
  try { targetPlayer.pauseVideo(); } catch (e) { }
  try { targetPlayer.setVolume(0); } catch (e) { }
  targetElem.style.opacity = 0;

  // load video at 12s
  try {
    targetPlayer.loadVideoById({ videoId: videoId, startSeconds: startSeconds, suggestedQuality: 'large' });
  } catch (err) {
    try { targetPlayer.loadVideoById(videoId); } catch (e) { }
  }

  // readiness loop, then play muted and after 3s start crossfade
  let attempts = 0;
  console.log("Playing...");
  const readyCheck = setInterval(() => {
    attempts++;
    let state = -1;
    if (attempts > 3) console.log(attempts);
    try { state = targetPlayer.getPlayerState(); } catch (e) { }
    if (state === YT.PlayerState.PLAYING || attempts > 20) {
      clearInterval(readyCheck);
      try { targetPlayer.setVolume(0); } catch (e) { }
      try { targetPlayer.playVideo(); } catch (e) { }
      // wait 3 seconds then crossfade
      setTimeout(() => startCrossfade(), 1000);
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
      if (timestamp > 4) {
        timestamp -= 4;
      }
      loadIntoInactiveAndCrossfade(nextSong, timestamp - 4);
      setTimeout(() => {
        hasLoadedNext = false;
      }, 10000);
    }

  } catch (error) {
    console.error("Error fetching or parsing API:", error);
  }
}

const WS_BASE_URL = "wss://unappendaged-aretha-unwaning.ngrok-free.dev/";
let wsuri = `${WS_BASE_URL}ws/`
const ws = new WebSocket(wsuri);
ws.onopen = () => console.log("WS open");
ws.onmessage = (ev) => {
  // server sends JSON like {"video_id": "abc123"}
  const data = JSON.parse(ev.data);
  getNextSong(data);

  // do something e.g. play the video_id
};
ws.onclose = () => console.log("WS closed");

function palythis() {
  const ws = new WebSocket(wsuri);
  ws.onopen = () => console.log("WS open");
  ws.onmessage = (ev) => {
    // server sends JSON like {"video_id": "abc123"}
    const data = JSON.parse(ev.data);
    getNextSong(data);

    // do something e.g. play the video_id
  };
  ws.onclose = () => console.log("WS closed");
}

function changeVol(vol) {
  if (player1.getPlayerState() == YT.PlayerState.PLAYING) {
    player1.setVolume(vol);
    maxVol = vol;
  } else {
    player2.setVolume(vol);
    maxVol = vol;
  }
}

// Volume control WebSocket
let volumeWsUri = `${WS_BASE_URL}ws/vol/`
const volumeWs = new WebSocket(volumeWsUri);
volumeWs.onopen = () => console.log("Volume WS open");
volumeWs.onmessage = (ev) => {
  // server sends JSON like {"volume": "50"}
  const data = JSON.parse(ev.data);
  const vol = parseInt(data.volume);
  // console.log("Received volume:", vol);
  changeVol(vol);
};
volumeWs.onclose = () => {
  console.log("Volume WS closed");
  // Optionally reconnect after a delay
  setTimeout(() => {
    const volumeWs = new WebSocket(volumeWsUri);
    volumeWs.onopen = () => console.log("Volume WS reconnected");
    volumeWs.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      const vol = parseInt(data.volume);
      changeVol(vol);
    };
  }, 3000);
};
