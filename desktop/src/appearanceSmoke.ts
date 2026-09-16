import type { WebContents } from "electron";

// Exercise the real menu in the isolated smoke profile without typing into a terminal.
export async function checkAppearance(contents: WebContents) {
  const results = await contents.executeJavaScript(`(async () => {
    const wait = async (read) => {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const value = read();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Appearance control did not become ready');
    };
    const rows = [];
    for (const [label, id, background] of [
      ['Light', 'light', '#e1e2e7'],
      ['Dark', 'dark', '#1a1b26'],
      ['System', 'system', null],
      ['Trash Panda 2026', 'trash-panda-2026', '#151719'],
    ]) {
      if (!document.querySelector('[aria-label="Application theme"]')) {
        (await wait(() => document.querySelector('button[aria-label="Menu"], button[aria-label="Menu, update available"]'))).click();
      }
      (await wait(() => document.querySelector('[aria-label="Application theme"]'))).click();
      (await wait(() => Array.from(document.querySelectorAll('[cmdk-item]')).find(item => item.textContent.trim() === label))).click();
      await wait(() => document.documentElement.dataset.palette === id);
      const actual = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      const stored = localStorage.getItem('roamgate:theme');
      if ((background && actual !== background) || stored !== id) throw new Error('Theme mismatch: ' + id + ' ' + actual + ' ' + stored);
      rows.push({id, background: actual, stored});
    }
    return rows;
  })()`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Theme reload timed out")),
      15_000,
    );
    contents.once("did-finish-load", () => {
      clearTimeout(timeout);
      resolve();
    });
    contents.reload();
  });
  const persisted = await contents.executeJavaScript(`({
    palette: document.documentElement.dataset.palette,
    background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  })`);
  if (
    persisted.palette !== "trash-panda-2026" ||
    persisted.background !== "#151719"
  )
    throw new Error("Trash Panda did not survive reload");
  return { results, persisted };
}
