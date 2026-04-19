"use client";

import * as React from "react";

export type ToastInput = {
  title: string;
  variant?: "default" | "destructive";
};

type Toast = ToastInput & { id: string };

const ToastContext = React.createContext<(t: ToastInput) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);

  const toast = React.useCallback((t: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(
      () => setItems((x) => x.filter((i) => i.id !== id)),
      4500,
    );
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ${
              t.variant === "destructive"
                ? "border-red-900/80 bg-red-950/95 text-red-100"
                : "border-border bg-card text-foreground"
            }`}
          >
            {t.title}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}
