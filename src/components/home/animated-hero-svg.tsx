"use client";

import { useCallback, useEffect, useRef } from "react";

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function AnimatedHeroSvg() {
  const objectRef = useRef<HTMLObjectElement | null>(null);
  const hoverAnimationsRef = useRef<Animation[]>([]);
  const introPlayedRef = useRef(false);
  const loopStartedRef = useRef(false);

  const applyThemePalette = useCallback(() => {
    const doc = objectRef.current?.contentDocument;
    if (!doc) return;

    const theme = document.documentElement.getAttribute("data-theme") ?? "dark";
    const isDark = theme.startsWith("dark");

    // Dedicated illustration palette: tuned to preserve local contrast/detail.
    const fromTo = new Map<string, string>(
      isDark
        ? [
            // Dark mode: keep neon spirit, reduce fill dominance.
            ["#FFC727", "#BFD941"],
            ["#455A64", "#5C7283"],
            ["#37474F", "#4D6472"],
          ]
        : [
            // Light mode: avoid near-black replacement that crushes details.
            ["#FFC727", "#7B9141"],
            ["#455A64", "#5A6F7D"],
            ["#37474F", "#485D6B"],
          ]
    );

    const nodes = Array.from(doc.querySelectorAll<SVGElement>("[style*='fill:#'], [fill]"));
    nodes.forEach((node) => {
      const inlineStyle = node.getAttribute("style");
      if (inlineStyle && inlineStyle.includes("fill:")) {
        const baseStyle = node.getAttribute("data-base-style") ?? inlineStyle;
        if (!node.hasAttribute("data-base-style")) {
          node.setAttribute("data-base-style", inlineStyle);
        }

        const nextStyle = baseStyle.replace(/fill:\s*(#[0-9a-fA-F]{6})/g, (match, hex: string) => {
          const mapped = fromTo.get(hex.toUpperCase());
          return mapped ? `fill:${mapped}` : match;
        });

        if (nextStyle !== node.getAttribute("style")) {
          node.setAttribute("style", nextStyle);
        }
      }

      const currentFill = node.getAttribute("fill");
      if (currentFill) {
        const baseFill = node.getAttribute("data-base-fill") ?? currentFill;
        if (!node.hasAttribute("data-base-fill")) {
          node.setAttribute("data-base-fill", currentFill);
        }

        const mapped = fromTo.get(baseFill.toUpperCase());
        if (mapped) {
          node.setAttribute("fill", mapped);
        }
      }
    });
  }, []);

  const stopHoverLoop = useCallback(() => {
    hoverAnimationsRef.current.forEach((animation) => animation.cancel());
    hoverAnimationsRef.current = [];
  }, []);

  const playLoop = useCallback(() => {
    const doc = objectRef.current?.contentDocument;
    if (!doc || loopStartedRef.current) return;

    stopHoverLoop();

    const targets = [
      {
        selector: 'g[id*="Character"]',
        keyframes: [
          { transform: "translate3d(0, 0, 0) rotate(0deg)" },
          { transform: "translate3d(0, -16px, 0) rotate(-3.4deg)" },
          { transform: "translate3d(0, 0, 0) rotate(0deg)" },
        ],
        options: { duration: 2500, easing: "ease-in-out" as const },
      },
      {
        selector: 'g[id*="Galaxy"]',
        keyframes: [
          { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
          { transform: "translate3d(0, -13px, 0) scale(1.1)", opacity: 0.93 },
          { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
        ],
        options: { duration: 3000, easing: "ease-in-out" as const },
      },
      {
        selector: 'g[id*="Plant"]',
        keyframes: [
          { transform: "translate3d(0, 0, 0) rotate(0deg)" },
          { transform: "translate3d(6px, -10px, 0) rotate(4.2deg)" },
          { transform: "translate3d(0, 0, 0) rotate(0deg)" },
        ],
        options: { duration: 2200, easing: "ease-in-out" as const },
      },
    ];

    targets.forEach((target) => {
      const element = doc.querySelector<SVGGElement>(target.selector);
      if (!element) return;

      element.style.transformOrigin = "50% 50%";
      element.style.transformBox = "fill-box";

      const animation = element.animate(target.keyframes, {
        ...target.options,
        iterations: Infinity,
      });

      hoverAnimationsRef.current.push(animation);
    });

    loopStartedRef.current = true;
  }, [stopHoverLoop]);

  const playIntro = useCallback(() => {
    const doc = objectRef.current?.contentDocument;
    if (!doc || introPlayedRef.current) return;

    const backgroundGroup = doc.querySelector<SVGGElement>('g[id*="background-complete"]');
    if (backgroundGroup) {
      backgroundGroup.style.opacity = "0.22";
    }

    const groups = Array.from(doc.querySelectorAll<SVGGElement>('svg > g[id^="freepik--"]'));
    if (!groups.length) return;

    groups.forEach((group) => {
      group.style.transformOrigin = "50% 50%";
      group.style.transformBox = "fill-box";

      const translateX = randomBetween(-20, 20);
      const translateY = randomBetween(-18, 18);
      const rotate = randomBetween(-3, 3);
      const scale = randomBetween(0.94, 0.985);

      group.animate(
        [
          {
            opacity: 0,
            transform: `translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotate}deg) scale(${scale})`,
          },
          { opacity: 1, transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)" },
        ],
        {
          duration: randomBetween(850, 1600),
          delay: randomBetween(0, 520),
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        }
      );
    });

    introPlayedRef.current = true;
  }, []);

  const handleLoad = useCallback(() => {
    applyThemePalette();
    playIntro();
    playLoop();
  }, [applyThemePalette, playIntro, playLoop]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver((mutations) => {
      const themeChanged = mutations.some(
        (mutation) => mutation.type === "attributes" && mutation.attributeName === "data-theme"
      );
      if (themeChanged) {
        applyThemePalette();
      }
    });

    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [applyThemePalette]);

  return (
    <div className="hero-asset-wrap relative w-full max-w-xl opacity-95">
      <object
        ref={objectRef}
        data="/assets/svg/virtual-reality-cuate.svg"
        type="image/svg+xml"
        aria-label="Streaming visual hero"
        onLoad={handleLoad}
        className="hero-asset h-auto w-full select-none illustration-glow"
      />
    </div>
  );
}
