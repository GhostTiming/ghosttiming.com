"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "@/hooks/use-toast";

export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
