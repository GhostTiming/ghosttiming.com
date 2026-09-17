"use client";

import { Loader2 } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

export const FormSaveFailedContext = createContext(false);

export function PendingSubmitButton({
  children,
  className,
  pendingLabel = "Saving…",
  savedLabel = "Saved",
  disabled,
}: {
  children: ReactNode;
  className?: string;
  pendingLabel?: string;
  savedLabel?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const saveFailed = useContext(FormSaveFailedContext);
  const wasPending = useRef(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    if (saveFailed) return;
    const show = window.setTimeout(() => setSaved(true), 0);
    const hide = window.setTimeout(() => setSaved(false), 1600);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [pending, saveFailed]);

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={className}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {pendingLabel}
        </span>
      ) : saved ? (
        savedLabel
      ) : (
        children
      )}
    </button>
  );
}
