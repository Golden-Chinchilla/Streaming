"use client";

import "@/plugins/register-all";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Moon, Sun, ArrowRight } from "lucide-react";
import logoLight from "@/assets/logo/logo-light.svg";
import { FlowLineStage } from "@/components/home/flow-line-stage";
import { AnimatedHeroSvg } from "@/components/home/animated-hero-svg";
import { loadAppPreferences, saveAppPreferences, upsertDocument } from "@/lib/storage";
import { getAllDiagramPlugins, getDiagramPlugin } from "@/lib/diagram-registry";
import { BaseDocument, DiagramType } from "@/lib/types";
import { setThemeWithTransition } from "@/lib/theme-transition";
import { DiagramTypePickerDialog } from "@/components/common/diagram-type-picker-dialog";

const nowTimestamp = () => Date.now();

export function Dashboard() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const parallaxTargetRef = useRef({ x: 0, y: 0 });
  const parallaxCurrentRef = useRef({ x: 0, y: 0 });
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [isEntering, setIsEntering] = useState(false);
  const [defaultDiagramType, setDefaultDiagramType] = useState<DiagramType | null>(null);
  const [showDiagramTypePicker, setShowDiagramTypePicker] = useState(false);
  const [rememberAsDefault, setRememberAsDefault] = useState(false);

  useEffect(() => {
    loadAppPreferences().then((prefs) => {
      setTheme(prefs.defaultTheme);
      document.documentElement.setAttribute("data-theme", prefs.defaultTheme);
      setDefaultDiagramType(prefs.defaultDiagramType ?? null);
    });
  }, []);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const current = parallaxCurrentRef.current;
      const target = parallaxTargetRef.current;

      current.x += (target.x - current.x) * 0.075;
      current.y += (target.y - current.y) * 0.075;

      if (containerRef.current) {
        containerRef.current.style.setProperty("--mx", `${current.x.toFixed(2)}px`);
        containerRef.current.style.setProperty("--my", `${current.y.toFixed(2)}px`);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const plugins = useMemo(() => getAllDiagramPlugins(), []);

  const handleToggleTheme = async () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeWithTransition(next);
    const prefs = await loadAppPreferences();
    await saveAppPreferences({ ...prefs, defaultTheme: next });
  };

  const createAndOpenEditor = async (type: DiagramType) => {
    const selectedPlugin = getDiagramPlugin(type);
    if (!selectedPlugin) {
      router.push("/editor");
      return;
    }
    const now = nowTimestamp();
    const newDoc: BaseDocument = {
      id: crypto.randomUUID(),
      title: `Untitled ${selectedPlugin.displayName}`,
      diagramType: selectedPlugin.type,
      folderId: null,
      createdAt: now,
      updatedAt: now,
      data: selectedPlugin.defaultData(),
    };

    await upsertDocument(newDoc);
    router.push(`/editor?id=${newDoc.id}`);
  };

  const handleEnterEditor = async () => {
    if (isEntering) return;
    const hasValidDefault = defaultDiagramType && Boolean(getDiagramPlugin(defaultDiagramType));
    if (!hasValidDefault) {
      setRememberAsDefault(false);
      setShowDiagramTypePicker(true);
      return;
    }

    setIsEntering(true);
    try {
      await createAndOpenEditor(defaultDiagramType);
    } finally {
      setIsEntering(false);
    }
  };

  const handleSelectDiagramType = async (type: DiagramType) => {
    setShowDiagramTypePicker(false);
    setIsEntering(true);
    try {
      if (rememberAsDefault) {
        const prefs = await loadAppPreferences();
        await saveAppPreferences({ ...prefs, defaultDiagramType: type });
        setDefaultDiagramType(type);
      }
      await createAndOpenEditor(type);
    } finally {
      setIsEntering(false);
      setRememberAsDefault(false);
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    parallaxTargetRef.current = { x: nx * 24, y: ny * 24 };
  };

  const handleMouseLeave = () => {
    parallaxTargetRef.current = { x: 0, y: 0 };
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="parallax-root relative min-h-screen overflow-hidden bg-bg-primary text-foreground"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="parallax-layer-far absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,color-mix(in_srgb,var(--primary)_18%,transparent)_0%,transparent_45%),radial-gradient(circle_at_78%_16%,color-mix(in_srgb,var(--text-primary)_12%,transparent)_0%,transparent_38%),radial-gradient(circle_at_50%_82%,color-mix(in_srgb,var(--primary)_10%,transparent)_0%,transparent_46%)]" />
        <div className="parallax-layer-near absolute inset-0">
          <FlowLineStage />
        </div>
        <div className="parallax-layer-far absolute inset-0 bg-[linear-gradient(to_bottom,transparent_15%,var(--bg-primary)_100%)]" />
      </div>

      <header className="relative z-20 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-3">
          <div className="brand-logo-entry brand-logo-shell grid h-12 w-12 place-items-center">
            <Image
              src={logoLight}
              alt="Streaming logo"
              className="brand-logo-img brand-logo-img--adaptive h-12 w-12 select-none"
              priority
            />
          </div>
          <span className="text-sm font-semibold uppercase tracking-[0.17em] text-foreground">Streaming</span>
        </div>
        <button
          onClick={handleToggleTheme}
          className="cursor-pointer rounded-full border border-border/70 bg-surface-container-high p-2.5 text-text-secondary transition hover:border-primary/50 hover:text-primary"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-84px)] w-full max-w-6xl items-center px-6 pb-14 md:px-10">
        <section className="grid w-full items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-8">
            <div className="space-y-6">
              <h1
                className="max-w-3xl text-5xl font-semibold leading-[0.95] tracking-[-0.03em] text-foreground md:text-7xl"
                style={{ fontFamily: "var(--font-syne), var(--font-inter), sans-serif" }}
              >
                Streaming
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-text-secondary md:text-base">
                Flow lines, cinematic contrast. Shape ideas into clear systems.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handleEnterEditor}
                disabled={isEntering}
                className="group inline-flex cursor-pointer items-center gap-2 rounded-full border border-primary/30 bg-primary px-7 py-3 text-sm font-semibold tracking-wide text-on-primary shadow-(--shadow-base) transition hover:-translate-y-0.5 hover:brightness-95 hover:shadow-(--shadow-lg) disabled:cursor-not-allowed disabled:opacity-65"
              >
                {isEntering ? "Preparing..." : "Enter Editor"}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="absolute -inset-6 rounded-[2rem] bg-surface-container/12 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border-base)_25%,transparent)] backdrop-blur-[1px]" />
            <AnimatedHeroSvg />
          </div>
        </section>
      </main>

      <DiagramTypePickerDialog
        isOpen={showDiagramTypePicker}
        plugins={plugins}
        onClose={() => {
          if (!isEntering) {
            setShowDiagramTypePicker(false);
            setRememberAsDefault(false);
          }
        }}
        onSelect={handleSelectDiagramType}
        title="Start With A Diagram Type"
        confirmHint="Choose the visualization module before entering the editor."
        isSubmitting={isEntering}
        rememberAsDefault={rememberAsDefault}
        onRememberAsDefaultChange={setRememberAsDefault}
      />
    </div>
  );
}
