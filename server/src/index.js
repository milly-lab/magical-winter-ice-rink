// Winterwood Ice Rink — multiplayer server (Phase 1: connection only)
//
// Cloudflare Worker ("gatekeeper") + one Durable Object ("RinkRoom") that owns the shared rink.
//
//   browser ──wss://…/ws──► Worker: checks the path, the Upgrade header and the page's Origin
//                             └──► RinkRoom (one instance, name "main-rink"): accepts the WebSocket
//
// Phase 1 scope: accept a connection, give it an id, answer hello / echo test messages, and protect the
// free plan (room capacity, message size, per-connection rate limit, two-step daily message budget).
//
// Daily budget (Workers Free plan: 100,000 Durable Object requests/day; incoming WebSocket messages are billed
// 20:1 and every new connection counts as 1 request, so the free day ≈ 2,000,000 message units):
//   · soft limit = DAILY_MESSAGE_BUDGET (wrangler.jsonc, 1,600,000 = 80%): new players are refused, players who are
//     already in keep playing and get one "daily-limit-soon" notice (the room is not cut off suddenly);
//   · hard limit = 95% of the free day (never below the soft limit): every connection is closed with 4002, so the
//     room can never run the free allowance dry. Limits reset at 00:00 UTC (09:00 KST).
// The counter is saved every 100 units (every 20 above the soft limit). When the room wakes from hibernation the
// last unsaved units are unknown, so one full save interval is added — the counter can only run ahead, never behind.
// NOT implemented yet: player state, movement relay, avatars, interaction requests (later phases).
//
// Nothing secret lives here: allowed origins and limits are plain settings in wrangler.jsonc ("vars").

import { DurableObject } from 'cloudflare:workers';

const ROOM_NAME = 'main-rink';          // a single shared rink for now
const MAX_MESSAGE_BYTES = 1024;         // UTF-8 bytes; test messages are tiny, anything bigger is refused
const RATE_WINDOW_MS = 1000;            // per-connection rate limit window…
const RATE_MAX = 15;                    // …max messages per window (later movement needs ≤ 8/s)
const FREE_UNITS_PER_DAY = 100000 * 20; // free Durable Object requests/day × 20 incoming messages per billed request
const HARD_SHARE = 0.95;                // hard stop at 95% of the free day
const CONNECT_UNITS = 20;               // a new connection is 1 billed request = 20 message units
const SAVE_EVERY = 100;                 // persist the counter every N units (≈ 20,000 rows written/day at most)…
const SAVE_EVERY_NEAR_LIMIT = 20;       // …and more often once past the soft limit (more precise near the hard stop)
const utf8 = new TextEncoder();

// ---------- helpers ----------
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;                                   // browsers always send Origin on WebSocket upgrades
  const self = new URL(request.url).origin;                    // the Worker's own /test page
  return origin === self || allowedOrigins(env).includes(origin);
}
const utcDay = () => new Date().toISOString().slice(0, 10);   // free-plan limits reset at 00:00 UTC (09:00 KST)
const json = (obj) => JSON.stringify(obj);

