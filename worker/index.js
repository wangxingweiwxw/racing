// Pages hosts the game assets; this Worker provides an optional unified entry.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    if (url.pathname === "/api/health") {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ ok: true, service: "racing-gateway" }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    // Assign the path separately so a //hostname path cannot change the origin.
    const target = new URL(env.PAGES_ORIGIN);
    target.pathname = url.pathname;
    target.search = url.search;
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    headers.delete("host");
    try {
      const upstream = await fetch(target, { method: request.method, headers, redirect: "manual" });
      const response = new Response(upstream.body, upstream);
      const location = response.headers.get("location");
      if (location) {
        const redirect = new URL(location, target);
        if (redirect.origin === target.origin) {
          redirect.protocol = url.protocol;
          redirect.host = url.host;
          response.headers.set("location", redirect.href);
        }
      }
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch {
      return new Response("Game assets temporarily unavailable", { status: 502 });
    }
  },
};
