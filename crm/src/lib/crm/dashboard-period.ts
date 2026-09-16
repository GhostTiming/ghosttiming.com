export type DashboardPeriodKey = "year" | "all" | "custom";

export type DashboardPeriod = {
  key: DashboardPeriodKey;
  startDate: string | null;
  endDate: string | null;
  endExclusive: string | null;
  label: string;
  customStartDefault: string;
  customEndDefault: string;
};

type PeriodParams = {
  period?: string | string[];
  from?: string | string[];
  to?: string | string[];
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function easternYear(now: Date) {
  const year = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: "America/New_York",
  })
    .formatToParts(now)
    .find((part) => part.type === "year")?.value;
  return Number(year ?? now.getUTCFullYear());
}

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function addDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function labelDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function resolveDashboardPeriod(
  params: PeriodParams,
  now = new Date(),
): DashboardPeriod {
  const year = easternYear(now);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const requested = first(params.period);

  if (requested === "all") {
    return {
      key: "all",
      startDate: null,
      endDate: null,
      endExclusive: null,
      label: "All time",
      customStartDefault: yearStart,
      customEndDefault: yearEnd,
    };
  }

  if (requested === "custom") {
    const startDate = validDate(first(params.from));
    const endDate = validDate(first(params.to));
    if (startDate && endDate && startDate <= endDate) {
      return {
        key: "custom",
        startDate,
        endDate,
        endExclusive: addDay(endDate),
        label: `${labelDate(startDate)} – ${labelDate(endDate)}`,
        customStartDefault: startDate,
        customEndDefault: endDate,
      };
    }
  }

  return {
    key: "year",
    startDate: yearStart,
    endDate: yearEnd,
    endExclusive: `${year + 1}-01-01`,
    label: `${year}`,
    customStartDefault: yearStart,
    customEndDefault: yearEnd,
  };
}
