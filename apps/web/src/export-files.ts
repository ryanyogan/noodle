import type { ExportData } from "@noodle/db";
import {
	type DayKey,
	MONEY_IN_KIND_LABELS,
	owedBackPartText,
	owedBackUncounted,
	toCsv,
} from "@noodle/domain";

// The files a Household's "Download your data" ZIP holds (ADR-0028), built from what the Parent
// may see. CSVs are escaped by toCsv: quoted where needed, and a cell a spreadsheet would read as
// a formula (=, +, -, @) starts with an apostrophe. Money goes out as numbers, in dollars.

/** How long a prepared download stays: 24 hours. */
export const EXPORT_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** What a stored download says about itself (its R2 object's custom metadata). */
export type ExportMeta = { householdId: string; memberId: string; expiresAt: number };

/** Whether this Parent may download it now: theirs, in their Household, and not expired. */
export function exportAvailable(
	meta: Partial<Record<keyof ExportMeta, string | number>> | undefined,
	viewer: { householdId: string; memberId: string },
	now: number,
): boolean {
	if (!meta) return false;
	const expiresAt = Number(meta.expiresAt);
	return (
		meta.householdId === viewer.householdId &&
		meta.memberId === viewer.memberId &&
		Number.isFinite(expiresAt) &&
		now < expiresAt
	);
}

/** Where a download is stored in R2. */
export const exportKey = (householdId: string, id: string) => `exports/${householdId}/${id}.zip`;

const dollars = (cents: number | null | undefined) =>
	cents === null || cents === undefined ? null : Math.round(cents) / 100;

const day = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));

