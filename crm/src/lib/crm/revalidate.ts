import { revalidatePath } from "next/cache";

export function refreshCatalogLinkedViews(input: {
  bookingId?: string | null;
  eventId?: string | null;
  prospectId?: string | null;
}) {
  revalidatePath("/bookings", "layout");
  revalidatePath("/events", "layout");
  revalidatePath("/prospecting", "layout");
  revalidatePath("/organizations", "layout");
  revalidatePath("/contacts", "layout");
  revalidatePath("/dashboard", "layout");
  if (input.bookingId) {
    revalidatePath(`/bookings/${input.bookingId}`, "layout");
  }
  if (input.eventId) {
    revalidatePath(`/events/${input.eventId}`, "layout");
  }
  if (input.prospectId) {
    revalidatePath(`/prospecting/${input.prospectId}`, "layout");
  }
}
