"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { updateProspectStageAction } from "@/app/prospect-actions";
import { ClosedLostPrompt } from "@/components/prospecting/closed-lost-prompt";
import { OutcomeReasonPrompt } from "@/components/prospecting/outcome-reason-prompt";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";
import {
  disqualifiedReasonLabels,
  disqualifiedReasons,
  prospectListOutcomeStages,
  unqualifiedReasonLabels,
  unqualifiedReasons,
} from "@/lib/crm/domain";

function menuItemClass(active: boolean) {
  return `flex w-full items-center px-3 py-2 text-left text-sm ${
    active
      ? "cursor-default text-slate-400"
      : "text-slate-800 hover:bg-slate-50"
  } disabled:cursor-default`;
}

function PassedEventItem({ currentStageKey }: { currentStageKey: string }) {
  const { pending } = useFormStatus();
  const active = currentStageKey === "past_event";
  return (
    <button
      type="submit"
      name="stageKey"
      value="past_event"
      disabled={pending || active}
      title={pending ? "Saving…" : active ? "Already passed event" : "Passed event"}
      aria-busy={pending}
      className={menuItemClass(active)}
    >
      Passed event
    </button>
  );
}

export function ProspectListStageBubbles({
  prospectId,
  currentStageKey,
}: {
  prospectId: string;
  currentStageKey: string;
}) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState<"unqualified" | "disqualified" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const alreadyLost = currentStageKey === "closed_lost";

  function closeMenu() {
    setOpen(false);
    setMenuPos(null);
  }

  function toggleMenu() {
    setError(null);
    if (open) {
      closeMenu();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [open]);

  async function submit(formData: FormData) {
    setError(null);
    closeMenu();
    try {
      await updateProspectStageAction(formData);
    } catch (cause) {
      rethrowNextControlFlow(cause);
      setError(cause instanceof Error ? cause.message : "Could not save stage.");
    }
  }

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="Mark prospect outcome"
            className="fixed z-[80] min-w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <form action={submit}>
              <input type="hidden" name="prospectId" value={prospectId} />
              {prospectListOutcomeStages.map((stage) =>
                stage.key === "closed_lost" ? (
                  <button
                    key={stage.key}
                    type="button"
                    role="menuitem"
                    disabled={alreadyLost}
                    className={menuItemClass(alreadyLost)}
                    onClick={() => {
                      closeMenu();
                      if (!alreadyLost) setLostOpen(true);
                    }}
                  >
                    {stage.label}
                  </button>
                ) : stage.key === "unqualified" || stage.key === "disqualified" ? (
                  <button
                    key={stage.key}
                    type="button"
                    role="menuitem"
                    disabled={currentStageKey === stage.key}
                    className={menuItemClass(currentStageKey === stage.key)}
                    onClick={() => {
                      closeMenu();
                      if (currentStageKey !== stage.key) setOutcomeOpen(stage.key);
                    }}
                  >
                    {stage.label}
                  </button>
                ) : (
                  <PassedEventItem
                    key={stage.key}
                    currentStageKey={currentStageKey}
                  />
                ),
              )}
            </form>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
      >
        Outcome
        <ChevronDown aria-hidden className="size-3.5" />
      </button>
      {menu}
      {error ? (
        <p className="mt-1 text-right text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {lostOpen && !alreadyLost ? (
        <ClosedLostPrompt
          prospectId={prospectId}
          onCancel={() => setLostOpen(false)}
        />
      ) : null}
      {outcomeOpen && currentStageKey !== outcomeOpen ? (
        <OutcomeReasonPrompt
          prospectId={prospectId}
          stageKey={outcomeOpen}
          title={outcomeOpen === "unqualified" ? "Mark unqualified" : "Disqualify"}
          description={
            outcomeOpen === "unqualified"
              ? "Choose why this race is unqualified."
              : "Choose why this race is disqualified."
          }
          reasons={
            outcomeOpen === "unqualified"
              ? unqualifiedReasons.map((key) => ({
                  key,
                  label: unqualifiedReasonLabels[key],
                }))
              : disqualifiedReasons.map((key) => ({
                  key,
                  label: disqualifiedReasonLabels[key],
                }))
          }
          submitLabel={outcomeOpen === "unqualified" ? "Unqualify" : "Disqualify"}
          onCancel={() => setOutcomeOpen(null)}
        />
      ) : null}
    </>
  );
}
