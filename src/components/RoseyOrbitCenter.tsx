import React, { useEffect, useRef } from "react";
import { AppState } from "../types";

interface RoseyOrbitCenterProps {
  assistantName: string;
  appState: AppState;
  isMicHearing?: boolean;
  audioLevel?: number;
  onToggleCall?: () => void;
}

// 4 Mathematical Elliptical Orbits with tilted geometry
const ORBITS = [
  {
    // Orbit 1: Wide tilted ellipse (-25 deg)
    rx: 420,
    ry: 165,
    theta: (-25 * Math.PI) / 180,
    baseSpeed: 0.22,
    initialAngle: 0.8,
    isDotted: true,
  },
  {
    // Orbit 2: Steep tilted ellipse (60 deg)
    rx: 360,
    ry: 145,
    theta: (60 * Math.PI) / 180,
    baseSpeed: -0.18,
    initialAngle: 2.2,
    isDotted: true,
  },
  {
    // Orbit 3: Steep opposite ellipse (-60 deg)
    rx: 340,
    ry: 135,
    theta: (-60 * Math.PI) / 180,
    baseSpeed: 0.26,
    initialAngle: 4.1,
    isDotted: true,
  },
  {
    // Orbit 4: Faint solid ring (18 deg)
    rx: 450,
    ry: 190,
    theta: (18 * Math.PI) / 180,
    baseSpeed: -0.15,
    initialAngle: 5.3,
    isDotted: false,
  },
];

