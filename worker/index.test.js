import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./index.js";

const env = { PAGES_ORIGIN: "https://racing-wangxingweiwxw.pages.dev" };

test("health and unsupported methods never call the origin", async () => {
  const health = await worker.fetch(new Request("https://game.example/api/health"), env);
  assert.deepEqual(await health.json(), { ok: true, service: "racing-gateway" });
  const head = await worker.fetch(new Request("https://game.example/api/health", { method: "HEAD" }), env);
  assert.equal(await head.text(), "");
  const post = await worker.fetch(new Request("https://game.example/", { method: "POST" }), env);
  assert.equal(post.status, 405);
});

test("proxy fixes the origin, preserves ranges, and strips credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async (target, init) => {
    assert.equal(target.href, `${env.PAGES_ORIGIN}//other.example/data/terrain.bin?v=2`);
    assert.equal(init.headers.get("range"), "bytes=0-9");
    assert.equal(init.headers.get("cookie"), null);
    assert.equal(init.headers.get("authorization"), null);
    return new Response("0123456789", { status: 206, headers: { "Content-Range": "bytes 0-9/100" } });
  });
  const response = await worker.fetch(new Request("https://game.example//other.example/data/terrain.bin?v=2", {
    headers: { Range: "bytes=0-9", Cookie: "session=private", Authorization: "Bearer private" },
  }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-9/100");
  assert.equal(await response.text(), "0123456789");
});

test("origin redirects stay on the Worker entry", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, {
    status: 301, headers: { Location: `${env.PAGES_ORIGIN}/credits?view=1` },
  }));
  const response = await worker.fetch(new Request("https://game.example/credits.html"), env);
  assert.equal(response.headers.get("location"), "https://game.example/credits?view=1");
});

test("origin failures return 502", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  assert.equal((await worker.fetch(new Request("https://game.example/"), env)).status, 502);
});
