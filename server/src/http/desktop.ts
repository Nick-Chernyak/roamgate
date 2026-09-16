import { timingSafeEqual } from "node:crypto";

/** Desktop authority stays in the main process, never renderer JS or a URL. */
export function createDesktopGuard(token: string | undefined) {
  if (token !== undefined && !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("Invalid desktop session token");
  }
  return (req: Request, port: number): Response | null => {
    if (!token) return null;
    const url = new URL(req.url);
    const host = `127.0.0.1:${port}`;
    const origin = req.headers.get("origin");
    if (
      url.host !== host ||
      req.headers.get("host") !== host ||
      (origin !== null && origin !== `http://${host}`)
    ) {
      return new Response("Forbidden desktop origin", { status: 403 });
    }
    const actual = Buffer.from(req.headers.get("x-roamgate-desktop") ?? "");
    const expected = Buffer.from(token);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return new Response("Unauthorized desktop request", { status: 401 });
    }
    return null;
  };
}
