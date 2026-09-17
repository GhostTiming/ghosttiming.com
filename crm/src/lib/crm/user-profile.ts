export function splitFullName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null as string | null, lastName: null as string | null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null as string | null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function displayUserName(input: {
  firstName?: string | null;
  lastName?: string | null;
  fallback?: string | null;
}) {
  const combined = [input.firstName, input.lastName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return combined || input.fallback?.trim() || "";
}
