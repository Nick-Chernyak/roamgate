# Musipusi

The Windows x64 desktop application keeps the existing Roamgate interface and
uses Herdr as its terminal and agent runtime. Install the per-user NSIS installer
and open Musipusi. A working compatible Herdr server is reused. If it is
stopped, the desktop starts it through Roamgate's managed user service; if it is
missing, the verified Herdr release is downloaded with pinned checksum checks.
An incompatible running server is never replaced or downgraded.

## Everyday use

- Launch at Windows login is enabled on the first packaged launch. Change it in
  the tray menu, or in Windows Startup Apps. Login launches stay in the tray.
- Closing the window hides it in the tray. Double-click the tray icon or press
  Ctrl+Shift+Space to open it. The shortcut toggles a focused window.
- Alt reveals the application menu. It includes restart, logs and startup settings.
- Quit desktop stops its private Roamgate bridge, but leaves Herdr and agents
  running. Herdr has an independent user service; disabling desktop startup does
  not disable that service. See deployment documentation for service removal.
- Window bounds and maximization persist. Off-screen positions are discarded.
- Agent completion notifications are enabled initially in desktop mode and use
  the existing interface notification setting. Clicking one restores the window
  and navigates to its workspace/pane. Windows notification settings still apply.
- Open logs from the menu if startup fails; Try again retries without reinstalling
  or terminating a running Herdr server.

The first missing-runtime setup requires internet access. A compatible installed
runtime and an existing workspace work locally without a cloud account.

Musipusi is the desktop name of this Roamgate fork. The pixel bunny is its app,
tray and interface emblem. Upgrades retain the previous app ID and
`Roamgate Desktop` data directory so existing preferences and sessions survive;
the login entry is repaired when the executable name changes.

## Build

Use Windows x64, Bun 1.4.1+ and Node.js 22+:

```powershell
bun install --frozen-lockfile
node node_modules/electron/install.js
bun run desktop:typecheck
bun run desktop:test
bun run desktop:package
```

The installer is in `dist/desktop`. `bun run desktop:build` builds the application
and the embedded bridge; `bun run desktop:start` runs the unpackaged app.
Development runs never register Windows login startup. `bun run desktop:smoke`
runs a development smoke check with isolated desktop preferences, captures the
interface and writes results into `desktop/.smoke`. It uses the real local Herdr
runtime and can set it up when missing, just like the application.

Only Windows x64 desktop packaging is currently supported. The original web
release commands are independent. Desktop binaries are unsigned unless a signing
identity is provided to electron-builder; Windows may show an unrecognized
publisher prompt. No signing certificate is included in the repository.

## Runtime and security

Electron owns a dedicated loopback bridge. A fresh random 256-bit token is passed
through the child environment and injected only into requests from the desktop
window to that exact bridge, including WebSocket handshakes. It is never placed
in a URL or exposed by preload. The bridge checks Host, Origin and the token
before every endpoint, including health. The renderer has sandboxing and context
isolation enabled and no Node.js access. Preload only exposes show, retry and logs;
IPC validates the sender and frame. External HTTP(S)/mailto links open in the
system browser; arbitrary OS protocols are rejected.

Desktop preferences, its connection profiles, logs and Chromium session live in
Electron's `Roamgate Desktop` user-data directory. Existing Roamgate repository
settings and Herdr workspaces remain shared. The bridge prefers a remembered
loopback port and picks a free one when occupied; browser preferences are scoped
to the resulting origin. Original Roamgate web instances can remain running.

Bridge failures get three automatic retries; Herdr health is checked every 30
seconds. A failed Herdr recovery becomes an explicit retry screen. The desktop
does not stop an unrelated process or kill Herdr when it exits.

The web binary updater is blocked in desktop mode. Install a desktop release
from this fork to update; automatic desktop downloads, signatures and rollback
are not implemented. The bundled bridge is updated with the desktop application.
