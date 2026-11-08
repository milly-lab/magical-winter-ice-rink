// Winterwood Ice Rink — multiplayer server (Phase 1: connection · Phase 5: players + movement relay)
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
//
// Phase 5 (2026-11-06) — basic multiplayer sync. Protocol (JSON text; "ping"/"pong" and hello/hello-ok unchanged):
//   client → server
//     {t:"join", nick, style:"skater"|"girl", color, x, z, h}   enter the rink with a profile + position (again = refresh)
//     {t:"mv", x, z, h, v, f, ts}                                own position / heading / speed / flags / sender clock (ms)
//   server → client
//     {t:"welcome", id, players, max}                            (Phase 1) connection accepted
//     {t:"join-ok", id, players, max, peers:[P…]}                the players already skating (never yourself)
//     {t:"peer", …P}                                             someone entered (or re-sent their profile)
//     {t:"mv", id, x, z, h, v, f, ts}                            someone moved
//     {t:"leave", id, players}                                   someone left / was disconnected
//     {t:"count", players}                                       the number of connected players changed
//   P = {id, nick, style, color, x, z, h, v, f}
// Every value is checked (types, ranges, the 8 top colours, nickname length / characters); bad messages get an
// "error" reply and a client that keeps sending them is disconnected. Nothing is stored permanently: the player
// list is the open connections themselves (their attachments survive hibernation).
// Duplicates / ghosts: each page sends a random session key (?sid=…). A new connection with the same key replaces
// the old one at once (it is closed with 4003 and removed for everyone) — e.g. a phone coming back from the
// background. Connections that went silent (no "ping" and no message for 75 s, e.g. a phone that was locked) are
// removed by a sweep every 30 s, which runs only while someone is connected.
// NOT implemented yet: jumps / spins / interaction requests (later phases).
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
// Phase 5
const SWEEP_MS = 30000;                 // dead-connection sweep interval (only while connections exist; each run = 1 request)
const SILENT_MS = 75000;                // no ping / message for this long → the connection is treated as gone
const BAD_MAX = 20;                     // invalid messages tolerated per connection before it is closed
const NICK_MAX = 8;                     // characters (같은 기준: 한글 1자 = 1)
const STYLES = ['skater', 'girl'];
const TOP_COLORS = [0xf1e8d6, 0xf3cfd4, 0xf5d6bf, 0xf2e6b3, 0xcbe8da, 0xc7dcf2, 0xcfd0f2, 0xe8d2ec];   // = the page's 8 choices
const LIMIT_X = 70, LIMIT_Z = 37;       // a little outside the rink (66.6 × 33.3 half sizes)
const SID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;

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
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi);
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const wrapAngle = (h) => Math.atan2(Math.sin(h), Math.cos(h));
// returns a clean state [x, z, h, v, f] or null
function cleanState(m, needMove) {
  if (!num(m.x, -LIMIT_X, LIMIT_X) || !num(m.z, -LIMIT_Z, LIMIT_Z) || !num(m.h, -1000, 1000)) return null;
  const v = m.v === undefined && !needMove ? 0 : m.v, f = m.f === undefined && !needMove ? 0 : m.f;
  if (!num(v, 0, 30) || !Number.isInteger(f) || f < 0 || f > 255) return null;
  return [r2(m.x), r2(m.z), r3(wrapAngle(m.h)), r2(v), f];
}
function cleanProfile(m) {
  if (typeof m.nick !== 'string' || !STYLES.includes(m.style) || !TOP_COLORS.includes(m.color)) return null;
  const nick = m.nick.normalize('NFC').replace(/\s+/g, ' ').trim();
  const len = Array.from(nick).length;
  if (len < 1 || len > NICK_MAX || utf8.encode(nick).length > 64 || BAD_CHARS.test(nick)) return null;
  return { n: nick, s: m.style, c: m.color };
}
const peerOf = (a) => ({ id: a.id, nick: a.p.n, style: a.p.s, color: a.p.c, x: a.st[0], z: a.st[1], h: a.st[2], v: a.st[3], f: a.st[4] });

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
  _players(except = null) {
    return this.ctx.getWebSockets().filter((ws) => { if (ws === except) return false; const a = ws.deserializeAttachment() || {}; return a.joined && !a.gone; });
  }
  // (Phase 5) players who entered the rink (profile + position), except one
  _skaters(except = null) {
    return this._players(except).filter((ws) => (ws.deserializeAttachment() || {}).p);
  }
  _broadcast(obj, except = null, list = null) {
    const text = json(obj);
    for (const s of list || this._skaters(except)) { if (s !== except) { try { s.send(text); } catch { /* closing */ } } }
  }
  // remove a connection for everyone (left, replaced, silent): tell the others once, then close it
  _drop(ws, code, reason) {
    const a = ws.deserializeAttachment() || {};
    if (a.gone) return;
    a.gone = true;
    try { ws.serializeAttachment(a); } catch { /* closed */ }
    if (a.joined) {
      const rest = this._players(ws), n = rest.length;
      if (a.p) {                                               // skaters remove the avatar; players still choosing get the count
        this._broadcast({ t: 'leave', id: a.id, players: n }, ws, rest.filter((s) => (s.deserializeAttachment() || {}).p));
        this._broadcast({ t: 'count', players: n }, ws, rest.filter((s) => !(s.deserializeAttachment() || {}).p));
      } else this._broadcast({ t: 'count', players: n }, ws, rest);
    }
    if (code) { try { ws.close(code, reason); } catch { /* already closed */ } }
  }
  async _ensureSweep() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  async fetch(request) {
    this._use(CONNECT_UNITS);                                  // every connection attempt is a billed request
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    // (Phase 5) the same page reconnecting (e.g. back from the background): its old connection is replaced first,
    // so it never shows twice and never takes a second place in the room
    const sidRaw = new URL(request.url).searchParams.get('sid') || '';
    const sid = SID_RE.test(sidRaw) ? sidRaw : null;
    if (sid) {
      for (const old of this.ctx.getWebSockets()) {
        if (old !== server && (old.deserializeAttachment() || {}).sid === sid) this._drop(old, 4003, 'replaced');
      }
    }
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
    server.serializeAttachment({ id, joined: true, since: Date.now(), last: Date.now(), win: 0, n: 0, sid, bad: 0, p: null, st: null });
    const players = this._players().length;
    server.send(json({ t: 'welcome', id, players, max: this.maxPlayers }));
    this._broadcast({ t: 'count', players }, server, this._players(server));   // everyone else: one more player
    await this._ensureSweep();
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
    if (a.gone) return;                                        // (replaced / timed out: closing)
    if (now - (a.win || 0) > RATE_WINDOW_MS) { a.win = now; a.n = 0; }
    a.n = (a.n || 0) + 1;
    a.last = now;
    ws.serializeAttachment(a);
    if (a.n > RATE_MAX) { this._drop(ws, 4008, 'rate-limit'); await this._save(true); return; }
    // real UTF-8 size (Korean text is 3 bytes per character); .length alone would let ~3 KB through
    const size = typeof message === 'string'
      ? (message.length > MAX_MESSAGE_BYTES ? message.length : utf8.encode(message).length)   // length ≤ bytes: no need to encode huge strings
      : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) { this._drop(ws, 1009, 'too-big'); await this._save(); return; }
    if (typeof message !== 'string') { ws.send(json({ t: 'error', reason: 'text-only' })); return; }

    let msg;
    try { msg = JSON.parse(message); } catch { ws.send(json({ t: 'error', reason: 'bad-json' })); return; }

    const bad = async (reason) => {                            // invalid data: reply; a client that keeps doing it is closed
      a.bad = (a.bad || 0) + 1;
      ws.serializeAttachment(a);
      if (a.bad > BAD_MAX) { this._drop(ws, 4009, 'bad-data'); await this._save(true); return; }
      ws.send(json({ t: 'error', reason }));
      await this._save();
    };
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { await bad('bad-data'); return; }

    if (msg.t === 'mv') {                                      // (Phase 5) movement: keep the latest, pass it on
      if (!a.p) { await bad('not-joined'); return; }
      const st = cleanState(msg, true);
      if (!st || !(msg.ts === undefined || num(msg.ts, 0, 9007199254740991))) { await bad('bad-data'); return; }
      a.st = st;
      ws.serializeAttachment(a);
      this._broadcast({ t: 'mv', id: a.id, x: st[0], z: st[1], h: st[2], v: st[3], f: st[4], ts: Math.floor(msg.ts || 0) }, ws);
      await this._save();
      return;
    }
    if (msg.t === 'join') {                                    // (Phase 5) enter the rink (sent again after a reconnect / resync)
      const p = cleanProfile(msg), st = cleanState(msg, false);
      if (!p || !st) { await bad('bad-data'); return; }
      a.p = p; a.st = st;
      ws.serializeAttachment(a);
      const others = this._skaters(ws);
      ws.send(json({ t: 'join-ok', id: a.id, players: this._players().length, max: this.maxPlayers,
        peers: others.map((s) => peerOf(s.deserializeAttachment())) }));
      this._broadcast({ t: 'peer', ...peerOf(a) }, ws, others);
      await this._save();
      return;
    }

    if (msg.t === 'hello') {
      ws.send(json({ t: 'hello-ok', id: a.id, players: this._players().length, max: this.maxPlayers, serverTime: now }));
    } else if (msg.t === 'echo') {
      ws.send(json({ t: 'echo', id: a.id, data: String(msg.data ?? '').slice(0, 200), serverTime: now }));
    } else {
      ws.send(json({ t: 'error', reason: 'unknown-type' }));   // interactions arrive in later phases
    }
    await this._save();
  }

  async webSocketClose(ws, code, reason) {
    this._drop(ws, 0);                                         // (Phase 5) gone for everyone else, right away
    try { ws.close(code, reason); } catch { /* already closed */ }
    await this._save(true);
  }

  async webSocketError(ws) {
    this._drop(ws, 1011, 'error');
  }

  // (Phase 5) every 30 s while anyone is connected: remove connections that went silent (no ping, no message)
  async alarm() {
    this._use(CONNECT_UNITS);                                  // an alarm run is a billed request too
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.gone) { try { ws.close(4004, 'timeout'); } catch { /* closed */ } continue; }
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      const last = Math.max(a.last || a.since || 0, pinged ? pinged.getTime() : 0);
      if (now - last > SILENT_MS) this._drop(ws, 4004, 'timeout');
    }
    if (this._players().length) await this.ctx.storage.setAlarm(now + SWEEP_MS);
    await this._save();
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
