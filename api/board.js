// Rozet tablosu: herkesin takma adı + kaç rozet topladığı. En çok rozet en üstte.
// GET  /api/board?me=KOD → {items:[{name,n,ids,at,mine}], me:{rank}}
// POST /api/board {code,name,badges:[id…]} → kendi satırını güncelle (hesap gerekli)
const crypto = require("crypto");
const { redis, CODE_RE, cleanCode, overLimit, send } = require("./_lib");
const KEY = "board", BANNED = "lib:banned";
const IDS = ["first_topic","streak3","streak7","h10","h50","week15","course_done","kurul_done","grade"];
const owner = code => crypto.createHash("sha256").update("lib:" + code).digest("hex").slice(0, 16);
const clip = (s, n) => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (req.method === "GET") {
      const me = q.me ? owner(cleanCode(q.me)) : null;
      const h = await redis("HGETALL", KEY) || [];
      const rows = []; for (let i = 0; i < h.length; i += 2) { const r = JSON.parse(h[i + 1]); if (r.n > 0) rows.push({ ...r, mine: h[i] === me }); }
      rows.sort((a, b) => b.n - a.n || a.at - b.at);
      const rank = rows.findIndex(r => r.mine);
      return send(res, 200, { items: rows.slice(0, 50), total: rows.length, me: rank >= 0 ? { rank: rank + 1, ...rows[rank] } : null });
    }
    if (req.method === "POST") {
      const code = cleanCode(b.code);
      if (!CODE_RE.test(code) || !(await redis("GET", `u:${code}`))) return send(res, 403, { error: "Giriş yapmalısın." });
      if (await overLimit(`rl:board:${code}:${new Date().toISOString().slice(0, 13)}`, 60, 3600)) return send(res, 429, { error: "Çok sık." });
      const by = owner(code);
      if (await redis("SISMEMBER", BANNED, by)) { await redis("HDEL", KEY, by); return send(res, 200, { ok: true }); }
      const ids = [...new Set((Array.isArray(b.badges) ? b.badges : []).filter(x => IDS.includes(x)))];
      const name = clip(b.name, 24);
      if (!name) return send(res, 400, { error: "Takma ad gerekli." });
      const cur = JSON.parse(await redis("HGET", KEY, by) || "null");
      const at = cur && cur.n === ids.length ? cur.at : Date.now();   // aynı sayıdaysa ilk ulaşan önde
      await redis("HSET", KEY, by, JSON.stringify({ name, n: ids.length, ids, at }));
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: "Desteklenmeyen istek" });
  } catch (e) { send(res, 500, { error: e.message }); }
};
