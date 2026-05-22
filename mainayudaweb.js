// ============================================================
//  AYUDA QUEUE — Cloudflare Worker  (Fixed)
//  wrangler.toml KV binding:
//    [[kv_namespaces]]
//    binding = "AYUDA_KV"
//    id      = "<your-kv-id>"
// ============================================================

const BATCH_DURATION = 600_000; // 10 min in ms
const MUSIC_URL =
  "https://mp3tourl.com/audio/1779373516167-dfd3f082-673a-402f-8926-d3b580f009f0.m4a";

// ── Safe KV helpers ───────────────────────────────────────────
async function kvGet(env, key, fallback = null) {
  try {
    const raw = await env.AYUDA_KV.get(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
async function kvSet(env, key, value, opts = {}) {
  try { await env.AYUDA_KV.put(key, JSON.stringify(value), opts); } catch (e) {}
}
async function kvDel(env, key) {
  try { await env.AYUDA_KV.delete(key); } catch (e) {}
}

// ── Expired-ID registry (stops the re-promote loop) ──────────
async function addExpiredId(env, id) {
  try {
    const list = await kvGet(env, "expiredIds", []);
    if (!list.includes(id)) {
      list.push(id);
      await kvSet(env, "expiredIds", list.slice(-50));
    }
  } catch (e) {}
}

// ── Viewer helpers ────────────────────────────────────────────
async function pingViewer(env, vsid) {
  await kvSet(env, `viewer:${vsid}`, Date.now(), { expirationTtl: 45 });
}
async function removeViewer(env, vsid) {
  await kvDel(env, `viewer:${vsid}`);
}
async function countViewers(env) {
  try {
    const list = await env.AYUDA_KV.list({ prefix: "viewer:" });
    return list.keys.length;
  } catch (e) {
    return 1; // safe fallback so page still renders
  }
}

// ── Queue / batch helpers ─────────────────────────────────────
async function getQueue(env)  { return kvGet(env, "queue",      []); }
async function setQueue(env, q) { await kvSet(env, "queue", q); }
async function getBatch(env)  { return kvGet(env, "batchState", { active: false }); }
async function setBatch(env, s) { await kvSet(env, "batchState", s); }
async function clearBatch(env)  { await kvSet(env, "batchState", { active: false }); }

// ── Safe string replacement (avoids $ backreference bug) ──────
// Using a function as the replacer prevents JS from interpreting
// $& $` $' $1 etc. inside the replacement string.
function safeReplace(html, pattern, value) {
  const str = String(value);
  return html.replace(pattern, () => str);
}

// ── Build the countdown page ──────────────────────────────────
async function buildPage(env) {
  try {
    let queue       = await getQueue(env);
    let batch       = await getBatch(env);
    const now       = Date.now();
    const expiredIds = await kvGet(env, "expiredIds", []);

    // 1) Strip any already-expired items from the queue
    queue = queue.filter(item => !expiredIds.includes(item.id));

    // 2) Auto-promote oldest past-due item → active batch
    if (!batch.active) {
      const sorted = queue.slice().sort(
        (a, b) => new Date(a.releaseTime).getTime() - new Date(b.releaseTime).getTime()
      );
      for (const item of sorted) {
        const rt = new Date(item.releaseTime).getTime();
        if (!isNaN(rt) && rt <= now) {
          batch = {
            active:      true,
            itemId:      item.id,
            itemBatchId: item.batchId ?? "",
            title:       item.title ?? "",
            url:         item.url   ?? "",
            startTimeMs: now,
            startTime:   new Date(now).toISOString(),
            serverTime:  new Date(now).toISOString(),
          };
          await setBatch(env, batch);
          break;
        }
      }
    }

    // 3) Check if the active batch has expired on the server side
    if (batch.active) {
      const startMs = batch.startTimeMs ?? new Date(batch.startTime ?? 0).getTime();
      const elapsed = now - startMs;
      if (elapsed >= BATCH_DURATION) {
        const expiredId  = batch.itemId ?? "";
        const expiredUrl = batch.url    ?? "";
        await addExpiredId(env, expiredId);
        const newQueue = queue.filter(i => i.id !== expiredId);
        await setQueue(env, newQueue);
        await clearBatch(env);
        await kvSet(env, "readyBatch",
          { ready: true, url: expiredUrl, itemId: expiredId });
        queue = newQueue;
        batch = { active: false };
      }
    }

    const readyBatch   = await kvGet(env, "readyBatch",  { ready: false });
    const announce     = await kvGet(env, "announce",    { active: false, message: "", id: "0" });
    const viewerCount  = await countViewers(env);

    const clientBatch = batch.active
      ? { active: true,  itemId: batch.itemId, title: batch.title,
          url: batch.url, startTimeMs: batch.startTimeMs,
          startTime: batch.startTime, serverTime: batch.serverTime }
      : { active: false };
    const clientReady = readyBatch.ready
      ? { ready: true, url: readyBatch.url ?? "" }
      : { ready: false };

    // ── FIX: use safeReplace (function replacer) everywhere ──
    let html = countdownHTML();
    html = safeReplace(html, /QUEUE_DATA_PH/g,     JSON.stringify(queue));
    html = safeReplace(html, /BATCH_STATE_PH/g,    JSON.stringify(clientBatch));
    html = safeReplace(html, /READY_BATCH_PH/g,    JSON.stringify(clientReady));
    html = safeReplace(html, /BATCH_DURATION_PH/g, String(BATCH_DURATION));
    html = safeReplace(html, /VIEWER_COUNT_PH/g,   String(viewerCount));
    html = safeReplace(html, /MUSIC_URL_PH/g,      MUSIC_URL);

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  } catch (err) {
    // Never return Error 1101 — show a readable error page instead
    return new Response(
      `<!DOCTYPE html><html><body style="background:#0f0f1a;color:#fff;font-family:monospace;padding:2rem">
       <h2 style="color:#ef4444">Worker Error</h2><pre>${err.stack || err}</pre>
       <p><a href="/" style="color:#8B5CF6">Retry</a></p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

// ── Safe cookie parser ────────────────────────────────────────
function parseCookies(str) {
  const out = {};
  if (!str) return out;
  for (const part of str.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// ── Router ────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    try {
      const url    = new URL(request.url);
      const path   = url.pathname;
      const method = request.method.toUpperCase();

      // Preflight
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: { "Access-Control-Allow-Origin": "*",
                     "Access-Control-Allow-Methods": "GET,POST",
                     "Access-Control-Allow-Headers": "Content-Type" }
        });
      }

      if (path === "/" && method === "GET")
        return buildPage(env);

      if (path === "/admin" && method === "GET")
        return new Response(adminHTML(), {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });

      if (path === "/api/queue" && method === "GET")
        return jsonResp(await getQueue(env));

      if (path === "/api/queue" && method === "POST") {
        const body = await request.json().catch(() => null);
        if (!Array.isArray(body)) return jsonResp({ error: "Expected array" }, 400);
        await setQueue(env, body);
        return jsonResp({ success: true });
      }

      if (path === "/api/delete" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const id   = String(body.id ?? "");
        let q = await getQueue(env);
        q = q.filter(i => i.id !== id && i.batchId !== id);
        await setQueue(env, q);
        const batch = await getBatch(env);
        if (batch.active && batch.itemId === id) await clearBatch(env);
        const rb = await kvGet(env, "readyBatch", { ready: false });
        if (rb.itemId === id) await kvDel(env, "readyBatch");
        await addExpiredId(env, id);
        return jsonResp({ success: true, deleted: id });
      }

      if (path === "/api/viewers/ping" && method === "POST") {
        const cookies = parseCookies(request.headers.get("Cookie") ?? "");
        const vsid    = cookies["vsid"] || crypto.randomUUID().slice(0, 12);
        await pingViewer(env, vsid);
        const count = await countViewers(env);
        const res   = jsonResp({ count });
        res.headers.set("Set-Cookie",
          `vsid=${vsid}; Path=/; Max-Age=3600; SameSite=Lax`);
        return res;
      }

      if (path === "/api/viewers/leave" && method === "POST") {
        const cookies = parseCookies(request.headers.get("Cookie") ?? "");
        const vsid    = cookies["vsid"] ?? "";
        if (vsid) await removeViewer(env, vsid);
        return jsonResp({ ok: true });
      }

      if (path === "/api/viewers/count" && method === "GET")
        return jsonResp({ count: await countViewers(env) });

      if (path === "/api/announce" && method === "GET")
        return jsonResp(await kvGet(env, "announce",
          { active: false, message: "", id: "0" }));

      if (path === "/api/announce" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        await kvSet(env, "announce", {
          active:  Boolean(body.active),
          message: String(body.message ?? ""),
          id:      String(Date.now()),
        });
        return jsonResp({ success: true });
      }

      return new Response("Not Found", { status: 404 });

    } catch (err) {
      // Top-level catch — no more Error 1101
      console.error("Worker error:", err);
      return new Response(
        `<!DOCTYPE html><html><body style="background:#0f0f1a;color:#fff;font-family:monospace;padding:2rem">
         <h2 style="color:#ef4444">Worker Error</h2><pre>${err.stack || err}</pre>
         <p><a href="/" style="color:#8B5CF6">Retry</a></p></body></html>`,
        { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }
  },
};

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

    /* ── FIRE ───────────────────────────────────────── */
    #fireCanvas{position:fixed;bottom:0;left:0;width:100%;height:260px;z-index:6;pointer-events:none}

    /* ── SPOTLIGHTS ─────────────────────────────────── */
    .spotlights{position:fixed;top:0;left:0;width:100%;height:100%;z-index:3;pointer-events:none;overflow:hidden}
    .beam{position:absolute;top:-60px;width:70px;height:110vh;transform-origin:top center;will-change:transform,opacity}
    .beam::after{content:'';position:absolute;top:0;left:0;width:100%;height:100%;
      clip-path:polygon(35% 0%,65% 0%,100% 100%,0% 100%);filter:blur(10px)}
    .b1{left:11%;animation:sw1 4.2s ease-in-out infinite}
    .b1::after{background:linear-gradient(to bottom,rgba(255,105,180,.9) 0%,rgba(255,105,180,.2) 55%,transparent 100%)}
    .b2{left:34%;animation:sw2 5.5s ease-in-out infinite .9s}
    .b2::after{background:linear-gradient(to bottom,rgba(255,255,255,.9) 0%,rgba(200,160,255,.3) 55%,transparent 100%)}
    .b3{left:61%;animation:sw3 3.8s ease-in-out infinite .4s}
    .b3::after{background:linear-gradient(to bottom,rgba(139,92,246,.95) 0%,rgba(139,92,246,.25) 55%,transparent 100%)}
    .b4{left:83%;animation:sw4 4.8s ease-in-out infinite 1.5s}
    .b4::after{background:linear-gradient(to bottom,rgba(59,180,255,.9) 0%,rgba(59,130,246,.2) 55%,transparent 100%)}
    @keyframes sw1{0%,100%{transform:rotate(-22deg);opacity:.6}50%{transform:rotate(14deg);opacity:.85}}
    @keyframes sw2{0%,100%{transform:rotate(18deg);opacity:.5}50%{transform:rotate(-20deg);opacity:.9}}
    @keyframes sw3{0%,100%{transform:rotate(-15deg);opacity:.7}50%{transform:rotate(22deg);opacity:1}}
    @keyframes sw4{0%,100%{transform:rotate(12deg);opacity:.55}50%{transform:rotate(-18deg);opacity:.8}}

    /* ── STAGE GLOW ─────────────────────────────────── */
    .stage-glow{position:fixed;bottom:0;left:0;width:100%;height:200px;
      background:linear-gradient(to top,rgba(255,80,0,.35) 0%,rgba(255,120,0,.1) 40%,transparent 100%);
      z-index:5;pointer-events:none}

    /* ── UI ─────────────────────────────────────────── */
    .color-bg{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;transition:background .8s}
    .blur-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:10;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:2rem;padding-bottom:280px;transition:filter .5s}
    .blur-overlay:not(.unlocked){filter:blur(20px)}
    .blur-overlay.unlocked{filter:none}
    .top-controls{position:fixed;top:1.5rem;left:50%;transform:translateX(-50%);
      z-index:20;display:flex;gap:.75rem;flex-wrap:wrap;justify-content:center}
    .top-btn{display:inline-flex;align-items:center;justify-content:center;
      padding:.6rem 1.5rem;font-family:'Orbitron',monospace;font-size:.75rem;font-weight:600;
      letter-spacing:.1em;color:#fff;
      background:linear-gradient(135deg,rgba(255,105,180,.3),rgba(139,92,246,.3));
      border:1px solid rgba(255,255,255,.2);border-radius:25px;cursor:pointer;
      backdrop-filter:blur(10px);transition:all .3s;
      -webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .top-btn:hover{background:linear-gradient(135deg,rgba(255,105,180,.5),rgba(139,92,246,.5));
      transform:translateY(-2px)}
    .container{text-align:center;margin-bottom:3rem;position:relative;z-index:2}
    .title{font-family:'Orbitron',monospace;font-size:clamp(1.2rem,4vw,2rem);font-weight:700;
      letter-spacing:.3em;margin-bottom:2rem;color:#FF69B4;text-shadow:0 0 30px #FF69B4}
    .bars-container{display:flex;flex-wrap:wrap;justify-content:center;gap:1.5rem;
      max-width:1200px;margin:0 auto}

    /* ── CARDS ──────────────────────────────────────── */
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
    .bar-prog-wrap{background:rgba(255,255,255,.1);border-radius:10px;
      height:12px;overflow:hidden;margin-bottom:.75rem}
    .bar-prog{height:100%;background:linear-gradient(90deg,#FF69B4,#8B5CF6);
      border-radius:10px;transition:width .5s ease;width:0%}
    .bar-card.active .bar-prog{background:linear-gradient(90deg,#22c55e,#34d399)}
    .bar-card.waiting .bar-prog{background:linear-gradient(90deg,#fbbf24,#fcd34d)}
    .bar-card.expired .bar-prog{background:linear-gradient(90deg,#ef4444,#f87171);width:100%!important}
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

    /* ── NO QUEUE ───────────────────────────────────── */
    .no-qua{display:none;position:fixed;top:0;left:0;width:100%;height:100%;
      background:#000;z-index:100;flex-direction:column;align-items:center;
      justify-content:center;gap:2.5rem}
    .no-qua.show{display:flex}
    .no-qua-text{font-family:'Orbitron',monospace;font-size:clamp(1.3rem,5vw,2.5rem);
      font-weight:700;text-align:center;padding:0 1.5rem;
      animation:glow 2s ease-in-out infinite alternate}
    .music-btn{display:flex;align-items:center;justify-content:center;gap:.75rem;
      padding:1rem 2.5rem;font-family:'Orbitron',monospace;font-size:.9rem;font-weight:700;
      letter-spacing:.15em;color:#fff;background:transparent;border:2px solid #FF69B4;
      border-radius:50px;cursor:pointer;-webkit-tap-highlight-color:transparent;
      touch-action:manipulation;animation:musicGlow 2s ease-in-out infinite alternate}
    .music-btn.playing{animation:musicGlowOn 1.5s ease-in-out infinite alternate}
    .mbars{display:flex;align-items:flex-end;gap:3px;height:18px}
    .mbars span{display:block;width:4px;background:currentColor;border-radius:2px}
    .playing .mbars span:nth-child(1){animation:mb1 .6s ease-in-out infinite alternate}
    .playing .mbars span:nth-child(2){animation:mb2 .5s ease-in-out infinite alternate}
    .playing .mbars span:nth-child(3){animation:mb3 .7s ease-in-out infinite alternate}
    .playing .mbars span:nth-child(4){animation:mb4 .4s ease-in-out infinite alternate}
    @keyframes mb1{0%{height:4px}100%{height:16px}}
    @keyframes mb2{0%{height:10px}100%{height:6px}}
    @keyframes mb3{0%{height:6px}100%{height:14px}}
    @keyframes mb4{0%{height:14px}100%{height:4px}}
    @keyframes musicGlow{0%{box-shadow:0 0 10px #FF69B4,0 0 25px #FF69B4;color:#FF69B4;border-color:#FF69B4}
      100%{box-shadow:0 0 15px #8B5CF6,0 0 35px #8B5CF6;color:#8B5CF6;border-color:#8B5CF6}}
    @keyframes musicGlowOn{0%{box-shadow:0 0 15px #8B5CF6,0 0 40px #8B5CF6;color:#8B5CF6;border-color:#8B5CF6}
      100%{box-shadow:0 0 20px #FF69B4,0 0 50px #FF69B4;color:#FF69B4;border-color:#FF69B4}}
    @keyframes glow{0%{text-shadow:0 0 10px #FF69B4,0 0 20px #FF69B4;color:#FF69B4}
      100%{text-shadow:0 0 20px #8B5CF6,0 0 40px #8B5CF6;color:#8B5CF6}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.5}}
    @keyframes bounce{0%,100%{transform:translateX(-50%) translateY(0)}
      50%{transform:translateX(-50%) translateY(-6px)}}
    @keyframes bounceCard{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}

    /* ── ENTER BTN ──────────────────────────────────── */
    .enter-btn{position:fixed;bottom:22%;left:50%;transform:translateX(-50%);z-index:15;
      display:none;align-items:center;justify-content:center;gap:.75rem;
      padding:1rem 3rem;font-family:'Orbitron',monospace;font-size:1.2rem;font-weight:700;
      letter-spacing:.15em;color:#fff;background:linear-gradient(135deg,#22c55e,#34d399);
      border:none;border-radius:50px;cursor:pointer;
      box-shadow:0 10px 40px rgba(34,197,94,.4);
      -webkit-tap-highlight-color:transparent;touch-action:manipulation}
    .enter-btn.show{display:flex;animation:bounce 1s infinite}

    /* ── MISC ───────────────────────────────────────── */
    .queue-info{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);z-index:15;
      font-size:.8rem;color:#a0a0b0;letter-spacing:.1em;display:flex;align-items:center;
      gap:1rem;flex-wrap:wrap;justify-content:center}
    .queue-count{color:#FF69B4;font-weight:700}
    .viewer-row{display:inline-flex;align-items:center;gap:.4rem}
    .vdot{width:8px;height:8px;border-radius:50%;background:#22c55e;
      box-shadow:0 0 6px #22c55e;animation:pulse 2s ease-in-out infinite}
    .vnum{color:#22c55e;font-weight:700}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.3)}}
    .ann-bar{display:none;position:fixed;top:0;left:0;width:100%;z-index:200;
      padding:1rem 1.5rem;text-align:center;font-family:'Orbitron',monospace;
      font-size:clamp(.75rem,3vw,1rem);font-weight:700;letter-spacing:.1em;color:#fff;
      background:linear-gradient(90deg,rgba(255,105,180,.9),rgba(139,92,246,.9),rgba(255,105,180,.9));
      background-size:200% 100%;animation:annBg 3s linear infinite;
      box-shadow:0 4px 30px rgba(255,105,180,.5);opacity:0;transition:opacity .6s ease}
    .ann-bar.visible{opacity:1}
    .ann-bar.hiding{opacity:0}
    @keyframes annBg{0%{background-position:0% 50%}100%{background-position:200% 50%}}
    .ann-close{position:absolute;right:1rem;top:50%;transform:translateY(-50%);
      background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;
      opacity:.8;padding:.25rem .5rem}
    .bar-enter-btn{display:block;width:100%;margin-top:1rem;padding:.75rem;
      font-family:'Orbitron',monospace;font-size:.85rem;font-weight:700;letter-spacing:.1em;
      color:#fff;background:linear-gradient(135deg,#22c55e,#34d399);border:none;
      border-radius:12px;cursor:pointer;box-shadow:0 4px 20px rgba(34,197,94,.4);
      animation:bounceCard 1s infinite;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
    @media(max-width:768px){
      .bars-container{flex-direction:column;align-items:center}
      .bar-card{max-width:100%;width:100%}
      .bar-timer{font-size:1.6rem}
    }
  </style>
</head>
<body>

  <div class="spotlights">
    <div class="beam b1"></div>
    <div class="beam b2"></div>
    <div class="beam b3"></div>
    <div class="beam b4"></div>
  </div>

  <canvas id="fireCanvas"></canvas>
  <div class="stage-glow"></div>

  <div class="ann-bar" id="annBar">
    <span id="annMsg"></span>
    <button class="ann-close" id="annClose">&#10005;</button>
  </div>

  <div class="color-bg" id="colorBg"></div>

  <div class="no-qua" id="noQua">
    <div class="no-qua-text">wala pang ayuda:><br>balik ka nalang mamaya</div>
    <button class="music-btn" id="musicBtn" onclick="toggleMusic()">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
      <span id="musicLbl">PLAY MUSIC</span>
      <div class="mbars">
        <span style="height:4px"></span><span style="height:10px"></span>
        <span style="height:6px"></span><span style="height:14px"></span>
      </div>
    </button>
  </div>

  <div class="top-controls" id="topCtrl">
    <button class="top-btn" onclick="location.reload()">REFRESH</button>
    <button class="top-btn" id="soundBtn">SOUND</button>
  </div>

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
    <span class="queue-count" id="qCount">0</span> releases &nbsp;|&nbsp;
    <span class="viewer-row">
      <span class="vdot"></span>
      <span class="vnum" id="vCount">VIEWER_COUNT_PH</span> viewing
    </span>
  </div>

  <audio id="bgMusic" loop>
    <source src="MUSIC_URL_PH" type="audio/mp4">
    <source src="MUSIC_URL_PH" type="audio/mpeg">
  </audio>
  <audio id="noQuaMusic" loop>
    <source src="MUSIC_URL_PH" type="audio/mp4">
    <source src="MUSIC_URL_PH" type="audio/mpeg">
  </audio>

<script>
// ── FIRE ─────────────────────────────────────────────────────
(function(){
  var cv=document.getElementById('fireCanvas'),ctx=cv.getContext('2d'),pts=[],MAX=45,W,H=260;
  function rsz(){ W=cv.width=window.innerWidth; cv.height=H; }
  rsz(); window.addEventListener('resize',rsz);
  var ems=[0,.14,.28,.5,.72,.86,1];
  function rnd(a,b){ return a+Math.random()*(b-a); }
  function spn(){ return {x:(ems[Math.floor(Math.random()*ems.length)]+rnd(-.05,.05))*W,
    y:H,vx:rnd(-.8,.8),vy:rnd(-3.5,-2),sz:rnd(14,28),life:1,dec:rnd(.016,.028)}; }
  function draw(){
    ctx.clearRect(0,0,W,H);
    var add=Math.min(3,MAX-pts.length);
    for(var s=0;s<add;s++) pts.push(spn());
    for(var i=pts.length-1;i>=0;i--){
      var p=pts[i];
      p.x+=p.vx; p.y+=p.vy; p.vy-=.06; p.vx+=rnd(-.25,.25); p.sz*=.974; p.life-=p.dec;
      if(p.life<=0||p.sz<1.5){ pts.splice(i,1); continue; }
      var l=p.life,r,g,b;
      if(l>.65){ r=255;g=Math.floor((1-l)*130);b=0; }
      else if(l>.35){ r=255;g=Math.floor(80+(0.65-l)*420);b=0; }
      else{ r=255;g=210;b=Math.floor((0.35-l)*180); }
      var gd=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.sz);
      gd.addColorStop(0,'rgba('+r+','+g+','+b+','+(l*.9)+')');
      gd.addColorStop(.5,'rgba('+r+','+(g>40?g-40:0)+',0,'+(l*.5)+')');
      gd.addColorStop(1,'rgba(255,30,0,0)');
      ctx.beginPath(); ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);
      ctx.fillStyle=gd; ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ── DATA ──────────────────────────────────────────────────────
var QUEUE_DATA     = QUEUE_DATA_PH;
var BATCH_STATE    = BATCH_STATE_PH;
var READY_BATCH    = READY_BATCH_PH;
var BATCH_DURATION = BATCH_DURATION_PH;

// ── Expiration loop fix: remember IDs we already expired ──────
var clientExpiredIds = {};

// ── AUDIO ─────────────────────────────────────────────────────
var noQuaAudio = document.getElementById('noQuaMusic');
var bgMusic    = document.getElementById('bgMusic');
var nqPlaying  = false;

function toggleMusic(){
  var btn=document.getElementById('musicBtn'), lbl=document.getElementById('musicLbl');
  if(!nqPlaying){
    noQuaAudio.play().then(function(){ nqPlaying=true; btn.classList.add('playing'); lbl.textContent='PAUSE MUSIC'; }).catch(function(){});
  } else {
    noQuaAudio.pause(); nqPlaying=false; btn.classList.remove('playing'); lbl.textContent='PLAY MUSIC';
  }
}
document.getElementById('soundBtn').addEventListener('click',function(){
  bgMusic.play().catch(function(){});
});

// ── BG COLOR PULSE ────────────────────────────────────────────
var COLORS=['#FF69B4','#8B5CF6','#3B82F6'], ci=0, colorBg=document.getElementById('colorBg');
function updateBg(){
  var c=COLORS[ci]; colorBg.style.background='radial-gradient(ellipse at center,'+c+'40 0%,#0f0f1a 70%)';
  colorBg.style.boxShadow='inset 0 0 150px '+c+'60'; ci=(ci+1)%COLORS.length;
}
updateBg(); setInterval(updateBg,1000);

// ── HELPERS ───────────────────────────────────────────────────
var isUnlocked=false;
var enterBtn=document.getElementById('enterBtn');
var blurOverlay=document.getElementById('blurOverlay');
var barsContainer=document.getElementById('barsContainer');

function pad(n){ return String(n).padStart(2,'0'); }
function fmtMs(ms){ var s=Math.max(0,Math.floor(ms/1000)); return pad(Math.floor(s/60))+':'+pad(s%60); }
function pct(e,d){ return Math.min(100,Math.max(0,(e/d)*100)); }

function bStatus(item,bs){
  var now=Date.now(), rt=new Date(item.releaseTime).getTime();
  if(bs&&bs.active&&bs.itemId===item.id){
    var st=bs.startTimeMs||new Date(bs.startTime||0).getTime();
    return (now-st)>=BATCH_DURATION?'expired':'active';
  }
  return rt<=now?'active':'waiting';
}

function makeCard(item,idx,bs){
  var now=Date.now(), rt=new Date(item.releaseTime).getTime();
  var status=bStatus(item,bs), timer='00:00', p=0, tcls='', stxt='', badge='QUEUED';
  if(bs&&bs.active&&bs.itemId===item.id){
    var st=bs.startTimeMs||new Date(bs.startTime||0).getTime();
    var el=now-st, rem=Math.max(0,BATCH_DURATION-el);
    timer=fmtMs(rem); p=pct(el,BATCH_DURATION);
    tcls=rem<=30000?'urgent':rem<=60000?'warning':'';
    stxt=rem<=0?'EXPIRED':'LIVE - HURRY!'; badge='LIVE';
  } else if(rt<=now){
    var le=now-rt, lr=Math.max(0,BATCH_DURATION-le);
    timer=fmtMs(lr); p=pct(le,BATCH_DURATION);
    tcls=lr<=30000?'urgent':lr<=60000?'warning':'';
    stxt=lr<=0?'EXPIRED':'LIVE - HURRY!'; badge='LIVE';
  } else {
    timer=fmtMs(rt-now); stxt=idx===0?'NEXT UP':'COUNTDOWN';
  }
  var h='<div class="bar-card '+status+'" data-id="'+item.id+'" data-url="'+(item.url||'')+'">';
  h+='<div class="bar-header"><span class="bar-badge">'+badge+'</span></div>';
  h+='<div class="bar-title">'+(item.title||'Untitled')+'</div>';
  h+='<div class="bar-subtitle">Qua '+(idx+1)+'</div>';
  h+='<div class="bar-prog-wrap"><div class="bar-prog" style="width:'+p+'%"></div></div>';
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
  barsContainer.innerHTML=sorted.map(function(itm,i){ return makeCard(itm,i,BATCH_STATE); }).join('');
}

// ── EXPIRATION (fires once per item ID) ───────────────────────
var reloadPending=false;
function expireItem(id){
  if(reloadPending||clientExpiredIds[id]) return;
  clientExpiredIds[id]=true;
  reloadPending=true;
  fetch('/api/delete',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:id}),
    keepalive:true
  }).finally(function(){
    setTimeout(function(){ location.reload(); },1200);
  });
}

function updateTimers(){
  var now=Date.now();
  var cards=document.querySelectorAll('.bar-card');
  for(var ci2=0;ci2<cards.length;ci2++){
    var card=cards[ci2], id=card.dataset.id;
    var item=null;
    for(var qi=0;qi<QUEUE_DATA.length;qi++){
      if(QUEUE_DATA[qi].id===id){ item=QUEUE_DATA[qi]; break; }
    }
    if(!item) continue;
    var te=card.querySelector('.bar-timer');
    var pe=card.querySelector('.bar-prog');
    var se=card.querySelector('.bar-status');
    var be=card.querySelector('.bar-badge');
    if(!te) continue;
    var rt=new Date(item.releaseTime).getTime();

    if(BATCH_STATE&&BATCH_STATE.active&&BATCH_STATE.itemId===id){
      var st=BATCH_STATE.startTimeMs||new Date(BATCH_STATE.startTime||0).getTime();
      var el=now-st, rem=Math.max(0,BATCH_DURATION-el);
      te.textContent=fmtMs(rem); pe.style.width=pct(el,BATCH_DURATION)+'%';
      te.className='bar-timer'+(rem<=30000?' urgent':rem<=60000?' warning':'');
      if(rem<=0){ se.textContent='EXPIRED'; card.className='bar-card expired'; expireItem(id); }
      else se.textContent='LIVE - HURRY!';
    } else {
      var diff=rt-now;
      if(diff<=0){
        var le=now-rt, lr=Math.max(0,BATCH_DURATION-le);
        if(le>=BATCH_DURATION){
          te.textContent='00:00'; pe.style.width='100%';
          card.className='bar-card expired'; se.textContent='EXPIRED'; expireItem(id); continue;
        }
        te.textContent=fmtMs(lr); pe.style.width=pct(le,BATCH_DURATION)+'%';
        te.className='bar-timer'+(lr<=30000?' urgent':lr<=60000?' warning':'');
        card.classList.remove('waiting'); card.classList.add('active');
        if(be) be.textContent='LIVE';
        if(!card.querySelector('.bar-enter-btn')){
          var eb=document.createElement('button');
          eb.className='bar-enter-btn'; eb.dataset.url=card.dataset.url||'';
          eb.innerHTML='ENTER NOW &#8594;'; card.appendChild(eb);
        }
        enterBtn.classList.add('show');
        if(lr<=0){ se.textContent='EXPIRED'; card.className='bar-card expired'; expireItem(id); }
        else se.textContent='LIVE - HURRY!';
      } else {
        te.textContent=fmtMs(diff); pe.style.width='0%';
      }
    }
  }
}

// ── UNLOCK ────────────────────────────────────────────────────
function unlock(){
  if(isUnlocked) return;
  isUnlocked=true; blurOverlay.classList.add('unlocked');
  bgMusic.play().catch(function(){}); enterBtn.classList.remove('show');
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

// ── INIT ──────────────────────────────────────────────────────
renderBars();
if(BATCH_STATE&&BATCH_STATE.active) enterBtn.classList.add('show');
if(READY_BATCH&&READY_BATCH.ready)  enterBtn.classList.add('show');
document.getElementById('qCount').textContent=(QUEUE_DATA&&QUEUE_DATA.length)||0;
if(!QUEUE_DATA||!QUEUE_DATA.length){
  document.getElementById('noQua').classList.add('show');
  blurOverlay.style.display='none';
  document.getElementById('topCtrl').style.display='none';
  enterBtn.style.display='none';
}

// RAF tick
var lastTick=0;
(function tick(ts){
  if(ts-lastTick>=1000){ lastTick=ts; updateTimers(); }
  requestAnimationFrame(tick);
})(0);

// ── VIEWER PING ───────────────────────────────────────────────
var vEl=document.getElementById('vCount');
function pingV(){
  fetch('/api/viewers/ping',{method:'POST',keepalive:true})
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(d){ if(d&&d.count) vEl.textContent=d.count; })
    .catch(function(){});
}
pingV(); setInterval(pingV,15000);
window.addEventListener('beforeunload',function(){
  fetch('/api/viewers/leave',{method:'POST',keepalive:true}).catch(function(){});
});

// ── ANNOUNCEMENTS ─────────────────────────────────────────────
var annBar=document.getElementById('annBar');
var annMsg=document.getElementById('annMsg');
var lastAnnId=null, hideTimer=null;

function beep(){
  try{
    var ac=new(window.AudioContext||window.webkitAudioContext)();
    var o=ac.createOscillator(),g=ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type='sine'; o.frequency.setValueAtTime(880,ac.currentTime);
    g.gain.setValueAtTime(0,ac.currentTime);
    g.gain.linearRampToValueAtTime(0.4,ac.currentTime+0.05);
    g.gain.linearRampToValueAtTime(0,ac.currentTime+0.6);
    o.start(ac.currentTime); o.stop(ac.currentTime+0.65);
  }catch(e){}
}
function showAnn(text,id){
  if(lastAnnId===id) return; lastAnnId=id;
  if(hideTimer) clearTimeout(hideTimer);
  annMsg.textContent=text;
  annBar.style.display='block';
  requestAnimationFrame(function(){ annBar.classList.remove('hiding'); annBar.classList.add('visible'); });
  beep();
  document.getElementById('topCtrl').style.marginTop='3.5rem';
  hideTimer=setTimeout(hideAnn,12000);
}
function hideAnn(){
  annBar.classList.add('hiding'); annBar.classList.remove('visible');
  document.getElementById('topCtrl').style.marginTop='';
  setTimeout(function(){ annBar.style.display='none'; },650);
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
    .q-item{background:rgba(255,255,255,.03);border-radius:12px;padding:1.25rem;
      border:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;
      align-items:flex-start;flex-wrap:wrap;gap:1rem}
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
    input{width:100%;padding:.85rem 1rem;font-size:1rem;color:#fff;
      background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
      border-radius:10px;outline:none;transition:all .3s}
    input:focus{border-color:#8B5CF6;box-shadow:0 0 20px rgba(139,92,246,.2)}
    .btn{padding:1rem;font-family:'Orbitron',monospace;font-size:.85rem;font-weight:600;
      border-radius:10px;cursor:pointer;transition:all .3s;border:none}
    .btn-pri{background:linear-gradient(135deg,#FF69B4,#8B5CF6);color:#fff;flex:1}
    .btn-sec{background:rgba(139,92,246,.2);color:#8B5CF6;border:1px solid #8B5CF6}
    .btn-sec:hover{background:#8B5CF6;color:#fff}
    .add-btn{background:linear-gradient(135deg,#FF69B4,#8B5CF6);color:#fff;border:none;
      padding:1rem 2rem;border-radius:50px;font-family:'Orbitron',monospace;font-weight:700;
      cursor:pointer;transition:all .3s;margin-top:1rem}
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
        <span id="qStat" class="bdg bdg-pk">0 releases</span>
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
          <input type="text" id="annIn" placeholder="e.g. Magastart na!" maxlength="200">
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
function sortQ(a){ return a.slice().sort(function(x,y){ return new Date(x.releaseTime).getTime()-new Date(y.releaseTime).getTime(); }); }
function api(url,opts){ return fetch(url,opts).then(function(r){ return r.json(); }); }
function loadQ(){ return api('/api/queue').then(function(d){ if(Array.isArray(d)) queue=d; }); }
function saveQ(){ return api('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(queue)}); }

function showForm(t){ document.getElementById('formTitle').textContent=t; document.getElementById('listView').style.display='none'; document.getElementById('formView').style.display=''; }
function showList(){ document.getElementById('listView').style.display=''; document.getElementById('formView').style.display='none'; editId=null; }

function attachEv(){
  document.querySelectorAll('.ic-d').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=btn.dataset.id;
      if(!confirm('Delete this release?')) return;
      queue=queue.filter(function(c){ return c.id!==id&&c.batchId!==id; });
      api('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})});
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
  var list=document.getElementById('qList'), stat=document.getElementById('qStat');
  var sorted=sortQ(queue);
  var active=sorted.filter(function(c){ return !isReleased(c.releaseTime); });
  var done=sorted.filter(function(c){ return isReleased(c.releaseTime); });
  if(!queue.length){
    list.innerHTML='<div class="empty"><p>No releases yet.</p><button class="add-btn" id="addBtn">+ ADD RELEASE</button></div>';
    stat.textContent='0 releases'; stat.className='bdg bdg-pk'; attachEv(); return;
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
  attachEv();
}

document.getElementById('btnCancel').addEventListener('click',showList);
document.getElementById('btnSave').addEventListener('click',function(){
  var title=document.getElementById('fTitle').value.trim();
  var url=document.getElementById('fUrl').value.trim();
  var batch=document.getElementById('fBatch').value.trim()||'qua1';
  var date=document.getElementById('fDate').value;
  var time=document.getElementById('fTime').value;
  if(!title||!url||!date||!time){ alert('Fill all fields'); return; }
  var releaseTime=new Date(date+'T'+time+':00+08:00').toISOString();
  if(editId){
    for(var i=0;i<queue.length;i++){
      if(queue[i].id===editId){ queue[i].title=title; queue[i].url=url; queue[i].batchId=batch; queue[i].releaseTime=releaseTime; break; }
    }
  } else {
    queue.push({id:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6),batchId:batch,title:title,url:url,releaseTime:releaseTime});
  }
  saveQ().then(function(d){
    if(d&&d.success){ showList(); render(); } else { alert('Failed to save!'); }
  }).catch(function(){ alert('Network error'); });
});

function refreshV(){
  api('/api/viewers/count').then(function(d){
    if(d&&typeof d.count!=='undefined')
      document.getElementById('vBadge').textContent=d.count+' viewer'+(d.count!==1?'s':'');
  }).catch(function(){});
}
refreshV(); setInterval(refreshV,15000);

document.getElementById('btnSend').addEventListener('click',function(){
  var msg=document.getElementById('annIn').value.trim();
  if(!msg){ alert('Enter a message first'); return; }
  var st=document.getElementById('annSt'); st.textContent='Sending...';
  api('/api/announce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:true,message:msg})})
    .then(function(d){ st.textContent=d.success?'Sent!':'Failed.'; st.style.color=d.success?'#22c55e':'#ef4444'; })
    .catch(function(){ st.textContent='Error'; st.style.color='#ef4444'; });
});
document.getElementById('btnClear').addEventListener('click',function(){
  document.getElementById('annIn').value='';
  var st=document.getElementById('annSt');
  api('/api/announce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:false,message:''})})
    .then(function(){ st.textContent='Cleared.'; st.style.color='#a0a0b0'; }).catch(function(){});
});

loadQ().then(render);
<\/script>
</body>
</html>`;
}
