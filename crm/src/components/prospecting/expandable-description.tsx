"use client";

import { useState } from "react";

export function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const canCollapse = text.length > 180 || text.split("\n").length > 2;

  return (
    <div>
      <p
        className={`whitespace-pre-wrap text-sm leading-6 text-slate-700 ${
          expanded || !canCollapse ? "" : "line-clamp-2"
        }`}
      >
        {text}
      </p>
      {canCollapse ? (
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-cyan-700 hover:text-cyan-900"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show less" : "Read full description"}
        </button>
      ) : null}
    </div>
  );
}
