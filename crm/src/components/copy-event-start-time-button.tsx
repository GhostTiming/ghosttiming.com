"use client";

export function CopyEventStartTimeButton({
  eventStartLocal,
}: {
  eventStartLocal: string | null;
}) {
  const value = eventStartLocal?.slice(0, 16) ?? "";
  if (!value) return null;
  return (
    <button
      type="button"
      className="text-xs font-semibold text-cyan-700 hover:text-cyan-900"
      onClick={(event) => {
        const form = event.currentTarget.form;
        const input = form?.querySelector<HTMLInputElement>(
          'input[name="startTime"]',
        );
        if (input) {
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }}
    >
      Copy event start time
    </button>
  );
}
