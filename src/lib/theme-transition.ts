export type AppTheme = "light" | "dark";

let clearTransitionTimer: number | null = null;

export function setThemeWithTransition(
  nextTheme: AppTheme,
  event?: React.MouseEvent | MouseEvent,
  durationMs = 400
) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const className = "theme-transition-active";
  const docWithViewTransition = document as Document & {
    startViewTransition?: (updateCallback: () => void) => {
      finished: Promise<void>;
      ready: Promise<void>;
    };
  };

  const x = event?.clientX ?? window.innerWidth / 2;
  const y = event?.clientY ?? window.innerHeight / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  if (typeof docWithViewTransition.startViewTransition === "function") {
    const transition = docWithViewTransition.startViewTransition(() => {
      root.setAttribute("data-theme", nextTheme);
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];

      document.documentElement.animate(
        { clipPath },
        {
          duration: durationMs,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
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
