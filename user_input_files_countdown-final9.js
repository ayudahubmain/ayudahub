/**
 * CLOUDFLARE WORKER - Enhanced Countdown with Server-Side Batch Timer
 * Features: Server-authoritative 10-min batch timer, auto-delete qua1, proper queue progression
 */

const CONFIG = {
  MUSIC_URL: 'https://yammering-amethyst-b1g1tge5s8.edgeone.app/FREE%20Smino%20Type%20Beat%20%20Vibe.mp3',
  TIMEZONE: 'Asia/Manila',
  KV_KEY: 'release_queue',
  BATCH_KEY: 'batch_state',
  BATCH_DURATION: 600000 // 10 minutes in milliseconds
};

const HTML_COUNTDOWN = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Countdown Release</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;min-height:100vh;background:#0f0f1a;color:#fff;overflow-x:hidden}
    .color-bg{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;transition:background .8s}
    .blur-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;transition:filter .5s,opacity .5s;filter:blur(20px)}
    .blur-overlay.unlocked{filter:blur(0);opacity:1}
    
    /* TOP BUTTONS - Positioned at top of countdown */
    .top-controls{position:fixed;top:1.5rem;left:50%;transform:translateX(-50%);z-index:15;display:flex;gap:.75rem;flex-wrap:wrap;justify-content:center}
    .top-btn{display:inline-flex;align-items:center;justify-content:center;padding:.6rem 1.5rem;font-family:'Orbitron',monospace;font-size:.75rem;font-weight:600;letter-spacing:.1em;color:#fff;background:linear-gradient(135deg,rgba(255,105,180,.3),rgba(139,92,246,.3));border:1px solid rgba(255,255,255,0.2);border-radius:25px;cursor:pointer;backdrop-filter:blur(10px);transition:all .3s;text-decoration:none}
    .top-btn:hover{background:linear-gradient(135deg,rgba(255,105,180,.5),rgba(139,92,246,.5));transform:translateY(-2px);box-shadow:0 5px 20px rgba(255,105,180,.3)}
    
    .container{text-align:center;margin-bottom:3rem;position:relative;z-index:2}
    .title{font-family:'Orbitron',monospace;font-size:clamp(1.2rem,4vw,2rem);font-weight:700;letter-spacing:.3em;margin-bottom:1.5rem;color:#FF69B4;text-shadow:0 0 30px #FF69B4}
    .release-title{font-family:'Orbitron',monospace;font-size:1.5rem;color:#8B5CF6;margin-bottom:2rem;text-shadow:0 0 20px #8B5CF6}
    .countdown{display:flex;align-items:center;justify-content:center;gap:.5rem;flex-wrap:wrap}
    .segment{display:flex;flex-direction:column;align-items:center;min-width:clamp(60px,15vw,100px)}
    .value{font-family:'Orbitron',monospace;font-size:clamp(2.5rem,10vw,6rem);font-weight:900;color:#fff;text-shadow:0 0 40px currentColor}
    .label{font-size:.8rem;font-weight:600;letter-spacing:.2em;color:#a0a0b0;margin-top:.5rem}
    .sep{font-family:'Orbitron',monospace;font-size:clamp(2rem,8vw,4rem);font-weight:700;opacity:.5}
    
    /* Batch Timer Box */
    .batch-timer{background:linear-gradient(135deg,rgba(255,105,180,.2),rgba(139,92,246,.2));border:2px solid rgba(255,105,180,.5);border-radius:16px;padding:1.5rem 2rem;margin-bottom:1.5rem;max-width:400px;margin-left:auto;margin-right:auto;display:none}
    .batch-timer.active{display:block;animation:pulse 2s infinite}
    .batch-timer-header{display:flex;align-items:center;justify-content:center;gap:.75rem;margin-bottom:.75rem}
    .batch-icon{width:28px;height:28px;color:#FF69B4}
    .batch-timer-title{font-family:'Orbitron',monospace;font-size:.9rem;font-weight:700;color:#FF69B4;letter-spacing:.1em}
    .batch-time{font-family:'Orbitron',monospace;font-size:2.5rem;font-weight:900;color:#fff;text-shadow:0 0 30px #FF69B4}
    .batch-time.warning{color:#fbbf24;text-shadow:0 0 30px #fbbf24}
    .batch-time.urgent{color:#ef4444;text-shadow:0 0 30px #ef4444;animation:blink 0.5s infinite}
    .batch-label{font-size:.75rem;color:#a0a0b0;letter-spacing:.15em;margin-top:.25rem}
    .batch-enter-btn{margin-top:1rem;padding:1rem 2.5rem;font-family:'Orbitron',monospace;font-size:1rem;font-weight:700;color:#fff;background:linear-gradient(135deg,#FF69B4,#8B5CF6);border:none;border-radius:50px;cursor:pointer;transition:all .3s;box-shadow:0 10px 40px rgba(255,105,180,.4);animation:bounce 1s infinite}
    .batch-enter-btn:hover{transform:scale(1.05)}
    .batch-expired{color:#ef4444;font-family:'Orbitron',monospace;font-size:1rem;font-weight:600;margin-top:1rem;display:none}
    
    @keyframes pulse{0%,100%{box-shadow:0 0 20px rgba(255,105,180,.3)}50%{box-shadow:0 0 40px rgba(255,105,180,.6)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.5}}
    @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
    
    .enter-btn{position:fixed;bottom:15%;left:50%;transform:translateX(-50%);z-index:10;display:flex;align-items:center;justify-content:center;gap:.75rem;padding:1rem 3rem;font-family:'Orbitron',monospace;font-size:1.2rem;font-weight:700;letter-spacing:.15em;color:#fff;background:linear-gradient(135deg,#FF69B4,#8B5CF6);border:none;border-radius:50px;cursor:pointer;transition:all .3s;box-shadow:0 10px 40px rgba(255,105,180,.4)}
    .enter-btn:hover{transform:translateX(-50%) scale(1.05)}
    .enter-btn.animating{animation:jumpUp 1s ease-in-out forwards}
    .enter-btn.hidden{display:none}
    .btn-icon{width:24px;height:24px}
    @keyframes jumpUp{0%{transform:translateX(-50%) translateY(0) scale(1);opacity:1}50%{transform:translateX(-50%) translateY(-150px) scale(.9);opacity:.8}100%{transform:translateX(-50%) translateY(-300px) scale(.8);opacity:0}}
    #bg-music{display:none}
    
    /* Queue indicator */
    .queue-info{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);z-index:10;font-size:.8rem;color:#a0a0b0;letter-spacing:.1em}
    .queue-count{color:#FF69B4;font-weight:700}
  </style>
</head>
<body>
  <div class="color-bg" id="colorBg"></div>
  
  <!-- TOP BUTTONS - REFRESH and SOUND only -->
  <div class="top-controls">
    <button class="top-btn" id="refreshBtn">
      <svg style="width:16px;height:16px;margin-right:6px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
        <path d="M16 16h5v5"/>
      </svg>
      REFRESH
    </button>
    <button class="top-btn" id="soundBtn">
      <svg style="width:16px;height:16px;margin-right:6px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      </svg>
      SOUND
    </button>
  </div>
  
  <div class="blur-overlay" id="blurOverlay">
    <div class="container">
      <h1 class="title">RELEASE IN</h1>
      <p class="release-title" id="releaseTitle">Loading...</p>
      
      <!-- BATCH TIMER - Shows when countdown reaches 0 -->
      <div class="batch-timer" id="batchTimer">
        <div class="batch-timer-header">
          <svg class="batch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="batch-timer-title">BATCH 1</span>
        </div>
        <div class="batch-time" id="batchTime">10:00</div>
        <div class="batch-label">10 MINS ONLY - CLICK TO ENTER</div>
        <button class="batch-enter-btn" id="batchEnterBtn">
          <svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          ENTER NOW
        </button>
        <div class="batch-expired" id="batchExpired">BATCH EXPIRED</div>
      </div>
      
      <div class="countdown">
        <div class="segment"><span class="value" id="days">00</span><span class="label">DAYS</span></div>
        <span class="sep">:</span>
        <div class="segment"><span class="value" id="hours">00</span><span class="label">HOURS</span></div>
        <span class="sep">:</span>
        <div class="segment"><span class="value" id="minutes">00</span><span class="label">MINS</span></div>
        <span class="sep">:</span>
        <div class="segment"><span class="value" id="seconds">00</span><span class="label">SECS</span></div>
      </div>
    </div>
  </div>
  <button class="enter-btn" id="enterBtn">
    <span>ENTER</span>
    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  </button>
  
  <div class="queue-info">
    <span class="queue-count" id="queueCount">0</span> releases in queue
  </div>
  
  <audio id="bg-music" loop>
    <source src="${CONFIG.MUSIC_URL}" type="audio/mpeg">
  </audio>

  <script>
    const COLORS = ['#FF69B4', '#8B5CF6', '#3B82F6'];
    let colorIdx = 0;
    let isUnlocked = false;
    const QUEUE_DATA = __QUEUE_DATA__;
    const BATCH_STATE = __BATCH_STATE__;
    const BATCH_DURATION = __BATCH_DURATION__;

    const music = document.getElementById('bg-music');
    const enterBtn = document.getElementById('enterBtn');
    const blurOverlay = document.getElementById('blurOverlay');
    const colorBg = document.getElementById('colorBg');
    const batchTimer = document.getElementById('batchTimer');
    const batchTime = document.getElementById('batchTime');
    const batchEnterBtn = document.getElementById('batchEnterBtn');
    const batchExpired = document.getElementById('batchExpired');
    const refreshBtn = document.getElementById('refreshBtn');
    const soundBtn = document.getElementById('soundBtn');
    const queueCount = document.getElementById('queueCount');

    let batchExpiredFlag = false;
    let currentRedirectUrl = null;
    let currentItemId = null;
    let batchStartTime = null; // For client-side timer tracking

    function pad(n) { return n.toString().padStart(2, '0'); }

    // Check if we have a pending batch from a previous page load (localStorage)
    function checkPendingBatch() {
      const pending = localStorage.getItem('pendingBatch');
      if (pending) {
        const data = JSON.parse(pending);
        // Check if pending batch is still valid (within 10 minutes)
        const elapsed = new Date() - new Date(data.startTime);
        if (elapsed < BATCH_DURATION) {
          return data;
        } else {
          // Pending batch expired, clear it
          localStorage.removeItem('pendingBatch');
        }
      }
      return null;
    }

    function savePendingBatch(itemId, title, url) {
      const data = {
        itemId: itemId,
        title: title,
        url: url,
        startTime: new Date().toISOString()
      };
      localStorage.setItem('pendingBatch', JSON.stringify(data));
    }

    // Update queue count display
    if (QUEUE_DATA && QUEUE_DATA.length > 0) {
      queueCount.textContent = QUEUE_DATA.length;
    }

    // Background animation
    function updateBg() {
      const c = COLORS[colorIdx];
      colorBg.style.background = 'radial-gradient(ellipse at center, ' + c + '40 0%, #0f0f1a 70%)';
      colorBg.style.boxShadow = 'inset 0 0 150px ' + c + '60';
      document.body.style.color = c;
      colorIdx = (colorIdx + 1) % COLORS.length;
    }
    updateBg();
    setInterval(updateBg, 1000);

    // Sound toggle
    let soundOn = false;
    soundBtn.addEventListener('click', function() {
      soundOn = !soundOn;
      if (soundOn) {
        music.play().catch(function() {});
        soundBtn.innerHTML = '<svg style="width:16px;height:16px;margin-right:6px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>SOUND';
      } else {
        music.pause();
        soundBtn.innerHTML = '<svg style="width:16px;height:16px;margin-right:6px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>SOUND';
      }
    });

    // Refresh button
    refreshBtn.addEventListener('click', function() {
      location.reload();
    });

    // Check if batch timer is active (from server or localStorage) and show it
    function checkBatchState() {
      // Check server batch state first
      const hasServerBatch = BATCH_STATE && BATCH_STATE.active === true;
      const pendingBatch = checkPendingBatch();

      if (hasServerBatch) {
        // Calculate remaining time from server start time
        const serverNow = new Date(BATCH_STATE.serverTime);
        const startTime = new Date(BATCH_STATE.startTime);
        const elapsed = serverNow - startTime;
        const remaining = Math.max(0, BATCH_DURATION - elapsed);

        // ALWAYS show enter button when server batch is active
        enterBtn.classList.remove('hidden');
        enterBtn.classList.remove('animating');

        if (remaining <= 0) {
          // Batch expired
          batchExpiredFlag = true;
          batchEnterBtn.style.display = 'none';
          batchExpired.style.display = 'block';
          batchTimer.classList.add('active');
          batchTime.textContent = '00:00';
          batchTime.className = 'batch-time urgent';
          localStorage.removeItem('pendingBatch');

          // Reset enter button state
          isUnlocked = false;
          enterBtn.classList.remove('hidden');
          enterBtn.classList.remove('animating');

          return true;
        }

        // Show active batch timer
        currentRedirectUrl = BATCH_STATE.url;
        batchTimer.classList.add('active');
        batchExpired.style.display = 'none';
        batchEnterBtn.style.display = 'block';
        batchStartTime = startTime;

        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        batchTime.textContent = pad(mins) + ':' + pad(secs);

        // Visual warnings
        if (remaining <= 60000 && remaining > 30000) {
          batchTime.className = 'batch-time warning';
        } else if (remaining <= 30000) {
          batchTime.className = 'batch-time urgent';
        } else {
          batchTime.className = 'batch-time';
        }

        return true;
      }

      // Check localStorage pending batch
      if (pendingBatch) {
        const startTime = new Date(pendingBatch.startTime);
        const elapsed = new Date() - startTime;
        const remaining = Math.max(0, BATCH_DURATION - elapsed);

        // ALWAYS show enter button when pending batch exists
        enterBtn.classList.remove('hidden');
        enterBtn.classList.remove('animating');

        if (remaining <= 0) {
          // Batch expired
          batchExpiredFlag = true;
          batchEnterBtn.style.display = 'none';
          batchExpired.style.display = 'block';
          batchTimer.classList.add('active');
          batchTime.textContent = '00:00';
          batchTime.className = 'batch-time urgent';
          localStorage.removeItem('pendingBatch');

          // Reset enter button state
          isUnlocked = false;
          enterBtn.classList.remove('hidden');
          enterBtn.classList.remove('animating');

          return true;
        }

        // Show active batch timer from localStorage
        currentRedirectUrl = pendingBatch.url;
        currentItemId = pendingBatch.itemId;
        batchTimer.classList.add('active');
        batchExpired.style.display = 'none';
        batchEnterBtn.style.display = 'block';
        batchStartTime = startTime;

        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        batchTime.textContent = pad(mins) + ':' + pad(secs);

        // Visual warnings
        if (remaining <= 60000 && remaining > 30000) {
          batchTime.className = 'batch-time warning';
        } else if (remaining <= 30000) {
          batchTime.className = 'batch-time urgent';
        } else {
          batchTime.className = 'batch-time';
        }

        return true;
      }

      // No active batch
      batchTimer.classList.remove('active');
      return false;
    }

    function updateBatchTimer() {
      // Check if batch is active (server or localStorage)
      const hasServerBatch = BATCH_STATE && BATCH_STATE.active === true;
      const pendingBatch = checkPendingBatch();

      if (!hasServerBatch && !pendingBatch) return;
      if (batchExpiredFlag) return;
      
      // Use the appropriate start time
      let startTime;
      if (hasServerBatch) {
        startTime = new Date(BATCH_STATE.startTime);
        currentRedirectUrl = BATCH_STATE.url;
      } else if (pendingBatch) {
        startTime = new Date(pendingBatch.startTime);
        currentRedirectUrl = pendingBatch.url;
      }
      
      const now = new Date();
      const elapsed = now - startTime;
      const remaining = Math.max(0, BATCH_DURATION - elapsed);
      
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      batchTime.textContent = pad(mins) + ':' + pad(secs);
      
      // Visual warnings
      if (remaining <= 60000 && remaining > 30000) {
        batchTime.className = 'batch-time warning';
      } else if (remaining <= 30000) {
        batchTime.className = 'batch-time urgent';
      } else {
        batchTime.className = 'batch-time';
      }
      
      // Batch expired
      if (remaining <= 0 && !batchExpiredFlag) {
        batchExpiredFlag = true;
        batchEnterBtn.style.display = 'none';
        batchExpired.style.display = 'block';
        batchTime.textContent = '00:00';
        batchTime.className = 'batch-time urgent';
        localStorage.removeItem('pendingBatch');
        
        // Auto reload to show next queue item
        setTimeout(function() { location.reload(); }, 3000);
      }
    }

    // Batch enter button
    batchEnterBtn.addEventListener('click', function() {
      if (batchExpiredFlag) return;
      if (!currentRedirectUrl) return;

      music.play().catch(function() {});
      blurOverlay.classList.add('unlocked');

      // Don't hide batch timer - just unblur the background
      // Redirect to release URL after animation
      setTimeout(function() {
        window.location.href = currentRedirectUrl;
      }, 500);
    });

    // Enter button - Just unblur, don't redirect
    function unlockOverlay() {
      if (isUnlocked) return;
      isUnlocked = true;
      music.play().catch(function() {});
      enterBtn.classList.add('animating');
      setTimeout(function() {
        enterBtn.classList.add('hidden');
        blurOverlay.classList.add('unlocked');
      }, 500);
    }

    enterBtn.addEventListener('click', unlockOverlay);

    // Keyboard support - Enter key triggers unlock
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !isUnlocked) {
        unlockOverlay();
      }
    });

    // Click anywhere on overlay to unblur (as alternative to button)
    blurOverlay.addEventListener('click', function(e) {
      // Don't trigger if clicking on batch timer or its buttons
      if (e.target.closest('.batch-timer') || e.target.closest('.batch-enter-btn')) return;
      if (e.target.closest('.enter-btn')) return;
      if (!batchExpiredFlag && !isUnlocked) {
        unlockOverlay();
      }
    });

    // Main update - Handle both batch state and countdown
    let lastBatchItemId = null; // Track which item we're currently on

    function update() {
      // Check if batch item changed - reset states
      const hasServerBatch = BATCH_STATE && BATCH_STATE.active === true;
      const pendingBatch = checkPendingBatch();
      const currentBatchItemId = hasServerBatch ? BATCH_STATE.itemId : (pendingBatch ? pendingBatch.itemId : null);
      const activeBatchTitle = hasServerBatch ? BATCH_STATE.title : (pendingBatch ? pendingBatch.title : null);

      if (currentBatchItemId && currentBatchItemId !== lastBatchItemId) {
        // New batch item started, reset unlock state
        isUnlocked = false;
        batchExpiredFlag = false;
        lastBatchItemId = currentBatchItemId;
      }

      // Reset unlock state if batch expired
      if (batchExpiredFlag) {
        isUnlocked = false;
      }

      // Get next item info from server (for showing qua2 countdown while qua1 is active)
      const nextItem = BATCH_STATE && BATCH_STATE.nextItem ? BATCH_STATE.nextItem : null;

      // Check if there's an active batch (qua1 is LIVE)
      if (checkBatchState()) {
        // Batch is active - show batch timer at 00:00:00
        document.getElementById('days').textContent = '00';
        document.getElementById('hours').textContent = '00';
        document.getElementById('minutes').textContent = '00';
        document.getElementById('seconds').textContent = '00';

        if (batchExpiredFlag) {
          document.getElementById('releaseTitle').textContent = 'BATCH EXPIRED - Reloading...';
          setTimeout(function() { location.reload(); }, 2000);
        } else {
          // Show current batch title
          const title = activeBatchTitle || 'RELEASE';
          document.getElementById('releaseTitle').textContent = title + ' - LIVE!';
        }

        updateBatchTimer();

        // If there's a next item ready, show its countdown below
        if (nextItem) {
          const nextTarget = new Date(nextItem.releaseTime || nextItem.startTime);
          const now = new Date();
          const diff = nextTarget - now;

          if (diff > 0) {
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);

            document.getElementById('days').textContent = pad(days);
            document.getElementById('hours').textContent = pad(hours);
            document.getElementById('minutes').textContent = pad(minutes);
            document.getElementById('seconds').textContent = pad(seconds);
            document.getElementById('releaseTitle').textContent = nextItem.title + ' - NEXT!';
          }
        }

        return;
      }

      // No active batch, show countdown for next item
      if (!QUEUE_DATA || QUEUE_DATA.length === 0) {
        document.getElementById('days').textContent = '00';
        document.getElementById('hours').textContent = '00';
        document.getElementById('minutes').textContent = '00';
        document.getElementById('seconds').textContent = '00';
        document.getElementById('releaseTitle').textContent = 'No releases scheduled';
        enterBtn.classList.add('hidden');
        enterBtn.classList.remove('animating');
        return;
      }

      const now = new Date();

      // Sort queue by release time
      const sorted = QUEUE_DATA.slice().sort(function(a, b) {
        return new Date(a.releaseTime) - new Date(b.releaseTime);
      });

      // Find releases that are ready (past their release time) but NOT the active batch item
      const readyReleases = sorted.filter(function(c) {
        return new Date(c.releaseTime) <= now && c.id !== currentBatchItemId;
      });

      // Find the next upcoming release (NOT the active batch item)
      const upcomingReleases = sorted.filter(function(c) {
        return new Date(c.releaseTime) > now && c.id !== currentBatchItemId;
      });

      // If there's a ready release that's not the active batch, start its batch
      if (readyReleases.length > 0) {
        const next = readyReleases[0];

        // Check if we have a pending batch from localStorage
        const pendingBatchLocal = checkPendingBatch();
        if (pendingBatchLocal && pendingBatchLocal.itemId === next.id) {
          batchStartTime = new Date(pendingBatchLocal.startTime);
          currentRedirectUrl = pendingBatchLocal.url;
          currentItemId = next.id;
          batchTimer.classList.add('active');
          batchExpired.style.display = 'none';
          batchEnterBtn.style.display = 'block';
          enterBtn.classList.remove('hidden');
          enterBtn.classList.remove('animating');
          document.getElementById('releaseTitle').textContent = pendingBatchLocal.title + ' - LIVE!';
          return;
        }

        // Auto-start batch for this release
        batchStartTime = new Date();
        savePendingBatch(next.id, next.title, next.url);

        batchTimer.classList.add('active');
        batchTime.textContent = '10:00';
        batchTime.className = 'batch-time';
        batchExpired.style.display = 'none';
        batchEnterBtn.style.display = 'block';
        currentRedirectUrl = next.url;
        currentItemId = next.id;
        lastBatchItemId = next.id;

        enterBtn.classList.remove('hidden');
        enterBtn.classList.remove('animating');

        document.getElementById('days').textContent = '00';
        document.getElementById('hours').textContent = '00';
        document.getElementById('minutes').textContent = '00';
        document.getElementById('seconds').textContent = '00';
        document.getElementById('releaseTitle').textContent = next.title + ' - LIVE!';
        return;
      }

      // Show countdown for next upcoming release
      if (upcomingReleases.length > 0) {
        const next = upcomingReleases[0];
        const target = new Date(next.releaseTime);
        const diff = target - now;

        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        document.getElementById('days').textContent = pad(days);
        document.getElementById('hours').textContent = pad(hours);
        document.getElementById('minutes').textContent = pad(minutes);
        document.getElementById('seconds').textContent = pad(seconds);
        document.getElementById('releaseTitle').textContent = next.title;
        enterBtn.classList.add('hidden');
        enterBtn.classList.remove('animating');
        currentRedirectUrl = next.url;
        currentItemId = next.id;
        return;
      }

      // No more releases
      document.getElementById('days').textContent = '00';
      document.getElementById('hours').textContent = '00';
      document.getElementById('minutes').textContent = '00';
      document.getElementById('seconds').textContent = '00';
      document.getElementById('releaseTitle').textContent = 'All Releases Complete';
      enterBtn.classList.add('hidden');
      enterBtn.classList.remove('animating');
      batchTimer.classList.remove('active');
    }

    update();
    setInterval(update, 1000);
  <\/script>
</body>
</html>`;

const HTML_ADMIN = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Panel</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;min-height:100vh;background:linear-gradient(135deg,#0a0a14,#1a1a2e);color:#fff;padding:2rem;padding-bottom:6rem}
    .container{max-width:800px;margin:0 auto}
    h1{font-family:'Orbitron',monospace;font-size:1.5rem;letter-spacing:.1em;margin-bottom:2rem;text-align:center}
    .nav{text-align:center;margin-bottom:2rem;display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}
    .nav a{display:inline-block;padding:.5rem 1rem;border:1px solid #8B5CF6;border-radius:25px;color:#8B5CF6;text-decoration:none;transition:all .3s}
    .nav a:hover,.nav a.active{background:#8B5CF6;color:#fff}
    .card{background:rgba(20,20,35,0.95);border-radius:16px;padding:1.5rem;border:1px solid rgba(255,255,255,0.1);margin-bottom:1.5rem}
    .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.1)}
    .card-header h2{font-family:'Orbitron',monospace;font-size:1rem}
    .badge{padding:.3rem .8rem;border-radius:20px;font-size:.75rem;font-weight:600}
    .badge.active{background:rgba(34,197,94,0.2);color:#22c55e}
    .badge.released{background:rgba(139,92,246,0.2);color:#8B5CF6}
    .badge.draft{background:rgba(255,105,180,0.2);color:#FF69B4}
    .queue-list{display:flex;flex-direction:column;gap:1rem}
    .queue-item{background:rgba(255,255,255,0.03);border-radius:12px;padding:1.25rem;border:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem}
    .queue-item.playing{background:rgba(255,105,180,0.1);border-color:#FF69B4}
    .queue-info{flex:1;min-width:200px}
    .queue-title{font-family:'Orbitron',monospace;font-size:.95rem;font-weight:600;margin-bottom:.25rem}
    .queue-position{font-size:.7rem;color:#FF69B4;margin-bottom:.5rem}
    .queue-timer{font-family:'Orbitron',monospace;font-size:.85rem;color:#22c55e;margin-top:.5rem}
    .queue-timer.warning{color:#fbbf24}
    .queue-timer.urgent{color:#ef4444;animation:blink 0.5s infinite}
    .queue-actions{display:flex;gap:.5rem}
    .btn-icon{width:36px;height:36px;border-radius:8px;border:none;cursor:pointer;font-size:1rem;transition:all .3s}
    .btn-edit{background:rgba(59,130,246,0.2);color:#3B82F6}
    .btn-edit:hover{background:rgba(59,130,246,0.4)}
    .btn-delete{background:rgba(239,68,68,0.2);color:#ef4444}
    .btn-delete:hover{background:rgba(239,68,68,0.4)}
    .form{display:grid;gap:1.25rem}
    .form-row{display:flex;gap:1rem;flex-wrap:wrap}
    .form-group{flex:1;min-width:200px}
    label{display:block;font-size:.85rem;font-weight:600;margin-bottom:.5rem;color:#a0a0b0}
    input{width:100%;padding:.85rem 1rem;font-size:1rem;color:#fff;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;outline:none;transition:all .3s}
    input:focus{border-color:#8B5CF6;box-shadow:0 0 20px rgba(139,92,246,0.2)}
    .btn{padding:1rem;font-family:'Orbitron',monospace;font-size:.85rem;font-weight:600;border-radius:10px;cursor:pointer;transition:all .3s;border:none}
    .btn-primary{background:linear-gradient(135deg,#FF69B4,#8B5CF6);color:#fff;flex:1}
    .btn-primary:hover{transform:translateY(-2px)}
    .btn-secondary{background:rgba(139,92,246,0.2);color:#8B5CF6;border:1px solid #8B5CF6}
    .btn-secondary:hover{background:#8B5CF6;color:#fff}
    .success{background:rgba(34,197,94,0.2);color:#22c55e;padding:1rem;border-radius:10px;margin-bottom:1rem;text-align:center;font-weight:600;display:none}
    .empty{text-align:center;padding:3rem;color:#a0a0b0}
    .add-btn{background:linear-gradient(135deg,#FF69B4,#8B5CF6);color:#fff;border:none;padding:1rem 2rem;border-radius:50px;font-family:'Orbitron',monospace;font-weight:700;cursor:pointer;transition:all .3s}
    .add-btn:hover{transform:scale(1.05)}
    .current-time{color:#a0a0b0;font-size:.85rem;margin-top:.5rem}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.5}}
    @media(max-width:600px){.form-row{flex-direction:column}.queue-item{flex-direction:column}.queue-actions{width:100%;justify-content:flex-end}}
  </style>
</head>
<body>
  <div class="container">
    <h1>ADMIN PANEL</h1>
    <div class="nav">
      <a href="/">View Countdown</a>
      <a href="#" class="active">Manage Queue</a>
    </div>

    <div id="listView">
      <div class="card">
        <div class="card-header">
          <h2>Release Queue</h2>
          <span id="queueStatus" class="badge draft">0 releases</span>
        </div>
        <div id="queueList" class="queue-list"></div>
      </div>
    </div>

    <div id="formView" style="display:none" class="card">
      <div class="card-header">
        <h2 id="formTitle">Add New Release</h2>
      </div>
      <form class="form" id="releaseForm">
        <div class="form-group">
          <label>Release Title</label>
          <input type="text" id="title" placeholder="My Awesome Release" required>
        </div>
        <div class="form-group">
          <label>Redirect URL (where visitors go when countdown ends)</label>
          <input type="url" id="url" placeholder="https://youtube.com/watch?v=..." required>
        </div>
        <div class="form-group">
          <label>Batch ID (e.g., "batch1", "qua1")</label>
          <input type="text" id="batchId" placeholder="batch1" value="batch1">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Date</label>
            <input type="date" id="date" required>
          </div>
          <div class="form-group">
            <label>Time (PHT)</label>
            <input type="time" id="time" required>
          </div>
        </div>
        <div style="display:flex;gap:1rem">
          <button type="submit" class="btn btn-primary">SAVE RELEASE</button>
          <button type="button" id="cancelBtn" class="btn btn-secondary">CANCEL</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const TZ = '${CONFIG.TIMEZONE}';
    let queue = [];
    let editingId = null;

    function pad(n) { return n.toString().padStart(2, '0'); }

    function formatDate(iso) {
      if (!iso) return 'Not set';
      return new Date(iso).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
    }

    function getStatus(releaseTime) {
      return new Date(releaseTime) <= new Date() ? 'released' : 'active';
    }

    function sortByDate(items) {
      return items.sort(function(a, b) { return new Date(a.releaseTime) - new Date(b.releaseTime); });
    }

    async function fetchQueue() {
      try {
        const res = await fetch('/api/queue');
        if (res.ok) queue = await res.json();
      } catch (e) { console.error(e); }
    }

    async function saveQueue() {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queue)
      });
      return res.ok;
    }

    function render() {
      const list = document.getElementById('queueList');
      const status = document.getElementById('queueStatus');

      const sorted = sortByDate([].concat(queue));
      const active = sorted.filter(function(c) { return getStatus(c.releaseTime) === 'active'; });
      const released = sorted.filter(function(c) { return getStatus(c.releaseTime) === 'released'; });

      if (queue.length === 0) {
        list.innerHTML = '<div class="empty"><p>No releases in queue. Add your first one!</p><button class="add-btn" id="addBtn">+ ADD RELEASE</button></div>';
        status.textContent = '0 releases';
        status.className = 'badge draft';
        return;
      }

      let html = '';
      active.forEach(function(c, i) {
        const pos = i === 0 ? 'NOW PLAYING' : '#' + (i + 1) + ' IN QUEUE';
        const cls = i === 0 ? ' playing' : '';
        html += '<div class="queue-item' + cls + '"><div class="queue-info"><div class="queue-title">' + c.title + '</div><div class="queue-position">' + pos + '</div><div class="current-time">' + formatDate(c.releaseTime) + '</div></div><span class="badge active">active</span><div class="queue-actions"><button class="btn-icon btn-edit" data-id="' + c.id + '">&#9998;</button><button class="btn-icon btn-delete" data-id="' + c.id + '">&times;</button></div></div>';
      });

      released.forEach(function(c) {
        html += '<div class="queue-item" style="opacity:0.5"><div class="queue-info"><div class="queue-title">' + c.title + '</div><div class="queue-position">COMPLETED</div><div class="current-time">' + formatDate(c.releaseTime) + '</div></div><span class="badge released">released</span><div class="queue-actions"><button class="btn-icon btn-delete" data-id="' + c.id + '">&times;</button></div></div>';
      });

      html += '<button class="add-btn" id="addBtn" style="margin-top:1rem">+ ADD ANOTHER RELEASE</button>';
      list.innerHTML = html;

      status.textContent = active.length + ' active, ' + released.length + ' released';
      status.className = 'badge ' + (active.length > 0 ? 'active' : 'released');
    }

    function showForm(item) {
      document.getElementById('listView').style.display = 'none';
      document.getElementById('formView').style.display = 'block';

      if (item) {
        document.getElementById('formTitle').textContent = 'Edit Release';
        document.getElementById('title').value = item.title || '';
        document.getElementById('url').value = item.url || '';
        document.getElementById('batchId').value = item.batchId || 'batch1';
        if (item.releaseTime) {
          const d = new Date(item.releaseTime);
          const local = d.toLocaleString('en-CA', { timeZone: TZ });
          const parts = local.split(' ');
          document.getElementById('date').value = parts[0];
          document.getElementById('time').value = parts[1].slice(0, 5);
        }
        editingId = item.id;
      } else {
        document.getElementById('formTitle').textContent = 'Add New Release';
        document.getElementById('title').value = '';
        document.getElementById('url').value = '';
        document.getElementById('batchId').value = 'batch1';
        document.getElementById('date').value = '';
        document.getElementById('time').value = '';
        editingId = null;
      }
      document.getElementById('title').focus();
    }

    function hideForm() {
      document.getElementById('formView').style.display = 'none';
      document.getElementById('listView').style.display = 'block';
      editingId = null;
    }

    document.addEventListener('click', async function(e) {
      if (e.target.id === 'addBtn') { showForm(); }
      else if (e.target.id === 'cancelBtn') { hideForm(); }
      else if (e.target.classList.contains('btn-edit')) {
        const item = queue.find(function(c) { return c.id === e.target.dataset.id; });
        if (item) showForm(item);
      }
      else if (e.target.classList.contains('btn-delete')) {
        if (confirm('Delete this release?')) {
          queue = queue.filter(function(c) { return c.id !== e.target.dataset.id; });
          if (await saveQueue()) { render(); }
        }
      }
    });

    document.getElementById('releaseForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const title = document.getElementById('title').value.trim();
      const url = document.getElementById('url').value.trim();
      const batchId = document.getElementById('batchId').value.trim() || 'batch1';
      const date = document.getElementById('date').value;
      const time = document.getElementById('time').value;

      if (!title || !url || !date || !time) {
        alert('Please fill all fields');
        return;
      }

      const releaseTime = new Date(date + 'T' + time + ':00').toISOString();
      const newItem = { id: editingId || Date.now().toString(), title: title, url: url, batchId: batchId, releaseTime: releaseTime };

      if (editingId) {
        const idx = queue.findIndex(function(c) { return c.id === editingId; });
        if (idx > -1) queue[idx] = newItem;
      } else {
        queue.push(newItem);
      }

      if (await saveQueue()) {
        hideForm();
        render();
        alert('Release saved!');
      } else {
        alert('Failed to save!');
      }
    });

    (async function init() {
      await fetchQueue();
      render();
    })();
  <\/script>
</body>
</html>`;

async function getQueue(env) {
  try {
    const data = await env.COUNTDOWN_KV.get(CONFIG.KV_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

async function saveQueue(env, data) {
  await env.COUNTDOWN_KV.put(CONFIG.KV_KEY, JSON.stringify(data));
}

async function getBatchState(env) {
  try {
    const data = await env.COUNTDOWN_KV.get(CONFIG.BATCH_KEY);
    return data ? JSON.parse(data) : { active: false };
  } catch (e) {
    return { active: false };
  }
}

async function saveBatchState(env, state) {
  await env.COUNTDOWN_KV.put(CONFIG.BATCH_KEY, JSON.stringify(state));
}

async function clearBatchState(env) {
  await env.COUNTDOWN_KV.delete(CONFIG.BATCH_KEY);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API: Get queue
    if (path === '/api/queue' && request.method === 'GET') {
      const queue = await getQueue(env);
      return new Response(JSON.stringify(queue), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // API: Save queue
    if (path === '/api/queue' && request.method === 'POST') {
      try {
        const data = await request.json();
        await saveQueue(env, data);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid' }), { status: 400 });
      }
    }

    // API: Start batch timer for a specific item
    if (path === '/api/start-batch' && request.method === 'POST') {
      try {
        const { itemId } = await request.json();
        let queue = await getQueue(env);
        const batchState = await getBatchState(env);
        const now = new Date();

        // Only start batch if not already active
        if (!batchState.active) {
          const item = queue.find(function(c) { return c.id === itemId; });
          if (item) {
            const newBatchState = {
              active: true,
              itemId: item.id,
              itemBatchId: item.batchId,
              title: item.title,
              url: item.url,
              startTime: now.toISOString(),
              serverTime: now.toISOString()
            };
            await saveBatchState(env, newBatchState);
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid' }), { status: 400 });
      }
    }

    // API: Delete specific item
    if (path === '/api/delete' && request.method === 'POST') {
      try {
        const { id } = await request.json();
        let queue = await getQueue(env);
        
        // Filter out the item to delete
        queue = queue.filter(function(c) { 
          return c.id !== id && c.batchId !== id; 
        });
        
        await saveQueue(env, queue);
        
        // If deleting the currently active batch item, clear batch state
        const batchState = await getBatchState(env);
        if (batchState.active && (batchState.itemId === id || batchState.itemBatchId === id)) {
          await clearBatchState(env);
        }
        
        return new Response(JSON.stringify({ success: true, deleted: id }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid' }), { status: 400 });
      }
    }

    // Admin page
    if (path === '/admin') {
      return new Response(HTML_ADMIN, { headers: { 'Content-Type': 'text/html' } });
    }

    // Main countdown page
    let queue = await getQueue(env);
    let batchState = await getBatchState(env);
    const now = new Date();
    const serverTime = now.toISOString();

    // Clean up expired batches and find all expired items
    if (batchState.active) {
      const batchAge = now - new Date(batchState.startTime);
      if (batchAge >= CONFIG.BATCH_DURATION) {
        // Batch expired - delete the item
        queue = queue.filter(function(c) {
          return c.id !== batchState.itemId;
        });
        await saveQueue(env, queue);
        await clearBatchState(env);
        batchState = { active: false };
      }
    }

    // Check if any release is ready to start a new batch (even if one is active)
    // This allows qua2 to start its batch while qua1 is still running
    const sorted = queue.sort(function(a, b) {
      return new Date(a.releaseTime) - new Date(b.releaseTime);
    });

    const ready = sorted.filter(function(c) {
      return new Date(c.releaseTime) <= now;
    });

    // Start batch for first ready item if no active batch, OR start batch for next ready item
    if (!batchState.active && ready.length > 0) {
      // No active batch - start one for the first ready item
      const next = ready[0];
      batchState = {
        active: true,
        itemId: next.id,
        itemBatchId: next.batchId,
        title: next.title,
        url: next.url,
        startTime: now.toISOString(),
        serverTime: serverTime
      };
      await saveBatchState(env, batchState);
    } else if (batchState.active && ready.length > 1) {
      // Active batch exists, check if we need to start the next batch
      const currentBatchId = batchState.itemId;
      const currentBatchAge = now - new Date(batchState.startTime);

      // If current batch is more than half way through, start preparing next batch
      if (currentBatchAge >= CONFIG.BATCH_DURATION / 2) {
        // Find next ready item (not the current active one)
        const nextReady = ready.filter(function(c) {
          return c.id !== currentBatchId;
        });

        if (nextReady.length > 0) {
          const next = nextReady[0];
          // Save next batch info to localStorage so client can show it
          // The client will display the countdown for this item
          const nextBatchInfo = {
            itemId: next.id,
            itemBatchId: next.batchId,
            title: next.title,
            url: next.url,
            startTime: now.toISOString(),
            serverTime: serverTime,
            nextReady: true
          };
          // Store this as a "pending" state that client will use
          await saveBatchState(env, {
            active: true,
            current: batchState,
            next: nextBatchInfo
          });
        }
      }
    }

    // Re-fetch batch state after potential updates
    batchState = await getBatchState(env);

    // Prepare batch state for client (only if active)
    let clientBatchState = { active: false };
    if (batchState.active) {
      if (batchState.current && batchState.next) {
        // Multiple batches - send current batch info
        clientBatchState = {
          active: true,
          itemId: batchState.current.itemId,
          title: batchState.current.title,
          url: batchState.current.url,
          startTime: batchState.current.startTime,
          serverTime: serverTime,
          nextItem: {
            itemId: batchState.next.itemId,
            title: batchState.next.title,
            url: batchState.next.url,
            releaseTime: batchState.next.releaseTime
          }
        };
      } else if (batchState.itemId) {
        // Single batch format (backwards compatible)
        clientBatchState = {
          active: true,
          itemId: batchState.itemId,
          title: batchState.title,
          url: batchState.url,
          startTime: batchState.startTime,
          serverTime: serverTime
        };
      }
    }

    // Show countdown page
    const html = HTML_COUNTDOWN
      .replace('__QUEUE_DATA__', JSON.stringify(queue))
      .replace('__BATCH_STATE__', JSON.stringify(clientBatchState))
      .replace('__BATCH_DURATION__', CONFIG.BATCH_DURATION.toString());
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }
};
