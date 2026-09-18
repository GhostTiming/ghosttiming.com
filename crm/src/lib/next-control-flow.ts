export function isNextControlFlowError(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  const digest = String((error as { digest?: unknown }).digest);
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND");
}

export function isNextNotFoundError(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return String((error as { digest?: unknown }).digest).startsWith("NEXT_NOT_FOUND");
}

export function rethrowNextControlFlow(error: unknown) {
  if (isNextControlFlowError(error)) throw error;
}
