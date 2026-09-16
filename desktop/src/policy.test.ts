import { expect, test } from "bun:test";
import { bridgeEnvironment, isBridgeUrl, safeExternalUrl } from "./policy";

test("desktop secrets are scoped to the exact bridge including WebSocket", () => {
  const origin = "http://127.0.0.1:3000";
  expect(isBridgeUrl(`${origin}/api/health`, origin)).toBe(true);
  expect(isBridgeUrl("ws://127.0.0.1:3000/ws", origin)).toBe(true);
  for (const url of [
    "http://127.0.0.1:3001/",
    "http://127.0.0.1.evil:3000/",
    "http://evil@127.0.0.1:3000/",
    "file:///tmp/file",
  ]) {
    expect(isBridgeUrl(url, origin)).toBe(false);
  }
  expect(safeExternalUrl("javascript:alert(1)")).toBe(false);
  expect(safeExternalUrl("file:///C:/Windows/notepad.exe")).toBe(false);
  expect(safeExternalUrl("https://github.com/Nick-Chernyak/roamgate")).toBe(
    true,
  );
});

test("inherited service and remote settings cannot redirect the desktop runtime", () => {
  const env = bridgeEnvironment(
    {
      PATH: "safe",
      HOST: "0.0.0.0",
      HERDR_SSH_HOST: "other-host",
      ROAMGATE_PASSWORD: "old",
      HERDR_GUI_CONNECTIONS_PATH: "old",
    },
    "secret",
    "profiles.json",
  );
  expect(env.PATH).toBe("safe");
  expect(env.HOST).toBeUndefined();
  expect(env.HERDR_SSH_HOST).toBeUndefined();
  expect(env.ROAMGATE_PASSWORD).toBeUndefined();
  expect(env.HERDR_GUI_CONNECTIONS_PATH).toBeUndefined();
  expect(env.ROAMGATE_DESKTOP_TOKEN).toBe("secret");
});
