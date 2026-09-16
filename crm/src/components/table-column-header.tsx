import { ArrowUpDown } from "lucide-react";
import Link from "next/link";
import {
  TableColumnFilter,
  type TableFilterField,
  type TableQueryParams,
} from "@/components/table-column-filter";
import { buildSearchHref } from "@/lib/crm/search-params";

type TableColumnHeaderProps = {
  label: string;
  pathname: string;
  params: TableQueryParams;
  sortKey?: string;
  currentSort?: string;
  currentDirection?: "asc" | "desc";
  filters?: TableFilterField[];
  align?: "left" | "right";
};

export function TableColumnHeader({
  label,
  pathname,
  params,
  sortKey,
  currentSort,
  currentDirection = "asc",
  filters = [],
  align = "left",
}: TableColumnHeaderProps) {
  const nextDirection =
    currentSort === sortKey && currentDirection !== "desc" ? "desc" : "asc";
  const sortHref = sortKey
    ? buildSearchHref(pathname, params, {
        sort: sortKey,
        direction: nextDirection,
        page: null,
      })
    : null;

  return (
    <div className="relative inline-flex items-center gap-0.5">
      {sortHref ? (
        <Link
          href={sortHref}
          className="inline-flex items-center gap-1 hover:text-cyan-700"
        >
          {label}
          <ArrowUpDown aria-hidden className="size-3.5" />
        </Link>
      ) : (
        <span>{label}</span>
      )}
      {filters.length ? (
        <TableColumnFilter
          label={label}
          pathname={pathname}
          params={params}
          filters={filters}
          align={align}
        />
      ) : null}
    </div>
  );
}

export type { TableFilterField, TableQueryParams };
