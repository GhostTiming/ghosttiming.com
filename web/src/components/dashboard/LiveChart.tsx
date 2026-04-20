"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { RateBuffers } from "@/lib/rate-buffer";
import {
  binRatesForSeries,
  buildXs,
  trendFromRates,
  WINDOW_SECONDS,
} from "@/lib/chart-data";

export type SeriesSpec = {
  kind: "mac" | "antenna";
  mac: string;
  port?: string;
  label: string;
  color: string;
  linewidth: number;
  trend: boolean;
};

type Props = {
  buffers: React.MutableRefObject<RateBuffers>;
  series: SeriesSpec[];
  gateLabel?: string;
};

export function LiveChart({ buffers, series, gateLabel }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const seriesKey = series
    .map((s) => `${s.kind}:${s.mac}:${s.port ?? ""}:${s.label}:${s.color}:${s.linewidth}:${s.trend ? 1 : 0}`)
    .join("|");

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const xs = buildXs();

    const buildAlignedData = (
      specList: SeriesSpec[],
    ): uPlot.AlignedData => {
      const nowMono = performance.now();
      const ys: (Float64Array | number[])[] = [xs];
      if (specList.length === 0) {
        ys.push(new Float64Array(xs.length));
        return ys as unknown as uPlot.AlignedData;
      }
      for (const spec of specList) {
        const buf = buffers.current.get(spec.mac);
        const rates = binRatesForSeries(
          buf,
          nowMono,
          spec.kind,
          spec.port,
        );
        ys.push(rates);
        if (spec.trend) ys.push(trendFromRates(rates));
      }
      return ys as unknown as uPlot.AlignedData;
    };

    const buildSeriesOpts = (specList: SeriesSpec[]) => {
      if (specList.length === 0) {
        return [{ stroke: "#555", width: 1 }] as uPlot.Series[];
      }
      const out: uPlot.Series[] = [];
      for (const spec of specList) {
        out.push({
          label: spec.label,
          stroke: spec.color,
          width: spec.linewidth,
          spanGaps: true,
        });
        if (spec.trend) {
          out.push({
            label: `${spec.label} trend`,
            stroke: `${spec.color}99`,
            width: Math.max(0.9, spec.linewidth * 0.6),
            dash: [6, 6],
            spanGaps: true,
          });
        }
      }
      return out;
    };

    const mkOpts = (specList: SeriesSpec[]): uPlot.Options => ({
      width: el.clientWidth || 600,
      height: Math.min(420, Math.max(280, el.clientHeight || 360)),
      scales: {
        x: {
          time: false,
          range: [-WINDOW_SECONDS, 0],
        },
        y: { auto: true },
      },
      axes: [
        {
          stroke: "#9aa1b2",
          grid: { stroke: "rgba(255,255,255,0.08)" },
        },
        {
          stroke: "#9aa1b2",
          grid: { stroke: "rgba(255,255,255,0.08)" },
        },
      ],
      series: [{}, ...buildSeriesOpts(specList)],
      legend: { show: true, live: true },
    });

    const plot = new uPlot(
      mkOpts(seriesRef.current),
      buildAlignedData(seriesRef.current),
      el,
    );
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      if (!rootRef.current || !plotRef.current) return;
      plotRef.current.setSize({
        width: rootRef.current.clientWidth || 600,
        height: Math.min(
          420,
          Math.max(280, rootRef.current.clientHeight || 360),
        ),
      });
    });
    ro.observe(el);

    const iv = setInterval(() => {
      if (!plotRef.current) return;
      plotRef.current.setData(buildAlignedData(seriesRef.current));
    }, 1500);

    return () => {
      clearInterval(iv);
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [buffers, seriesKey]);

  return (
    <div className="flex min-h-[320px] w-full flex-col gap-2">
      <div className="text-xs text-muted">
        Rolling {WINDOW_SECONDS / 60} min ·{" "}
        {gateLabel ? `Gate ${gateLabel} · ` : ""}
        Thick = MAC · Thin = antenna · Dashed = trend
      </div>
      <div
        ref={rootRef}
        className="min-h-[320px] w-full overflow-hidden rounded-lg border border-border bg-[#0f1219]"
      />
    </div>
  );
}
