export type DigestStatus = 'ok' | 'retry' | 'fail';

/** One job's valid events, aggregated in file order. */
export type DigestRow = {
  job: string;
  /** Owner on the job's last valid event; null remains missing data. */
  owner: string | null;
  /** All valid events for this job, including retry and fail events. */
  runs: number;
  /** Valid events for this job whose status is retry. */
  retries: number;
  lastStatus: DigestStatus;
  /** Latest supplied error in file order, or null; recovery does not erase it. */
  lastError: string | null;
  /** First and last valid event's at strings, preserving the logged offsets. */
  firstAt: string;
  lastAt: string;
};

/** Counts of valid events, not counts of jobs grouped by their last status. */
export type DigestCounts = {
  ok: number;
  retry: number;
  fail: number;
};

export type DigestResult = {
  /** One row per job, sorted by job in ascending string order. */
  rows: DigestRow[];
  /** Malformed lines skipped without contributing to rows or counts. */
  badLines: number;
  counts: DigestCounts;
};

/**
 * Synchronously read runsDir/<night>.jsonl; implemented in src/digest/reader.ts.
 * Return null only when the file is missing. An empty file returns empty rows,
 * zero badLines and zero counts. Other filesystem errors are not missing nights.
 *
 * Each physical line must parse as a JSON object with string at and job,
 * status ok/retry/fail, owner string/null, and optional string error. Invalid JSON
 * or invalid fields count as one bad line and are skipped, never thrown.
 * Blank lines are malformed; an empty file has no lines, and a final newline
 * does not create an extra line. Extra object fields are ignored.
 *
 * Events retain file order, including the row's last owner and status and its
 * first/last timestamps. Timestamp strings are kept verbatim, not UTC-normalized.
 */
export type ReadNight = (runsDir: string, night: string) => DigestResult | null;
