// ============================================================
//  AYUDA QUEUE — Cloudflare Worker
//  KV bindings needed: AYUDA_KV
//  wrangler.toml:
//    [[kv_namespaces]]
//    binding = "AYUDA_KV"
//    id      = "<your-kv-id>"
// ============================================================

const BATCH_DURATION = 10000; // 10 minutes in ms
const MUSIC_URL =
  "https://mp3tourl.com/audio/1779373516167-dfd3f082-673a-402f-8926-d3b580f009f0.m4a";

// ── KV helpers ───────────────────────────────────────────────
async function kvGet(env, key, fallback = null) {
  try {
    const raw = await env.AYUDA_KV.get(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
async function kvSet(env, key, value, opts = {}) {
  await env.AYUDA_KV.put(key, JSON.stringify(value), opts);
}
async function kvDel(env, key) {
  await env.AYUDA_KV.delete(key);
}

// ── Expiry fix: server-side expired-ID registry ──────────────
async function addExpiredId(env, id) {
  const list = await kvGet(env, "expiredIds", []);
  if (!list.includes(id)) {
    list.push(id);
    // Keep only last 50 to avoid unbounded growth
    await kvSet(env, "expiredIds", list.slice(-50));
  }
}
async function isExpiredId(env, id) {
  const list = await kvGet(env, "expiredIds", []);
  return list.includes(id);
}

// ── Batch helpers ─────────────────────────────────────────────
async function getBatch(env) {
  return kvGet(env, "batchState", { active: false });
}
async function setBatch(env, state) {
  await kvSet(env, "batchState", state);
}
async function clearBatch(env) {
  await kvSet(env, "batchState", { active: false });
}

// ── Viewer helpers ────────────────────────────────────────────
const VIEWER_TTL = 45; // seconds

async function pingViewer(env, vsid) {
  await kvSet(env, `viewer:${vsid}`, Date.now(), { expirationTtl: VIEWER_TTL });
}
async function removeViewer(env, vsid) {
  await kvDel(env, `viewer:${vsid}`);
}
async function countViewers(env) {
  const list = await env.AYUDA_KV.list({ prefix: "viewer:" });
  return list.keys.length;
}

// ── Queue helpers ─────────────────────────────────────────────
async function getQueue(env) {
  return kvGet(env, "queue", []);
}
async function setQueue(env, q) {
  await kvSet(env, "queue", q);
}

// ── Build the countdown page ──────────────────────────────────
async function buildPage(env, request) {
  let queue = await getQueue(env);
  let batch = await getBatch(env);
  const now = Date.now();

  // Filter out any items whose IDs are in the expired registry
  const expiredIds = await kvGet(env, "expiredIds", []);
  queue = queue.filter(item => !expiredIds.includes(item.id));

  // Auto-promote: if no active batch, check if any item is past its release time
  if (!batch.active) {
    const sorted = queue.slice().sort((a, b) =>
      new Date(a.releaseTime).getTime() - new Date(b.releaseTime).getTime()
    );
    for (const item of sorted) {
      const rt = new Date(item.releaseTime).getTime();
      if (rt <= now && !(await isExpiredId(env, item.id))) {
        batch = {
          active:      true,
          itemId:      item.id,
          itemBatchId: item.batchId ?? "",
          title:       item.title,
          url:         item.url ?? "",
          startTimeMs: now,
          startTime:   new Date(now).toISOString(),
          serverTime:  new Date(now).toISOString(),
        };
        await setBatch(env, batch);
        break;
      }
    }
  }

  // ── EXPIRATION CHECK — runs once, sets expiredId, clears batch ──
  if (batch.active) {
    const startMs = batch.startTimeMs ?? new Date(batch.startTime ?? 0).getTime();
    const elapsed = now - startMs;
    if (elapsed >= BATCH_DURATION) {
      const expiredId  = batch.itemId;
      const expiredUrl = batch.url ?? "";
      // 1) Register in expired list so it's never re-promoted
      await addExpiredId(env, expiredId);
      // 2) Remove from queue
      const newQueue = queue.filter(i => i.id !== expiredId);
      await setQueue(env, newQueue);
      queue = newQueue;
      // 3) Clear the active batch
      await clearBatch(env);
      batch = { active: false };
      // 4) Mark ready (so clients can get the link)
      await kvSet(env, "readyBatch", { ready: true, url: expiredUrl, itemId: expiredId });
    }
  }

  const readyBatch = await kvGet(env, "readyBatch", { ready: false });
  const announce   = await kvGet(env, "announce",   { active: false, message: "", id: "0" });
  const viewerCount = await countViewers(env);

  const clientBatch = batch.active
    ? { active: true, itemId: batch.itemId, title: batch.title,
        url: batch.url, startTimeMs: batch.startTimeMs,
        startTime: batch.startTime, serverTime: batch.serverTime }
    : { active: false };
  const clientReady = readyBatch.ready
    ? { ready: true, url: readyBatch.url ?? "" }
    : { ready: false };

  const html = countdownHTML()
    .replace(/QUEUE_DATA_PH/g,     JSON.stringify(queue))
    .replace(/BATCH_STATE_PH/g,    JSON.stringify(clientBatch))
    .replace(/READY_BATCH_PH/g,    JSON.stringify(clientReady))
    .replace(/BATCH_DURATION_PH/g, String(BATCH_DURATION))
    .replace(/VIEWER_COUNT_PH/g,   String(viewerCount))
    .replace(/MUSIC_URL_PH/g,      MUSIC_URL);

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── Router ────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method.toUpperCase();

    // ── GET / ─────────────────────────────────────────────────
    if (path === "/" && method === "GET") {
      return buildPage(env, request);
    }

    // ── GET /admin ────────────────────────────────────────────
    if (path === "/admin" && method === "GET") {
      return new Response(adminHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ── GET /api/queue ────────────────────────────────────────
    if (path === "/api/queue" && method === "GET") {
      const q = await getQueue(env);
      return json(q);
    }

    // ── POST /api/queue ───────────────────────────────────────
    if (path === "/api/queue" && method === "POST") {
      const body = await request.json();
      if (!Array.isArray(body)) return json({ error: "Expected array" }, 400);
      await setQueue(env, body);
      return json({ success: true });
    }

    // ── POST /api/delete ──────────────────────────────────────
    if (path === "/api/delete" && method === "POST") {
      const { id } = await request.json();
      let q = await getQueue(env);
      q = q.filter(i => i.id !== id && i.batchId !== id);
      await setQueue(env, q);
      const batch = await getBatch(env);
      if (batch.active && batch.itemId === id) await clearBatch(env);
      const rb = await kvGet(env, "readyBatch", { ready: false });
      if (rb.itemId === id) await kvDel(env, "readyBatch");
      // Also register as expired so it won't be re-promoted
      await addExpiredId(env, id);
      return json({ success: true, deleted: id });
    }

    // ── POST /api/viewers/ping ────────────────────────────────
    if (path === "/api/viewers/ping" && method === "POST") {
      const cookies = parseCookies(request.headers.get("Cookie") ?? "");
      const vsid    = cookies["vsid"] ?? crypto.randomUUID().slice(0, 12);
      await pingViewer(env, vsid);
      const count = await countViewers(env);
      const res   = json({ count });
      res.headers.set("Set-Cookie",
        `vsid=${vsid}; Path=/; Max-Age=3600; SameSite=Lax`);
      return res;
    }

    // ── POST /api/viewers/leave ───────────────────────────────
    if (path === "/api/viewers/leave" && method === "POST") {
      const cookies = parseCookies(request.headers.get("Cookie") ?? "");
      const vsid    = cookies["vsid"] ?? "";
      if (vsid) await removeViewer(env, vsid);
      return json({ ok: true });
    }

    // ── GET /api/viewers/count ────────────────────────────────
    if (path === "/api/viewers/count" && method === "GET") {
      const count = await countViewers(env);
      return json({ count });
    }

    // ── GET /api/announce ─────────────────────────────────────
    if (path === "/api/announce" && method === "GET") {
      const ann = await kvGet(env, "announce", { active: false, message: "", id: "0" });
      return json(ann);
    }

    // ── POST /api/announce ────────────────────────────────────
    if (path === "/api/announce" && method === "POST") {
      const body = await request.json();
      await kvSet(env, "announce", {
        active:  Boolean(body.active),
        message: String(body.message ?? ""),
        id:      String(Date.now()),
      });
      return json({ success: true });
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ── Helpers ───────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
function parseCookies(str) {
  return Object.fromEntries(
    str.split(";").map(c => c.trim().split("=").map(decodeURIComponent))
  );
}

// ╔══════════════════════════════════════════════════════════╗
// ║               COUNTDOWN PAGE HTML                        ║
// ╚══════════════════════════════════════════════════════════╝
function countdownHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Release Queue</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;min-height:100vh;background:#0f0f1a;color:#fff;overflow-x:hidden}

    /* ── FIRE ─────────────────────────────────────────── */
    #fireCanvas{position:fixed;bottom:0;left:0;width:100%;height:260px;z-index:6;pointer-events:none}

    /* ── SPOTLIGHTS ───────────────────────────────────── */
    .spotlights{position:fixed;top:0;left:0;width:100%;height:100%;z-index:3;pointer-events:none;overflow:hidden}
    .beam{position:absolute;top:-60px;width:70px;height:110vh;transform-origin:top center;will-change:transform,opacity}
    .beam::after{content:'';position:absolute;top:0;left:0;width:100%;height:100%;
      clip-path:polygon(35% 0%,65% 0%,100% 100%,0% 100%);filter:blur(10px)}
    .beam-1{left:11%;animation:sw1 4.2s ease-in-out infinite}
    .beam-1::after{background:linear-gradient(to bottom,rgba(255,105,180,.9) 0%,rgba(255,105,180,.2) 55%,transparent 100%)}
    .beam-2{left:34%;animation:sw2 5.5s ease-in-out infinite .9s}
    .beam-2::after{background:linear-gradient(to bottom,rgba(255,255,255,.9) 0%,rgba(200,160,255,.3) 55%,transparent 100%)}
    .beam-3{left:61%;animation:sw3 3.8s ease-in-out infinite .4s}
    .beam-3::after{background:linear-gradient(to bottom,rgba(139,92,246,.95) 0%,rgba(139,92,246,.25) 55%,transparent 100%)}
    .beam-4{left:83%;animation:sw4 4.8s ease-in-out infinite 1.5s}
    .beam-4::after{background:linear-gradient(to bottom,rgba(59,180,255,.9) 0%,rgba(59,130,246,.2) 55%,transparent 100%)}
    @keyframes sw1{0%,100%{transform:rotate(-22deg);opacity:.6}50%{transform:rotate(14deg);opacity:.85}}
    @keyframes sw2{0%,100%{transform:rotate(18deg);opacity:.5}50%{transform:rotate(-20deg);opacity:.9}}
    @keyframes sw3{0%,100%{transform:rotate(-15deg);opacity:.7}50%{transform:rotate(22deg);opacity:1}}
    @keyframes sw4{0%,100%{transform:rotate(12deg);opacity:.55}50%{transform:rotate(-18deg);opacity:.8}}

    /* ── STAGE GLOW ───────────────────────────────────── */
    .stage-glow{position:fixed;bottom:0;left:0;width:100%;height:200px;
      background:linear-gradient(to top,rgba(255,80,0,.35) 0%,rgba(255,120,0,.1) 40%,transparent 100%);
      z-index:5;pointer-events:none}

    /* ── LAYOUT ───────────────────────────────────────── */
    .color-bg{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;transition:background .8s}
    .blur-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:10;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:2rem;padding-bottom:280px;transition:filter .5s}
    .blur-overlay:not(.unlocked){filter:blur(20px)}
    .blur-overlay.unlocked{filter:blur(0)}
    .top-controls{position:fixed;top:1.5rem;left:50%;transform:translateX(-50%);
      z-index:20;display:flex;gap:.75rem;flex-wrap:wrap;justify-content:center}
    .top-btn{display:inline-flex;align-items:center;justify-content:center;
      padding:.6rem 1.5rem;font-family:'Orbitron',monospace;font-size:.75rem;font-weight:600;
      letter-spacing:.1em;color:#fff;background:linear-gradient(135deg,rgba(255,105,180,.3),rgba(139,92,246,.3));
      border:1px solid rgba(255,255,255,.2);border-radius:25px;cursor:pointer;
      backdrop-filter:blur(10px);transition:all .3s;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .top-btn:hover{background:linear-gradient(135deg,rgba(255,105,180,.5),rgba(139,92,246,.5));transform:translateY(-2px)}
    .container{text-align:center;margin-bottom:3rem;position:relative;z-index:2}
    .title{font-family:'Orbitron',monospace;font-size:clamp(1.2rem,4vw,2rem);font-weight:700;
      letter-spacing:.3em;margin-bottom:2rem;color:#FF69B4;text-shadow:0 0 30px #FF69B4}
    .bars-container{display:flex;flex-wrap:wrap;justify-content:center;gap:1.5rem;max-width:1200px;margin:0 auto}

    /* ── CARDS ────────────────────────────────────────── */
    .bar-card{background:linear-gradient(135deg,rgba(255,105,180,.15),rgba(139,92,246,.15));
      border:2px solid rgba(255,105,180,.4);border-radius:16px;padding:1.5rem;
      min-width:280px;max-width:350px;flex:1;transition:all .3s}
    .bar-card.active{border-color:#22c55e;box-shadow:0 0 30px rgba(34,197,94,.3)}
    .bar-card.waiting{border-color:#fbbf24;box-shadow:0 0 20px rgba(251,191,36,.2)}
    .bar-card.expired{border-color:#ef4444;box-shadow:0 0 20px rgba(239,68,68,.2)}
    .bar-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
    .bar-badge{font-family:'Orbitron',monospace;font-size:.7rem;font-weight:700;
      padding:.3rem .6rem;border-radius:20px;background:rgba(255,105,180,.3);color:#FF69B4}
    .bar-card.active .bar-badge{background:rgba(34,197,94,.3);color:#22c55e}
    .bar-card.waiting .bar-badge{background:rgba(251,191,36,.3);color:#fbbf24}
    .bar-card.expired .bar-badge{background:rgba(239,68,68,.3);color:#ef4444}
    .bar-title{font-family:'Orbitron',monospace;font-size:1rem;font-weight:600;
      color:#fff;margin-bottom:.5rem;word-break:break-word}
    .bar-subtitle{font-size:.75rem;color:#a0a0b0;margin-bottom:1rem}
    .bar-progress-container{background:rgba(255,255,255,.1);border-radius:10px;height:12px;overflow:hidden;margin-bottom:.75rem}
    .bar-progress{height:100%;background:linear-gradient(90deg,#FF69B4,#8B5CF6);
      border-radius:10px;transition:width .5s ease;width:0%}
    .bar-card.active .bar-progress{background:linear-gradient(90deg,#22c55e,#34d399)}
    .bar-card.waiting .bar-progress{background:linear-gradient(90deg,#fbbf24,#fcd34d)}
    .bar-card.expired .bar-progress{background:linear-gradient(90deg,#ef4444,#f87171);width:100%!important}
    .bar-timer{font-family:'Orbitron',monospace;font-size:2rem;font-weight:900;
      color:#fff;text-shadow:0 0 20px currentColor;margin-bottom:.25rem}
    .bar-card.active .bar-timer{color:#22c55e;text-shadow:0 0 30px #22c55e}
    .bar-card.waiting .bar-timer{color:#fbbf24;text-shadow:0 0 30px #fbbf24}
    .bar-card.expired .bar-timer{color:#ef4444;text-shadow:0 0 30px #ef4444}
    .bar-timer.warning{color:#fbbf24}
    .bar-timer.urgent{color:#ef4444;animation:blink .5s infinite}
    .bar-label{font-size:.7rem;color:#a0a0b0;letter-spacing:.15em}
    .bar-status{font-size:.8rem;color:#a0a0b0;margin-top:.75rem;min-height:1.2rem}
    .bar-card.active .bar-status{color:#22c55e}
    .bar-card.expired .bar-status{color:#ef4444}

    /* ── NO QUEUE SCREEN ──────────────────────────────── */
    .no-qua-screen{display:none;position:fixed;top:0;left:0;width:100%;height:100%;
      background:#000;z-index:100;flex-direction:column;align-items:center;justify-content:center;gap:2.5rem}
    .no-qua-screen.show{display:flex}
    .no-qua-text{font-family:'Orbitron',monospace;font-size:clamp(1.3rem,5vw,2.5rem);
      font-weight:700;text-align:center;padding:0 1.5rem;animation:glow 2s ease-in-out infinite alternate}
    .play-music-btn{display:flex;align-items:center;justify-content:center;gap:.75rem;
      padding:1rem 2.5rem;font-family:'Orbitron',monospace;font-size:.9rem;font-weight:700;
      letter-spacing:.15em;color:#fff;background:transparent;border:2px solid #FF69B4;
      border-radius:50px;cursor:pointer;animation:musicGlow 2s ease-in-out infinite alternate;
      -webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .play-music-btn.playing{animation:musicGlowPlaying 1.5s ease-in-out infinite alternate}
    .music-bars{display:flex;align-items:flex-end;gap:3px;height:18px}
    .music-bars span{display:block;width:4px;background:currentColor;border-radius:2px}
    .playing .music-bars span:nth-child(1){animation:bar1 .6s ease-in-out infinite alternate}
    .playing .music-bars span:nth-child(2){animation:bar2 .5s ease-in-out infinite alternate}
    .playing .music-bars span:nth-child(3){animation:bar3 .7s ease-in-out infinite alternate}
    .playing .music-bars span:nth-child(4){animation:bar4 .4s ease-in-out infinite alternate}
    @keyframes bar1{0%{height:4px}100%{height:16px}}
    @keyframes bar2{0%{height:10px}100%{height:6px}}
    @keyframes bar3{0%{height:6px}100%{height:14px}}
    @keyframes bar4{0%{height:14px}100%{height:4px}}
    @keyframes musicGlow{0%{box-shadow:0 0 10px #FF69B4,0 0 25px #FF69B4;color:#FF69B4;border-color:#FF69B4}
      100%{box-shadow:0 0 15px #8B5CF6,0 0 35px #8B5CF6;color:#8B5CF6;border-color:#8B5CF6}}
    @keyframes musicGlowPlaying{0%{box-shadow:0 0 15px #8B5CF6,0 0 40px #8B5CF6;color:#8B5CF6;border-color:#8B5CF6}
      100%{box-shadow:0 0 20px #FF69B4,0 0 50px #FF69B4;color:#FF69B4;border-color:#FF69B4}}
    @keyframes glow{0%{text-shadow:0 0 10px #FF69B4,0 0 20px #FF69B4;color:#FF69B4}
      100%{text-shadow:0 0 20px #8B5CF6,0 0 40px #8B5CF6;color:#8B5CF6}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.5}}
    @keyframes bounce{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-6px)}}
    @keyframes bounceCard{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}

    /* ── ENTER BTN ────────────────────────────────────── */
    .enter-btn{position:fixed;bottom:22%;left:50%;transform:translateX(-50%);z-index:15;
      display:none;align-items:center;justify-content:center;gap:.75rem;padding:1rem 3rem;
      font-family:'Orbitron',monospace;font-size:1.2rem;font-weight:700;letter-spacing:.15em;
      color:#fff;background:linear-gradient(135deg,#22c55e,#34d399);border:none;
      border-radius:50px;cursor:pointer;box-shadow:0 10px 40px rgba(34,197,94,.4);
      -webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .enter-btn.show{display:flex;animation:bounce 1s infinite}

    /* ── MISC ─────────────────────────────────────────── */
    .queue-info{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);z-index:15;
      font-size:.8rem;color:#a0a0b0;letter-spacing:.1em;display:flex;align-items:center;
      gap:1rem;flex-wrap:wrap;justify-content:center}
    .queue-count{color:#FF69B4;font-weight:700}
    .viewer-count{display:inline-flex;align-items:center;gap:.4rem}
    .viewer-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;
      box-shadow:0 0 6px #22c55e;animation:pulse 2s ease-in-out infinite}
    .viewer-num{color:#22c55e;font-weight:700}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.3)}}
    .announce-banner{display:none;position:fixed;top:0;left:0;width:100%;z-index:200;
      padding:1rem 1.5rem;text-align:center;font-family:'Orbitron',monospace;
      font-size:clamp(.75rem,3vw,1rem);font-weight:700;letter-spacing:.1em;color:#fff;
      background:linear-gradient(90deg,rgba(255,105,180,.9),rgba(139,92,246,.9),rgba(255,105,180,.9));
      background-size:200% 100%;animation:annBg 3s linear infinite;
      box-shadow:0 4px 30px rgba(255,105,180,.5);opacity:0;transition:opacity .6s ease}
    .announce-banner.visible{opacity:1}
    .announce-banner.hiding{opacity:0}
    @keyframes annBg{0%{background-position:0% 50%}100%{background-position:200% 50%}}
    .announce-close{position:absolute;right:1rem;top:50%;transform:translateY(-50%);
      background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;opacity:.8;padding:.25rem .5rem}
    .bar-enter-btn{display:block;width:100%;margin-top:1rem;padding:.75rem;
      font-family:'Orbitron',monospace;font-size:.85rem;font-weight:700;letter-spacing:.1em;
      color:#fff;background:linear-gradient(135deg,#22c55e,#34d399);border:none;
      border-radius:12px;cursor:pointer;box-shadow:0 4px 20px rgba(34,197,94,.4);
      animation:bounceCard 1s infinite;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    @media(max-width:768px){.bars-container{flex-direction:column;align-items:center}
      .bar-card{max-width:100%;width:100%}.bar-timer{font-size:1.6rem}}
  </style>
</head>
<body>

  <!-- Event spotlights -->
  <div class="spotlights">
    <div class="beam beam-1"></div>
    <div class="beam beam-2"></div>
    <div class="beam beam-3"></div>
    <div class="beam beam-4"></div>
  </div>

  <!-- Realistic fire -->
  <canvas id="fireCanvas"></canvas>

  <!-- Stage floor glow -->
  <div class="stage-glow"></div>

  <!-- Announcement -->
  <div class="announce-banner" id="annBanner">
    <span id="annMsg"></span>
    <button class="announce-close" id="annClose">&#10005;</button>
  </div>

  <div class="color-bg" id="colorBg"></div>

  <!-- No queue screen -->
  <div class="no-qua-screen" id="noQuaScreen">
    <div class="no-qua-text">wala pang ayuda:><br>balik ka nalang mamaya</div>
    <button class="play-music-btn" id="playMusicBtn" onclick="toggleNoQuaMusic()">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
      <span id="playMusicLabel">PLAY MUSIC</span>
      <div class="music-bars">
        <span style="height:4px"></span><span style="height:10px"></span>
        <span style="height:6px"></span><span style="height:14px"></span>
      </div>
    </button>
  </div>

  <!-- Top controls -->
  <div class="top-controls" id="topControls">
    <button class="top-btn" onclick="location.reload()">REFRESH</button>
    <button class="top-btn" id="soundBtn">SOUND</button>
  </div>

  <!-- Main blurred overlay -->
  <div class="blur-overlay" id="blurOverlay">
    <div class="container">
      <h1 class="title">RELEASE QUEUE</h1>
      <div class="bars-container" id="barsContainer"></div>
    </div>
  </div>

  <button class="enter-btn" id="enterBtn">
    <span>ENTER NOW</span>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  </button>

  <div class="queue-info">
    <span class="queue-count" id="queueCount">0</span> releases in queue &nbsp;|&nbsp;
    <span class="viewer-count">
      <span class="viewer-dot"></span>
      <span class="viewer-num" id="viewerCount">VIEWER_COUNT_PH</span> viewing
    </span>
  </div>

  <audio id="bg-music" loop>
    <source src="MUSIC_URL_PH" type="audio/mp4">
    <source src="MUSIC_URL_PH" type="audio/mpeg">
  </audio>
  <audio id="noqoa-music" loop>
    <source src="MUSIC_URL_PH" type="audio/mp4">
    <source src="MUSIC_URL_PH" type="audio/mpeg">
  </audio>

<script>
// ── FIRE PARTICLE SYSTEM ─────────────────────────────────────
(function(){
  var canvas = document.getElementById('fireCanvas');
  var ctx    = canvas.getContext('2d');
  var pts    = [];
  var MAX    = 45;
  var W, H   = 260;

  function resize(){ W = canvas.width = window.innerWidth; canvas.height = H; }
  resize();
  window.addEventListener('resize', resize);

  var emitters = [0, .14, .28, .5, .72, .86, 1];
  function rnd(a,b){ return a + Math.random()*(b-a); }

  function spawn(){
    var ex = emitters[Math.floor(Math.random()*emitters.length)];
    return { x:(ex+rnd(-.05,.05))*W, y:H, vx:rnd(-.8,.8), vy:rnd(-3.5,-2),
             sz:rnd(14,28), life:1, dec:rnd(.016,.028) };
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    var add = Math.min(3, MAX-pts.length);
    for(var s=0;s<add;s++) pts.push(spawn());

    for(var i=pts.length-1;i>=0;i--){
      var p=pts[i];
      p.x+=p.vx; p.y+=p.vy; p.vy-=.06;
      p.vx+=rnd(-.25,.25); p.sz*=.974; p.life-=p.dec;
      if(p.life<=0||p.sz<1.5){ pts.splice(i,1); continue; }

      var l=p.life, r,g,b;
      if(l>.65)      { r=255; g=Math.floor((1-l)*130);         b=0; }
      else if(l>.35) { r=255; g=Math.floor(80+(0.65-l)*420);  b=0; }
      else           { r=255; g=210; b=Math.floor((0.35-l)*180); }

      var grd=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.sz);
      grd.addColorStop(0,   'rgba('+r+','+g+','+b+','+(l*.9)+')');
      grd.addColorStop(.5,  'rgba('+r+','+(g>40?g-40:0)+',0,'+(l*.5)+')');
      grd.addColorStop(1,   'rgba(255,30,0,0)');

      ctx.beginPath();
      ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);
      ctx.fillStyle=grd;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ── APP ───────────────────────────────────────────────────────
var noQuaAudio   = document.getElementById('noqoa-music');
var noQuaPlaying = false;

function toggleNoQuaMusic(){
  var btn=document.getElementById('playMusicBtn');
  var lbl=document.getElementById('playMusicLabel');
  if(!noQuaPlaying){
    noQuaAudio.play().then(function(){
      noQuaPlaying=true; btn.classList.add('playing'); lbl.textContent='PAUSE MUSIC';
    }).catch(function(){});
  } else {
    noQuaAudio.pause(); noQuaPlaying=false;
    btn.classList.remove('playing'); lbl.textContent='PLAY MUSIC';
  }
}

var COLORS = ['#FF69B4','#8B5CF6','#3B82F6'];
var colorIdx=0, isUnlocked=false;

var QUEUE_DATA     = QUEUE_DATA_PH;
var BATCH_STATE    = BATCH_STATE_PH;
var READY_BATCH    = READY_BATCH_PH;
var BATCH_DURATION = BATCH_DURATION_PH;

// ── FIX: client-side expired ID set ─────────────────────────
// Prevents the reload loop: once we've triggered a delete for
// an item, we remember its ID in memory so we never fire again.
var clientExpiredIds = new Set();

var music         = document.getElementById('bg-music');
var enterBtn      = document.getElementById('enterBtn');
var blurOverlay   = document.getElementById('blurOverlay');
var colorBg       = document.getElementById('colorBg');
var barsContainer = document.getElementById('barsContainer');
var noQuaScreen   = document.getElementById('noQuaScreen');
var topControls   = document.getElementById('topControls');
var queueCountEl  = document.getElementById('queueCount');

document.getElementById('soundBtn').addEventListener('click',function(){
  music.play().catch(function(){});
});

// Background colour pulse
function updateBg(){
  var c=COLORS[colorIdx];
  colorBg.style.background='radial-gradient(ellipse at center,'+c+'40 0%,#0f0f1a 70%)';
  colorBg.style.boxShadow='inset 0 0 150px '+c+'60';
  colorIdx=(colorIdx+1)%COLORS.length;
}
updateBg(); setInterval(updateBg,1000);

function pad(n){ return String(n).padStart(2,'0'); }
function fmtMs(ms){ var s=Math.max(0,Math.floor(ms/1000)); return pad(Math.floor(s/60))+':'+pad(s%60); }
function pct(e,d){ return Math.min(100,Math.max(0,(e/d)*100)); }

function barStatus(item,bs){
  var now=Date.now(), rt=new Date(item.releaseTime).getTime();
  if(bs&&bs.active&&bs.itemId===item.id){
    var st=bs.startTimeMs||new Date(bs.startTime||0).getTime();
    return (now-st)>=BATCH_DURATION?'expired':'active';
  }
  return rt<=now?'active':'waiting';
}

function makeCard(item,idx,bs){
  var now=Date.now(), rt=new Date(item.releaseTime).getTime();
  var status=barStatus(item,bs), timer='00:00', p=0, tcls='', stxt='', badge='QUEUED';

  if(bs&&bs.active&&bs.itemId===item.id){
    var st=bs.startTimeMs||new Date(bs.startTime||0).getTime();
    var el=now-st, rem=Math.max(0,BATCH_DURATION-el);
    timer=fmtMs(rem); p=pct(el,BATCH_DURATION);
    if(rem<=60000&&rem>30000) tcls='warning';
    else if(rem<=30000) tcls='urgent';
    stxt=rem<=0?'EXPIRED':'LIVE - HURRY!'; badge='LIVE';
  } else if(rt<=now){
    var le=now-rt, lr=Math.max(0,BATCH_DURATION-le);
    timer=fmtMs(lr); p=pct(le,BATCH_DURATION);
    if(lr<=60000&&lr>30000) tcls='warning';
    else if(lr<=30000) tcls='urgent';
    stxt=lr<=0?'EXPIRED':'LIVE - HURRY!'; badge='LIVE';
  } else {
    timer=fmtMs(rt-now); stxt=idx===0?'NEXT UP':'COUNTDOWN';
  }

  var h='<div class="bar-card '+status+'" data-id="'+item.id+'" data-url="'+(item.url||'')+'">';
  h+='<div class="bar-header"><span class="bar-badge">'+badge+'</span></div>';
  h+='<div class="bar-title">'+(item.title||'Untitled')+'</div>';
  h+='<div class="bar-subtitle">Qua '+(idx+1)+'</div>';
  h+='<div class="bar-progress-container"><div class="bar-progress" style="width:'+p+'%"></div></div>';
  h+='<div class="bar-timer '+tcls+'">'+timer+'</div>';
  h+='<div class="bar-label">'+(status==='active'?'TIME LEFT':'RELEASE IN')+'</div>';
  h+='<div class="bar-status">'+stxt+'</div>';
  if(status==='active') h+='<button class="bar-enter-btn" data-url="'+(item.url||'')+'">ENTER NOW &#8594;</button>';
  h+='</div>';
  return h;
}

function renderBars(){
  if(!QUEUE_DATA||!QUEUE_DATA.length){ barsContainer.innerHTML=''; return; }
  var sorted=QUEUE_DATA.slice().sort(function(a,b){
    return new Date(a.releaseTime).getTime()-new Date(b.releaseTime).getTime();
  });
  barsContainer.innerHTML=sorted.map(function(item,i){ return makeCard(item,i,BATCH_STATE); }).join('');
}

// ── EXPIRATION — fixed to fire ONCE per item ─────────────────
var reloadPending=false;
function expireItem(id){
  if(reloadPending) return;
  if(clientExpiredIds.has(id)) return;   // ← already handled
  clientExpiredIds.add(id);
  reloadPending=true;
  fetch('/api/delete',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:id}), keepalive:true
  }).finally(function(){
    setTimeout(function(){ location.reload(); }, 1200);
  });
}

function updateTimers(){
  var now=Date.now();
  var cards=document.querySelectorAll('.bar-card');
  for(var ci=0;ci<cards.length;ci++){
    var card=cards[ci], id=card.dataset.id;
    var item=null;
    for(var qi=0;qi<QUEUE_DATA.length;qi++){ if(QUEUE_DATA[qi].id===id){ item=QUEUE_DATA[qi]; break; } }
    if(!item) continue;

    var timerEl=card.querySelector('.bar-timer');
    var progEl =card.querySelector('.bar-progress');
    var statEl =card.querySelector('.bar-status');
    var badgeEl=card.querySelector('.bar-badge');
    if(!timerEl) continue;

    var rt=new Date(item.releaseTime).getTime();

    if(BATCH_STATE&&BATCH_STATE.active&&BATCH_STATE.itemId===id){
      var st=BATCH_STATE.startTimeMs||new Date(BATCH_STATE.startTime||0).getTime();
      var el=now-st, rem=Math.max(0,BATCH_DURATION-el);
      timerEl.textContent=fmtMs(rem);
      progEl.style.width=pct(el,BATCH_DURATION)+'%';
      timerEl.className='bar-timer'+(rem<=60000&&rem>30000?' warning':rem<=30000?' urgent':'');
      if(rem<=0){ statEl.textContent='EXPIRED'; card.className='bar-card expired'; expireItem(id); }
      else statEl.textContent='LIVE - HURRY!';

    } else {
      var diff=rt-now;
      if(diff<=0){
        var le=now-rt, lr=Math.max(0,BATCH_DURATION-le);
        if(le>=BATCH_DURATION){
          timerEl.textContent='00:00'; progEl.style.width='100%';
          card.className='bar-card expired'; statEl.textContent='EXPIRED';
          expireItem(id); continue;
        }
        timerEl.textContent=fmtMs(lr);
        progEl.style.width=pct(le,BATCH_DURATION)+'%';
        timerEl.className='bar-timer'+(lr<=60000&&lr>30000?' warning':lr<=30000?' urgent':'');
        card.classList.remove('waiting'); card.classList.add('active');
        if(badgeEl) badgeEl.textContent='LIVE';
        if(!card.querySelector('.bar-enter-btn')){
          var eb=document.createElement('button');
          eb.className='bar-enter-btn'; eb.dataset.url=card.dataset.url||'';
          eb.innerHTML='ENTER NOW &#8594;'; card.appendChild(eb);
        }
        enterBtn.classList.add('show');
        if(lr<=0){ statEl.textContent='EXPIRED'; card.className='bar-card expired'; expireItem(id); }
        else statEl.textContent='LIVE - HURRY!';
      } else {
        timerEl.textContent=fmtMs(diff); progEl.style.width='0%';
      }
    }
  }
}

// Enter / unlock
function unlock(){
  if(isUnlocked) return;
  isUnlocked=true; blurOverlay.classList.add('unlocked');
  music.play().catch(function(){}); enterBtn.classList.remove('show');
}
enterBtn.addEventListener('click',unlock);
blurOverlay.addEventListener('click',unlock);
document.addEventListener('keydown',function(e){ if(e.key==='Enter') unlock(); });

barsContainer.addEventListener('click',function(e){
  var btn=e.target;
  while(btn&&!btn.classList.contains('bar-enter-btn')) btn=btn.parentElement;
  if(btn&&btn.dataset&&btn.dataset.url){
    btn.textContent='ENTERING...';
    setTimeout(function(){ window.location.href=btn.dataset.url; },400);
  }
});

// Init
renderBars();
if(BATCH_STATE&&BATCH_STATE.active) enterBtn.classList.add('show');
if(READY_BATCH&&READY_BATCH.ready)  enterBtn.classList.add('show');
if(QUEUE_DATA&&QUEUE_DATA.length)   queueCountEl.textContent=QUEUE_DATA.length;

if(!QUEUE_DATA||!QUEUE_DATA.length){
  noQuaScreen.classList.add('show');
  blurOverlay.style.display='none';
  topControls.style.display='none';
  enterBtn.style.display='none';
}

// RAF tick — 1 second
var lastTick=0;
(function tick(ts){
  if(ts-lastTick>=1000){ lastTick=ts; updateTimers(); }
  requestAnimationFrame(tick);
})(0);

// Viewer ping
var viewerEl=document.getElementById('viewerCount');
function pingViewer(){
  fetch('/api/viewers/ping',{method:'POST',keepalive:true})
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(d){ if(d&&d.count) viewerEl.textContent=d.count; })
    .catch(function(){});
}
pingViewer(); setInterval(pingViewer,15000);
window.addEventListener('beforeunload',function(){
  fetch('/api/viewers/leave',{method:'POST',keepalive:true}).catch(function(){});
});

// Announcements
var annBanner=document.getElementById('annBanner');
var annMsg=document.getElementById('annMsg');
var lastAnnId=null, hideTimer=null;

function beep(){
  try{
    var ctx=new(window.AudioContext||window.webkitAudioContext)();
    var o=ctx.createOscillator(),g=ctx.createGain();
    o.connect(g);g.connect(ctx.destination);
    o.type='sine';o.frequency.setValueAtTime(880,ctx.currentTime);
    g.gain.setValueAtTime(0,ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.4,ctx.currentTime+0.05);
    g.gain.linearRampToValueAtTime(0,ctx.currentTime+0.6);
    o.start(ctx.currentTime);o.stop(ctx.currentTime+0.65);
  }catch(e){}
}
function showAnn(text,id){
  if(lastAnnId===id) return; lastAnnId=id;
  if(hideTimer) clearTimeout(hideTimer);
  annMsg.textContent=text;
  annBanner.style.display='block';
  requestAnimationFrame(function(){ annBanner.classList.remove('hiding'); annBanner.classList.add('visible'); });
  beep();
  topControls.style.marginTop='3.5rem';
  hideTimer=setTimeout(hideAnn,12000);
}
function hideAnn(){
  annBanner.classList.add('hiding'); annBanner.classList.remove('visible');
  topControls.style.marginTop='';
  setTimeout(function(){ annBanner.style.display='none'; },650);
}
document.getElementById('annClose').addEventListener('click',hideAnn);

function pollAnn(){
  fetch('/api/announce')
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(d&&d.active&&d.message) showAnn(d.message,d.id);
      else if(!d||!d.active) lastAnnId=null;
    }).catch(function(){});
}
pollAnn(); setInterval(pollAnn,10000);
<\/script>
</body>
</html>`;
}

// ╔══════════════════════════════════════════════════════════╗
// ║                    ADMIN PAGE HTML                       ║
// ╚══════════════════════════════════════════════════════════╝
function adminHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Admin Panel</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;min-height:100vh;background:linear-gradient(135deg,#0a0a14,#1a1a2e);color:#fff;padding:2rem;padding-bottom:6rem}
    .wrap{max-width:800px;margin:0 auto}
    h1{font-family:'Orbitron',monospace;font-size:1.5rem;letter-spacing:.1em;margin-bottom:2rem;text-align:center;color:#FF69B4;text-shadow:0 0 20px #FF69B4}
    .nav{text-align:center;margin-bottom:2rem;display:flex;gap:1rem;justify-content:center}
    .nav a{display:inline-block;padding:.5rem 1rem;border:1px solid #8B5CF6;border-radius:25px;color:#8B5CF6;text-decoration:none;transition:all .3s}
    .nav a:hover,.nav a.act{background:#8B5CF6;color:#fff}
    .card{background:rgba(20,20,35,.95);border-radius:16px;padding:1.5rem;border:1px solid rgba(255,255,255,.1);margin-bottom:1.5rem}
    .card-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,.1)}
    .card-hdr h2{font-family:'Orbitron',monospace;font-size:1rem}
    .bdg{padding:.3rem .8rem;border-radius:20px;font-size:.75rem;font-weight:600}
    .bdg-g{background:rgba(34,197,94,.2);color:#22c55e}
    .bdg-p{background:rgba(139,92,246,.2);color:#8B5CF6}
    .bdg-pk{background:rgba(255,105,180,.2);color:#FF69B4}
    .q-list{display:flex;flex-direction:column;gap:1rem}
    .q-item{background:rgba(255,255,255,.03);border-radius:12px;padding:1.25rem;border:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem}
    .q-item.playing{background:rgba(255,105,180,.1);border-color:#FF69B4}
    .q-info{flex:1;min-width:200px}
    .q-title{font-family:'Orbitron',monospace;font-size:.95rem;font-weight:600;margin-bottom:.25rem}
    .q-pos{font-size:.7rem;color:#FF69B4;margin-bottom:.5rem}
    .q-sub{font-size:.8rem;color:#a0a0b0}
    .q-actions{display:flex;gap:.5rem}
    .ic{width:36px;height:36px;border-radius:8px;border:none;cursor:pointer;font-size:1rem;transition:all .3s}
    .ic-e{background:rgba(59,130,246,.2);color:#3B82F6}
    .ic-e:hover{background:rgba(59,130,246,.4)}
    .ic-d{background:rgba(239,68,68,.2);color:#ef4444}
    .ic-d:hover{background:rgba(239,68,68,.4)}
    .form{display:grid;gap:1.25rem}
    .form-row{display:flex;gap:1rem;flex-wrap:wrap}
    .fg{flex:1;min-width:200px}
    label{display:block;font-size:.85rem;font-weight:600;margin-bottom:.5rem;color:#a0a0b0}
    input{width:100%;padding:.85rem 1rem;font-size:1rem;color:#fff;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;outline:none;transition:all .3s}
    input:focus{border-color:#8B5CF6;box-shadow:0 0 20px rgba(139,92,246,.2)}
    .btn{padding:1rem;font-family:'Orbitron',monospace;font-size:.85rem;font-weight:600;border-radius:10px;cursor:pointer;transition:all .3s;border:none}
    .btn-pri{background:linear-gradient(135deg,#FF69B4,#8B5CF6);color:#fff;flex:1}
    .btn-sec{background:rgba(139,92,246,.2);color:#8B5CF6;border:1px solid #8B5CF6}
    .btn-sec:hover{background:#8B5CF6;color:#fff}
    .add-btn{background:linear-gradient(135deg,#FF69B4,#8B5CF6);color:#fff;border:none;padding:1rem 2rem;border-radius:50px;font-family:'Orbitron',monospace;font-weight:700;cursor:pointer;transition:all .3s;margin-top:1rem}
    .empty{text-align:center;padding:3rem;color:#a0a0b0}
    @media(max-width:600px){.form-row{flex-direction:column}.q-item{flex-direction:column}.q-actions{width:100%;justify-content:flex-end}}
  </style>
</head>
<body>
<div class="wrap">
  <h1>&#9889; ADMIN PANEL</h1>
  <div class="nav">
    <a href="/">View Countdown</a>
    <a href="#" class="act">Manage Queue</a>
  </div>

  <div id="listView">
    <div class="card">
      <div class="card-hdr">
        <h2>Release Queue</h2>
        <span id="qStatus" class="bdg bdg-pk">0 releases</span>
      </div>
      <div id="qList" class="q-list"></div>
    </div>

    <div class="card">
      <div class="card-hdr">
        <h2>&#128226; Announcement</h2>
        <span id="vBadge" class="bdg bdg-g">0 viewers</span>
      </div>
      <div class="form">
        <div class="fg">
          <label>Message (shown to all users)</label>
          <input type="text" id="annInput" placeholder="e.g. Magastart na!" maxlength="200">
        </div>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap">
          <button class="btn btn-pri" id="btnSend">SEND</button>
          <button class="btn btn-sec" id="btnClear">CLEAR</button>
        </div>
        <div id="annSt" style="font-size:.8rem;color:#a0a0b0;min-height:1.2rem"></div>
      </div>
    </div>
  </div>

  <div id="formView" style="display:none" class="card">
    <div class="card-hdr"><h2 id="formTitle">Add New Release</h2></div>
    <div class="form">
      <div class="fg"><label>Release Title</label><input type="text" id="fTitle" placeholder="My Awesome Release"></div>
      <div class="fg"><label>Redirect URL</label><input type="text" id="fUrl" placeholder="https://..."></div>
      <div class="fg"><label>Qua ID (e.g. qua1)</label><input type="text" id="fBatch" value="qua1"></div>
      <div class="form-row">
        <div class="fg"><label>Date</label><input type="date" id="fDate"></div>
        <div class="fg"><label>Time (PHT +08:00)</label><input type="time" id="fTime"></div>
      </div>
      <div style="display:flex;gap:1rem">
        <button class="btn btn-pri" id="btnSave">SAVE RELEASE</button>
        <button class="btn btn-sec" id="btnCancel">CANCEL</button>
      </div>
    </div>
  </div>
</div>

<script>
var TZ='Asia/Manila', queue=[], editId=null;

function fmtDate(iso){
  try{ return new Date(iso).toLocaleString('en-US',{timeZone:TZ,dateStyle:'medium',timeStyle:'short'}); }
  catch(e){ return iso; }
}
function isReleased(rt){ return new Date(rt).getTime()<=Date.now(); }
function sortQ(arr){
  return arr.slice().sort(function(a,b){ return new Date(a.releaseTime).getTime()-new Date(b.releaseTime).getTime(); });
}
function apiFetch(url,opts){
  return fetch(url,opts).then(function(r){ return r.json(); });
}

function loadQ(){ return apiFetch('/api/queue').then(function(d){ if(Array.isArray(d)) queue=d; }); }
function saveQ(){ return apiFetch('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(queue)}); }

function showForm(title){
  document.getElementById('formTitle').textContent=title;
  document.getElementById('listView').style.display='none';
  document.getElementById('formView').style.display='';
}
function showList(){
  document.getElementById('listView').style.display='';
  document.getElementById('formView').style.display='none';
  editId=null;
}

function attachEvents(){
  document.querySelectorAll('.ic-d').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=btn.dataset.id;
      if(!confirm('Delete this release?')) return;
      queue=queue.filter(function(c){ return c.id!==id&&c.batchId!==id; });
      apiFetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})});
      saveQ().then(render);
    });
  });
  document.querySelectorAll('.ic-e').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=btn.dataset.id, item=null;
      for(var i=0;i<queue.length;i++){ if(queue[i].id===id){ item=queue[i]; break; } }
      if(!item) return;
      editId=id;
      var dt=new Date(item.releaseTime);
      document.getElementById('fTitle').value=item.title||'';
      document.getElementById('fUrl').value=item.url||'';
      document.getElementById('fBatch').value=item.batchId||'qua1';
      document.getElementById('fDate').value=dt.toLocaleDateString('en-CA',{timeZone:TZ});
      document.getElementById('fTime').value=dt.toLocaleTimeString('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit'});
      showForm('Edit Release');
    });
  });
  var ab=document.getElementById('addBtn');
  if(ab) ab.addEventListener('click',function(){
    editId=null;
    ['fTitle','fUrl','fDate','fTime'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('fBatch').value='qua1';
    showForm('Add New Release');
  });
}

function render(){
  var list=document.getElementById('qList');
  var stat=document.getElementById('qStatus');
  var sorted=sortQ(queue);
  var active=sorted.filter(function(c){ return !isReleased(c.releaseTime); });
  var done  =sorted.filter(function(c){ return  isReleased(c.releaseTime); });

  if(!queue.length){
    list.innerHTML='<div class="empty"><p>No releases yet.</p><button class="add-btn" id="addBtn">+ ADD RELEASE</button></div>';
    stat.textContent='0 releases'; stat.className='bdg bdg-pk'; attachEvents(); return;
  }

  var h='';
  active.forEach(function(c,i){
    var pos=i===0?'NOW PLAYING':'#'+(i+1)+' IN QUEUE';
    h+='<div class="q-item'+(i===0?' playing':'')+'"><div class="q-info"><div class="q-title">'+c.title+'</div><div class="q-pos">'+pos+'</div><div class="q-sub">'+fmtDate(c.releaseTime)+'</div></div><span class="bdg bdg-g">active</span><div class="q-actions"><button class="ic ic-e" data-id="'+c.id+'">&#9998;</button><button class="ic ic-d" data-id="'+c.id+'">&times;</button></div></div>';
  });
  done.forEach(function(c){
    h+='<div class="q-item" style="opacity:.5"><div class="q-info"><div class="q-title">'+c.title+'</div><div class="q-pos">COMPLETED</div><div class="q-sub">'+fmtDate(c.releaseTime)+'</div></div><span class="bdg bdg-p">released</span><div class="q-actions"><button class="ic ic-d" data-id="'+c.id+'">&times;</button></div></div>';
  });
  h+='<button class="add-btn" id="addBtn">+ ADD RELEASE</button>';
  list.innerHTML=h;
  stat.textContent=active.length+' active, '+done.length+' released';
  stat.className='bdg '+(active.length>0?'bdg-g':'bdg-pk');
  attachEvents();
}

document.getElementById('btnCancel').addEventListener('click',showList);

document.getElementById('btnSave').addEventListener('click',function(){
  var title=document.getElementById('fTitle').value.trim();
  var url  =document.getElementById('fUrl').value.trim();
  var batch=document.getElementById('fBatch').value.trim()||'qua1';
  var date =document.getElementById('fDate').value;
  var time =document.getElementById('fTime').value;
  if(!title||!url||!date||!time){ alert('Fill all fields'); return; }

  var releaseTime=new Date(date+'T'+time+':00+08:00').toISOString();

  if(editId){
    for(var i=0;i<queue.length;i++){
      if(queue[i].id===editId){
        queue[i].title=title; queue[i].url=url; queue[i].batchId=batch; queue[i].releaseTime=releaseTime; break;
      }
    }
  } else {
    queue.push({id:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6),batchId:batch,title:title,url:url,releaseTime:releaseTime});
  }
  saveQ().then(function(d){
    if(d&&d.success){ showList(); render(); } else { alert('Failed to save!'); }
  }).catch(function(){ alert('Network error'); });
});

// Viewers
function refreshViewers(){
  apiFetch('/api/viewers/count').then(function(d){
    if(d&&typeof d.count!=='undefined')
      document.getElementById('vBadge').textContent=d.count+' viewer'+(d.count!==1?'s':'');
  }).catch(function(){});
}
refreshViewers(); setInterval(refreshViewers,15000);

// Announcements
document.getElementById('btnSend').addEventListener('click',function(){
  var msg=document.getElementById('annInput').value.trim();
  if(!msg){ alert('Enter a message first'); return; }
  var st=document.getElementById('annSt'); st.textContent='Sending...';
  apiFetch('/api/announce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:true,message:msg})})
    .then(function(d){ st.textContent=d.success?'Sent!':'Failed.'; st.style.color=d.success?'#22c55e':'#ef4444'; })
    .catch(function(){ st.textContent='Error'; st.style.color='#ef4444'; });
});
document.getElementById('btnClear').addEventListener('click',function(){
  document.getElementById('annInput').value='';
  var st=document.getElementById('annSt');
  apiFetch('/api/announce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:false,message:''})})
    .then(function(){ st.textContent='Cleared.'; st.style.color='#a0a0b0'; }).catch(function(){});
});

loadQ().then(render);
<\/script>
</body>
</html>`;
}
