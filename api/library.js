// Hazır kurul kütüphanesi (herkese açık)
// GET    /api/library?me=KOD            → liste (kurul kodları olmadan); me = ADMIN_CODE ise admin:true
// GET    /api/library?id=XXXX           → tek kurulun kurul kodu (KRL1…)
// POST   /api/library {code,name,school,data} → kütüphaneye ekle (hesap kodu gerekli, yasaklı değilse)
// POST   /api/library {action:"restore",code,id} → silineni geri al (10 dk içinde; yasak da kalkar)
// GET    /api/library?me=ADMIN&bans=1 → yasaklılar listesi (sadece admin)
// POST   /api/library {action:"unban",code,by} → yasağı kaldır (sadece admin)
// DELETE /api/library {code,id,ban}     → sil (paylaşan ya da admin). ban:true (sadece admin) → paylaşanı yasakla
const crypto = require("crypto");
const { redis, CODE_RE, cleanCode, ipOf, overLimit, send, today } = require("./_lib");
const LIST = "lib:list", BANNED = "lib:banned", BANS = "lib:bans";
const MAX_DATA = 300 * 1024, MAX_ITEMS = 300, TRASH_TTL = 600;
const owner = code => crypto.createHash("sha256").update("lib:" + code).digest("hex").slice(0, 16);
const ipHash = req => "ip:" + crypto.createHash("sha256").update("libip:" + ipOf(req)).digest("hex").slice(0, 16);
const clip = (s, n) => String(s || "").replace(/[<>]/g, "").trim().slice(0, n);
const isAdmin = code => !!process.env.ADMIN_CODE && !!code && code === cleanCode(process.env.ADMIN_CODE);

module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (req.method === "GET") {
      if (q.id) {
        const raw = await redis("GET", `lib:item:${clip(q.id, 20)}`);
        if (!raw) return send(res, 404, { error: "Bu kurul kütüphanede yok." });
        return send(res, 200, JSON.parse(raw));
      }
      const meCode = q.me ? cleanCode(q.me) : "";
      if (q.bans) {
        if (!isAdmin(meCode)) return send(res, 403, { error: "Sadece yönetici." });
        const h = await redis("HGETALL", BANS) || [];
        const bans = []; for (let i = 0; i < h.length; i += 2) bans.push({ by: h[i], ...JSON.parse(h[i + 1]) });
        bans.sort((a, b) => b.at - a.at);
        return send(res, 200, { bans: bans.map(({ ip, ...x }) => x) });
      }
      const me = meCode ? owner(meCode) : null;
      const items = (await redis("LRANGE", LIST, 0, MAX_ITEMS - 1) || []).map(x => JSON.parse(x));
      return send(res, 200, { admin: isAdmin(meCode), items: items.map(({ by, ip, ...it }) => ({ ...it, mine: !!me && by === me })) });
    }
    if (req.method === "POST" && b.action === "unban") {
      if (!isAdmin(cleanCode(b.code))) return send(res, 403, { error: "Sadece yönetici." });
      const by = clip(b.by, 40), raw = await redis("HGET", BANS, by);
      await redis("SREM", BANNED, by);
      if (raw) { const r = JSON.parse(raw); if (r.ip) await redis("SREM", BANNED, r.ip); }
      await redis("HDEL", BANS, by);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && b.action === "restore") {
      const code = cleanCode(b.code), id = clip(b.id, 20);
      const raw = await redis("GET", `lib:trash:${id}`);
      if (!raw) return send(res, 404, { error: "Geri alma süresi doldu." });
      const t = JSON.parse(raw), meta = JSON.parse(t.meta);
      if (!isAdmin(code) && meta.by !== owner(code)) return send(res, 403, { error: "Yetkin yok." });
      await redis("SET", `lib:item:${id}`, t.item);
      await redis("LPUSH", LIST, t.meta);
      await redis("LTRIM", LIST, 0, MAX_ITEMS - 1);
      if (t.banned) { await redis("SREM", BANNED, meta.by); if (meta.ip) await redis("SREM", BANNED, meta.ip); await redis("HDEL", BANS, meta.by); }
      await redis("DEL", `lib:trash:${id}`);
      return send(res, 200, { ok: true, id });
    }
    if (req.method === "POST") {
      const code = cleanCode(b.code);
      if (!CODE_RE.test(code) || !(await redis("GET", `u:${code}`))) return send(res, 403, { error: "Paylaşmak için giriş yapmış olmalısın." });
      const ip = ipHash(req);
      if (!isAdmin(code) && ((await redis("SISMEMBER", BANNED, owner(code))) || (await redis("SISMEMBER", BANNED, ip))))
        return send(res, 403, { error: "Kütüphaneye paylaşman yönetici tarafından engellendi." });
      const data = String(b.data || "");
      if (!/^KRL[01]\.[A-Za-z0-9_-]+$/.test(data) || data.length > MAX_DATA) return send(res, 400, { error: "Geçersiz kurul verisi." });
      const name = clip(b.name, 90), school = clip(b.school, 90);
      if (!name) return send(res, 400, { error: "Kurul adı gerekli." });
      if (await overLimit(`rl:lib:${ipOf(req)}:${today()}`, 10, 86400)) return send(res, 429, { error: "Bugün çok fazla paylaşım yapıldı." });
      const id = crypto.randomBytes(5).toString("hex");
      const meta = { id, name, school, courses: Math.min(99, +b.courses || 0), topics: Math.min(9999, +b.topics || 0), sessions: Math.min(9999, +b.sessions || 0), createdAt: Date.now(), by: owner(code), ip };
      await redis("SET", `lib:item:${id}`, JSON.stringify({ id, name, data }));
      await redis("LPUSH", LIST, JSON.stringify(meta));
      await redis("LTRIM", LIST, 0, MAX_ITEMS - 1);
      return send(res, 200, { ok: true, id });
    }
    if (req.method === "DELETE") {
      const code = cleanCode(b.code), id = clip(b.id, 20), admin = isAdmin(code);
      const items = await redis("LRANGE", LIST, 0, MAX_ITEMS - 1) || [];
      const raw = items.find(x => JSON.parse(x).id === id);
      if (!raw) return send(res, 404, { error: "Bulunamadı." });
      const meta = JSON.parse(raw);
      if (!admin && meta.by !== owner(code)) return send(res, 403, { error: "Sadece paylaşan kişi silebilir." });
      const ban = !!b.ban && admin;
      const item = await redis("GET", `lib:item:${id}`);
      await redis("SET", `lib:trash:${id}`, JSON.stringify({ meta: raw, item, banned: ban }), "EX", TRASH_TTL);
      await redis("LREM", LIST, 1, raw);
      await redis("DEL", `lib:item:${id}`);
      if (ban) {
        await redis("SADD", BANNED, meta.by); if (meta.ip) await redis("SADD", BANNED, meta.ip);
        await redis("HSET", BANS, meta.by, JSON.stringify({ at: Date.now(), name: meta.name, school: meta.school || "", ip: meta.ip || "" }));
      }
      return send(res, 200, { ok: true, banned: ban });
    }
    send(res, 405, { error: "Desteklenmeyen istek" });
  } catch (e) { send(res, 500, { error: e.message }); }
};
