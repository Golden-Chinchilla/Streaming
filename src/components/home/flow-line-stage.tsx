"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import { createNoise2D } from "simplex-noise";

type FlowPath = {
  id: string;
  d: string;
  width: number;
  duration: number;
  delay: number;
  opacity: number;
};

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

export function FlowLineStage() {
  const paths = useMemo<FlowPath[]>(() => {
    const rand = seededRandom(20260217);
    const noise2D = createNoise2D(rand);

    return Array.from({ length: 11 }, (_, index) => {
      const points: Array<{ x: number; y: number }> = [];
      const segments = 9;
      const yBase = 110 + index * 42;

      for (let step = 0; step <= segments; step++) {
        const t = step / segments;
        const x = -80 + t * 1160;
        const noise = noise2D(index * 0.26, t * 1.85);
        const swing = noise * (34 + index * 1.7);
        const y = yBase + swing;
        points.push({ x, y });
      }

      return {
        id: `flow-line-${index}`,
        d: buildSmoothPath(points),
        width: 0.8 + (index % 3) * 0.7,
        duration: 11 + index * 0.9,
        delay: index * 0.35,
        opacity: 0.12 + (index % 4) * 0.07,
      };
    });
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg viewBox="0 0 1000 600" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="flow-stage-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--text-primary)" stopOpacity="0" />
            <stop offset="35%" stopColor="var(--primary)" stopOpacity="0.9" />
            <stop offset="70%" stopColor="var(--text-primary)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--text-primary)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="flow-stage-vignette" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="var(--primary-subtle)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--bg-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1000" height="600" fill="url(#flow-stage-vignette)" />

        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            fill="none"
            stroke="url(#flow-stage-gradient)"
            strokeWidth={path.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0.76, opacity: path.opacity }}
            animate={{
              pathLength: [0.7, 1, 0.7],
              opacity: [path.opacity, Math.min(path.opacity + 0.2, 0.7), path.opacity],
              strokeDashoffset: [0, -90, -180],
            }}
            transition={{
              duration: path.duration,
              delay: path.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{ strokeDasharray: "16 18" }}
          />
        ))}
      </svg>
    </div>
  );
}
