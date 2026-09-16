import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  type Rectangle,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bridgeEnvironment, isBridgeUrl, safeExternalUrl } from "./policy";
import { isSupportedHerdrProtocol } from "../../server/src/bridge/protocol-compat";

const APP_ID = "dev.nickchernyak.roamgate.desktop";
const smoke = !app.isPackaged && process.argv.includes("--smoke-test");
app.setName("Roamgate Desktop");
app.setAppUserModelId(APP_ID);
if (smoke) app.setPath("userData", join(app.getAppPath(), ".smoke"));
const data = app.getPath("userData");
mkdirSync(data, { recursive: true });
const logFile = join(data, "desktop.log");
if (existsSync(logFile) && statSync(logFile).size > 5_000_000)
  renameSync(logFile, `${logFile}.previous`);
function log(message: string) {
  appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
}
const prefsFile = join(data, "desktop.json");
interface Preferences {
  launchAtLogin?: boolean;
  bounds?: Rectangle;
  maximized?: boolean;
  port?: number;
}
let prefs: Preferences = {};
try {
  const saved: unknown = JSON.parse(readFileSync(prefsFile, "utf8"));
  if (saved && typeof saved === "object" && !Array.isArray(saved))
    prefs = saved;
} catch {
  /* first launch */
}
function savePrefs() {
  const temporary = `${prefsFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(prefs, null, 2));
  renameSync(temporary, prefsFile);
}
const assets = join(app.getAppPath(), "assets");
const startupUrl = pathToFileURL(join(assets, "startup.html")).href;
const bridgePath = app.isPackaged
  ? join(process.resourcesPath, "bridge", "roamgate.exe")
  : resolve(app.getAppPath(), "../server/roamgate-desktop.exe");
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let child: ChildProcess | null = null;
let origin = "";
let token = "";
let quitting = false;
let starting = false;
let restartCount = 0;
let healthTimer: ReturnType<typeof setInterval> | undefined;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let herdrRepair: Promise<void> | null = null;
let smokeStarted = false;
let bootState = {
  title: "Starting your workspace...",
  detail:
    "Herdr runs in the background. Your agents keep working when you close this window.",
  failed: false,
};

function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function isOwnFrame(url: string) {
  return url === startupUrl || (!!origin && isBridgeUrl(url, origin));
}
function logError(error: unknown) {
  log(error instanceof Error ? (error.stack ?? error.message) : String(error));
}
function updateStartup(
  title: string,
  detail = bootState.detail,
  failed = false,
) {
  bootState = { title, detail, failed };
  if (window?.webContents.getURL() === startupUrl) {
    void window.webContents
      .executeJavaScript(
        `document.getElementById('status').textContent=${JSON.stringify(title)};document.getElementById('detail').textContent=${JSON.stringify(detail)};document.getElementById('retry').hidden=${!failed};`,
      )
      .catch(logError);
  }
}
async function showStartup() {
  if (window && window.webContents.getURL() !== startupUrl)
    await window.loadURL(startupUrl);
  updateStartup(bootState.title, bootState.detail, bootState.failed);
}
function loginSettings() {
  return { path: process.execPath, args: ["--startup"] };
}
function setAutostart(enabled: boolean) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    ...loginSettings(),
    openAtLogin: enabled,
    name: APP_ID,
  });
  prefs.launchAtLogin = enabled;
  savePrefs();
  rebuildMenu();
}
function rebuildMenu() {
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: "Open Roamgate", click: showWindow },
    { type: "separator" },
    {
      label: "Launch at Windows login",
      type: "checkbox",
      enabled: app.isPackaged,
      checked:
        app.isPackaged && app.getLoginItemSettings(loginSettings()).openAtLogin,
      click: (item) => setAutostart(item.checked),
    },
    {
      label: "Restart desktop connection",
      click: () => {
        restartCount = 0;
        void startRuntime();
      },
    },
    {
      label: "Open logs",
      click: () => {
        void shell.openPath(data);
      },
    },
    {
      label: "Desktop releases",
      click: () => {
        void shell.openExternal(
          "https://github.com/Nick-Chernyak/roamgate/releases",
        );
      },
    },
    { type: "separator" },
    { label: "Quit desktop (keep agents running)", click: () => app.quit() },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(items));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Roamgate", submenu: items },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "togglefullscreen" },
          ...(!app.isPackaged ? [{ role: "toggleDevTools" as const }] : []),
        ],
      },
    ]),
  );
}
async function freePort(preferred: number): Promise<number> {
  const listen = (port: number) =>
    new Promise<number>((accept, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const assigned =
          typeof address === "object" && address ? address.port : 0;
        server.close((error) => (error ? reject(error) : accept(assigned)));
      });
    });
  try {
    return await listen(preferred);
  } catch {
    return listen(0);
  }
}
async function request(path: string, options: RequestInit = {}) {
  return fetch(`${origin}${path}`, {
    ...options,
    headers: { "x-roamgate-desktop": token, ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(180_000),
  });
}
async function ensureHerdr() {
  const status = await request("/api/herdr/status", {
    signal: AbortSignal.timeout(5000),
  });
  const info = (await status.json()) as {
    state?: string;
    error?: string;
    can_setup?: boolean;
    protocol?: number;
  };
  if (!status.ok) throw new Error(info.error ?? "Cannot inspect Herdr");
  if (info.state === "running") {
    if (!isSupportedHerdrProtocol(info.protocol))
      throw new Error(
        `This desktop build does not support Herdr protocol ${info.protocol}. Your running server has been left untouched.`,
      );
    return;
  }
  if (!info.can_setup)
    throw new Error(
      "Automatic Herdr setup is unavailable for this connection. Open logs to inspect the configuration.",
    );
  updateStartup(
    info.state === "missing"
      ? "Installing the verified Herdr runtime..."
      : "Starting Herdr in the background...",
    "The first launch may take a minute. Herdr runs as your user and keeps agents alive independently of this window.",
  );
  const response = await request("/api/herdr/setup", {
    method: "POST",
    headers: { "x-roamgate-herdr-setup": "1" },
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Herdr did not start");
}
async function stopBridge() {
  clearInterval(healthTimer);
  clearTimeout(restartTimer);
  const previous = child;
  child = null;
  if (!previous || previous.exitCode !== null) return;
  await request("/api/desktop/shutdown", {
    method: "POST",
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
  await new Promise<void>((done) => {
    if (previous.exitCode !== null) {
      done();
      return;
    }
    const timeout = setTimeout(() => {
      previous.kill();
      done();
    }, 5000);
    previous.once("exit", () => {
      clearTimeout(timeout);
      done();
    });
  });
}
async function startRuntime() {
  if (starting || quitting) return;
  starting = true;
  try {
    await stopBridge();
    if (quitting) return;
    updateStartup(
      "Starting your workspace...",
      "Connecting to your local Herdr engine.",
    );
    await showStartup();
    if (!existsSync(bridgePath))
      throw new Error(
        "The bundled bridge is missing. Reinstall Roamgate Desktop or run bun run desktop:build.",
      );
    const preferred =
      Number.isInteger(prefs.port) && prefs.port! > 1024 && prefs.port! <= 65535
        ? prefs.port!
        : 18787;
    const port = await freePort(preferred);
    if (quitting) return;
    prefs.port = port;
    savePrefs();
    token = randomBytes(32).toString("hex");
    origin = `http://127.0.0.1:${port}`;
    const current = spawn(
      bridgePath,
      ["--host", "127.0.0.1", "--port", String(port)],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: data,
        env: bridgeEnvironment(
          process.env,
          token,
          join(data, "connections.json"),
        ),
      },
    );
    child = current;
    let spawnError: Error | null = null;
    current.on("error", (error) => {
      spawnError = error;
      logError(error);
    });
    for (const stream of [current.stdout, current.stderr])
      stream?.on("data", (chunk: Buffer) =>
        log(chunk.toString().replaceAll(token, "[redacted]")),
      );
    current.on("exit", (code) => {
      log(`Bridge exited (${code})`);
      if (child !== current || quitting) return;
      child = null;
      if (!starting && restartCount++ < 3) {
        updateStartup(
          "Reconnecting...",
          "The desktop connection stopped. Restarting it; Herdr and your agents are still running.",
        );
        void showStartup();
        restartTimer = setTimeout(
          () => void startRuntime(),
          1500 * restartCount,
        );
      } else if (!starting) {
        updateStartup(
          "The desktop connection needs attention",
          "Automatic retries have stopped. Open logs or choose Try again.",
          true,
        );
        void showStartup();
      }
    });
    const deadline = Date.now() + 25_000;
    for (;;) {
      if (quitting) return;
      if (spawnError) throw spawnError;
      if (current.exitCode !== null)
        throw new Error(
          `The desktop bridge exited (${current.exitCode}). Open logs for details.`,
        );
      try {
        if (
          (await request("/api/health", { signal: AbortSignal.timeout(1000) }))
            .ok
        )
          break;
      } catch {
        /* wait for bind */
      }
      if (Date.now() > deadline)
        throw new Error("The local desktop connection did not become ready.");
      await new Promise((done) => setTimeout(done, 200));
    }
    await ensureHerdr();
    if (quitting) return;
    await window!.loadURL(origin);
    log("Desktop and Herdr are ready");
    healthTimer = setInterval(() => {
      if (herdrRepair || starting || quitting) return;
      herdrRepair = ensureHerdr()
        .then(async () => {
          if (window?.webContents.getURL() === startupUrl && !quitting)
            await window.loadURL(origin);
        })
        .catch((error) => {
          clearInterval(healthTimer);
          logError(error);
          updateStartup(
            "Herdr needs attention",
            (error as Error).message,
            true,
          );
          void showStartup();
        })
        .finally(() => {
          herdrRepair = null;
        });
    }, 30_000);
    if (smoke && !smokeStarted) {
      smokeStarted = true;
      void smokeCheck();
    }
  } catch (error) {
    logError(error);
    await stopBridge();
    updateStartup(
      "Could not start your workspace",
      (error as Error).message,
      true,
    );
    await showStartup();
    if (smoke) {
      writeFileSync(
        join(data, "result.json"),
        JSON.stringify({ ok: false, error: String(error) }),
      );
      app.quit();
    }
  } finally {
    starting = false;
  }
}

