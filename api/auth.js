// Hesap girişi: e-posta + şifre ile kayıt, takma ad (ya da e-posta) + şifre ile giriş, Google alternatif.
// Arka planda her hesap yine 4 haneli koda bağlıdır; giriş başarılı olunca istemciye o kod verilir.
// GET  /api/auth?config=1                                   → {google: clientId|""}
// GET  /api/auth?me=KOD                                     → {email, hasPw, google}
// POST /api/auth {action:"register", name, email, password} → {code}
// POST /api/auth {action:"login", id, password}             → {code}   (id = takma ad ya da e-posta)
// POST /api/auth {action:"setpw", code, email, password}    → eski kodlu hesaba e-posta + şifre ekle / değiştir
// POST /api/auth {action:"google", credential, name?}       → {code} ya da {needName:true}
// POST /api/auth {action:"linkgoogle", code, credential}    → mevcut hesaba Google bağla
// E-posta onayı (BREVO_API_KEY + MAIL_FROM tanımlıysa): register/setpw önce {verify:true} döner, e-postaya 6 haneli kod gider.
// POST /api/auth {action:"verify", email, vcode}            → kaydı tamamla → {code}
// POST /api/auth {action:"verifyset", code, vcode}          → e-posta/şifre eklemeyi tamamla
// POST /api/auth {action:"resend", email | code}            → kodu tekrar gönder
const crypto = require("crypto");
const { redis, newCode, CODE_RE, cleanCode, ipOf, overLimit, send, today, indexUser } = require("./_lib");

const owner = code => crypto.createHash("sha256").update("lib:" + code).digest("hex").slice(0, 16);
const clipName = s => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
const normName = s => clipName(s).toLocaleLowerCase("tr");
const normEmail = s => String(s || "").trim().toLowerCase().slice(0, 120);
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const hashPw = (pw, salt = crypto.randomBytes(16).toString("hex")) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 64).toString("hex") });
const checkPw = (pw, rec) => { try { const h = crypto.scryptSync(String(pw), rec.salt, 64); return crypto.timingSafeEqual(h, Buffer.from(rec.hash, "hex")); } catch (e) { return false; } };
const getUser = async code => JSON.parse((await redis("GET", `auth:user:${code}`)) || "null");
const putUser = (code, u) => redis("SET", `auth:user:${code}`, JSON.stringify(u));

