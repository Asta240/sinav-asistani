// GET  /api/data?code=XXXXXX             → o kodun verisi + sürüm (updatedAt)
// PUT  /api/data  {code, json, base}       → kaydet. base = cihazın bildiği son sürüm.
//      Sunucudaki sürüm farklıysa (başka cihaz daha önce kaydetmiş) 409 + güncel veri döner.
// DELETE /api/data {code}                 → hesabı sil (10 dk geri alınabilir)
// POST   /api/data {action:"restore",code} → silineni geri getir
const { redis, CODE_RE, cleanCode, ipOf, overLimit, send, indexUser, deleteAccount, restoreAccount } = require("./_lib");
const MAX = 900 * 1024; // ~900 KB

module.exports = async (req, res) => {
  try {
    const ip = ipOf(req);
    if (req.method === "GET") {
      const code = cleanCode(req.query?.code ?? new URL(req.url, "http://x").searchParams.get("code"));
      if (!CODE_RE.test(code)) return send(res, 404, { error: "Bu kod bulunamadı." });
      // Kod tahminine karşı: saatte 30 yanlış denemeden sonra engelle
      const missKey = `rl:miss:${ip}:${new Date().toISOString().slice(0, 13)}`;
      if (Number((await redis("GET", missKey)) || 0) >= 30)
        return send(res, 429, { error: "Çok fazla yanlış kod denendi, 1 saat sonra tekrar dene." });
      const raw = await redis("GET", `u:${code}`);
      if (!raw) { await overLimit(missKey, 30, 3600); return send(res, 404, { error: "Bu kod bulunamadı." }); }
      const d = JSON.parse(raw);
      return send(res, 200, { code, json: d.json, updatedAt: d.updatedAt || 0 });
    }
    if (req.method === "PUT") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const code = cleanCode(b.code);
      if (!CODE_RE.test(code)) return send(res, 400, { error: "Geçersiz kod." });
      if (typeof b.json !== "string" || b.json.length > MAX) return send(res, 413, { error: "Veri çok büyük." });
      if (await overLimit(`rl:put:${code}:${new Date().toISOString().slice(0, 16)}`, 40, 60))
        return send(res, 429, { error: "Çok sık kayıt, birazdan tekrar dene." });
      const raw = await redis("GET", `u:${code}`);
      if (!raw) return send(res, 404, { error: "Bu kod bulunamadı." });
      const cur = JSON.parse(raw);
      const curV = cur.updatedAt || 0;
      if (cur.json && Number(b.base || 0) !== curV) return send(res, 409, { json: cur.json, updatedAt: curV });
      const v = Math.max(Date.now(), curV + 1);   // sürüm = sunucu zamanı (cihaz saatlerinden bağımsız)
      await redis("SET", `u:${code}`, JSON.stringify({ json: b.json, updatedAt: v }));
      try { await indexUser(code, b.json); } catch (e) {}
      return send(res, 200, { ok: true, updatedAt: v });
    }
    if (req.method === "DELETE" || (req.method === "POST")) {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const code = cleanCode(b.code);
      if (!CODE_RE.test(code)) return send(res, 400, { error: "Geçersiz kod." });
      if (await overLimit(`rl:del:${ip}:${new Date().toISOString().slice(0, 13)}`, 20, 3600)) return send(res, 429, { error: "Çok sık, sonra tekrar dene." });
      if (req.method === "DELETE") return (await deleteAccount(code)) ? send(res, 200, { ok: true }) : send(res, 404, { error: "Bu kod bulunamadı." });
      if (b.action === "restore") return (await restoreAccount(code)) ? send(res, 200, { ok: true }) : send(res, 404, { error: "Geri alma süresi doldu." });
    }
    send(res, 405, { error: "GET veya PUT kullan" });
  } catch (e) { send(res, 500, { error: e.message }); }
};
