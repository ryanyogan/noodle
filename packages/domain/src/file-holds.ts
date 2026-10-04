// Statement and Receipt files that outlive the rows pointing at them (#78, ADR-0035). A snapshot
// holds rows, not files: it refers to each file by its key. So while a kept snapshot refers to a
// file, a Fresh start or Delete Household leaves that file where it is, and it goes only once
// nothing needs it: no row the Household has now, and no snapshot still kept.

/** Rows per table, as a snapshot stores them: column name to stored value. */
export type StoredTables = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;

/**
 * The files a set of rows refers to: every text value that is a key under one of the Household's
 * file prefixes. By value, not by column, so a new table that keeps a file is covered unasked.
 */
export function referencedFiles(tables: StoredTables, prefixes: readonly string[]): string[] {
	const keys = new Set<string>();
	for (const rows of Object.values(tables)) {
		for (const row of rows) {
			for (const value of Object.values(row)) {
				if (typeof value !== "string") continue;
				if (prefixes.some((prefix) => value.length > prefix.length && value.startsWith(prefix)))
					keys.add(value);
			}
		}
	}
	return [...keys].sort();
}

/** Who still needs a file: the Household's rows as they are now, a kept snapshot, or nobody. */
export type FileNeed = "rows" | "snapshot" | null;

export function whoNeedsFile(
	key: string,
	live: ReadonlySet<string>,
	snapshots: readonly ReadonlySet<string>[],
): FileNeed {
	if (live.has(key)) return "rows";
	if (snapshots.some((keys) => keys.has(key))) return "snapshot";
	return null;
}

/**
 * Sorts the files a clear left behind into those to keep and those to delete now. `live` is what
 * the Household's rows refer to today (a restore brings such rows back); `snapshots` is what each
 * snapshot still kept refers to. A file is deleted only when neither needs it, so it goes the
 * night its last snapshot expires and not before.
 */
export function splitHeldFiles(
	held: readonly string[],
	live: ReadonlySet<string>,
	snapshots: readonly ReadonlySet<string>[],
): { keep: string[]; remove: string[] } {
	const keep: string[] = [];
	const remove: string[] = [];
	for (const key of [...new Set(held)].sort())
		(whoNeedsFile(key, live, snapshots) ? keep : remove).push(key);
	return { keep, remove };
}

/**
 * What a clear may delete at once and what it must leave: a listed file stays when a snapshot that
 * outlives the clear refers to it.
 */
export function splitFilesForClear(
	listed: readonly string[],
	needed: ReadonlySet<string>,
): { hold: string[]; remove: string[] } {
	const hold: string[] = [];
	const remove: string[] = [];
	for (const key of listed) (needed.has(key) ? hold : remove).push(key);
	return { hold, remove };
}
