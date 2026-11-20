// Not & slayt paylaşımı (link) — dosya sitede tutulmaz, sadece link + bilgiler.
// GET    /api/notes?me=KOD              → liste (sahibi gizli; mine:true/false, admin:true/false)
// POST   /api/notes {code,title,url,course,kurul,kind,name} → paylaş (hesap + takma ad gerekli, yasaklı değil)
// POST   /api/notes {action:"restore",code,id}   → silineni geri al (10 dk içinde; yasak da kalkar)
// DELETE /api/notes {code,id,ban}       → sil (paylaşan ya da admin). ban:true (admin) → paylaşanı yasakla (kütüphaneyle ortak yasak listesi)
const crypto = require("crypto");
const { redis, CODE_RE, cleanCode, ipOf, overLimit, send, today } = require("./_lib");
const LIST = "notes:list", BANNED = "lib:banned", BANS = "lib:bans";
const MAX_ITEMS = 1000, TRASH_TTL = 600;
const KINDS = ["slayt", "not", "soru", "diger"];
const owner = code => crypto.createHash("sha256").update("lib:" + code).digest("hex").slice(0, 16);
const ipHash = req => "ip:" + crypto.createHash("sha256").update("libip:" + ipOf(req)).digest("hex").slice(0, 16);
const clip = (s, n) => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const isAdmin = code => !!process.env.ADMIN_CODE && !!code && code === cleanCode(process.env.ADMIN_CODE);

module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (req.method === "GET") {
      const meCode = q.me ? cleanCode(q.me) : "", me = meCode ? owner(meCode) : null;
      const items = (await redis("LRANGE", LIST, 0, MAX_ITEMS - 1) || []).map(x => JSON.parse(x));
      return send(res, 200, { admin: isAdmin(meCode), items: items.map(({ by, ip, ...it }) => ({ ...it, mine: !!me && by === me })) });
    }
    if (req.method === "POST" && b.action === "restore") {
      const code = cleanCode(b.code), id = clip(b.id, 20);
      const raw = await redis("GET", `notes:trash:${id}`);
      if (!raw) return send(res, 404, { error: "Geri alma süresi doldu." });
      const t = JSON.parse(raw), meta = JSON.parse(t.meta);
      if (!isAdmin(code) && meta.by !== owner(code)) return send(res, 403, { error: "Yetkin yok." });
      await redis("LPUSH", LIST, t.meta);
      await redis("LTRIM", LIST, 0, MAX_ITEMS - 1);
      if (t.banned) { await redis("SREM", BANNED, meta.by); if (meta.ip) await redis("SREM", BANNED, meta.ip); await redis("HDEL", BANS, meta.by); }
      await redis("DEL", `notes:trash:${id}`);
      return send(res, 200, { ok: true, id });
    }
    if (req.method === "POST") {
      const code = cleanCode(b.code);
      if (!CODE_RE.test(code) || !(await redis("GET", `u:${code}`))) return send(res, 403, { error: "Paylaşmak için giriş yapmış olmalısın." });
      const ip = ipHash(req);
      if (!isAdmin(code) && ((await redis("SISMEMBER", BANNED, owner(code))) || (await redis("SISMEMBER", BANNED, ip))))
        return send(res, 403, { error: "Paylaşım yapman yönetici tarafından engellendi." });
      const url = String(b.url || "").trim();
      let u; try { u = new URL(url); } catch (e) {}
      if (!u || !/^https?:$/.test(u.protocol) || url.length > 600) return send(res, 400, { error: "Geçerli bir link yapıştır (https://…)." });
      const title = clip(b.title, 120), name = clip(b.name, 24);
      if (!title) return send(res, 400, { error: "Başlık gerekli." });
      if (!name) return send(res, 400, { error: "Önce takma ad seç." });
      if (await overLimit(`rl:notes:${ipOf(req)}:${today()}`, 30, 86400)) return send(res, 429, { error: "Bugün çok fazla paylaşım yapıldı." });
      const id = crypto.randomBytes(5).toString("hex");
      const meta = { id, title, url: u.href, course: clip(b.course, 60), kurul: clip(b.kurul, 90), kind: KINDS.includes(b.kind) ? b.kind : "diger", name, createdAt: Date.now(), by: owner(code), ip };
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
      await redis("SET", `notes:trash:${id}`, JSON.stringify({ meta: raw, banned: ban }), "EX", TRASH_TTL);
      await redis("LREM", LIST, 1, raw);
      if (ban) {
        await redis("SADD", BANNED, meta.by); if (meta.ip) await redis("SADD", BANNED, meta.ip);
        await redis("HSET", BANS, meta.by, JSON.stringify({ at: Date.now(), name: meta.title, school: meta.name ? "👤 " + meta.name : "", ip: meta.ip || "" }));
      }
      return send(res, 200, { ok: true, banned: ban });
    }
    send(res, 405, { error: "Desteklenmeyen istek" });
  } catch (e) { send(res, 500, { error: e.message }); }
};
