export type AppTheme = "light" | "dark";

let clearTransitionTimer: number | null = null;

export function setThemeWithTransition(nextTheme: AppTheme, durationMs = 380) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const className = "theme-transition-active";
  const docWithViewTransition = document as Document & {
    startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
  };

  if (typeof docWithViewTransition.startViewTransition === "function") {
    docWithViewTransition.startViewTransition(() => {
      root.setAttribute("data-theme", nextTheme);
    });
    return;
  }

  root.classList.add(className);

  window.requestAnimationFrame(() => {
    root.setAttribute("data-theme", nextTheme);
  });

  if (clearTransitionTimer !== null) {
    window.clearTimeout(clearTransitionTimer);
  }

  clearTransitionTimer = window.setTimeout(() => {
    root.classList.remove(className);
    clearTransitionTimer = null;
  }, durationMs + 90);
}
