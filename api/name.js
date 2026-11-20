// Takma adlar benzersiz: aynı takma adı iki kişi alamaz (büyük/küçük harf ve boşluk farkı sayılmaz)
// GET  /api/name?name=Ali&me=KOD → {available:true/false}
// POST /api/name {code,name}     → adı al (eski adı bırakır). Başkasınınsa 409.
const crypto = require("crypto");
const { redis, CODE_RE, cleanCode, ipOf, overLimit, send } = require("./_lib");
const owner = code => crypto.createHash("sha256").update("lib:" + code).digest("hex").slice(0, 16);
const clip = s => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
const norm = s => clip(s).toLocaleLowerCase("tr");

module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (await overLimit(`rl:name:${ipOf(req)}:${new Date().toISOString().slice(0, 13)}`, 120, 3600)) return send(res, 429, { error: "Çok sık denendi, biraz sonra tekrar dene." });
    if (req.method === "GET") {
      const n = norm(q.name); if (!n) return send(res, 400, { error: "Takma ad boş." });
      const cur = await redis("HGET", "names", n), me = q.me ? owner(cleanCode(q.me)) : null;
      return send(res, 200, { available: !cur || cur === me });
    }
    if (req.method === "POST") {
      const code = cleanCode(b.code);
      if (!CODE_RE.test(code) || !(await redis("GET", `u:${code}`))) return send(res, 403, { error: "Giriş yapmalısın." });
      const n = norm(b.name); if (!n) return send(res, 400, { error: "Takma ad boş." });
      const me = owner(code), cur = await redis("HGET", "names", n);
      if (cur && cur !== me) return send(res, 409, { error: "Bu takma ad zaten alınmış." });
      const old = await redis("GET", `nameof:${me}`);
      if (old && old !== n && (await redis("HGET", "names", old)) === me) await redis("HDEL", "names", old);
      await redis("HSET", "names", n, me);
      await redis("SET", `nameof:${me}`, n);
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: "Desteklenmeyen istek" });
  } catch (e) { send(res, 500, { error: e.message }); }
};
