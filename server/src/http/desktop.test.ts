import { describe, expect, test } from "bun:test";
import { createDesktopGuard } from "./desktop";

describe("desktop bridge boundary", () => {
  const token = "a".repeat(64);
  const guard = createDesktopGuard(token);
  function request(headers: Record<string, string> = {}, path = "/ws") {
    return new Request(`http://127.0.0.1:12345${path}`, {
      headers: {
        host: "127.0.0.1:12345",
        "x-roamgate-desktop": token,
        ...headers,
      },
    });
  }
  test("requires secret even for health and WebSocket upgrades", () => {
    for (const path of ["/health", "/ws", "/api/herdr/setup"]) {
      expect(
        guard(request({ "x-roamgate-desktop": "" }, path), 12345)?.status,
      ).toBe(401);
    }
  });
  test("accepts the desktop and rejects cross-origin and rebinding requests", () => {
    expect(guard(request(), 12345)).toBeNull();
    expect(
      guard(request({ origin: "http://127.0.0.1:12345" }), 12345),
    ).toBeNull();
    expect(
      guard(request({ origin: "https://attacker.example" }), 12345)?.status,
    ).toBe(403);
    expect(
      guard(request({ host: "attacker.example:12345" }), 12345)?.status,
    ).toBe(403);
    expect(guard(request({ origin: "null" }), 12345)?.status).toBe(403);
    expect(
      guard(request({ "x-roamgate-desktop": "b".repeat(64) }), 12345)?.status,
    ).toBe(401);
  });
  test("normal web mode is unchanged; malformed desktop configuration fails closed", () => {
    expect(createDesktopGuard(undefined)(request(), 12345)).toBeNull();
    expect(() => createDesktopGuard("")).toThrow();
  });
});
