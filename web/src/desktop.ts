declare global {
  interface Window {
    roamgateDesktop?: { showWindow(): void; retry(): void; openLogs(): void };
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.roamgateDesktop;
}

export function focusDesktopWindow(): void {
  window.roamgateDesktop?.showWindow();
  window.focus();
}
