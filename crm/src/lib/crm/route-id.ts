import { notFound } from "next/navigation";
import { z } from "zod";

const uuid = z.string().uuid();

export function parseRouteUuid(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) notFound();
  return parsed.data;
}
