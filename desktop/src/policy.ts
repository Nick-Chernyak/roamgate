export function isBridgeUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "http:" || url.protocol === "ws:") &&
      url.host === new URL(origin).host
    );
  } catch {
    return false;
  }
}

export function safeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["https:", "http:", "mailto:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function bridgeEnvironment(
  environment: NodeJS.ProcessEnv,
  token: string,
  profiles: string,
): NodeJS.ProcessEnv {
  const clean = { ...environment };
  for (const key of Object.keys(clean)) {
    if (
      /^(ROAMGATE_|HERDR_GUI_|HERDR_SOCKET_PATH$|HERDR_CLIENT_SOCKET_PATH$|HERDR_SSH_HOST$|HERDR_SESSION$|HOST$|PORT$|PUBLIC_DIR$|OPEN_BROWSER$)/i.test(
        key,
      )
    )
      delete clean[key];
  }
  return {
    ...clean,
    ROAMGATE_DESKTOP_TOKEN: token,
    ROAMGATE_CONNECTIONS_PATH: profiles,
    OPEN_BROWSER: "0",
  };
}
