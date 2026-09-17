"use client";

import { Flag } from "lucide-react";
import { useState } from "react";

const sizeClass = {
  list: "size-8",
  header: "size-14",
} as const;

export function EventLogo(props: {
  url?: string | null;
  name: string;
  size?: "list" | "header";
  tone?: "light" | "dark";
}) {
  return <EventLogoInner key={props.url ?? ""} {...props} />;
}

function EventLogoInner({
  url,
  name,
  size = "list",
  tone = "light",
}: {
  url?: string | null;
  name: string;
  size?: "list" | "header";
  tone?: "light" | "dark";
}) {
  const [failed, setFailed] = useState(false);
  const frame = `${sizeClass[size]} shrink-0 overflow-hidden rounded-lg`;
  const placeholderTone =
    tone === "dark"
      ? "bg-cyan-900 text-cyan-100"
      : "bg-cyan-100 text-cyan-800";

  if (!url || failed) {
    return (
      <span
        aria-hidden
        className={`inline-flex items-center justify-center ${frame} ${placeholderTone}`}
        title={name}
      >
        <Flag className={size === "header" ? "size-5" : "size-3.5"} />
      </span>
    );
  }

  return (
    // External catalog logos come from arbitrary CDNs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      title={name}
      width={size === "header" ? 56 : 32}
      height={size === "header" ? 56 : 32}
      className={`${frame} bg-white object-cover`}
      onError={() => setFailed(true)}
    />
  );
}
