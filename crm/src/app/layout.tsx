import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GHOST_TIMING_ICON } from "@/lib/branding";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Prevent accidental page zoom from overflow; users can still zoom accessibility settings.
};

export const metadata: Metadata = {
  title: {
    default: "Ghost Timing CRM",
    template: "%s | Ghost Timing CRM",
  },
  description: "Race prospecting and operations for Ghost Timing",
  icons: {
    icon: [{ url: GHOST_TIMING_ICON, type: "image/png" }],
    shortcut: GHOST_TIMING_ICON,
    apple: GHOST_TIMING_ICON,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-50 text-slate-950">{children}</body>
    </html>
  );
}