export default function RoseyOrbitCenter({
  assistantName,
  appState,
  isMicHearing = false,
  audioLevel = 0,
  onToggleCall,
}: RoseyOrbitCenterProps) {
  const isSpeaking = appState === "speaking";
  const isListening = appState === "listening";

  // References for the 4 traveling glowing dots
  const dot1Ref = useRef<SVGGElement | null>(null);
  const dot2Ref = useRef<SVGGElement | null>(null);
  const dot3Ref = useRef<SVGGElement | null>(null);
  const dot4Ref = useRef<SVGGElement | null>(null);

  // Store angles & latest audio level in refs for 60fps RAF loop without React re-renders
  const audioLevelRef = useRef(audioLevel);
  audioLevelRef.current = audioLevel;

  const anglesRef = useRef([
    ORBITS[0].initialAngle,
    ORBITS[1].initialAngle,
    ORBITS[2].initialAngle,
    ORBITS[3].initialAngle,
  ]);

  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const dotRefs = [dot1Ref, dot2Ref, dot3Ref, dot4Ref];
    const centerX = 500;
    const centerY = 300;

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Current volume speed factor (scales dots with live mic/voice volume)
      const speedMultiplier = 1 + Math.min(audioLevelRef.current * 4, 3.5);

      for (let i = 0; i < ORBITS.length; i++) {
        const orbit = ORBITS[i];
        anglesRef.current[i] += orbit.baseSpeed * speedMultiplier * dt;
        const phi = anglesRef.current[i];

        // Parametric ellipse math with tilt theta
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);
        const cosTheta = Math.cos(orbit.theta);
        const sinTheta = Math.sin(orbit.theta);

        const x = centerX + orbit.rx * cosPhi * cosTheta - orbit.ry * sinPhi * sinTheta;
        const y = centerY + orbit.rx * cosPhi * sinTheta + orbit.ry * sinPhi * cosTheta;

        const dotEl = dotRefs[i].current;
        if (dotEl) {
          dotEl.setAttribute("transform", `translate(${x.toFixed(1)}, ${y.toFixed(1)})`);
        }
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Compute helper path for an ellipse tilted by angle deg
  const makeEllipsePath = (rx: number, ry: number, thetaRad: number) => {
    const cx = 500;
    const cy = 300;
    const deg = (thetaRad * 180) / Math.PI;
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  };

  // Clean assistant name
  const cleanName =
    !assistantName || assistantName.toLowerCase() === "xantrikx"
      ? "Rosey"
      : assistantName.charAt(0).toUpperCase() + assistantName.slice(1);

  // Audio reactivity scale for pill glow
  const volumeScale = 1 + Math.min(audioLevel * 0.22, 0.25);
  const glowOpacity = isSpeaking ? 0.95 : isListening && isMicHearing ? 0.85 : 0.7;

  return (
    <div className="relative w-full h-full flex items-center justify-center select-none overflow-visible">
      {/* SVG Tilted Elliptical Orbit Rings with Dotted Lines & 4 Glowing Dots */}
      <svg
        className="absolute w-[95vw] max-w-[1200px] h-[75vh] max-h-[700px] pointer-events-none overflow-visible"
        viewBox="0 0 1000 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Intense Bloom Flare for Travelling White Dots */}
          <filter id="super-dot-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Orbit Ring 1 (Dotted) */}
        <path
          d={makeEllipsePath(ORBITS[0].rx, ORBITS[0].ry, ORBITS[0].theta)}
          transform={`rotate(${(-25).toFixed(1)} 500 300)`}
          stroke="var(--accent)"
          strokeWidth="1.8"
          strokeDasharray="2 6"
          strokeLinecap="round"
          strokeOpacity="0.55"
        />

        {/* Orbit Ring 2 (Dotted) */}
        <path
          d={makeEllipsePath(ORBITS[1].rx, ORBITS[1].ry, ORBITS[1].theta)}
          transform={`rotate(${(60).toFixed(1)} 500 300)`}
          stroke="var(--accent)"
          strokeWidth="1.8"
          strokeDasharray="2 6"
          strokeLinecap="round"
          strokeOpacity="0.55"
        />

        {/* Orbit Ring 3 (Dotted) */}
        <path
          d={makeEllipsePath(ORBITS[2].rx, ORBITS[2].ry, ORBITS[2].theta)}
          transform={`rotate(${(-60).toFixed(1)} 500 300)`}
          stroke="var(--accent)"
          strokeWidth="1.8"
          strokeDasharray="2 6"
          strokeLinecap="round"
          strokeOpacity="0.45"
        />

        {/* Orbit Ring 4 (1 Thin Solid Faint Ring) */}
        <path
          d={makeEllipsePath(ORBITS[3].rx, ORBITS[3].ry, ORBITS[3].theta)}
          transform={`rotate(${(18).toFixed(1)} 500 300)`}
          stroke="var(--accent)"
          strokeWidth="1"
          strokeOpacity="0.22"
        />

        {/* 4 Travelling Glowing Dots with Bright White Center and Accent Outer Bloom */}
        <g ref={dot1Ref}>
          <circle r="14" fill="var(--accent)" opacity="0.4" filter="url(#super-dot-glow)" />
          <circle r="8" fill="var(--accent)" opacity="0.75" />
          <circle r="4.5" fill="#ffffff" filter="url(#super-dot-glow)" />
        </g>

        <g ref={dot2Ref}>
          <circle r="14" fill="var(--accent)" opacity="0.4" filter="url(#super-dot-glow)" />
          <circle r="8" fill="var(--accent)" opacity="0.75" />
          <circle r="4.5" fill="#ffffff" filter="url(#super-dot-glow)" />
        </g>

        <g ref={dot3Ref}>
          <circle r="14" fill="var(--accent)" opacity="0.4" filter="url(#super-dot-glow)" />
          <circle r="8" fill="var(--accent)" opacity="0.75" />
          <circle r="4.5" fill="#ffffff" filter="url(#super-dot-glow)" />
        </g>

        <g ref={dot4Ref}>
          <circle r="14" fill="var(--accent)" opacity="0.4" filter="url(#super-dot-glow)" />
          <circle r="8" fill="var(--accent)" opacity="0.75" />
          <circle r="4.5" fill="#ffffff" filter="url(#super-dot-glow)" />
        </g>
      </svg>

      {/* THE CENTRAL LARGE GLASS CAPSULE (PILL) */}
      <div
        onClick={onToggleCall}
        className={`group relative z-10 flex items-center justify-center cursor-pointer transition-transform duration-300 ease-out active:scale-95 ${
          isSpeaking
            ? "scale-[1.04]"
            : isListening && isMicHearing
            ? "scale-[1.02]"
            : "hover:scale-[1.02]"
        }`}
        title="Tap to toggle live voice session"
      >
        {/* Soft, Broad Ambient Glow Halo around the Capsule */}
        <div
          className="absolute -inset-4 sm:-inset-6 rounded-full pointer-events-none transition-all duration-300 ease-out"
          style={{
            background:
              "radial-gradient(ellipse at center, var(--glow) 0%, color-mix(in srgb, var(--accent) 30%, transparent) 40%, transparent 75%)",
            filter: "blur(20px)",
            transform: `scale(${volumeScale})`,
            opacity: glowOpacity,
            willChange: "transform, opacity",
          }}
        />

        {/* Capsule Pill Body: width ~30vw (min 340px, max 560px), aspect ~2.5:1, translucent accent fill, 2px bright border */}
        <div
          className="relative w-[34vw] min-w-[340px] max-w-[560px] aspect-[2.5/1] rounded-full backdrop-blur-xl flex items-center justify-center border-2 transition-all duration-700 ease-out overflow-hidden"
          style={{
            backgroundColor: "color-mix(in srgb, var(--accent) 24%, rgba(10, 14, 28, 0.45))",
            borderColor: "var(--accent)",
            boxShadow: `
              0 0 45px var(--glow),
              0 0 90px var(--accent-soft),
              inset 0 1px 2px rgba(255, 255, 255, 0.45),
              inset 0 -1px 2px rgba(0, 0, 0, 0.5)
            `,
          }}
        >
          {/* Top Glass Gloss Sheen Highlight */}
          <div className="absolute top-1 left-8 right-8 h-[40%] rounded-full bg-gradient-to-b from-white/25 via-white/5 to-transparent pointer-events-none opacity-80" />

          {/* Central Rosey Name in Pacifico cursive, white, clean and large */}
          <span
            className="font-['Pacifico',cursive] text-[44px] sm:text-[56px] md:text-[64px] font-normal text-white select-none transition-all duration-300 drop-shadow-[0_0_18px_rgba(255,255,255,0.7)]"
            style={{
              letterSpacing: "0.02em",
              textTransform: "none",
            }}
          >
            {cleanName}
          </span>
        </div>
      </div>
    </div>
  );
}
