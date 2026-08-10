'use client';

import { useEffect, useRef } from 'react';

interface RadarOverlayProps {
  centerX: number;
  centerY: number;
  radiusPx: number;
  enabled: boolean;
}

const SWEEP_SPEED = 0.7; // radians/second — one full rotation ~8.97 seconds (realistic radar is 5-12s)
const TRAIL_ARC = Math.PI / 2; // 90° phosphor afterglow
const TRAIL_STEPS = 32;

export default function RadarOverlay({ centerX, centerY, radiusPx, enabled }: RadarOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const angleRef = useRef<number>(-Math.PI / 2); // start sweeping from 12 o'clock

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    if (!ctx) return;

    const dpr = window.devicePixelRatio ?? 1;
    const size = radiusPx * 2;

    // Set physical resolution for crisp rendering on retina
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = radiusPx; // center within canvas (CSS pixels)
    const cy = radiusPx;
    const r = radiusPx - 1; // leave 1px margin so outer ring isn't clipped

    let lastTime = performance.now();

    function draw(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms to avoid big jumps
      lastTime = now;
      angleRef.current += SWEEP_SPEED * dt;
      const angle = angleRef.current;

      ctx.clearRect(0, 0, size, size);

      // Clip everything to the radar circle so no drawing bleeds outside
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      // 1. Very faint background tint to give the radar a scope feel
      ctx.fillStyle = 'rgba(0, 30, 10, 0.12)';
      ctx.fill();

      // 2. Phosphor afterglow trail — arc wedge fading from sweep line backward 90°
      for (let i = 0; i < TRAIL_STEPS; i++) {
        // t=0 near the sweep (bright), t=1 far behind (dark)
        const t = i / TRAIL_STEPS;
        const tNext = (i + 1) / TRAIL_STEPS;
        const arcStart = angle - TRAIL_ARC * tNext;
        const arcEnd = angle - TRAIL_ARC * t;

        // Exponential decay: bright near the line, fast fade
        const alpha = Math.pow(1 - t, 1.6) * 0.22;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, arcStart, arcEnd);
        ctx.closePath();
        ctx.fillStyle = `rgba(57, 255, 20, ${alpha.toFixed(4)})`;
        ctx.fill();
      }

      // 3. Concentric rings at 25 / 50 / 75 / 100% of radius
      const ringFractions = [0.25, 0.5, 0.75, 1.0];
      ringFractions.forEach((frac) => {
        const isOuter = frac === 1.0;
        ctx.beginPath();
        ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
        ctx.strokeStyle = isOuter ? 'rgba(57, 255, 20, 0.35)' : 'rgba(57, 255, 20, 0.18)';
        ctx.lineWidth = isOuter ? 1.2 : 0.6;
        ctx.stroke();
      });

      // 4. Crosshair lines through center (very subtle)
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.strokeStyle = 'rgba(57, 255, 20, 0.10)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // 5. Sweep line — bright leading edge with glow
      const sweepX = cx + Math.cos(angle) * r;
      const sweepY = cy + Math.sin(angle) * r;

      ctx.save();
      ctx.shadowColor = '#39ff14';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sweepX, sweepY);
      ctx.strokeStyle = 'rgba(57, 255, 20, 0.90)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // 6. Crosshair at center (small, precise)
      const CH = 8;
      ctx.beginPath();
      ctx.moveTo(cx - CH, cy);
      ctx.lineTo(cx + CH, cy);
      ctx.moveTo(cx, cy - CH);
      ctx.lineTo(cx, cy + CH);
      ctx.strokeStyle = 'rgba(57, 255, 20, 0.50)';
      ctx.lineWidth = 0.75;
      ctx.stroke();

      // 7. Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(57, 255, 20, 0.95)';
      ctx.fill();

      ctx.restore(); // end clip

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, radiusPx]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: centerX - radiusPx,
        top: centerY - radiusPx,
        width: radiusPx * 2,
        height: radiusPx * 2,
        pointerEvents: 'none',
        zIndex: 500,
      }}
    />
  );
}
