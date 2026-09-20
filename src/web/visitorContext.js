import { randomUUID } from "node:crypto";

export function visitorContext(publicOrigin = "") {
  let published;
  if (publicOrigin) {
    try { published = new URL(publicOrigin); } catch { throw new Error("PUBLIC_ORIGIN 必须是完整的 HTTPS 网站地址。"); }
    if (published.protocol !== "https:" || published.origin !== publicOrigin || published.username || published.password) {
      throw new Error("PUBLIC_ORIGIN 必须是 HTTPS 来源地址，例如 https://papers.example.com（末尾不带斜杠）。");
    }
  }
  return (request, response, next) => {
    // Static page establishes the cookie before its parallel API requests start.
    const cookie = request.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith("rp-visitor="))?.slice(11);
    const validCookie = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cookie || "");
    request.visitor = { ownerId: validCookie ? cookie.toLowerCase() : randomUUID() };
    if (!validCookie && request.path !== "/api/health") {
      response.cookie("rp-visitor", request.visitor.ownerId, { httpOnly: true, sameSite: "strict", secure: Boolean(published), maxAge: 30 * 86400000, path: "/" });
      response.set("Cache-Control", "no-store");
    }
    response.set("Referrer-Policy", "same-origin");
    response.set("X-Content-Type-Options", "nosniff");
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) { next(); return; }
    const host = request.get("Host");
    const origin = request.get("Origin");
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(request.hostname);
    const expectedOrigin = published ? published.origin : `http://${host}`;
    if ((published ? host !== published.host : !localHost) || request.get("Sec-Fetch-Site") === "cross-site" || (origin && origin !== expectedOrigin)) {
      response.status(403).json({ error: "请从本站页面发起请求。" }); return;
    }
    next();
  };
}
