/** Next.js redirect()/notFound() throw special errors that must not be caught. */
export function isNextControlFlowError(error: unknown) {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return false;
  }
  const digest = error.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))
  );
}

export function rethrowIfNextControlFlow(error: unknown): void {
  if (isNextControlFlowError(error)) throw error;
}
