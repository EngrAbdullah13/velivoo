"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const GrowthProgress = createContext(1);
const DURATION_MS = 3800;

/** One clock keeps each scene's counters, chart and bars in sync. */
export function GrowthScene({ children, className, label }: {
  children: ReactNode;
  className: string;
  label: string;
}) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [progress, setProgress] = useState(1);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);

    let intersecting = false;
    const updateVisibility = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      updateVisibility();
    }, { threshold: [0, 0.25] });
    if (sceneRef.current) observer.observe(sceneRef.current);
    document.addEventListener("visibilitychange", updateVisibility);

    return () => {
      observer.disconnect();
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!visible || reducedMotion) {
      setProgress(1);
      return;
    }

    setProgress(0);
    let frame = 0;
    let startedAt: number | undefined;
    let lastPaint = 0;
    const tick = (now: number) => {
      startedAt ??= now;
      const elapsed = Math.min((now - startedAt) / DURATION_MS, 1);
      // Cap React updates to 30fps; the easing still uses actual elapsed time.
      if (now - lastPaint >= 1000 / 30 || elapsed === 1) {
        setProgress(1 - Math.pow(1 - elapsed, 3));
        lastPaint = now;
      }
      if (elapsed < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, reducedMotion, replay]);

  const state = !visible ? "offscreen" : reducedMotion ? "reduced" : progress < 1 ? "running" : "complete";
  return <div
    ref={sceneRef}
    className={`${className} growth-scene`}
    aria-label={label}
    data-growth-state={state}
    data-growth-progress={progress.toFixed(4)}
    style={{ "--growth-progress": progress } as CSSProperties}
  >
    <GrowthProgress.Provider value={progress}>{children}</GrowthProgress.Provider>
    <div className="growth-scene-caption">
      <span>Illustrative data</span>
      <button type="button" onClick={() => setReplay(value => value + 1)} disabled={reducedMotion}
        aria-label={`Replay ${label}`}>
        <span aria-hidden="true">↻</span> Replay growth
      </button>
    </div>
  </div>;
}

/** Keep the final value accessible and reserve its width to prevent layout jumps. */
export function GrowingNumber({ value, prefix = "", suffix = "", decimals = 0 }: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const progress = useContext(GrowthProgress);
  const format = (number: number) => `${prefix}${number.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;
  const finalValue = format(value);
  return <span className="growth-number" data-growth-target={finalValue}>
    <span className="growth-sr-only">{finalValue}</span>
    <span className="growth-number-size" aria-hidden="true">{finalValue}</span>
    <span className="growth-number-value" aria-hidden="true">{format(value * progress)}</span>
  </span>;
}
