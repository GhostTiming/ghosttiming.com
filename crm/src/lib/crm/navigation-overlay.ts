export type OverlayLocation = {
  origin: string;
  pathname: string;
  search: string;
};

export function formSubmitLeavesCurrentPage(
  form: { method: string; getAttribute(name: string): string | null },
  location: OverlayLocation,
  submitterFormAction?: string | null,
) {
  if (form.method.toLowerCase() === "dialog") return false;
  const action = (submitterFormAction ?? form.getAttribute("action") ?? "").trim();
  if (!action || action.startsWith("#") || /^javascript:/i.test(action)) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(action, `${location.origin}${location.pathname}${location.search}`);
  } catch {
    return false;
  }
  if (url.origin !== location.origin) return false;
  return url.pathname !== location.pathname || url.search !== location.search;
}
