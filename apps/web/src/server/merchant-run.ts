import {
	type Db,
	loadMerchantNames,
	loadParentNames,
	loadUnnamedNotes,
	nameTransactions,
	saveMerchantNames,
} from "@noodle/db";
import { bankMerchantKey, cleanMerchant, plausibleMerchantName } from "@noodle/domain";
import { LEFTOVERS_PER_RUN, type MerchantNamer } from "./merchant-model";

// Background AI's first step (ADR-0027): name the Household's imported lines. The normaliser
// settles most; names the model gave before come from the Household's cache; what's left goes to
// the model in one prompt. Never logs a merchant or a raw line.
//
// A name a Parent gave a merchant comes before all of that (#95, ADR-0043): a new line from it
// takes their name and never reaches the model. Lines already named are never renamed here, so a
// Parent's rename of one Transaction is safe too. What the model says is kept only when it reads
// as that line's merchant (plausibleMerchantName); else the normaliser's name stands, uncached.

export type NameDeps = { db: Db; namer: MerchantNamer };

/** How many distinct raw lines one run names: new lines first, then old ones (the backfill). */
export const NOTES_PER_RUN = 500;

export type NameResult = { named: number; byModel: number; more: boolean };

export async function nameMerchants(
	deps: NameDeps,
	householdId: string,
	limit = NOTES_PER_RUN,
): Promise<NameResult> {
	const found = await loadUnnamedNotes(deps.db, householdId, limit + 1);
	const raws = found.slice(0, limit);
	const cached = await loadMerchantNames(deps.db, householdId, raws);
	const byParents = await loadParentNames(deps.db, householdId);
	const names = new Map<string, string>();
	const leftovers: string[] = [];
	const guesses = new Map<string, string>();
	for (const raw of raws) {
		const known =
			(byParents.size > 0 ? byParents.get(bankMerchantKey(raw)) : undefined) ?? cached.get(raw);
		if (known) {
			names.set(raw, known);
			continue;
		}
		const cleaned = cleanMerchant(raw);
		if (cleaned.sure) names.set(raw, cleaned.name);
		else {
			leftovers.push(raw);
			guesses.set(raw, cleaned.name);
		}
	}
	// Leftovers past the run's share wait, unnamed, for the next run.
	const asked = leftovers.slice(0, LEFTOVERS_PER_RUN);
	let modelled = new Map<string, string>();
	if (asked.length > 0) {
		try {
			const said = await deps.namer.name(asked);
			modelled = new Map([...said].filter(([raw, name]) => plausibleMerchantName(raw, name)));
		} catch (error) {
			console.warn(
				`Merchant names: the model failed (${(error as Error).name}); kept the normaliser's`,
			);
		}
	}
	for (const raw of asked) names.set(raw, modelled.get(raw) ?? (guesses.get(raw) as string));
	await saveMerchantNames(
		deps.db,
		householdId,
		asked
			.filter((raw) => modelled.has(raw))
			.map((raw) => ({ raw, name: modelled.get(raw) as string })),
	);
	await nameTransactions(deps.db, householdId, names);
	return {
		named: names.size,
		byModel: modelled.size,
		more: found.length > limit || leftovers.length > asked.length,
	};
}
