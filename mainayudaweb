/**
 * CLOUDFLARE WORKER - Queue Countdown with Individual Bars
 * Features: Each qua has its own bar, auto-reload on batch expire, enter only after reload
 */

const CONFIG = {
  MUSIC_URL: 'https://www.image2url.com/r2/default/audio/1779180686090-f0abfcd4-4931-4935-ae98-bb08bb1ab461.mp3',
  TIMEZONE: 'Asia/Manila',
  KV_KEY: 'release_queue',
  BATCH_KEY: 'batch_state',
  READY_KEY: 'ready_batch',
  VIEWER_KEY: 'viewer_sessions',
  ANNOUNCE_KEY: 'global_announce',
  BATCH_DURATION: 600000
};

const HTML_COUNTDOWN = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Release Queue</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;min-height:100vh;background:#0f0f1a;color:#fff;overflow-x:hidden}
    .color-bg{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;transition:background .8s}
    .blur-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;transition:filter .5s,opacity .5s;filter:blur(20px)}
    .blur-overlay.unlocked{filter:blur(0);opacity:1}
    .top-controls{position:fixed;top:1.5rem;left:50%;transform:translateX(-50%);z-index:15;display:flex;gap:.75rem;flex-wrap:wrap;justify-content:center}
    .top-btn{display:inline-flex;align-items:center;justify-content:center;padding:.6rem 1.5rem;font-family:'Orbitron',monospace;font-size:.75rem;font-weight:600;letter-spacing:.1em;color:#fff;background:linear-gradient(135deg,rgba(255,105,180,.3),rgba(139,92,246,.3));border:1px solid rgba(255,255,255,0.2);border-radius:25px;cursor:pointer;backdrop-filter:blur(10px);transition:all .3s}
    .top-btn:hover{background:linear-gradient(135deg,rgba(255,105,180,.5),rgba(139,92,246,.5));transform:translateY(-2px);box-shadow:0 5px 20px rgba(255,105,180,.3)}
    .container{text-align:center;margin-bottom:3rem;position:relative;z-index:2}
    .title{font-family:'Orbitron',monospace;font-size:clamp(1.2rem,4vw,2rem);font-weight:700;letter-spacing:.3em;margin-bottom:2rem;color:#FF69B4;text-shadow:0 0 30px #FF69B4}
    .bars-container{display:flex;flex-wrap:wrap;justify-content:center;gap:1.5rem;max-width:1200px;margin:0 auto}
    .bar-card{background:linear-gradient(135deg,rgba(255,105,180,.15),rgba(139,92,246,.15));border:2px solid rgba(255,105,180,.4);border-radius:16px;padding:1.5rem;min-width:280px;max-width:350px;flex:1;position:relative;overflow:hidden;transition:all .3s}
    .bar-card.active{border-color:#22c55e;box-shadow:0 0 30px rgba(34,197,94,.3)}
    .bar-card.waiting{border-color:#fbbf24;box-shadow:0 0 20px rgba(251,191,36,.2)}
    .bar-card.expired{border-color:#ef4444;box-shadow:0 0 20px rgba(239,68,68,.2)}
    .bar-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
    .bar-badge{font-family:'Orbitron',monospace;font-size:.7rem;font-weight:700;padding:.3rem .6rem;border-radius:20px;background:rgba(255,105,180,.3);color:#FF69B4}
    .bar-card.active .bar-badge{background:rgba(34,197,94,.3);color:#22c55e}
    .bar-card.waiting .bar-badge{background:rgba(251,191,36,.3);color:#fbbf24}
    .bar-card.expired .bar-badge{background:rgba(239,68,68,.3);color:#ef4444}
    .bar-title{font-family:'Orbitron',monospace;font-size:1rem;font-weight:600;color:#fff;margin-bottom:.5rem;word-break:break-word}
    .bar-subtitle{font-size:.75rem;color:#a0a0b0;margin-bottom:1rem}
    .bar-progress-container{background:rgba(255,255,255,.1);border-radius:10px;height:12px;overflow:hidden;margin-bottom:.75rem}
    .bar-progress{height:100%;background:linear-gradient(90deg,#FF69B4,#8B5CF6);border-radius:10px;transition:width .5s ease;width:0%}
    .bar-card.active .bar-progress{background:linear-gradient(90deg,#22c55e,#34d399)}
    .bar-card.waiting .bar-progress{background:linear-gradient(90deg,#fbbf24,#fcd34d)}
    .bar-card.expired .bar-progress{background:linear-gradient(90deg,#ef4444,#f87171);width:100%!important}
    .bar-timer{font-family:'Orbitron',monospace;font-size:2rem;font-weight:900;color:#fff;text-shadow:0 0 20px currentColor;margin-bottom:.25rem}
    .bar-card.active .bar-timer{color:#22c55e;text-shadow:0 0 30px #22c55e}
    .bar-card.waiting .bar-timer{color:#fbbf24;text-shadow:0 0 30px #fbbf24}
    .bar-card.expired .bar-timer{color:#ef4444;text-shadow:0 0 30px #ef4444}
    .bar-timer.warning{color:#fbbf24}
    .bar-timer.urgent{color:#ef4444;animation:blink 0.5s infinite}
    .bar-label{font-size:.7rem;color:#a0a0b0;letter-spacing:.15em}
    .bar-status{font-size:.8rem;color:#a0a0b0;margin-top:.75rem;min-height:1.2rem}
    .bar-card.active .bar-status{color:#22c55e}
    .bar-card.expired .bar-status{color:#ef4444}
    .no-qua-screen{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:100;flex-direction:column;align-items:center;justify-content:center;gap:2.5rem}
    .no-qua-screen.show{display:flex}
    .no-qua-text{font-family:'Orbitron',monospace;font-size:clamp(1.5rem,5vw,3rem);font-weight:700;text-align:center;animation:glow 2s ease-in-out infinite alternate}
    .play-music-btn{display:flex;align-items:center;justify-content:center;gap:.75rem;padding:1rem 2.5rem;font-family:'Orbitron',monospace;font-size:.9rem;font-weight:700;letter-spacing:.15em;color:#fff;background:transparent;border:2px solid #FF69B4;border-radius:50px;cursor:pointer;position:relative;overflow:hidden;transition:all .3s;animation:musicGlow 2s ease-in-out infinite alternate}
    .play-music-btn:hover{transform:scale(1.07)}
    .play-music-btn.playing{border-color:#8B5CF6;animation:musicGlowPlaying 1.5s ease-in-out infinite alternate}
    .play-music-btn .music-icon{width:22px;height:22px;flex-shrink:0}
    @keyframes musicGlow{0%{box-shadow:0 0 10px #FF69B4,0 0 25px #FF69B4,0 0 50px rgba(255,105,180,.4);color:#FF69B4;border-color:#FF69B4}100%{box-shadow:0 0 15px #8B5CF6,0 0 35px #8B5CF6,0 0 70px rgba(139,92,246,.5);color:#8B5CF6;border-color:#8B5CF6}}
    @keyframes musicGlowPlaying{0%{box-shadow:0 0 15px #8B5CF6,0 0 40px #8B5CF6,0 0 80px rgba(139,92,246,.6);color:#8B5CF6;border-color:#8B5CF6}100%{box-shadow:0 0 20px #FF69B4,0 0 50px #FF69B4,0 0 100px rgba(255,105,180,.7);color:#FF69B4;border-color:#FF69B4}}
    .music-bars{display:flex;align-items:flex-end;gap:3px;height:18px}
    .music-bars span{display:block;width:4px;background:currentColor;border-radius:2px;animation:none}
    .playing .music-bars span:nth-child(1){animation:bar1 .6s ease-in-out infinite alternate}
    .playing .music-bars span:nth-child(2){animation:bar2 .5s ease-in-out infinite alternate}
    .playing .music-bars span:nth-child(3){animation:bar3 .7s ease-in-out infinite alternate}
    .playing .music-bars span:nth-child(4){animation:bar4 .4s ease-in-out infinite alternate}
    @keyframes bar1{0%{height:4px}100%{height:16px}}
    @keyframes bar2{0%{height:10px}100%{height:6px}}
    @keyframes bar3{0%{height:6px}100%{height:14px}}
    @keyframes bar4{0%{height:14px}100%{height:4px}}
    @keyframes glow{0%{text-shadow:0 0 10px #FF69B4,0 0 20px #FF69B4,0 0 30px #FF69B4;color:#FF69B4}100%{text-shadow:0 0 20px #8B5CF6,0 0 40px #8B5CF6,0 0 60px #8B5CF6;color:#8B5CF6}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.5}}
    @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
    .enter-btn{position:fixed;bottom:15%;left:50%;transform:translateX(-50%);z-index:10;display:flex;align-items:center;justify-content:center;gap:.75rem;padding:1rem 3rem;font-family:'Orbitron',monospace;font-size:1.2rem;font-weight:700;letter-spacing:.15em;color:#fff;background:linear-gradient(135deg,#22c55e,#34d399);border:none;border-radius:50px;cursor:pointer;transition:all .3s;box-shadow:0 10px 40px rgba(34,197,94,.4);display:none}
    .enter-btn.show{display:flex;animation:bounce 1s infinite}
    .enter-btn:hover{transform:translateX(-50%) scale(1.05)}
    .enter-btn.animating{animation:jumpUp 1s ease-in-out forwards}
    .btn-icon{width:24px;height:24px}
    @keyframes jumpUp{0%{transform:translateX(-50%) translateY(0) scale(1);opacity:1}50%{transform:translateX(-50%) translateY(-150px) scale(.9);opacity:.8}100%{transform:translateX(-50%) translateY(-300px) scale(.8);opacity:0}}
    #bg-music{display:none}
    .queue-info{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);z-index:10;font-size:.8rem;color:#a0a0b0;letter-spacing:.1em;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;justify-content:center}
    .queue-count{color:#FF69B4;font-weight:700}
    .viewer-count{display:inline-flex;align-items:center;gap:.4rem;color:#a0a0b0;font-size:.8rem}
    .viewer-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px #22c55e;animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.3)}}
    .viewer-num{color:#22c55e;font-weight:700}
    /* Announcement banner */
    .announce-banner{display:none;position:fixed;top:0;left:0;width:100%;z-index:200;padding:1rem 1.5rem;text-align:center;font-family:'Orbitron',monospace;font-size:clamp(.75rem,3vw,1rem);font-weight:700;letter-spacing:.1em;color:#fff;background:linear-gradient(90deg,rgba(255,105,180,.9),rgba(139,92,246,.9),rgba(255,105,180,.9));background-size:200% 100%;animation:announceBg 3s linear infinite;box-shadow:0 4px 30px rgba(255,105,180,.5);backdrop-filter:blur(10px);opacity:0;transition:opacity .6s ease}
    .announce-banner.visible{opacity:1}
    .announce-banner.hiding{opacity:0}
    @keyframes announceBg{0%{background-position:0% 50%}100%{background-position:200% 50%}}
    .announce-close{position:absolute;right:1rem;top:50%;transform:translateY(-50%);background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;opacity:.8;padding:.25rem .5rem}
    .announce-close:hover{opacity:1}
    .bar-enter-btn{display:block;width:100%;margin-top:1rem;padding:.75rem;font-family:'Orbitron',monospace;font-size:.85rem;font-weight:700;letter-spacing:.1em;color:#fff;background:linear-gradient(135deg,#22c55e,#34d399);border:none;border-radius:12px;cursor:pointer;transition:all .3s;box-shadow:0 4px 20px rgba(34,197,94,.4);animation:bounce 1s infinite;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .bar-enter-btn:hover{transform:scale(1.03);box-shadow:0 6px 30px rgba(34,197,94,.6)}
    .top-btn{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .play-music-btn{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    @media(max-width:768px){.bars-container{flex-direction:column;align-items:center}.bar-card{max-width:100%;width:100%}.bar-timer{font-size:1.6rem}.announce-banner{font-size:.75rem;padding:.75rem 2.5rem .75rem 1rem}}
  </style>
</head>
<body>
  <div class="announce-banner" id="announceBanner"><span id="announceMsg"></span><button class="announce-close" id="announceClose">&#10005;</button></div>
  <div class="color-bg" id="colorBg"></div>
  <div class="no-qua-screen" id="noQuaScreen">
    <div class="no-qua-text">wala pang ayuda:> <br> balik ka nalang mamaya</div>
    <button class="play-music-btn" id="playMusicBtn" onclick="toggleNoQuaMusic()">
      <svg class="music-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <span id="playMusicLabel">PLAY MUSIC</span>
      <div class="music-bars"><span style="height:4px"></span><span style="height:10px"></span><span style="height:6px"></span><span style="height:14px"></span></div>
    </button>
  </div>
  <audio id="noqoa-music" loop><source src="https://www.image2url.com/r2/default/audio/1779277842191-3cb6ce82-06b5-44e4-83ae-defc1ca76ff9.mp3" type="audio/mpeg"></audio>
  <div class="top-controls" id="topControls">
    <button class="top-btn" id="refreshBtn">REFRESH</button>
    <button class="top-btn" id="soundBtn">SOUND</button>
  </div>
  <div class="blur-overlay" id="blurOverlay">
    <div class="container">
      <h1 class="title">RELEASE QUEUE</h1>
      <div class="bars-container" id="barsContainer"></div>
    </div>
  </div>
  <button class="enter-btn" id="enterBtn"><span>ENTER NOW</span><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
  <div class="queue-info"><span class="queue-count" id="queueCount">0</span> releases in queue &nbsp;|&nbsp; <span class="viewer-count"><span class="viewer-dot"></span><span class="viewer-num" id="viewerCount">1</span> viewing</span></div>
  <audio id="bg-music" loop><source src="" type="audio/mpeg"></audio>
  <script>
    var noQuaAudio = document.getElementById('noqoa-music');
    var noQuaPlaying = false;
    function toggleNoQuaMusic(){
      var btn = document.getElementById('playMusicBtn');
      var lbl = document.getElementById('playMusicLabel');
      if(!noQuaPlaying){
        noQuaAudio.play().then(function(){
          noQuaPlaying = true;
          btn.classList.add('playing');
          lbl.textContent = 'PAUSE MUSIC';
        }).catch(function(){});
      } else {
        noQuaAudio.pause();
        noQuaPlaying = false;
        btn.classList.remove('playing');
        lbl.textContent = 'PLAY MUSIC';
      }
    }
    var COLORS = ['#FF69B4', '#8B5CF6', '#3B82F6'];
    var colorIdx = 0;
    var isUnlocked = false;
    var QUEUE_DATA = [];
    var BATCH_STATE = {active:false};
    var READY_BATCH = {ready:false};
    var BATCH_DURATION = 600000;
    var music = document.getElementById('bg-music');
    var enterBtn = document.getElementById('enterBtn');
    var blurOverlay = document.getElementById('blurOverlay');
    var colorBg = document.getElementById('colorBg');
    var barsContainer = document.getElementById('barsContainer');
    var noQuaScreen = document.getElementById('noQuaScreen');
    var topControls = document.getElementById('topControls');
    var refreshBtn = document.getElementById('refreshBtn');
    var soundBtn = document.getElementById('soundBtn');
    var queueCountEl = document.getElementById('queueCount');
    function pad(n){return n.toString().padStart(2,'0')}
    function formatTime(ms){
      var totalSecs = Math.max(0,Math.floor(ms/1000));
      var mins = Math.floor(totalSecs/60);
      var secs = totalSecs%60;
      return pad(mins)+':'+pad(secs);
    }
    function getProgress(elapsed,duration){return Math.min(100,Math.max(0,(elapsed/duration)*100))}
    function updateBg(){
      var c = COLORS[colorIdx];
      colorBg.style.background = 'radial-gradient(ellipse at center, '+c+'40 0%, #0f0f1a 70%)';
      colorBg.style.boxShadow = 'inset 0 0 150px '+c+'60';
      document.body.style.color = c;
      colorIdx = (colorIdx+1)%COLORS.length;
    }
    updateBg();
    setInterval(updateBg,1000);
    soundBtn.addEventListener('click',function(){
      music.play().catch(function(){});
    });
    refreshBtn.addEventListener('click',function(){location.reload();});
    function getBarStatus(item,batchState){
      if(!item) return 'expired';
      var now = new Date();
      var releaseTime = new Date(item.releaseTime);
      var diff = releaseTime - now;
      if(batchState && batchState.active && batchState.itemId === item.id){
        var batchStart = new Date(batchState.startTime);
        var batchElapsed = now - batchStart;
        if(batchElapsed >= BATCH_DURATION){return 'expired'}
        return 'active';
      }
      if(diff <= 0){return 'active'}
      return 'waiting';
    }
    function createBarCard(item,index,batchState){
      var status = getBarStatus(item,batchState);
      var now = new Date();
      var releaseTime = new Date(item.releaseTime);
      var diff = releaseTime - now;
      var timerText = '00:00';
      var progress = 0;
      var timerClass = '';
      var statusText = '';
      var badgeText = 'QUEUED';
      if(batchState && batchState.active && batchState.itemId === item.id){
        var batchStart = new Date(batchState.startTime);
        var batchElapsed = now - batchStart;
        var remaining = Math.max(0,BATCH_DURATION - batchElapsed);
        timerText = formatTime(remaining);
        progress = getProgress(batchElapsed,BATCH_DURATION);
        if(remaining <= 60000 && remaining > 30000){timerClass = 'warning'}
        else if(remaining <= 30000){timerClass = 'urgent'}
        statusText = remaining <= 0 ? 'EXPIRED' : 'LIVE - HURRY!';
        badgeText = 'LIVE';
      } else if(diff <= 0){
        var liveElapsed = now - releaseTime;
        var liveRemaining = Math.max(0, BATCH_DURATION - liveElapsed);
        timerText = formatTime(liveRemaining);
        progress = getProgress(liveElapsed, BATCH_DURATION);
        if(liveRemaining <= 60000 && liveRemaining > 30000){timerClass = 'warning'}
        else if(liveRemaining <= 30000){timerClass = 'urgent'}
        statusText = liveRemaining <= 0 ? 'EXPIRED' : 'LIVE - HURRY!';
        badgeText = 'LIVE';
      } else {
        timerText = formatTime(diff);
        statusText = index === 0 ? 'NEXT UP' : 'COUNTDOWN';
      }
      var html = '<div class="bar-card '+status+'" data-id="'+item.id+'">';
      html += '<div class="bar-header"><span class="bar-badge">'+badgeText+'</span></div>';
      html += '<div class="bar-title">'+(item.title||'Untitled')+'</div>';
      html += '<div class="bar-subtitle">Qua '+(index+1)+'</div>';
      html += '<div class="bar-progress-container"><div class="bar-progress" style="width:'+progress+'%"></div></div>';
      html += '<div class="bar-timer '+timerClass+'">'+timerText+'</div>';
      html += '<div class="bar-label">'+(status === 'active' ? 'TIME LEFT' : 'RELEASE IN')+'</div>';
      html += '<div class="bar-status">'+statusText+'</div>';
      if(status === 'active'){
        html += '<button class="bar-enter-btn" data-url="'+(item.url||'')+'">ENTER NOW &#8594;</button>';
      }
      html += '</div>';
      return html;
    }
    function renderBars(){
      if(!QUEUE_DATA || QUEUE_DATA.length === 0){
        barsContainer.innerHTML = '';
        return;
      }
      var sorted = QUEUE_DATA.slice().sort(function(a,b){return new Date(a.releaseTime)-new Date(b.releaseTime)});
      var html = '';
      sorted.forEach(function(item,index){html += createBarCard(item,index,BATCH_STATE)});
      barsContainer.innerHTML = html;
    }
    function checkReadyBatch(){
      if(BATCH_STATE && BATCH_STATE.active){enterBtn.classList.add('show');return true}
      if(READY_BATCH && READY_BATCH.ready){enterBtn.classList.add('show');return true}
      var now = new Date();
      var anyLive = QUEUE_DATA && QUEUE_DATA.some(function(i){return new Date(i.releaseTime)<=now});
      if(anyLive){enterBtn.classList.add('show');return true}
      return false;
    }
    var reloadScheduled = false;
    function safeReload(expiredId){
      if(reloadScheduled) return;
      reloadScheduled = true;
      function doReload(){
        setTimeout(function(){location.reload()},1000);
      }
      // Delete the expired item from KV first so it won't come back after reload
      if(expiredId){
        fetch('/api/delete',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id:expiredId}),
          keepalive:true
        }).then(function(){doReload()}).catch(function(){doReload()});
      } else {
        doReload();
      }
    }
    function updateTimers(){
      var now = new Date();
      var cards = document.querySelectorAll('.bar-card');
      cards.forEach(function(card){
        var itemId = card.dataset.id;
        var item = QUEUE_DATA ? QUEUE_DATA.find(function(i){return i.id === itemId}) : null;
        if(!item) return;
        var timerEl = card.querySelector('.bar-timer');
        var progressEl = card.querySelector('.bar-progress');
        var statusEl = card.querySelector('.bar-status');
        if(BATCH_STATE && BATCH_STATE.active && BATCH_STATE.itemId === item.id){
          var batchStart = new Date(BATCH_STATE.startTime);
          var batchElapsed = now - batchStart;
          var remaining = Math.max(0,BATCH_DURATION - batchElapsed);
          var progress = getProgress(batchElapsed,BATCH_DURATION);
          timerEl.textContent = formatTime(remaining);
          progressEl.style.width = progress+'%';
          timerEl.classList.remove('warning','urgent');
          if(remaining <= 60000 && remaining > 30000){timerEl.classList.add('warning')}
          else if(remaining <= 30000){timerEl.classList.add('urgent')}
          if(remaining <= 0){
            statusEl.textContent = 'EXPIRED';
            card.classList.remove('active');
            card.classList.add('expired');
            var eb = card.querySelector('.bar-enter-btn');
            if(eb) eb.style.display='none';
            safeReload(item.id);
          } else {statusEl.textContent = 'LIVE - HURRY!'}
        } else {
          var releaseTime = new Date(item.releaseTime);
          var diff = releaseTime - now;
          if(diff <= 0){
            var liveElapsed = now - releaseTime;
            var liveRemaining = Math.max(0, BATCH_DURATION - liveElapsed);
            var liveProgress = getProgress(liveElapsed, BATCH_DURATION);
            // If already expired beyond batch window — show expired, no reload loop
            if(liveElapsed >= BATCH_DURATION){
              timerEl.textContent = '00:00';
              progressEl.style.width = '100%';
              timerEl.classList.remove('warning','urgent');
              card.classList.remove('active','waiting');
              card.classList.add('expired');
              var badgeEl2 = card.querySelector('.bar-badge');
              if(badgeEl2) badgeEl2.textContent = 'EXPIRED';
              statusEl.textContent = 'EXPIRED';
              var enterBtnInCard2 = card.querySelector('.bar-enter-btn');
              if(enterBtnInCard2) enterBtnInCard2.style.display='none';
              return;
            }
            timerEl.textContent = formatTime(liveRemaining);
            progressEl.style.width = liveProgress+'%';
            timerEl.classList.remove('warning','urgent');
            if(liveRemaining <= 60000 && liveRemaining > 30000){timerEl.classList.add('warning')}
            else if(liveRemaining <= 30000){timerEl.classList.add('urgent')}
            card.classList.remove('waiting');
            card.classList.add('active');
            var badgeEl = card.querySelector('.bar-badge');
            if(badgeEl) badgeEl.textContent = 'LIVE';
            if(!card.querySelector('.bar-enter-btn')){
              var barBtn = document.createElement('button');
              barBtn.className = 'bar-enter-btn';
              barBtn.dataset.url = item.url || '';
              barBtn.innerHTML = 'ENTER NOW &#8594;';
              card.appendChild(barBtn);
            }
            enterBtn.classList.add('show');
            if(liveRemaining <= 0){
              statusEl.textContent = 'EXPIRED';
              card.classList.remove('active');
              card.classList.add('expired');
              var enterBtnInCard = card.querySelector('.bar-enter-btn');
              if(enterBtnInCard) enterBtnInCard.style.display = 'none';
              safeReload(item.id);
            } else {
              statusEl.textContent = 'LIVE - HURRY!';
            }
          } else {
            timerEl.textContent = formatTime(diff);
            progressEl.style.width = '0%';
          }
        }
      });
    }
    enterBtn.addEventListener('click',function(){
      if(!isUnlocked){
        isUnlocked = true;
        blurOverlay.classList.add('unlocked');
        music.play().catch(function(){});
        enterBtn.classList.remove('show');
      }
    });
    barsContainer.addEventListener('click',function(e){
      var btn = e.target.closest('.bar-enter-btn');
      if(btn){
        var url = btn.dataset.url;
        if(url){ btn.innerHTML = 'ENTERING...'; setTimeout(function(){window.location.href = url},400); }
      }
    });
    blurOverlay.addEventListener('click',function(){
      if(!isUnlocked){
        isUnlocked = true;
        blurOverlay.classList.add('unlocked');
        music.play().catch(function(){});
      }
    });
    document.addEventListener('keydown',function(e){
      if(e.key === 'Enter' && !isUnlocked){
        isUnlocked = true;
        blurOverlay.classList.add('unlocked');
        music.play().catch(function(){});
      }
    });
    renderBars();
    checkReadyBatch();
    // Use requestAnimationFrame-based tick instead of setInterval for better mobile perf
    var lastTick = 0;
    function tick(ts){
      if(ts - lastTick >= 1000){
        lastTick = ts;
        updateTimers();
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    if(QUEUE_DATA && QUEUE_DATA.length > 0){queueCountEl.textContent = QUEUE_DATA.length}
    if(!QUEUE_DATA || QUEUE_DATA.length === 0){
      noQuaScreen.classList.add('show');
      blurOverlay.style.display = 'none';
      topControls.style.display = 'none';
      enterBtn.style.display = 'none';
    }
    // ── Viewer count ──
    var viewerCountEl = document.getElementById('viewerCount');
    function pingViewer(){
      fetch('/api/viewers/ping',{method:'POST',keepalive:true}).then(function(r){
        return r.ok ? r.json() : null;
      }).then(function(d){
        if(d && d.count) viewerCountEl.textContent = d.count;
      }).catch(function(){});
    }
    pingViewer();
    setInterval(pingViewer,15000);
    window.addEventListener('beforeunload',function(){
      fetch('/api/viewers/leave',{method:'POST',keepalive:true}).catch(function(){});
    });
    // ── Announcement banner ──
    var announceBanner = document.getElementById('announceBanner');
    var announceMsg = document.getElementById('announceMsg');
    var announceClose = document.getElementById('announceClose');
    var lastAnnounceId = null;
    var announceHideTimer = null;
    function beep(){
      try{
        var ctx = new (window.AudioContext||window.webkitAudioContext)();
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine'; o.frequency.setValueAtTime(880,ctx.currentTime);
        g.gain.setValueAtTime(0,ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.4,ctx.currentTime+0.05);
        g.gain.linearRampToValueAtTime(0,ctx.currentTime+0.6);
        o.start(ctx.currentTime); o.stop(ctx.currentTime+0.65);
      }catch(e){}
    }
    function showAnnouncement(text,id){
      if(lastAnnounceId === id) return;
      lastAnnounceId = id;
      if(announceHideTimer) clearTimeout(announceHideTimer);
      announceMsg.textContent = text;
      announceBanner.style.display = 'block';
      requestAnimationFrame(function(){
        announceBanner.classList.remove('hiding');
        announceBanner.classList.add('visible');
      });
      beep();
      // Shift content down so banner doesn't cover top controls
      topControls.style.marginTop = '3.5rem';
      announceHideTimer = setTimeout(function(){
        hideAnnouncement();
      },12000);
    }
    function hideAnnouncement(){
      announceBanner.classList.add('hiding');
      announceBanner.classList.remove('visible');
      topControls.style.marginTop = '';
      setTimeout(function(){announceBanner.style.display='none'},650);
    }
    announceClose.addEventListener('click',function(){hideAnnouncement()});
    function pollAnnouncement(){
      fetch('/api/announce').then(function(r){return r.ok?r.json():null}).then(function(d){
        if(d && d.active && d.message){showAnnouncement(d.message,d.id)}
        else if(!d || !d.active){lastAnnounceId=null}
      }).catch(function(){});
    }
    pollAnnouncement();
    setInterval(pollAnnouncement,10000);
  </script>
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
    .nav{text-align:center;margin-bottom:2rem;display:flex;gap:1rem;justify-content:center}
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
    .empty{text-align:center;padding:3rem;color:#a0a0b0}
    .add-btn{background:linear-gradient(135deg,#FF69B4,#8B5CF6);color:#fff;border:none;padding:1rem 2rem;border-radius:50px;font-family:'Orbitron',monospace;font-weight:700;cursor:pointer;transition:all .3s}
    .add-btn:hover{transform:scale(1.05)}
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
      <div class="card" style="margin-top:1.5rem">
        <div class="card-header">
          <h2>&#128226; Global Announcement</h2>
          <span id="viewerBadge" class="badge active">0 viewers</span>
        </div>
        <div class="form">
          <div class="form-group">
            <label>Message (shown to all users with a beep)</label>
            <input type="text" id="announceInput" placeholder="e.g. Server will restart in 5 minutes" maxlength="200">
          </div>
          <div style="display:flex;gap:.75rem;flex-wrap:wrap">
            <button class="btn btn-primary" id="sendAnnounce">SEND ANNOUNCEMENT</button>
            <button class="btn btn-secondary" id="clearAnnounce">CLEAR</button>
          </div>
          <div id="announceStatus" style="font-size:.8rem;color:#a0a0b0;min-height:1.2rem"></div>
        </div>
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
          <label>Redirect URL</label>
          <input type="url" id="url" placeholder="https://youtube.com/watch?v=..." required>
        </div>
        <div class="form-group">
          <label>Qua ID (e.g., qua1, qua2)</label>
          <input type="text" id="batchId" placeholder="qua1" value="qua1">
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
    var TZ = 'Asia/Manila';
    var queue = [];
    var editingId = null;
    function formatDate(iso){
      if(!iso) return 'Not set';
      return new Date(iso).toLocaleString('en-US',{timeZone:TZ,dateStyle:'medium',timeStyle:'short'});
    }
    function getStatus(releaseTime){return new Date(releaseTime) <= new Date() ? 'released' : 'active'}
    function sortByDate(items){return items.sort(function(a,b){return new Date(a.releaseTime)-new Date(b.releaseTime)})}
    async function fetchQueue(){
      try{var res = await fetch('/api/queue');if(res.ok) queue = await res.json()}
      catch(e){console.error(e)}
    }
    async function saveQueue(){
      var res = await fetch('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(queue)});
      return res.ok;
    }
    function render(){
      var list = document.getElementById('queueList');
      var status = document.getElementById('queueStatus');
      var sorted = sortByDate([].concat(queue));
      var active = sorted.filter(function(c){return getStatus(c.releaseTime)==='active'});
      var released = sorted.filter(function(c){return getStatus(c.releaseTime)==='released'});
      if(queue.length === 0){
        list.innerHTML = '<div class="empty"><p>No releases in queue. Add your first one!</p><button class="add-btn" id="addBtn">+ ADD RELEASE</button></div>';
        status.textContent = '0 releases';
        status.className = 'badge draft';
        return;
      }
      var html = '';
      active.forEach(function(c,i){
        var pos = i === 0 ? 'NOW PLAYING' : '#'+(i+1)+' IN QUEUE';
        html += '<div class="queue-item'+(i===0?' playing':'')+'"><div class="queue-info"><div class="queue-title">'+c.title+'</div><div class="queue-position">'+pos+'</div><div>'+formatDate(c.releaseTime)+'</div></div><span class="badge active">active</span><div class="queue-actions"><button class="btn-icon btn-edit" data-id="'+c.id+'">&#9998;</button><button class="btn-icon btn-delete" data-id="'+c.id+'">&times;</button></div></div>';
      });
      released.forEach(function(c){
        html += '<div class="queue-item" style="opacity:0.5"><div class="queue-info"><div class="queue-title">'+c.title+'</div><div class="queue-position">COMPLETED</div><div>'+formatDate(c.releaseTime)+'</div></div><span class="badge released">released</span><div class="queue-actions"><button class="btn-icon btn-delete" data-id="'+c.id+'">&times;</button></div></div>';
      });
      html += '<button class="add-btn" id="addBtn" style="margin-top:1rem">+ ADD ANOTHER RELEASE</button>';
      list.innerHTML = html;
      status.textContent = active.length+' active, '+released.length+' released';
      status.className = 'badge '+(active.length>0?'active':'released');
    }
    function showForm(item){
      document.getElementById('listView').style.display = 'none';
      document.getElementById('formView').style.display = 'block';
      if(item){
        document.getElementById('formTitle').textContent = 'Edit Release';
        document.getElementById('title').value = item.title||'';
        document.getElementById('url').value = item.url||'';
        document.getElementById('batchId').value = item.batchId||'qua1';
        if(item.releaseTime){
          var d = new Date(item.releaseTime);
          var local = d.toLocaleString('en-CA',{timeZone:TZ});
          var parts = local.split(' ');
          document.getElementById('date').value = parts[0];
          document.getElementById('time').value = parts[1].slice(0,5);
        }
        editingId = item.id;
      } else {
        document.getElementById('formTitle').textContent = 'Add New Release';
        document.getElementById('title').value = '';
        document.getElementById('url').value = '';
        document.getElementById('batchId').value = 'qua1';
        document.getElementById('date').value = '';
        document.getElementById('time').value = '';
        editingId = null;
      }
      document.getElementById('title').focus();
    }
    function hideForm(){
      document.getElementById('formView').style.display = 'none';
      document.getElementById('listView').style.display = 'block';
      editingId = null;
    }
    document.addEventListener('click',async function(e){
      if(e.target.id==='addBtn') showForm();
      else if(e.target.id==='cancelBtn') hideForm();
      else if(e.target.classList.contains('btn-edit')){
        var item = queue.find(function(c){return c.id===e.target.dataset.id});
        if(item) showForm(item);
      }
      else if(e.target.classList.contains('btn-delete')){
        if(confirm('Delete this release?')){
          queue = queue.filter(function(c){return c.id!==e.target.dataset.id});
          if(await saveQueue()) render();
        }
      }
    });
    document.getElementById('releaseForm').addEventListener('submit',async function(e){
      e.preventDefault();
      var title = document.getElementById('title').value.trim();
      var url = document.getElementById('url').value.trim();
      var batchId = document.getElementById('batchId').value.trim()||'qua1';
      var date = document.getElementById('date').value;
      var time = document.getElementById('time').value;
      if(!title||!url||!date||!time){alert('Please fill all fields');return}
      var releaseTime = new Date(date+'T'+time+':00').toISOString();
      var newItem = {id:editingId||Date.now().toString(),title:title,url:url,batchId:batchId,releaseTime:releaseTime};
      if(editingId){
        var idx = queue.findIndex(function(c){return c.id===editingId});
        if(idx>-1) queue[idx] = newItem;
      } else {queue.push(newItem)}
      if(await saveQueue()){hideForm();render();alert('Release saved!')}
      else{alert('Failed to save!')}
    });
    (async function init(){await fetchQueue();render()})();
    // ── Admin: viewer count ──
    async function refreshViewers(){
      try{
        var r = await fetch('/api/viewers/count');
        if(r.ok){var d = await r.json(); document.getElementById('viewerBadge').textContent=d.count+' viewer'+(d.count!==1?'s':'');}
      }catch(e){}
    }
    refreshViewers();
    setInterval(refreshViewers,15000);
    // ── Admin: announcement ──
    document.getElementById('sendAnnounce').addEventListener('click',async function(){
      var msg = document.getElementById('announceInput').value.trim();
      if(!msg){alert('Enter a message first');return;}
      var st = document.getElementById('announceStatus');
      st.textContent='Sending...';
      try{
        var r = await fetch('/api/announce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:true,message:msg})});
        st.textContent = r.ok ? 'Announcement sent! Users will see it within 10s.' : 'Failed to send.';
        st.style.color = r.ok ? '#22c55e' : '#ef4444';
      }catch(e){st.textContent='Error: '+e.message;st.style.color='#ef4444';}
    });
    document.getElementById('clearAnnounce').addEventListener('click',async function(){
      document.getElementById('announceInput').value='';
      var st = document.getElementById('announceStatus');
      try{
        var r = await fetch('/api/announce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:false,message:''})});
        st.textContent = r.ok ? 'Announcement cleared.' : 'Failed.';
        st.style.color = r.ok ? '#a0a0b0' : '#ef4444';
      }catch(e){}
    });
  </script>
</body>
</html>`;

async function getViewerSessions(env){
  try{
    var data = await env.COUNTDOWN_KV.get(CONFIG.VIEWER_KEY);
    return data ? JSON.parse(data) : {};
  }catch(e){return {}}
}

async function getAnnounce(env){
  try{
    var data = await env.COUNTDOWN_KV.get(CONFIG.ANNOUNCE_KEY);
    return data ? JSON.parse(data) : {active:false,message:'',id:'0'};
  }catch(e){return {active:false,message:'',id:'0'}}
}

async function getQueue(env){
  try{
    var data = await env.COUNTDOWN_KV.get(CONFIG.KV_KEY);
    return data ? JSON.parse(data) : [];
  } catch(e){return []}
}

async function saveQueue(env,data){
  await env.COUNTDOWN_KV.put(CONFIG.KV_KEY,JSON.stringify(data));
}

async function getBatchState(env){
  try{
    var data = await env.COUNTDOWN_KV.get(CONFIG.BATCH_KEY);
    return data ? JSON.parse(data) : {active:false};
  } catch(e){return {active:false}}
}

async function saveBatchState(env,state){
  await env.COUNTDOWN_KV.put(CONFIG.BATCH_KEY,JSON.stringify(state));
}

async function clearBatchState(env){
  await env.COUNTDOWN_KV.delete(CONFIG.BATCH_KEY);
}

async function getReadyBatch(env){
  try{
    var data = await env.COUNTDOWN_KV.get(CONFIG.READY_KEY);
    return data ? JSON.parse(data) : {ready:false};
  } catch(e){return {ready:false}}
}

async function saveReadyBatch(env,state){
  await env.COUNTDOWN_KV.put(CONFIG.READY_KEY,JSON.stringify(state));
}

async function clearReadyBatch(env){
  await env.COUNTDOWN_KV.delete(CONFIG.READY_KEY);
}

export default {
  async fetch(request,env,ctx){
    var url = new URL(request.url);
    var path = url.pathname;

    if(path === '/api/queue' && request.method === 'GET'){
      var queue = await getQueue(env);
      return new Response(JSON.stringify(queue),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    }

    if(path === '/api/queue' && request.method === 'POST'){
      try{
        var data = await request.json();
        await saveQueue(env,data);
        return new Response(JSON.stringify({success:true}),{headers:{'Content-Type':'application/json'}});
      } catch(e){
        return new Response(JSON.stringify({error:'Invalid'}),{status:400});
      }
    }

    // Viewer ping
    if(path === '/api/viewers/ping' && request.method === 'POST'){
      var sessionId = request.headers.get('Cookie')||'';
      var match = sessionId.match(/vsid=([a-z0-9]+)/);
      var vsid = match ? match[1] : Math.random().toString(36).slice(2);
      var sessions = await getViewerSessions(env);
      var now2 = Date.now();
      sessions[vsid] = now2;
      // Prune stale sessions (>45s no ping)
      Object.keys(sessions).forEach(function(k){if(now2-sessions[k]>45000)delete sessions[k]});
      await env.COUNTDOWN_KV.put(CONFIG.VIEWER_KEY,JSON.stringify(sessions),{expirationTtl:120});
      var count = Object.keys(sessions).length;
      var headers = {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Set-Cookie':'vsid='+vsid+'; Path=/; SameSite=Lax; Max-Age=3600'};
      return new Response(JSON.stringify({count:count}),{headers:headers});
    }
    // Viewer leave
    if(path === '/api/viewers/leave' && request.method === 'POST'){
      var sessionId2 = request.headers.get('Cookie')||'';
      var match2 = sessionId2.match(/vsid=([a-z0-9]+)/);
      if(match2){
        var sessions2 = await getViewerSessions(env);
        delete sessions2[match2[1]];
        await env.COUNTDOWN_KV.put(CONFIG.VIEWER_KEY,JSON.stringify(sessions2),{expirationTtl:120});
      }
      return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json'}});
    }
    // Viewer count (admin)
    if(path === '/api/viewers/count' && request.method === 'GET'){
      var sessions3 = await getViewerSessions(env);
      var now3 = Date.now();
      Object.keys(sessions3).forEach(function(k){if(now3-sessions3[k]>45000)delete sessions3[k]});
      return new Response(JSON.stringify({count:Object.keys(sessions3).length}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    }
    // Announcement GET
    if(path === '/api/announce' && request.method === 'GET'){
      var ann = await getAnnounce(env);
      return new Response(JSON.stringify(ann),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    }
    // Announcement POST (admin)
    if(path === '/api/announce' && request.method === 'POST'){
      try{
        var annData = await request.json();
        var newAnn = {active:!!annData.active,message:annData.message||'',id:Date.now().toString()};
        await env.COUNTDOWN_KV.put(CONFIG.ANNOUNCE_KEY,JSON.stringify(newAnn));
        return new Response(JSON.stringify({success:true}),{headers:{'Content-Type':'application/json'}});
      }catch(e){return new Response(JSON.stringify({error:'Invalid'}),{status:400,headers:{'Content-Type':'application/json'}})}
    }
    if(path === '/api/delete' && request.method === 'POST'){
      try{
        var body = await request.json();
        var id = body.id;
        var queue = await getQueue(env);
        queue = queue.filter(function(c){return c.id !== id && c.batchId !== id});
        await saveQueue(env,queue);
        var batchState = await getBatchState(env);
        if(batchState.active && (batchState.itemId === id || batchState.itemBatchId === id)){
          await clearBatchState(env);
        }
        var readyBatch = await getReadyBatch(env);
        if(readyBatch.ready && readyBatch.itemId === id){
          await clearReadyBatch(env);
        }
        return new Response(JSON.stringify({success:true,deleted:id}),{headers:{'Content-Type':'application/json'}});
      } catch(e){
        return new Response(JSON.stringify({error:'Invalid'}),{status:400});
      }
    }

    if(path === '/admin'){
      return new Response(HTML_ADMIN,{headers:{'Content-Type':'text/html'}});
    }

    var queue = await getQueue(env);
    var batchState = await getBatchState(env);
    var readyBatch = await getReadyBatch(env);
    var now = new Date();
    var serverTime = now.toISOString();

    if(readyBatch.ready && readyBatch.expiresAt){
      if(new Date() >= new Date(readyBatch.expiresAt)){
        await clearReadyBatch(env);
        readyBatch = {ready:false};
      }
    }

    if(batchState.active){
      var batchStart = new Date(batchState.startTime);
      var batchAge = now - batchStart;
      if(batchAge >= CONFIG.BATCH_DURATION){
        queue = queue.filter(function(c){return c.id !== batchState.itemId});
        await saveQueue(env,queue);
        var readyBatchInfo = {
          ready:true,
          itemId:batchState.itemId,
          title:batchState.title,
          url:batchState.url,
          expiredAt:now.toISOString(),
          expiresAt:new Date(now.getTime()+300000).toISOString()
        };
        await saveReadyBatch(env,readyBatchInfo);
        readyBatch = readyBatchInfo;
        await clearBatchState(env);
        batchState = {active:false};
      }
    }

    var sorted = queue.sort(function(a,b){return new Date(a.releaseTime)-new Date(b.releaseTime)});

    // Auto-cleanup: delete any item that is fully past releaseTime + BATCH_DURATION
    // and is NOT the currently active batch item. Prevents reload loops.
    var activeId = batchState.active ? batchState.itemId : null;
    var nowMs = now.getTime();
    var cleanQueue = sorted.filter(function(c){
      if(activeId && c.id === activeId) return true; // keep the active one
      var expiry = new Date(c.releaseTime).getTime() + CONFIG.BATCH_DURATION;
      return expiry > nowMs;
    });
    if(cleanQueue.length !== sorted.length){
      await saveQueue(env, cleanQueue);
      sorted = cleanQueue;
    }

    var ready = sorted.filter(function(c){return new Date(c.releaseTime) <= now});

    if(!batchState.active && ready.length > 0){
      var next = ready[0];
      batchState = {
        active:true,
        itemId:next.id,
        itemBatchId:next.batchId,
        title:next.title,
        url:next.url,
        startTime:now.toISOString(),
        serverTime:serverTime
      };
      await saveBatchState(env,batchState);
    }

    var clientBatchState = {active:false};
    if(batchState.active){
      clientBatchState = {
        active:true,
        itemId:batchState.itemId,
        title:batchState.title,
        url:batchState.url,
        startTime:batchState.startTime,
        serverTime:serverTime
      };
    }

    var clientReadyBatch = {ready:false};
    if(readyBatch.ready){
      clientReadyBatch = {ready:true,url:readyBatch.url};
    }

    var html = HTML_COUNTDOWN
      .replace('var QUEUE_DATA = []','var QUEUE_DATA = '+JSON.stringify(queue))
      .replace('var BATCH_STATE = {active:false}','var BATCH_STATE = '+JSON.stringify(clientBatchState))
      .replace('var READY_BATCH = {ready:false}','var READY_BATCH = '+JSON.stringify(clientReadyBatch))
      .replace('var BATCH_DURATION = 600000','var BATCH_DURATION = '+CONFIG.BATCH_DURATION)
      .replace('src=""','src="'+CONFIG.MUSIC_URL+'"');
    return new Response(html,{headers:{'Content-Type':'text/html'}});
  }
};