async function smokeCheck() {
  try {
    await new Promise((done) => setTimeout(done, 8000));
    const unauthorized = await fetch(`${origin}/api/health`);
    const crossOrigin = await request("/api/health", {
      headers: { origin: "https://example.com" },
    });
    const update = await request("/api/update/install", { method: "POST" });
    const ui = await window!.webContents.executeJavaScript(
      "({text:document.body.innerText.slice(0,3000), mounted:document.getElementById('root')?.childElementCount>0, node:typeof require, desktop:typeof window.roamgateDesktop?.showWindow})",
    );
    const herdr = await (await request("/api/herdr/status")).json();
    const oldPid = child?.pid;
    child?.kill();
    const reconnectDeadline = Date.now() + 30_000;
    while (
      (!child ||
        child.pid === oldPid ||
        starting ||
        window!.webContents.getURL() === startupUrl) &&
      Date.now() < reconnectDeadline
    ) {
      await new Promise((done) => setTimeout(done, 250));
    }
    const recovered =
      !!child &&
      child.pid !== oldPid &&
      !starting &&
      window!.webContents.getURL() !== startupUrl;
    writeFileSync(
      join(data, "screenshot.png"),
      (await window!.webContents.capturePage()).toPNG(),
    );
    window!.close();
    const closeToTray = !window!.isDestroyed() && !window!.isVisible();
    const report = {
      ok:
        unauthorized.status === 401 &&
        crossOrigin.status === 403 &&
        update.status === 403 &&
        ui.mounted &&
        ui.node === "undefined" &&
        ui.desktop === "function" &&
        recovered &&
        closeToTray,
      unauthorized: unauthorized.status,
      crossOrigin: crossOrigin.status,
      updater: update.status,
      closeToTray,
      recovered,
      ui,
      herdr,
    };
    writeFileSync(join(data, "result.json"), JSON.stringify(report, null, 2));
  } catch (error) {
    writeFileSync(
      join(data, "result.json"),
      JSON.stringify({ ok: false, error: String(error) }),
    );
  }
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("window-all-closed", () => {
    /* tray owns the lifetime */
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    globalShortcut.unregisterAll();
    void stopBridge().finally(() => {
      tray?.destroy();
      app.quit();
    });
  });
  void app
    .whenReady()
    .then(async () => {
      const stored = prefs.bounds;
      const visibleBounds =
        stored &&
        Number.isFinite(stored.x) &&
        Number.isFinite(stored.y) &&
        stored.width >= 800 &&
        stored.height >= 600 &&
        screen
          .getAllDisplays()
          .some(
            ({ workArea: area }) =>
              stored.x + stored.width > area.x &&
              stored.y + stored.height > area.y &&
              stored.x < area.x + area.width &&
              stored.y < area.y + area.height,
          );
      window = new BrowserWindow({
        ...(visibleBounds ? stored : { width: 1440, height: 920 }),
        minWidth: 800,
        minHeight: 600,
        show: false,
        title: "Roamgate Desktop",
        backgroundColor: "#101216",
        icon: join(assets, "icon.png"),
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(app.getAppPath(), "dist", "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
          spellcheck: false,
          partition: "persist:roamgate-desktop",
        },
      });
      const desktopSession = window.webContents.session;
      window.webContents.on("preload-error", (_event, path, error) =>
        log(`Preload failed (${path}): ${error.stack ?? error.message}`),
      );
      desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        for (const key of Object.keys(headers))
          if (key.toLowerCase() === "x-roamgate-desktop") delete headers[key];
        if (
          origin &&
          details.webContentsId === window?.webContents.id &&
          isBridgeUrl(details.url, origin)
        )
          headers["x-roamgate-desktop"] = token;
        callback({ requestHeaders: headers });
      });
      desktopSession.setPermissionRequestHandler(
        (contents, permission, callback, details) =>
          callback(
            contents === window?.webContents &&
              isOwnFrame(details.requestingUrl) &&
              [
                "notifications",
                "clipboard-sanitized-write",
                "clipboard-read",
              ].includes(permission),
          ),
      );
      desktopSession.setPermissionCheckHandler(
        (contents, permission, requestingOrigin) =>
          contents === window?.webContents &&
          isOwnFrame(requestingOrigin) &&
          [
            "notifications",
            "clipboard-sanitized-write",
            "clipboard-read",
          ].includes(permission),
      );
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (
          safeExternalUrl(url) &&
          !isBridgeUrl(url, origin || "http://127.0.0.1")
        )
          void shell.openExternal(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (!isOwnFrame(url)) {
          event.preventDefault();
          if (safeExternalUrl(url)) void shell.openExternal(url);
        }
      });
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.webContents.on("will-redirect", (event, url) => {
        if (!isOwnFrame(url)) event.preventDefault();
      });
      window.webContents.on("render-process-gone", (_event, detail) => {
        log(`Renderer stopped: ${detail.reason}`);
        if (!quitting) void window?.loadURL(origin || startupUrl);
      });
      window.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        window?.hide();
      });
      const saveBounds = () => {
        if (!window || window.isDestroyed()) return;
        prefs.bounds = window.getNormalBounds();
        prefs.maximized = window.isMaximized();
        savePrefs();
      };
      window.on("resized", saveBounds);
      window.on("moved", saveBounds);
      window.on("maximize", saveBounds);
      window.on("unmaximize", saveBounds);
      window.webContents.on("did-finish-load", () => {
        if (window?.webContents.getURL() === startupUrl)
          updateStartup(bootState.title, bootState.detail, bootState.failed);
      });
      ipcMain.on("desktop:show", (event) => {
        if (
          event.sender === window?.webContents &&
          isOwnFrame(event.senderFrame?.url ?? "")
        )
          showWindow();
      });
      ipcMain.on("desktop:retry", (event) => {
        if (
          event.sender === window?.webContents &&
          event.senderFrame?.url === startupUrl
        ) {
          restartCount = 0;
          void startRuntime();
        }
      });
      ipcMain.on("desktop:logs", (event) => {
        if (
          event.sender === window?.webContents &&
          isOwnFrame(event.senderFrame?.url ?? "")
        )
          void shell.openPath(data);
      });
      tray = new Tray(
        nativeImage
          .createFromPath(join(assets, "icon.png"))
          .resize({ width: 32, height: 32 }),
      );
      tray.setToolTip("Roamgate Desktop · Herdr");
      tray.on("double-click", showWindow);
      rebuildMenu();
      if (app.isPackaged && prefs.launchAtLogin === undefined)
        setAutostart(true);
      if (!smoke)
        globalShortcut.register("CommandOrControl+Shift+Space", () =>
          window?.isVisible() && window.isFocused()
            ? window.hide()
            : showWindow(),
        );
      if (prefs.maximized) window.maximize();
      await showStartup();
      if (!process.argv.includes("--startup") && !smoke) showWindow();
      await startRuntime();
    })
    .catch((error) => {
      logError(error);
      dialog.showErrorBox("Roamgate Desktop", String(error));
      app.quit();
    });
}
