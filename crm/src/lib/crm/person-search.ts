export type PersonSearchFields = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
};

export function personNameSearchFields(person: PersonSearchFields) {
  return [
    person.displayName,
    person.firstName,
    person.lastName,
    [person.firstName, person.lastName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" "),
    [person.lastName, person.firstName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" "),
    person.email,
    person.phone,
  ];
}

export function splitPersonSearchTokens(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function matchesPersonNameQuery(person: PersonSearchFields, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  const fields = personNameSearchFields(person).map((value) =>
    (value ?? "").toLowerCase(),
  );
  if (fields.some((field) => field.includes(normalized))) return true;
  const tokens = splitPersonSearchTokens(normalized);
  return (
    tokens.length > 1 &&
    tokens.every((token) => fields.some((field) => field.includes(token)))
  );
}

export function personNameMatchesSql(
  queryExpr: string,
  options?: {
    alias?: string;
    includeEmail?: boolean;
    includePhone?: boolean;
    escape?: boolean;
  },
) {
  const alias = options?.alias ?? "person";
  const escape = options?.escape ? " ESCAPE '\\'" : "";
  const query = `(${queryExpr})::text`;
  const display = `COALESCE(${alias}.display_name, '')`;
  const first = `COALESCE(${alias}.first_name, '')`;
  const last = `COALESCE(${alias}.last_name, '')`;
  const full = `trim(concat_ws(' ', ${alias}.first_name, ${alias}.last_name))`;
  const reversed = `trim(concat_ws(' ', ${alias}.last_name, ${alias}.first_name))`;
  const fields = [
    display,
    first,
    last,
    full,
    reversed,
    options?.includeEmail === false ? null : `COALESCE(${alias}.email, '')`,
    options?.includePhone ? `COALESCE(${alias}.phone, '')` : null,
  ].filter((field): field is string => Boolean(field));
  const like = (column: string, needle: string) =>
    `${column} ILIKE '%' || ${needle} || '%'${escape}`;
  const fullMatch = fields.map((field) => like(field, query)).join("\n      OR ");
  const tokenMatch = fields.map((field) => like(field, "token")).join("\n          OR ");
  return `
    (
      ${query} IS NULL
      OR ${fullMatch}
      OR (
        SELECT bool_and(
          ${tokenMatch}
        )
        FROM unnest(regexp_split_to_array(btrim(${query}), '\\s+')) AS token
        WHERE token <> ''
      )
    )
  `;
}
