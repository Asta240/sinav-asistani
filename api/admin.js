// Yönetici sayfası
// GET  /api/admin?contact=1               → {contact}  (herkese açık: kodunu kaybeden yöneticiye ulaşsın)
// GET  /api/admin?code=KOD&check=1        → {admin:true/false}
// GET  /api/admin?code=KOD                → {users:[{code,name,at,k}], contact}  (sadece yönetici)
// POST /api/admin {code, contact}         → iletişim bilgisini kaydet (sadece yönetici)
// POST /api/admin {code, action:"warn", target, msg} → uygunsuz takma ad uyarısı: kişinin adı serbest kalır, açılışta uyarı + yeni ad seçtirilir
// GET  /api/admin?warnme=KOD             → {warn:{msg,at}|null} (kullanıcı kendi uyarısını alır)
// POST /api/admin {action:"ackwarn", code} → uyarıyı okundu say
const { redis, cleanCode, ipOf, overLimit, send, isAdmin, indexUser, deleteAccount, restoreAccount } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (req.method === "GET" && q.contact) return send(res, 200, { contact: (await redis("GET", "admin:contact")) || "" });
    if (req.method === "GET" && q.warnme) { const raw = await redis("GET", `warn:${cleanCode(q.warnme)}`); return send(res, 200, { warn: raw ? JSON.parse(raw) : null }); }
    if (req.method === "POST" && b.action === "ackwarn") { await redis("DEL", `warn:${cleanCode(b.code)}`); return send(res, 200, { ok: true }); }
    const code = cleanCode(req.method === "GET" ? q.code : b.code);
    if (req.method === "GET" && q.check) return send(res, 200, { admin: isAdmin(code) });   // hız sınırına takılmasın
    if (await overLimit(`rl:admin:${ipOf(req)}:${new Date().toISOString().slice(0, 13)}`, 300, 3600)) return send(res, 429, { error: "Çok sık." });
    if (!isAdmin(code)) return send(res, 403, { error: "Sadece yönetici." });
    if (req.method === "GET") {
      const h = await redis("HGETALL", "users") || [];
      const idx = {}; for (let i = 0; i < h.length; i += 2) idx[h[i]] = JSON.parse(h[i + 1]);
      // dizinde olmayan eski hesapları bul (SCAN u:*), en fazla 60 tanesini doldur
      let cursor = "0", missing = [], loops = 0;
      do { const r = await redis("SCAN", cursor, "MATCH", "u:*", "COUNT", 500); cursor = String(r[0]); (r[1] || []).forEach(k => { const c = k.slice(2); if (!idx[c]) missing.push(c); }); } while (cursor !== "0" && ++loops < 40);
      for (const c of missing.slice(0, 60)) { const raw = await redis("GET", `u:${c}`); let j = null; try { j = JSON.parse(raw || "null"); } catch (e) {} await indexUser(c, j && j.json); const v = JSON.parse(await redis("HGET", "users", c)); if (j && j.updatedAt) v.at = j.updatedAt; idx[c] = v; }
      const codes = Object.keys(idx);
      for (let i = 0; i < codes.length; i += 200) {   // e-posta / şifre / Google bilgisi
        const part = codes.slice(i, i + 200), vals = await redis("MGET", ...part.map(c => `auth:user:${c}`)) || [];
        part.forEach((c, k) => { const u = vals[k] ? JSON.parse(vals[k]) : null; if (u) { idx[c].email = u.email || ""; idx[c].pw = !!u.pw; idx[c].g = !!u.google; } });
      }
      const users = Object.entries(idx).map(([code, v]) => ({ code, ...v })).sort((a, b) => (b.at || 0) - (a.at || 0));
      return send(res, 200, { users, total: users.length, more: Math.max(0, missing.length - 60), contact: (await redis("GET", "admin:contact")) || "" });
    }
    if (req.method === "POST" && b.action === "delete") {
      const target = cleanCode(b.target); if (isAdmin(target)) return send(res, 400, { error: "Yönetici hesabı buradan silinemez." });
      return (await deleteAccount(target)) ? send(res, 200, { ok: true }) : send(res, 404, { error: "Bu kod bulunamadı." });
    }
    if (req.method === "POST" && b.action === "restore") return (await restoreAccount(cleanCode(b.target))) ? send(res, 200, { ok: true }) : send(res, 404, { error: "Geri alma süresi doldu." });
    if (req.method === "POST" && b.action === "resetpw") {
      const target = cleanCode(b.target), pw = String(b.password || "");
      if (pw.length < 6) return send(res, 400, { error: "Şifre en az 6 karakter olmalı." });
      const u = JSON.parse((await redis("GET", `auth:user:${target}`)) || "null"); if (!u) return send(res, 404, { error: "Bu hesapta e-posta/şifre yok." });
      const crypto = require("crypto"); const salt = crypto.randomBytes(16).toString("hex");
      u.pw = { salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex") }; await redis("SET", `auth:user:${target}`, JSON.stringify(u));
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && b.action === "warn") {
      const target = cleanCode(b.target);
      if (!(await redis("GET", `u:${target}`))) return send(res, 404, { error: "Bu kod bulunamadı." });
      const msg = String(b.msg || "").replace(/[<>]/g, "").trim().slice(0, 300) || "Takma adın uygunsuz bulundu. Lütfen yeni bir takma ad seç.";
      await redis("SET", `warn:${target}`, JSON.stringify({ msg, at: Date.now() }));
      // adı serbest bırak (aynı uygunsuz adı tekrar seçemesin diye ad yasak listesine de eklenir)
      const crypto = require("crypto"); const me = crypto.createHash("sha256").update("lib:" + target).digest("hex").slice(0, 16);
      const n = await redis("GET", `nameof:${me}`);
      if (n) { if ((await redis("HGET", "names", n)) === me) await redis("HDEL", "names", n); await redis("SADD", "names:blocked", n); await redis("DEL", `nameof:${me}`); }
      const u = JSON.parse((await redis("HGET", "users", target)) || "{}"); u.warned = Date.now(); await redis("HSET", "users", target, JSON.stringify(u));
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST") {
      const contact = String(b.contact || "").replace(/[<>]/g, "").trim().slice(0, 200);
      await redis("SET", "admin:contact", contact);
      return send(res, 200, { ok: true, contact });
    }
    send(res, 405, { error: "Desteklenmeyen istek" });
  } catch (e) { send(res, 500, { error: e.message }); }
};