async function nameFree(n, me) {
  if (await redis("SISMEMBER", "names:blocked", n)) return { ok: false, error: "Bu takma ad kullanılamaz." };
  const cur = await redis("HGET", "names", n);
  if (cur && cur !== me) return { ok: false, error: "Bu takma ad zaten alınmış.", taken: true };
  return { ok: true };
}
async function claim(code, name) {
  const n = normName(name), me = owner(code);
  const old = await redis("GET", `nameof:${me}`);
  if (old && old !== n && (await redis("HGET", "names", old)) === me) await redis("HDEL", "names", old);
  await redis("HSET", "names", n, me); await redis("SET", `nameof:${me}`, n);
  await redis("SET", `auth:byname:${n}`, code);
  if (old && old !== n && (await redis("GET", `auth:byname:${old}`)) === code) await redis("DEL", `auth:byname:${old}`);
}
async function createAccount(req) {
  if (await overLimit(`rl:new:${ipOf(req)}:${today()}`, 20, 86400)) throw { s: 429, e: "Bugün çok fazla yeni hesap açıldı, yarın tekrar dene." };
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    const ok = await redis("SET", `u:${code}`, JSON.stringify({ json: null, updatedAt: 0 }), "NX");
    if (ok === "OK") { try { await indexUser(code, null); } catch (e) {} return code; }
  }
  throw { s: 500, e: "Hesap açılamadı, tekrar dene." };
}
// ---- e-posta gönderme (Brevo, bedava 300/gün). Anahtar yoksa onay adımı atlanır.
const mailOn = () => !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
const sixDigits = () => String(crypto.randomInt(0, 1e6)).padStart(6, "0");
async function sendCode(to, vcode, name) {
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222"><p>Merhaba${name ? " " + name.replace(/[<>]/g, "") : ""},</p>
    <p>Sınav Haftası Asistanı e-posta onay kodun:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${vcode}</p>
    <p style="color:#666">Kod 15 dakika geçerli. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p><p>— CardiacAI</p></div>`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: process.env.MAIL_NAME || "Sınav Haftası Asistanı", email: process.env.MAIL_FROM }, to: [{ email: to }], subject: `Onay kodun: ${vcode}`, htmlContent: html }) });
  if (!r.ok) throw { s: 502, e: "Onay e-postası gönderilemedi, biraz sonra tekrar dene." };
}
async function checkPending(key, vcode) {
  const p = JSON.parse((await redis("GET", key)) || "null");
  if (!p) throw { s: 410, e: "Kodun süresi doldu, tekrar gönder." };
  if ((p.tries || 0) >= 5) { await redis("DEL", key); throw { s: 429, e: "Çok fazla yanlış deneme. Baştan başla." }; }
  if (String(vcode || "").trim() !== p.vcode) { p.tries = (p.tries || 0) + 1; await redis("SET", key, JSON.stringify(p), "EX", 900); throw { s: 400, e: "Kod yanlış." }; }
  await redis("DEL", key); return p;
}
async function verifyGoogle(credential) {
  const cid = process.env.GOOGLE_CLIENT_ID; if (!cid) throw { s: 400, e: "Google girişi henüz açık değil." };
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(String(credential || "")));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.aud !== cid || !j.sub || (j.email && String(j.email_verified) !== "true")) throw { s: 401, e: "Google girişi doğrulanamadı." };
  return { sub: j.sub, email: normEmail(j.email || "") };
}

module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (req.method === "GET") {
      if (q.config) return send(res, 200, { google: process.env.GOOGLE_CLIENT_ID || "", mail: mailOn() });
      const code = cleanCode(q.me); if (!CODE_RE.test(code)) return send(res, 400, { error: "Geçersiz kod." });
      const u = await getUser(code) || {};
      return send(res, 200, { email: u.email || "", hasPw: !!u.pw, google: !!u.google, verified: !!u.verified });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Desteklenmeyen istek" });
    const a = b.action;

    if (a === "register") {
      const name = clipName(b.name), n = normName(name), email = normEmail(b.email), pw = String(b.password || "");
      if (!name) return send(res, 400, { error: "Takma ad yaz." });
      if (!okEmail(email)) return send(res, 400, { error: "Geçerli bir e-posta yaz." });
      if (pw.length < 6) return send(res, 400, { error: "Şifre en az 6 karakter olmalı." });
      const nf = await nameFree(n, null); if (!nf.ok) return send(res, 409, { error: nf.error, taken: nf.taken });
      if (await redis("GET", `auth:email:${email}`)) return send(res, 409, { error: "Bu e-postayla zaten bir hesap var. Giriş yap.", emailTaken: true });
      if (mailOn()) {
        if (await overLimit(`rl:mail:${ipOf(req)}:${today()}`, 15, 86400)) return send(res, 429, { error: "Bugün çok fazla onay e-postası istendi." });
        const vcode = sixDigits();
        await redis("SET", `auth:pending:${email}`, JSON.stringify({ name, pw: hashPw(pw), vcode, tries: 0 }), "EX", 900);
        await sendCode(email, vcode, name);
        return send(res, 200, { verify: true, email });
      }
      const code = await createAccount(req);
      await putUser(code, { email, pw: hashPw(pw), at: Date.now(), verified: false });
      await redis("SET", `auth:email:${email}`, code);
      await claim(code, name);
      return send(res, 200, { code });
    }

    if (a === "verify") {
      const email = normEmail(b.email), p = await checkPending(`auth:pending:${email}`, b.vcode);
      const nf = await nameFree(normName(p.name), null); if (!nf.ok) return send(res, 409, { error: nf.error, taken: nf.taken });
      if (await redis("GET", `auth:email:${email}`)) return send(res, 409, { error: "Bu e-postayla zaten bir hesap var. Giriş yap.", emailTaken: true });
      const code = await createAccount(req);
      await putUser(code, { email, pw: p.pw, at: Date.now(), verified: true });
      await redis("SET", `auth:email:${email}`, code);
      await claim(code, p.name);
      return send(res, 200, { code, name: p.name });
    }
    if (a === "resend") {
      if (await overLimit(`rl:mail:${ipOf(req)}:${today()}`, 15, 86400)) return send(res, 429, { error: "Bugün çok fazla onay e-postası istendi." });
      const key = b.code ? `auth:pendset:${cleanCode(b.code)}` : `auth:pending:${normEmail(b.email)}`;
      const p = JSON.parse((await redis("GET", key)) || "null"); if (!p) return send(res, 410, { error: "Süre doldu, baştan başla." });
      p.vcode = sixDigits(); p.tries = 0; await redis("SET", key, JSON.stringify(p), "EX", 900);
      await sendCode(p.email || normEmail(b.email), p.vcode, p.name);
      return send(res, 200, { ok: true });
    }
    if (a === "verifyset") {
      const code = cleanCode(b.code); const p = await checkPending(`auth:pendset:${code}`, b.vcode);
      const other = await redis("GET", `auth:email:${p.email}`); if (other && other !== code) return send(res, 409, { error: "Bu e-posta başka bir hesapta kayıtlı." });
      const u = await getUser(code) || {};
      if (u.email && u.email !== p.email && (await redis("GET", `auth:email:${u.email}`)) === code) await redis("DEL", `auth:email:${u.email}`);
      u.email = p.email; u.pw = p.pw; u.verified = true; u.at = u.at || Date.now(); await putUser(code, u);
      await redis("SET", `auth:email:${p.email}`, code);
      const n = await redis("GET", `nameof:${owner(code)}`); if (n) await redis("SET", `auth:byname:${n}`, code);
      return send(res, 200, { ok: true });
    }

    if (a === "login") {
      if (await overLimit(`rl:login:${ipOf(req)}:${new Date().toISOString().slice(0, 13)}`, 30, 3600)) return send(res, 429, { error: "Çok fazla deneme yapıldı, biraz sonra tekrar dene." });
      const id = String(b.id || "").trim(), pw = String(b.password || "");
      const code = id.includes("@") ? await redis("GET", `auth:email:${normEmail(id)}`) : await redis("GET", `auth:byname:${normName(id)}`);
      const u = code && await getUser(code);
      if (!u || !u.pw || !checkPw(pw, u.pw) || !(await redis("GET", `u:${code}`))) return send(res, 401, { error: "Takma ad / e-posta ya da şifre yanlış." });
      return send(res, 200, { code });
    }

    if (a === "setpw") {
      const code = cleanCode(b.code); if (!CODE_RE.test(code) || !(await redis("GET", `u:${code}`))) return send(res, 403, { error: "Giriş yapmalısın." });
      const email = normEmail(b.email), pw = String(b.password || "");
      if (!okEmail(email)) return send(res, 400, { error: "Geçerli bir e-posta yaz." });
      if (pw.length < 6) return send(res, 400, { error: "Şifre en az 6 karakter olmalı." });
      const other = await redis("GET", `auth:email:${email}`); if (other && other !== code) return send(res, 409, { error: "Bu e-posta başka bir hesapta kayıtlı." });
      const u = await getUser(code) || {};
      if (mailOn()) {   // şifre ekleme/değiştirme her zaman e-posta koduyla onaylanır
        if (await overLimit(`rl:mail:${ipOf(req)}:${today()}`, 15, 86400)) return send(res, 429, { error: "Bugün çok fazla onay e-postası istendi." });
        const vcode = sixDigits();
        await redis("SET", `auth:pendset:${code}`, JSON.stringify({ email, pw: hashPw(pw), vcode, tries: 0 }), "EX", 900);
        await sendCode(email, vcode, "");
        return send(res, 200, { verify: true, email });
      }
      if (u.email && u.email !== email && (await redis("GET", `auth:email:${u.email}`)) === code) await redis("DEL", `auth:email:${u.email}`);
      u.email = email; u.pw = hashPw(pw); u.at = u.at || Date.now(); await putUser(code, u);
      await redis("SET", `auth:email:${email}`, code);
      const n = await redis("GET", `nameof:${owner(code)}`); if (n) await redis("SET", `auth:byname:${n}`, code);
      return send(res, 200, { ok: true });
    }

    if (a === "google") {
      const g = await verifyGoogle(b.credential);
      let code = await redis("GET", `auth:google:${g.sub}`);
      if (!code && g.email) {   // aynı e-postayla şifreli hesap varsa ona bağla
        code = await redis("GET", `auth:email:${g.email}`);
        if (code) { const u = await getUser(code) || {}; u.google = g.sub; await putUser(code, u); await redis("SET", `auth:google:${g.sub}`, code); }
      }
      if (code && (await redis("GET", `u:${code}`))) return send(res, 200, { code });
      // yeni kullanıcı: takma ad gerekli
      const name = clipName(b.name); if (!name) return send(res, 200, { needName: true, email: g.email });
      const nf = await nameFree(normName(name), null); if (!nf.ok) return send(res, 409, { error: nf.error, taken: nf.taken });
      code = await createAccount(req);
      await putUser(code, { email: g.email, google: g.sub, at: Date.now(), verified: true });
      if (g.email) await redis("SET", `auth:email:${g.email}`, code);
      await redis("SET", `auth:google:${g.sub}`, code);
      await claim(code, name);
      return send(res, 200, { code });
    }

    if (a === "linkgoogle") {
      const code = cleanCode(b.code); if (!CODE_RE.test(code) || !(await redis("GET", `u:${code}`))) return send(res, 403, { error: "Giriş yapmalısın." });
      const g = await verifyGoogle(b.credential);
      const other = await redis("GET", `auth:google:${g.sub}`); if (other && other !== code) return send(res, 409, { error: "Bu Google hesabı başka bir hesaba bağlı." });
      const u = await getUser(code) || {}; u.google = g.sub;
      if (!u.email && g.email && !(await redis("GET", `auth:email:${g.email}`))) { u.email = g.email; await redis("SET", `auth:email:${g.email}`, code); }
      await putUser(code, u); await redis("SET", `auth:google:${g.sub}`, code);
      return send(res, 200, { ok: true });
    }
    send(res, 400, { error: "Bilinmeyen işlem" });
  } catch (e) { if (e && e.s) return send(res, e.s, { error: e.e }); send(res, 500, { error: e.message }); }
};
