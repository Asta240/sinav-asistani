// Ortak yardımcılar: Upstash Redis (REST) + istek kontrolleri.
// Vercel'de "Upstash for Redis" eklenince ortam değişkenleri otomatik gelir.
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(...cmd) {
  if (!R_URL || !R_TOKEN) throw new Error("Veritabanı bağlı değil (Upstash ortam değişkenleri eksik).");
  const r = await fetch(R_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// Karışmayan karakterler: 0/O, 1/I/L yok
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
// Yeni kodlar 4 karakter (~920 bin ihtimal); önceden alınmış 6 karakterliler de geçerli
const CODE_RE = /^([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6})$/;
function newCode() {
  const bytes = require("crypto").randomBytes(4);
  let s = ""; for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
const cleanCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function ipOf(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
}
// Basit sayaç: süre dolunca sıfırlanır. limit aşılırsa true döner.
async function overLimit(key, limit, seconds) {
  const n = await redis("INCR", key);
  if (n === 1) await redis("EXPIRE", key, seconds);
  return n > limit;
}
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
const today = () => new Date().toISOString().slice(0, 10);
// Yöneticiler: ADMIN_CODE'a virgülle birden fazla kod yazılabilir (ör. "AB12,CD34")
const adminCodes = () => String(process.env.ADMIN_CODE || "").split(/[,\s;]+/).map(cleanCode).filter(Boolean);
const isAdmin = code => !!code && adminCodes().includes(cleanCode(code));
// Yönetici sayfası için hafif kullanıcı dizini: users hash → kod: {name, at, k}
async function indexUser(code, json) {
  let name = "", k = 0;
  try { const d = JSON.parse(json || "null"); name = String((d && d.profile && d.profile.name) || "").slice(0, 24); k = ((d && d.folders) || []).filter(f => f.courses && f.courses.length).length; } catch (e) {}
  const prev = JSON.parse((await redis("HGET", "users", code)) || "{}");
  await redis("HSET", "users", code, JSON.stringify({ name, at: Date.now(), k, ...(prev.warned && prev.name === name ? { warned: prev.warned } : {}) }));
}

module.exports = { redis, newCode, CODE_RE, cleanCode, ipOf, overLimit, send, today, isAdmin, indexUser };
