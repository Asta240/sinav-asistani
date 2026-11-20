// Yönetici sayfası
// GET  /api/admin?contact=1               → {contact}  (herkese açık: kodunu kaybeden yöneticiye ulaşsın)
// GET  /api/admin?code=KOD&check=1        → {admin:true/false}
// GET  /api/admin?code=KOD                → {users:[{code,name,at,k}], contact}  (sadece yönetici)
// POST /api/admin {code, contact}         → iletişim bilgisini kaydet (sadece yönetici)
const { redis, cleanCode, ipOf, overLimit, send, isAdmin, indexUser } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (req.method === "GET" && q.contact) return send(res, 200, { contact: (await redis("GET", "admin:contact")) || "" });
    const code = cleanCode(req.method === "GET" ? q.code : b.code);
    if (await overLimit(`rl:admin:${ipOf(req)}:${new Date().toISOString().slice(0, 13)}`, 120, 3600)) return send(res, 429, { error: "Çok sık." });
    if (req.method === "GET" && q.check) return send(res, 200, { admin: isAdmin(code) });
    if (!isAdmin(code)) return send(res, 403, { error: "Sadece yönetici." });
    if (req.method === "GET") {
      const h = await redis("HGETALL", "users") || [];
      const idx = {}; for (let i = 0; i < h.length; i += 2) idx[h[i]] = JSON.parse(h[i + 1]);
      // dizinde olmayan eski hesapları bul (SCAN u:*), en fazla 60 tanesini doldur
      let cursor = "0", missing = [], loops = 0;
      do { const r = await redis("SCAN", cursor, "MATCH", "u:*", "COUNT", 500); cursor = String(r[0]); (r[1] || []).forEach(k => { const c = k.slice(2); if (!idx[c]) missing.push(c); }); } while (cursor !== "0" && ++loops < 40);
      for (const c of missing.slice(0, 60)) { const raw = await redis("GET", `u:${c}`); let j = null; try { j = JSON.parse(raw || "null"); } catch (e) {} await indexUser(c, j && j.json); const v = JSON.parse(await redis("HGET", "users", c)); if (j && j.updatedAt) v.at = j.updatedAt; idx[c] = v; }
      const users = Object.entries(idx).map(([code, v]) => ({ code, ...v })).sort((a, b) => (b.at || 0) - (a.at || 0));
      return send(res, 200, { users, total: users.length, more: Math.max(0, missing.length - 60), contact: (await redis("GET", "admin:contact")) || "" });
    }
    if (req.method === "POST") {
      const contact = String(b.contact || "").replace(/[<>]/g, "").trim().slice(0, 200);
      await redis("SET", "admin:contact", contact);
      return send(res, 200, { ok: true, contact });
    }
    send(res, 405, { error: "Desteklenmeyen istek" });
  } catch (e) { send(res, 500, { error: e.message }); }
};
