export const CHIP_ROW =
  "flex flex-nowrap gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:pb-0";

export const DESKTOP_TABLE =
  "hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block";

export const MOBILE_CARDS = "space-y-3 md:hidden";

export const PAGINATION_ROW =
  "flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between";

export function chipClass(active: boolean) {
  return `whitespace-nowrap rounded-full px-3 py-1.5 text-sm ring-1 ${
    active
      ? "bg-slate-900 text-white ring-slate-900"
      : "bg-white ring-slate-200"
  }`;
}
