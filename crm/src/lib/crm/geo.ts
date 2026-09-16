const zipCache = new Map<string, { lat: number; lng: number } | null>();

export const US_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
] as const;

export function normalizeZip(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
}

export async function geocodeUsZip(zip: string) {
  const normalized = normalizeZip(zip);
  if (!normalized) return null;
  if (zipCache.has(normalized)) return zipCache.get(normalized) ?? null;
  try {
    const response = await fetch(`https://api.zippopotam.us/us/${normalized}`, {
      headers: { Accept: "application/json" },
      cache: "force-cache",
    });
    if (!response.ok) {
      zipCache.set(normalized, null);
      return null;
    }
    const body = (await response.json()) as {
      places?: { latitude?: string; longitude?: string }[];
    };
    const place = body.places?.[0];
    const lat = Number(place?.latitude);
    const lng = Number(place?.longitude);
    const coords =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    zipCache.set(normalized, coords);
    return coords;
  } catch {
    zipCache.set(normalized, null);
    return null;
  }
}
