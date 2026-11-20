// Hazır kurul kütüphanesi (herkese açık)
// GET    /api/library?me=KOD            → liste (kurul kodları olmadan)
// GET    /api/library?id=XXXX           → tek kurulun kurul kodu (KRL1…)
// POST   /api/library {code,name,school,data} → kütüphaneye ekle (hesap kodu gerekli)
// DELETE /api/library {code,id}         → sil (sadece paylaşan kişi ya da ADMIN_CODE)
const crypto = require("crypto");
const { redis, CODE_RE, cleanCode, ipOf, overLimit, send, today } = require("./_lib");
const LIST = "lib:list";
const MAX_DATA = 300 * 1024, MAX_ITEMS = 300;
const owner = code => crypto.createHash("sha256").update("lib:" + code).digest("hex").slice(0, 16);
const clip = (s, n) => String(s || "").replace(/[<>]/g, "").trim().slice(0, n);

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
      const me = q.me ? owner(cleanCode(q.me)) : null;
      const items = (await redis("LRANGE", LIST, 0, MAX_ITEMS - 1) || []).map(x => JSON.parse(x));
      return send(res, 200, { items: items.map(({ by, ...it }) => ({ ...it, mine: !!me && by === me })) });
    }
    if (req.method === "POST") {
      const code = cleanCode(b.code);
      if (!CODE_RE.test(code) || !(await redis("GET", `u:${code}`))) return send(res, 403, { error: "Paylaşmak için giriş yapmış olmalısın." });
      const data = String(b.data || "");
      if (!/^KRL[01]\.[A-Za-z0-9_-]+$/.test(data) || data.length > MAX_DATA) return send(res, 400, { error: "Geçersiz kurul verisi." });
      const name = clip(b.name, 90), school = clip(b.school, 90);
      if (!name) return send(res, 400, { error: "Kurul adı gerekli." });
      if (await overLimit(`rl:lib:${ipOf(req)}:${today()}`, 10, 86400)) return send(res, 429, { error: "Bugün çok fazla paylaşım yapıldı." });
      const id = crypto.randomBytes(5).toString("hex");
      const meta = { id, name, school, courses: Math.min(99, +b.courses || 0), topics: Math.min(9999, +b.topics || 0), sessions: Math.min(9999, +b.sessions || 0), createdAt: Date.now(), by: owner(code) };
      await redis("SET", `lib:item:${id}`, JSON.stringify({ id, name, data }));
      await redis("LPUSH", LIST, JSON.stringify(meta));
      await redis("LTRIM", LIST, 0, MAX_ITEMS - 1);
      return send(res, 200, { ok: true, id });
    }
    if (req.method === "DELETE") {
      const code = cleanCode(b.code), id = clip(b.id, 20);
      const admin = process.env.ADMIN_CODE && code === cleanCode(process.env.ADMIN_CODE);
      const items = await redis("LRANGE", LIST, 0, MAX_ITEMS - 1) || [];
      const raw = items.find(x => JSON.parse(x).id === id);
      if (!raw) return send(res, 404, { error: "Bulunamadı." });
      if (!admin && JSON.parse(raw).by !== owner(code)) return send(res, 403, { error: "Sadece paylaşan kişi silebilir." });
      await redis("LREM", LIST, 1, raw);
      await redis("DEL", `lib:item:${id}`);
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: "Desteklenmeyen istek" });
  } catch (e) { send(res, 500, { error: e.message }); }
};
