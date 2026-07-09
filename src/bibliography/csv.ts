/**
 * A minimal, dependency-free RFC-4180-ish CSV reader for the migration inputs
 * (`sources.csv`, `acquisition-tracker.csv`, the archive `acquisition-register.csv`).
 * It understands double-quoted fields, `""` escaped quotes, embedded commas and
 * newlines inside quotes, and both `\n` and `\r\n` record separators. It fails
 * loud on nothing structurally (an empty file yields an empty table); the
 * higher layer decides which columns are required.
 */

/** A parsed table: the header row plus each data row as a `column -> cell` map. */
export interface CsvTable {
  header: string[];
  rows: Record<string, string>[];
}

/** Split raw CSV text into records of fields, honoring quoting. */
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const endField = (): void => {
    record.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r') {
      // swallow; the paired \n ends the record
    } else if (ch === '\n') {
      endRecord();
    } else {
      field += ch;
    }
  }
  // Flush a trailing field/record that did not end with a newline.
  if (field.length > 0 || record.length > 0) {
    endRecord();
  }
  return records;
}

/** True for a record that is a single empty field (a blank line). */
function isBlank(fields: string[]): boolean {
  return fields.length === 1 && fields[0] === '';
}

/**
 * Parse CSV text into a {@link CsvTable}. The first non-empty record is the
 * header; each subsequent record becomes a `column -> cell` map (missing
 * trailing cells default to the empty string). Blank lines are skipped.
 */
export function parseCsv(text: string): CsvTable {
  const records = splitRecords(text).filter((fields) => !isBlank(fields));
  if (records.length === 0) {
    return { header: [], rows: [] };
  }
  const header = records[0];
  const rows = records.slice(1).map((fields) => {
    const row: Record<string, string> = {};
    header.forEach((column, index) => {
      row[column] = fields[index] ?? '';
    });
    return row;
  });
  return { header, rows };
}
