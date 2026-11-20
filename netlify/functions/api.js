// Netlify adaptörü: /api/* istekleri buraya gelir (netlify.toml'daki yönlendirme),
// Vercel için yazılmış api/*.js dosyaları aynen çalıştırılır.
const handlers = {
  new: require("../../api/new.js"),
  data: require("../../api/data.js"),
  library: require("../../api/library.js"),
  notes: require("../../api/notes.js"),
  board: require("../../api/board.js"),
  admin: require("../../api/admin.js"),
  name: require("../../api/name.js"),
};

exports.handler = async (event) => {
  const path = event.path || "";
  const m = path.match(/\/(new|data|library|notes|board|admin|name)\/?$/) || (event.rawUrl || "").match(/\/api\/(new|data|library|notes|board|admin|name)(?:[/?]|$)/);
  const fn = m && handlers[m[1]];
  if (!fn) return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Bulunamadı" }) };

  let body = event.body || "";
  if (event.isBase64Encoded && body) body = Buffer.from(body, "base64").toString("utf8");
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;
  if (!headers["x-forwarded-for"] && headers["x-nf-client-connection-ip"]) headers["x-forwarded-for"] = headers["x-nf-client-connection-ip"];
  const query = { ...(event.queryStringParameters || {}) };
  const qs = new URLSearchParams(query).toString();

  const req = {
    method: event.httpMethod, headers, query,
    url: "/api/" + m[1] + (qs ? "?" + qs : ""),
    body: body ? (() => { try { return JSON.parse(body); } catch { return body; } })() : {},
    socket: { remoteAddress: headers["x-forwarded-for"] || "?" },
  };
  return await new Promise((resolve) => {
    const out = { statusCode: 200, headers: {} };
    const res = {
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      setHeader(k, v) { out.headers[k] = v; },
      end(b) { resolve({ ...out, body: b == null ? "" : String(b) }); },
    };
    Promise.resolve(fn(req, res)).catch(e => resolve({ statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message }) }));
  });
};