// ---------- Worker: routes requests ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.method !== 'GET') return new Response('Expected GET', { status: 405 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected Upgrade: websocket', { status: 426 });
      if (!originAllowed(request, env)) return new Response('Origin not allowed', { status: 403 });
      return env.RINK.getByName(ROOM_NAME).fetch(request);
    }

    if (url.pathname === '/test') {                            // tiny manual test page (same origin → allowed)
      return new Response(TEST_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/') {
      return new Response('Winterwood Ice Rink server is running.\nWebSocket: /ws\nTest page: /test\n',
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return new Response('Not found', { status: 404 });
  },
};

// ---------- Durable Object: the shared rink room ----------
export class RinkRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.maxPlayers = Math.max(1, Number(env.MAX_PLAYERS) || 4);
    this.softLimit = Math.max(1000, Number(env.DAILY_MESSAGE_BUDGET) || 1600000);
    this.hardLimit = Math.max(this.softLimit, Math.floor(FREE_UNITS_PER_DAY * HARD_SHARE));
    // "ping" → "pong" is answered by Cloudflare itself: free, and it does not wake the room from hibernation
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // daily incoming-message counter (memory is cleared when the room hibernates, so it is reloaded here)
    this.day = utcDay();
    this.count = 0;
    this.unsaved = 0;
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get('usage');
      // waking up: up to one save interval may have been used but not saved → assume it was (stay on the safe side)
      if (saved && saved.day === this.day) { this.count = saved.count + (saved.every || SAVE_EVERY); this.unsaved = saved.every || SAVE_EVERY; }
    });
  }

  _rollDay() {
    const d = utcDay();
    if (d !== this.day) { this.day = d; this.count = 0; this.unsaved = 0; }
  }
  _use(units) { this._rollDay(); this.count += units; this.unsaved += units; }
  async _save(force = false) {
    const every = this.count >= this.softLimit ? SAVE_EVERY_NEAR_LIMIT : SAVE_EVERY;
    if (!force && this.unsaved < every) return;
    this.unsaved = 0;
    await this.ctx.storage.put('usage', { day: this.day, count: this.count, every });   // 1 row written
  }
  // hard stop: everyone is told why and disconnected; new players are refused until the daily reset
  async _stopAll() {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(json({ t: 'refused', reason: 'daily-limit' })); ws.close(4002, 'daily-limit'); } catch { /* already closing */ }
    }
    await this._save(true);
  }
  _players() {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() || {}).joined);
  }

  async fetch(request) {
    this._use(CONNECT_UNITS);                                  // every connection attempt is a billed request
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    // refuse politely (the client can read the reason): room full, or today's free budget nearly used up
    let refuse = null;
    if (this.count >= this.softLimit) refuse = { code: 4002, reason: 'daily-limit' };
    else if (this._players().length >= this.maxPlayers) refuse = { code: 4001, reason: 'room-full' };
    if (refuse) {
      server.send(json({ t: 'refused', reason: refuse.reason }));
      server.close(refuse.code, refuse.reason);
      await this._save();
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = crypto.randomUUID();                             // full 128-bit UUID chosen by the server: clients can never pick or overwrite one
    server.serializeAttachment({ id, joined: true, since: Date.now(), win: 0, n: 0 });
    server.send(json({ t: 'welcome', id, players: this._players().length, max: this.maxPlayers }));
    await this._save();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const wasBelowSoft = this.count < this.softLimit;
    this._use(1);
    // hard stop reached: close every connection (also covers clients that keep sending after the soft limit)
    if (this.count >= this.hardLimit) { await this._stopAll(); return; }
    const a = ws.deserializeAttachment() || {};
    // soft limit just crossed: players already inside keep playing; tell each of them once
    if (wasBelowSoft && this.count >= this.softLimit) {
      for (const s of this._players()) { try { s.send(json({ t: 'notice', reason: 'daily-limit-soon' })); } catch { /* closing */ } }
    }
    // per-connection rate limit: a client that floods is disconnected (dropped messages would still be billed)
    const now = Date.now();
    if (now - (a.win || 0) > RATE_WINDOW_MS) { a.win = now; a.n = 0; }
    a.n = (a.n || 0) + 1;
    ws.serializeAttachment(a);
    if (a.n > RATE_MAX) { ws.close(4008, 'rate-limit'); await this._save(true); return; }
    // real UTF-8 size (Korean text is 3 bytes per character); .length alone would let ~3 KB through
    const size = typeof message === 'string'
      ? (message.length > MAX_MESSAGE_BYTES ? message.length : utf8.encode(message).length)   // length ≤ bytes: no need to encode huge strings
      : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) { ws.close(1009, 'too-big'); await this._save(); return; }
    if (typeof message !== 'string') { ws.send(json({ t: 'error', reason: 'text-only' })); return; }

    let msg;
    try { msg = JSON.parse(message); } catch { ws.send(json({ t: 'error', reason: 'bad-json' })); return; }

    if (msg && msg.t === 'hello') {
      ws.send(json({ t: 'hello-ok', id: a.id, players: this._players().length, max: this.maxPlayers, serverTime: now }));
    } else if (msg && msg.t === 'echo') {
      ws.send(json({ t: 'echo', id: a.id, data: String(msg.data ?? '').slice(0, 200), serverTime: now }));
    } else {
      ws.send(json({ t: 'error', reason: 'unknown-type' }));   // movement / interactions arrive in later phases
    }
    await this._save();
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* already closed */ }
    await this._save(true);
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch { /* already closed */ }
  }
}

// ---------- manual test page (served at /test) ----------
const TEST_PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Winterwood rink server test</title>
<style>
  body { margin: 0; padding: 20px; background: #0a1330; color: #f0f6fc; font: 15px/1.5 -apple-system, "Apple SD Gothic Neo", sans-serif; }
  button { margin: 4px 6px 4px 0; padding: 10px 16px; border-radius: 999px; border: 1px solid rgba(243,217,184,.45);
    background: rgba(6,12,26,.6); color: #f0f6fc; font: inherit; }
  pre { background: rgba(0,0,0,.35); padding: 12px; border-radius: 10px; white-space: pre-wrap; min-height: 160px; }
</style></head><body>
<h3>윈터우드 아이스링크 서버 연결 테스트</h3>
<button id="c">연결</button><button id="h">hello 보내기</button><button id="e">echo 보내기</button><button id="p">ping</button><button id="x">연결 끊기</button>
<pre id="log"></pre>
<script>
  const log = (s) => { document.getElementById('log').textContent += new Date().toLocaleTimeString() + '  ' + s + '\\n'; };
  let ws = null;
  document.getElementById('c').onclick = () => {
    if (ws && ws.readyState <= 1) return log('이미 연결되어 있어요');
    ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws');
    ws.onopen = () => log('연결됨');
    ws.onmessage = (ev) => log('받음: ' + ev.data);
    ws.onclose = (ev) => log('끊김 (code ' + ev.code + (ev.reason ? ', ' + ev.reason : '') + ')');
    ws.onerror = () => log('오류');
  };
  const send = (o) => { if (!ws || ws.readyState !== 1) return log('먼저 연결하세요'); ws.send(typeof o === 'string' ? o : JSON.stringify(o)); log('보냄: ' + (typeof o === 'string' ? o : JSON.stringify(o))); };
  document.getElementById('h').onclick = () => send({ t: 'hello' });
  document.getElementById('e').onclick = () => send({ t: 'echo', data: '안녕 링크장' });
  document.getElementById('p').onclick = () => send('ping');
  document.getElementById('x').onclick = () => ws && ws.close(1000, 'bye');
</script></body></html>`;
