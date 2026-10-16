import React, { useMemo } from "react";

interface Star {
  id: number;
  top: string;
  left: string;
  size: number;
  opacity: number;
  duration: string;
  delay: string;
}

interface StarfieldProps {
  glowScale?: number;
  glowOpacity?: number;
}

export default function Starfield({ glowScale = 1, glowOpacity = 0.85 }: StarfieldProps) {
  // 60 tiny twinkling stars, pure CSS transform & opacity
  const stars = useMemo<Star[]>(() => {
    const list: Star[] = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      list.push({
        id: i,
        top: `${(Math.random() * 96 + 2).toFixed(1)}%`,
        left: `${(Math.random() * 96 + 2).toFixed(1)}%`,
        size: Math.random() > 0.85 ? 2.2 : Math.random() > 0.4 ? 1.6 : 1.0,
        opacity: +(Math.random() * 0.55 + 0.25).toFixed(2),
        duration: `${(Math.random() * 4 + 4).toFixed(1)}s`,
        delay: `${(Math.random() * 5).toFixed(1)}s`,
      });
    }
    return list;
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
      {/* 1. Large, Strong Radial Accent Glow Centered behind the pill (fills ~60% of screen) */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85vw] max-w-[1050px] h-[75vh] max-h-[780px] rounded-full pointer-events-none transition-transform duration-300 ease-out"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 50% 50%, color-mix(in srgb, var(--accent) 55%, transparent) 0%, color-mix(in srgb, var(--accent) 32%, transparent) 32%, color-mix(in srgb, var(--accent) 12%, transparent) 58%, transparent 78%)",
          filter: "blur(24px)",
          transform: `translate(-50%, -50%) scale(${glowScale})`,
          opacity: glowOpacity,
          willChange: "transform, opacity",
        }}
      />

      {/* 2. Faint Diagonal Light Streaks matching the reference aesthetic */}
      <div
        className="absolute top-[32%] -left-[20vw] w-[140vw] h-[100px] pointer-events-none -rotate-[24deg] opacity-[0.09]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent) 60%, transparent) 50%, transparent 100%)",
          filter: "blur(12px)",
        }}
      />
      <div
        className="absolute top-[52%] -left-[20vw] w-[140vw] h-[140px] pointer-events-none rotate-[34deg] opacity-[0.07]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent) 60%, transparent) 50%, transparent 100%)",
          filter: "blur(14px)",
        }}
      />

      {/* 3. About 60 Tiny Twinkling Stars */}
      {stars.map((s) => (
        <span
          key={s.id}
          className="star-particle absolute rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.85)]"
          style={
            {
              top: s.top,
              left: s.left,
              width: `${s.size}px`,
              height: `${s.size}px`,
              opacity: s.opacity,
              "--duration": s.duration,
              "--delay": s.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