/** The CSVs and household.json, by file name. */
export function exportFiles(data: ExportData): Record<string, string> {
	const memberName = new Map(data.members.map((m) => [m.id, m.name]));
	const forNames = (ids: string[]) =>
		ids.length === 0 ? "Everyone" : ids.map((id) => memberName.get(id) ?? "").join("; ");
	const bucket = (id: string | null) => (id ? (data.bucketNames[id] ?? "") : "");
	const commitment = (id: string | null) => (id ? (data.commitmentNames[id] ?? "") : "");

	const transactions: (string | number | null)[][] = [
		[
			"Date",
			"Account",
			"Merchant",
			"Note",
			"Amount",
			"Bucket",
			"Commitment",
			"Goal",
			"Splits",
			"For",
			// Kept as it was after its month ended (issue 141): the day the bank took it back or
			// lowered it, and what the bank says it is now when it only lowered it.
			"Bank took it back on",
			"Bank lowered it to",
			// Where a Parent moved it to another day (issue 148): Date is the day it counts on, and
			// this is the day the bank gave it. Empty while Date is still the bank's own.
			"Bank’s date",
		],
	];
	for (const t of data.transactions) {
		transactions.push([
			t.date,
			t.importedFrom ?? t.matchedIn ?? "",
			t.merchantName ?? "",
			t.note ?? "",
			dollars(t.amountCents),
			bucket(t.bucketId),
			commitment(t.commitmentId),
			t.goal?.name ?? "",
			t.splits
				.map((s) =>
					[
						bucket(s.bucketId) || commitment(s.commitmentId) || s.goal?.name || "Not filed",
						(dollars(s.amountCents) ?? 0).toFixed(2),
						`(${forNames(s.for)})`,
					].join(" "),
				)
				.join("; "),
			t.splits.length > 0 ? "" : forNames(t.for),
			t.bankTookBackOn ?? "",
			dollars(t.bankAmount),
			t.bankDate ?? "",
		]);
	}
	for (const total of data.privateTotals) {
		transactions.push([
			`${total.month}-01`,
			"",
			"",
			"Total for the month. The other Parent’s Personal Allowance isn’t listed line by line.",
			dollars(total.amountCents),
			bucket(total.bucketId),
			"",
			"",
			"",
			"Everyone",
			"",
			null,
			"",
		]);
	}

	const accounts: (string | number | null)[][] = [
		["Account", "Kind", "Balance", "Balance as of", "Owed now", "Whose"],
	];
	for (const a of data.accounts) {
		// "Balance" is what was last entered; "Owed now" is that less the payments filed since.
		accounts.push([
			a.name,
			a.kind,
			dollars(a.balanceCents),
			day(a.balanceAt),
			a.owedCents === null ? null : dollars(a.owedCents),
			// A Parent's name; empty for the Household's (ADR-0059).
			a.whoseMemberId ? (memberName.get(a.whoseMemberId) ?? "") : "",
		]);
	}

	const plan: (string | number | null)[][] = [["Month", "Line", "Name", "Amount", "Details"]];
	for (const p of data.plans) {
		plan.push([p.month, "Take-home pay", "", dollars(p.baseline), ""]);
		for (const c of p.commitments) {
			plan.push([
				p.month,
				"Commitment",
				c.name,
				dollars(c.amount),
				`${c.cadence}, due ${c.dueDate}`,
			]);
		}
		for (const b of p.buckets) {
			plan.push([
				p.month,
				b.owner ? "Personal Allowance" : "Bucket",
				b.name,
				dollars(b.allowance),
				b.rolling ? "Carries over" : "Resets monthly",
			]);
		}
	}
	for (const g of data.goals) {
		plan.push([
			"",
			"Goal",
			g.name,
			dollars(g.targetCents),
			g.targetDate ? `by ${g.targetDate}` : "",
		]);
	}

	const changes: (string | number | null)[][] = [
		["When", "Who", "What", "Name", "From month", "Scope", "Before", "After"],
	];
	for (const c of data.planChanges) {
		changes.push([
			new Date(c.at).toISOString(),
			c.memberName,
			c.kind,
			c.targetName ?? "",
			c.month,
			String(c.scope),
			c.before === null ? "" : JSON.stringify(c.before),
			c.after === null ? "" : JSON.stringify(c.after),
		]);
	}

	// The Log's own record: Rules removed (each with the Rule as it was made), Bank Connections
	// disconnected and Accounts archived.
	const removed: (string | number | null)[][] = [["When", "Who", "What", "Name", "Detail"]];
	for (const e of data.removed) {
		removed.push([
			new Date(e.at).toISOString(),
			e.memberName ?? "",
			e.kind,
			e.name ?? "",
			e.detail ?? "",
		]);
	}

	const rules: (string | number | null)[][] = [
		["Statement words", "Bucket", "For", "Private", "Filed so far", "Set by", "Owed back"],
	];
	for (const r of data.rules) {
		rules.push([
			r.pattern,
			r.bucketName,
			forNames(r.for),
			r.private ? "Yes" : "No",
			r.matched,
			r.createdBy ?? "",
			// What the Rule remembers (ADR-0058): "Casey pays back half".
			r.owedBack ? `${r.owedBack.who} pays back ${owedBackPartText(r.owedBack.percent)}` : "",
		]);
	}

	// Money in, every line with its kind (ADR-0057), and what the Household's Rules for it
	// remember. They are the Household's, so both Parents get the same. "Pay day" is the day a
	// paycheck counts on in place of its date (ADR-0063), so the month it counts in can be rebuilt.
	const whosePay = (id: string | null) => (id ? (memberName.get(id) ?? "") : "");
	const moneyIn: (string | number | null)[][] = [
		[
			"Date",
			"Account",
			"Note",
			"Amount",
			"Kind",
			"From Account",
			"Whose pay",
			"Pay day",
			"Bank took it back on",
			"Bank changed it to",
		],
	];
	for (const line of data.moneyIn) {
		moneyIn.push([
			line.date,
			line.account ?? "",
			line.note ?? "",
			dollars(line.amountCents),
			line.needsReview ? "Needs review" : MONEY_IN_KIND_LABELS[line.kind],
			line.otherAccount ?? "",
			whosePay(line.payMemberId),
			line.payDay ?? "",
			line.bankTookBackOn ?? "",
			dollars(line.bankAmountCents),
		]);
	}
	const moneyInRules: (string | number | null)[][] = [
		["Statement words", "Always", "Into Account", "From Account", "Whose pay", "Set by", "Made on"],
	];
	for (const r of data.moneyInRules) {
		moneyInRules.push([
			r.pattern,
			MONEY_IN_KIND_LABELS[r.kind],
			r.intoAccount ?? "",
			r.otherAccount ?? "",
			whosePay(r.payMemberId),
			r.createdBy ?? "",
			day(r.createdAt),
		]);
	}
	const cardPaymentRules: (string | number | null)[][] = [
		["Statement words", "Card", "Set by", "Made on"],
	];
	for (const r of data.cardPaymentRules) {
		cardPaymentRules.push([
			r.pattern,
			r.card ?? "A card that isn’t in Noodle",
			r.createdBy ?? "",
			day(r.createdAt),
		]);
	}
	const owedBack: (string | number | null)[][] = [
		["Date", "Purchase", "Who", "Owed back", "Paid back", "Still owed", "Counts as spending"],
	];
	for (const o of data.owedBack) {
		owedBack.push([
			o.date,
			o.purchase ?? "",
			o.who,
			dollars(o.owedCents),
			dollars(o.paidBackCents),
			dollars(o.owedCents - o.paidBackCents),
			// A purchase from October 1, 2026 on counts only the Household's share (ADR-0058, revised
			// 2026-10-08); an earlier one counted whole, and what is Paid back on it restores its Bucket.
			owedBackUncounted(o.date as DayKey) ? "No" : "Yes, until Paid back",
		]);
	}

	// What each Paid back money-in line settled (ADR-0058), and each Refund in checking with the
	// purchase it gives money back to (ADR-0057). A purchase the viewer can't see is left blank.
	const owedItem = new Map(data.owedBack.map((o) => [o.id, o]));
	const paidBack: (string | number | null)[][] = [
		["Counts on", "Paid back", "Who", "Purchase date", "Purchase", "Owed back"],
	];
	for (const m of data.paidBackMatches) {
		const item = owedItem.get(m.owedBackId);
		paidBack.push([
			// Empty where the money restores nothing: the part it settles never counted as spending.
			item && owedBackUncounted(item.date as DayKey) ? "" : m.countsOn,
			dollars(m.amountCents),
			item?.who ?? "",
			item?.date ?? "",
			item?.purchase ?? "",
			dollars(item?.owedCents),
		]);
	}

	// Pay to come (ADR-0066): what a Parent earned that was not in yet, what has arrived of it and
	// what is still to come. None of it is Income; what arrived is in money-in.csv as Income.
	const payToCome: (string | number | null)[][] = [
		[
			"Whose pay",
			"From",
			"Amount",
			"Expected",
			"Recorded",
			"Arrived",
			"Still to come",
			"Arrived on",
		],
	];
	for (const pay of data.payToCome) {
		const arrived = pay.arrivals.reduce((sum, arrival) => sum + arrival.coversCents, 0);
		payToCome.push([
			whosePay(pay.memberId),
			pay.from,
			dollars(pay.amountCents),
			pay.expectedOn ?? "",
			pay.recordedOn,
			dollars(arrived),
			dollars(Math.max(0, pay.amountCents - arrived)),
			pay.arrivals.map((arrival) => arrival.date).join("; "),
		]);
	}

	const purchaseOf = new Map(data.transactions.map((t) => [t.id, t]));
	const refundLinks: (string | number | null)[][] = [
		["Counts on", "Refund", "Purchase date", "Purchase", "Purchase amount", "Bucket", "Commitment"],
	];
	for (const link of data.refundLinks) {
		const purchase = purchaseOf.get(link.transactionId);
		refundLinks.push([
			link.countsOn,
			dollars(link.amountCents),
			purchase?.date ?? "",
			purchase?.note ?? purchase?.merchantName ?? "",
			dollars(purchase?.amountCents),
			bucket(purchase?.bucketId ?? null),
			commitment(purchase?.commitmentId ?? null),
		]);
	}

	return {
		"transactions.csv": toCsv(transactions),
		"accounts.csv": toCsv(accounts),
		"plan.csv": toCsv(plan),
		"plan-changes.csv": toCsv(changes),
		"log-removed.csv": toCsv(removed),
		"rules.csv": toCsv(rules),
		"money-in.csv": toCsv(moneyIn),
		"money-in-rules.csv": toCsv(moneyInRules),
		"card-payment-rules.csv": toCsv(cardPaymentRules),
		"owed-back.csv": toCsv(owedBack),
		"paid-back.csv": toCsv(paidBack),
		"refund-links.csv": toCsv(refundLinks),
		"pay-to-come.csv": toCsv(payToCome),
		"household.json": `${JSON.stringify({ ...data, files: data.files.map((f) => f.path) }, null, 2)}\n`,
	};
}
