"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { RotateCw } from "lucide-react";
import errorArt from "@/assets/svg/500 Internal Server Error-cuate.svg";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-bg-primary px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 md:flex-row md:items-center">
        <div className="w-full max-w-xl">
          <Image
            src={errorArt}
            alt="Server error illustration"
            className="h-auto w-full object-contain illustration-glow"
            priority
          />
        </div>

        <section className="w-full max-w-md space-y-5 text-center md:text-left">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-text-secondary">50X Error</p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Something went wrong</h1>
          <p className="text-base leading-relaxed text-text-secondary">
            The server hit an unexpected state. You can retry, or go back to dashboard.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:brightness-95"
            >
              <RotateCw className="h-4 w-4" />
              Try Again
            </button>
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-border/70 bg-surface-container-high px-5 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary/40"
            >
              Back to Home
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

