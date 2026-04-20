"use client";

import type React from "react";
import { useEffect, useRef } from "react";
import type { HeatmapSlotState } from "@/types/workspace";
import type { RateBuffers } from "@/lib/rate-buffer";

const FLASH_DURATION = 0.18;
const DARKNESS_WINDOW = 30;
const DARKNESS_REFERENCE_HITS = 60;
const RENDER_INTERVAL_STABLE_MS = 900;
const RENDER_INTERVAL_ANIMATED_MS = 140;
const ELAPSED_ROUNDING_STABLE_SEC = 5;

function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 90) return `${whole}s ago`;
  const m = Math.floor(whole / 60);
  const s = Math.floor(whole % 60);
  if (m < 60) return `${m}m ${s}s ago`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m ago`;
}

export type HeatmapCanvasProps = {
  buffers: React.MutableRefObject<RateBuffers>;
  slots: HeatmapSlotState[];
  macRgb: (mac: string) => [number, number, number];
  displayMac: (mac: string) => string;
  portTotals: Map<string, number>;
  lastSeenWall: Map<string, number>;
  motionMode?: "stable" | "animated";
};

export function HeatmapCanvas({
  buffers,
  slots,
  macRgb,
  displayMac,
  portTotals,
  lastSeenWall,
  motionMode = "stable",
}: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<Map<number, number>>(new Map());
  const snapRef = useRef<Map<string, number>>(new Map());

  const propsRef = useRef({
    buffers,
    slots,
    macRgb,
    displayMac,
    portTotals,
    lastSeenWall,
    motionMode,
  });
  propsRef.current = {
    buffers,
    slots,
    macRgb,
    displayMac,
    portTotals,
    lastSeenWall,
    motionMode,
  };

  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(320, rect.width);
      const ch = Math.max(280, Math.round((cw * 520) / 900));
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawFrame() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const drawCtx = ctx;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;

      const p = propsRef.current;
      const slotsLocal = p.slots;
      const nowPerf = performance.now();
      const nowWall = Date.now();

      drawCtx.fillStyle = "#111218";
      drawCtx.fillRect(0, 0, W, H);

      function recentFactor(mac: string | null, port: string | null): number {
        if (!mac || port === null || port === undefined) return 0;
        if (p.motionMode === "stable") {
          const key = `${mac}:${port}`;
          const total = p.portTotals.get(key) ?? 0;
          const norm =
            DARKNESS_REFERENCE_HITS <= 0
              ? 0
              : Math.pow(total / DARKNESS_REFERENCE_HITS, 0.35);
          return 0.2 + 0.8 * Math.min(1, norm);
        }
        const buf = p.buffers.current.get(mac);
        const cutoff = nowPerf - DARKNESS_WINDOW;
        let hits = 0;
        for (const s of buf) {
          if (s.t >= cutoff && String(s.port) === String(port)) hits++;
        }
        const norm =
          DARKNESS_REFERENCE_HITS <= 0
            ? 0
            : Math.pow(hits / DARKNESS_REFERENCE_HITS, 0.5);
        return 0.12 + 0.88 * Math.min(1, norm);
      }

      function slotFill(
        mac: string | null,
        port: string | null,
        flashAge: number,
      ): string {
        const baseRgb: [number, number, number] = [0.08, 0.09, 0.12];
        let r = baseRgb[0],
          g = baseRgb[1],
          b = baseRgb[2];
        if (mac) {
          const target = p.macRgb(mac);
          const factor = recentFactor(mac, port);
          r = baseRgb[0] + factor * (target[0] - baseRgb[0]);
          g = baseRgb[1] + factor * (target[1] - baseRgb[1]);
          b = baseRgb[2] + factor * (target[2] - baseRgb[2]);
        } else {
          r = 0.1;
          g = 0.11;
          b = 0.14;
        }
        const animated = p.motionMode === "animated";
        if (animated && flashAge >= 0 && flashAge < FLASH_DURATION) {
          const alpha = (1 - flashAge / FLASH_DURATION) * 0.16;
          r = r + (1 - r) * alpha;
          g = g + (1 - g) * alpha;
          b = b + (1 - b) * alpha;
        }
        const R = Math.round(Math.min(255, Math.max(0, r * 255)));
        const G = Math.round(Math.min(255, Math.max(0, g * 255)));
        const B = Math.round(Math.min(255, Math.max(0, b * 255)));
        return `rgb(${R},${G},${B})`;
      }

      const margin = 12;
      const sideGap = 6;
      const sideUnitW = Math.max(42, Math.min(70, W * 0.055));
      const gutter = 12;

      const leftSlots = slotsLocal.filter((s) => s.role === "left");
      const rightSlots = slotsLocal.filter((s) => s.role === "right");
      const leftN = leftSlots.length;
      const rightN = rightSlots.length;
      const leftW =
        leftN > 0 ? leftN * sideUnitW + (leftN - 1) * sideGap : 0;
      const rightW =
        rightN > 0 ? rightN * sideUnitW + (rightN - 1) * sideGap : 0;

      const midX = margin + leftW + (leftN ? gutter : 0);
      let midW =
        W -
        margin * 2 -
        leftW -
        rightW -
        (leftN ? gutter : 0) -
        (rightN ? gutter : 0);
      if (midW < 40) midW = 40;

      const r1 = slotsLocal.filter((s) => s.role === "row1");
      const r2 = slotsLocal.filter((s) => s.role === "row2");
      const nRows = (r1.length ? 1 : 0) + (r2.length ? 1 : 0) || 1;
      const rowGap = 14;
      const rowH = Math.max(
        60,
        (H - margin * 2 - rowGap * Math.max(0, nRows - 1)) /
          Math.max(1, nRows),
      );

      const idxMap = new Map<string, number>();
      slotsLocal.forEach((s, i) =>
        idxMap.set(`${s.role}:${s.col}:${s.row}`, i),
      );

      function drawSlotAt(
        c: CanvasRenderingContext2D,
        s: HeatmapSlotState,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
      ) {
        const index =
          idxMap.get(`${s.role}:${s.col}:${s.row}`) ?? 0;
        const mac = s.mac ?? null;
        const port = s.port ?? null;
        const key =
          mac && port !== null ? `${mac}:${port}` : "";
        const prevSeen = key ? snapRef.current.get(key) : undefined;
        const seenWall = key ? p.lastSeenWall.get(key) : undefined;
        if (key && seenWall !== undefined) {
          if (prevSeen === undefined) snapRef.current.set(key, seenWall);
          else if (seenWall > prevSeen) {
            flashRef.current.set(index, nowPerf);
            snapRef.current.set(key, seenWall);
          }
        }

        const fs = flashRef.current.get(index);
        const flashAge = fs !== undefined ? nowPerf - fs : 999;
        if (fs !== undefined && flashAge >= FLASH_DURATION) {
          flashRef.current.delete(index);
        }

        const fill = slotFill(mac, port, flashAge);
        c.fillStyle = fill;
        c.strokeStyle = mac ? "#4a5160" : "#2a2f3a";
        c.lineWidth = 2;
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        c.strokeRect(x0, y0, x1 - x0, y1 - y0);

        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const w = x1 - x0;
        const h = y1 - y0;
        const header =
          mac && port !== null
            ? `${p.displayMac(mac)} \u00b7 Ant ${port}`
            : `${
                s.role === "left"
                  ? "Left"
                  : s.role === "right"
                    ? "Right"
                    : s.role === "row1"
                      ? "Row 1"
                      : "Row 2"
              }`;

        const elapsed =
          mac && port !== null && key
            ? (() => {
                const t = p.lastSeenWall.get(key);
                if (t === undefined) return "no reads yet";
                const sec = (nowWall - t) / 1000;
                if (p.motionMode === "stable") {
                  const rounded =
                    Math.floor(sec / ELAPSED_ROUNDING_STABLE_SEC) *
                    ELAPSED_ROUNDING_STABLE_SEC;
                  return formatElapsed(rounded);
                }
                return formatElapsed(sec);
              })()
            : "";

        const total =
          mac && port !== null && key ? p.portTotals.get(key) ?? 0 : 0;
        const countText =
          mac && port !== null ? total.toLocaleString() : "";
        const countLabel = mac && port !== null ? "reads" : "";

        c.save();
        const isSide = s.role === "left" || s.role === "right";
        if (isSide) {
          c.translate(cx, cy);
          c.rotate(-Math.PI / 2);
        } else {
          c.translate(cx, cy);
        }

        const boxW = isSide ? h : w;
        const boxH = isSide ? w : h;
        const scale = Math.max(0.6, Math.min(1.4, boxW / 220));
        const headerPx = Math.max(11, Math.round(13 * scale));
        const countPx = Math.max(22, Math.round(38 * scale));
        const smallPx = Math.max(10, Math.round(11 * scale));

        const maxTextW = boxW * 0.88;
        const fitText = (
          text: string,
          weight: string,
          desiredPx: number,
        ): { text: string; px: number } => {
          let px = desiredPx;
          for (let i = 0; i < 6; i++) {
            c.font = `${weight} ${px}px system-ui,sans-serif`;
            if (c.measureText(text).width <= maxTextW) break;
            px = Math.max(9, Math.round(px * 0.9));
          }
          return { text, px };
        };

        const headerFit = fitText(header, "600", headerPx);
        const countFit = countText
          ? fitText(countText, "700", countPx)
          : null;

        if (mac) {
          c.fillStyle = "rgba(255,255,255,0.92)";
        } else {
          c.fillStyle = "#8a90a0";
        }
        c.textAlign = "center";
        c.textBaseline = "middle";

        // Header near the top of the cell so it can't collide with the count.
        const topY = -boxH / 2 + Math.max(12, boxH * 0.14);
        c.font = `600 ${headerFit.px}px system-ui,sans-serif`;
        c.fillText(headerFit.text, 0, topY);

        if (countFit) {
          c.fillStyle = "rgba(255,255,255,0.98)";
          c.font = `700 ${countFit.px}px system-ui,sans-serif`;
          c.fillText(countFit.text, 0, 0);

          if (countLabel) {
            c.fillStyle = "rgba(210,214,226,0.78)";
            c.font = `500 ${smallPx}px system-ui,sans-serif`;
            c.fillText(countLabel, 0, countFit.px * 0.62);
          }
        }

        if (elapsed && mac) {
          c.fillStyle = "rgba(205,210,222,0.75)";
          c.font = `500 ${smallPx}px system-ui,sans-serif`;
          const bottomY = boxH / 2 - Math.max(10, boxH * 0.12);
          c.fillText(elapsed, 0, bottomY);
        }

        c.restore();
      }

      leftSlots.forEach((s, i) => {
        const x0 = margin + i * (sideUnitW + sideGap);
        drawSlotAt(drawCtx, s, x0, margin, x0 + sideUnitW, H - margin);
      });

      rightSlots.forEach((s, i) => {
        const x0 = W - margin - rightW + i * (sideUnitW + sideGap);
        drawSlotAt(drawCtx, s, x0, margin, x0 + sideUnitW, H - margin);
      });

      let rowTop = margin;
      const cellGap = 10;
      if (r1.length) {
        const n = r1.length;
        const cellW = Math.max(30, (midW - cellGap * (n - 1)) / n);
        r1.forEach((s, i) => {
          const x0 = midX + i * (cellW + cellGap);
          drawSlotAt(drawCtx, s, x0, rowTop, x0 + cellW, rowTop + rowH);
        });
        rowTop += rowH + rowGap;
      }
      if (r2.length) {
        const n = r2.length;
        const cellW = Math.max(30, (midW - cellGap * (n - 1)) / n);
        r2.forEach((s, i) => {
          const x0 = midX + i * (cellW + cellGap);
          drawSlotAt(drawCtx, s, x0, rowTop, x0 + cellW, rowTop + rowH);
        });
      }

    }

    resize();
    const ro = new ResizeObserver(resize);
    const par = canvasRef.current?.parentElement;
    if (par) ro.observe(par);
    drawFrame();
    let interval: number | null = null;
    if (motionMode === "animated") {
      interval = window.setInterval(drawFrame, RENDER_INTERVAL_ANIMATED_MS);
    } else if (RENDER_INTERVAL_STABLE_MS > 0) {
      // Stable mode redraws slowly only as a fallback.
      interval = window.setInterval(drawFrame, RENDER_INTERVAL_STABLE_MS);
    }

    return () => {
      if (interval !== null) {
        window.clearInterval(interval);
      }
      ro.disconnect();
    };
  }, [motionMode]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        className="block w-full max-w-full rounded-lg border border-border bg-[#111218]"
      />
    </div>
  );
}
