/**
 * Normalize a Gallica human date label (French) into an ISO `YYYY-MM-DD`
 * string. Fails loud on anything it cannot parse (no fallback / no guess).
 *
 * Examples handled:
 *   "15 juillet 1879" -> "1879-07-15"
 *   "1er janvier 1880" -> "1880-01-01"  (the French "premier" ordinal)
 *   "15 aout 1879" / "15 août 1879" -> "1879-08-15"  (accents optional)
 */

/** French month name (diacritics stripped, lower-cased) -> month number. */
const FRENCH_MONTHS: Readonly<Record<string, number>> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

/** Strip combining diacritics so "août" matches "aout". */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * Parse a French human date into `YYYY-MM-DD`.
 *
 * @throws if the label does not match `<day> <month> <year>` or the month is
 *   not a recognized French month name.
 */
export function normalizeFrenchDate(label: string): string {
  const trimmed = label.trim();
  // day (optionally with the "er" ordinal suffix) | month word | 4-digit year
  const match = trimmed.match(
    /^(\d{1,2})(?:er)?\s+([A-Za-zÀ-ſ]+)\s+(\d{4})$/,
  );
  if (match === null) {
    throw new Error(
      `normalizeFrenchDate: cannot parse French date "${label}" ` +
        `(expected "<day> <month> <year>")`,
    );
  }

  const day = Number(match[1]);
  const monthKey = stripDiacritics(match[2]).toLowerCase();
  const year = Number(match[3]);

  const month = FRENCH_MONTHS[monthKey];
  if (month === undefined) {
    throw new Error(
      `normalizeFrenchDate: unrecognized French month "${match[2]}" ` +
        `in "${label}"`,
    );
  }
  if (day < 1 || day > 31) {
    throw new Error(
      `normalizeFrenchDate: day ${day} out of range in "${label}"`,
    );
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}
