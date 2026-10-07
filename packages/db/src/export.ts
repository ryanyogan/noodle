import {
	type DayKey,
	type MonthKey,
	monthOfDay,
	type Plan,
	type PlanChange,
	planForMonth,
} from "@noodle/domain";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { owedNow } from "./goals";
import type { Db } from "./index";
import { type LogEventRow, listLogEvents } from "./log-events";
import { listMembers, type MemberSummary } from "./members";
import { loadOwedBack, loadPaidBackSpending } from "./owed-back";
import { loadPlanRecords } from "./plan";
import { loadPlanChanges } from "./plan-log";
import { privateTotalId, privateTotals, type Viewer } from "./privacy";
import { loadRefundLinksForExport } from "./refund-links";
import { loadHistoryStart } from "./reports";
import { listRules, type RuleRow } from "./rules";
import {
	accountBalances,
	accounts,
	goals,
	households,
	imports,
	paidBackMatches,
	receipts,
} from "./schema";
import { loadTransactionsPage, type TransactionCursor, type TransactionRow } from "./transactions";

// Everything a Parent's "Download your data" holds (ADR-0028), read for that Parent: the other
// Parent's Personal Allowance only as totals per month (ADR-0003), never line by line.

export type ExportAccount = {
	id: string;
	name: string;
	kind: string;
	balanceCents: number | null;
	/** When the balance was last set, in ms since the epoch. */
	balanceAt: number | null;
	/**
	 * What's owed on a credit card or loan now, as the app shows it: for one kept by hand, the
	 * balance less the payments filed since in Commitments that pay it down (ADR-0050). Null for
	 * an Account that holds money, or with no balance.
	 */
	owedCents: number | null;
};

/** A stored statement or receipt file, and the path it takes in the ZIP. */
export type ExportFile = { key: string; path: string };

export type ExportData = {
	household: { id: string; name: string };
	viewer: { id: string; name: string };
	/** ms since the epoch. */
	exportedAt: number;
	members: MemberSummary[];
	accounts: ExportAccount[];
	/** Oldest first, as the viewer sees them. */
	transactions: TransactionRow[];
	/** The other Parent's Personal Allowance spending: one total per Bucket per month. */
	privateTotals: { bucketId: string; month: MonthKey; amountCents: number }[];
	/** The Plan in force each month, oldest first. */
	plans: Plan[];
	goals: { id: string; name: string; targetCents: number; targetDate: string | null }[];
	/** Every Bucket and Commitment by ID, archived ones too, for naming. */
	bucketNames: Record<string, string>;
	commitmentNames: Record<string, string>;
	planChanges: PlanChange[];
	/** The Log's own record of what was removed (issue 141), oldest first. */
	removed: LogEventRow[];
	rules: RuleRow[];
	/**
	 * What someone said they'd pay back, oldest purchase first, with how much of it is Paid back
	 * (ADR-0058): on the purchases the viewer may see.
	 */
	owedBack: {
		id: string;
		transactionId: string;
		splitId: string | null;
		/** The purchase's day and note. */
		date: string;
		purchase: string | null;
		who: string;
		owedCents: number;
		paidBackCents: number;
	}[];
	/** What each Paid back money-in line settled, and the day it counts on. */
	paidBackMatches: {
		incomeId: string;
		owedBackId: string;
		amountCents: number;
		countsOn: string;
	}[];
	/** Each Refund that landed in checking and the purchase it is linked to (ADR-0057). */
	refundLinks: {
		incomeId: string;
		transactionId: string;
		amountCents: number;
		countsOn: string;
	}[];
	files: ExportFile[];
};

const PAGE = 500;

/** Months from `from` through `until`, oldest first. */
export function monthsBetween(from: MonthKey, until: MonthKey): MonthKey[] {
	const out: MonthKey[] = [];
	let [y, m] = from.split("-").map(Number) as [number, number];
	for (let i = 0; i < 1200; i++) {
		const key = `${y}-${String(m).padStart(2, "0")}` as MonthKey;
		if (key > until) break;
		out.push(key);
		m += 1;
		if (m > 12) {
			m = 1;
			y += 1;
		}
	}
	return out;
}

const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 80);

/** Everything the viewer's export holds, as of `today` (in the Household's time zone). */
export async function loadExportData(
	db: Db,
	viewer: Viewer,
	today: DayKey,
	now: number,
): Promise<ExportData> {
	const thisMonth = today.slice(0, 7) as MonthKey;
	const [[household], members, historyStart, latestRecords] = await Promise.all([
		db
			.select({ id: households.id, name: households.name })
			.from(households)
			.where(eq(households.id, viewer.householdId)),
		listMembers(db, viewer.householdId),
		loadHistoryStart(db, viewer.householdId),
		loadPlanRecords(db, viewer.householdId, thisMonth),
	]);
	if (!household) throw new Error("No such Household");

	const transactions: TransactionRow[] = [];
	let after: TransactionCursor | undefined;
	for (;;) {
		const page = await loadTransactionsPage(db, viewer, { sort: "oldest", limit: PAGE, after });
		transactions.push(...page.transactions);
		if (!page.next) break;
		after = page.next;
	}

	const firstMonths = [
		historyStart?.slice(0, 7),
		...latestRecords.baselines.map((b) => b.month),
		...latestRecords.buckets.map((b) => b.fromMonth),
		transactions[0]?.date.slice(0, 7),
	].filter((m): m is string => !!m && m <= thisMonth);
	const firstMonth = (firstMonths.sort()[0] ?? thisMonth) as MonthKey;
	const months = monthsBetween(firstMonth, thisMonth);
	const plans = months.map((month) => planForMonth(latestRecords, month));

	const [owedBackItems, matchRows] = await Promise.all([
		loadOwedBack(db, viewer, {}),
		db
			.select({
				incomeId: paidBackMatches.incomeId,
				owedBackId: paidBackMatches.owedBackId,
				amountCents: paidBackMatches.amountCents,
				countsOn: paidBackMatches.countsOn,
			})
			.from(paidBackMatches)
			.where(eq(paidBackMatches.householdId, viewer.householdId))
			.orderBy(paidBackMatches.countsOn, paidBackMatches.id),
	]);
	// Only matches of what the viewer may see: never a purchase in the other Parent's allowance.
	const owedIds = new Set(owedBackItems.map((item) => item.id));

	const [wholes, splitTotals] = privateTotals(
		db,
		viewer,
		`${firstMonth}-01` as DayKey,
		"9999-12-31" as DayKey,
	);
	const totals = new Map<string, { bucketId: string; month: MonthKey; amountCents: number }>();
	// What was Paid back into the other Parent's Personal Allowance comes off its month's total,
	// as it does on This Month (ADR-0058).
	const restored = (
		await loadPaidBackSpending(db, viewer, `${firstMonth}-01` as DayKey, "9999-12-31" as DayKey)
	)
		.filter((spend) => spend.id === privateTotalId(spend.bucketId, monthOfDay(spend.date)))
		.map((spend) => ({
			bucketId: spend.bucketId,
			month: monthOfDay(spend.date),
			amount: spend.amount,
		}));
	for (const row of [...(await wholes), ...(await splitTotals), ...restored]) {
		const id = `${row.bucketId}:${row.month}`;
		const total = totals.get(id) ?? {
			bucketId: row.bucketId,
			month: row.month as MonthKey,
			amountCents: 0,
		};
		total.amountCents += row.amount;
		totals.set(id, total);
	}

	const [accountRows, balanceRows, goalRows, importRows, receiptRows, planChanges, rules] =
		await Promise.all([
			db
				.select({ id: accounts.id, name: accounts.name, kind: accounts.kind })
				.from(accounts)
				.where(eq(accounts.householdId, viewer.householdId))
				.orderBy(accounts.name),
			db
				.select({
					accountId: accountBalances.accountId,
					amountCents: accountBalances.amountCents,
					at: accountBalances.createdAt,
				})
				.from(accountBalances)
				.where(eq(accountBalances.householdId, viewer.householdId))
				.orderBy(desc(accountBalances.createdAt)),
			db
				.select({
					id: goals.id,
					name: goals.name,
					targetCents: goals.targetCents,
					targetDate: goals.targetDate,
				})
				.from(goals)
				.where(eq(goals.householdId, viewer.householdId)),
			db
				.select({
					id: imports.id,
					accountId: imports.accountId,
					fileName: imports.fileName,
					fileKey: imports.fileKey,
				})
				.from(imports)
				.where(and(eq(imports.householdId, viewer.householdId), isNotNull(imports.fileKey))),
			db
				.select({
					id: receipts.id,
					memberId: receipts.memberId,
					transactionId: receipts.transactionId,
					fileKey: receipts.fileKey,
				})
				.from(receipts)
				.where(eq(receipts.householdId, viewer.householdId)),
			loadPlanChanges(db, viewer, {}),
			listRules(db, viewer),
		]);

	const latestBalance = new Map<string, { amountCents: number; at: Date }>();
	for (const row of balanceRows) {
		if (!latestBalance.has(row.accountId)) latestBalance.set(row.accountId, row);
	}
	const owed = new Map<string, number | null>();
	for (const account of accountRows) {
		if (account.kind !== "credit-card" && account.kind !== "loan") continue;
		owed.set(
			account.id,
			await owedNow(db, { householdId: viewer.householdId, accountId: account.id }),
		);
	}
	const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
	const visible = new Set(transactions.map((t) => t.id));
	const files: ExportFile[] = [
		...importRows.map((row) => ({
			key: row.fileKey as string,
			path: `statements/${safeName(accountName.get(row.accountId) ?? "Account")}/${row.id}-${safeName(row.fileName ?? "statement")}`,
		})),
		// A receipt goes with its Parent, or with a Transaction this Parent sees.
		...receiptRows
			.filter(
				(r) =>
					r.memberId === viewer.memberId ||
					(r.transactionId !== null && visible.has(r.transactionId)),
			)
			.map((r) => ({
				key: r.fileKey,
				path: `receipts/${r.id}${/\.[a-z0-9]+$/i.exec(r.fileKey)?.[0] ?? ""}`,
			})),
	];

	return {
		household,
		viewer: {
			id: viewer.memberId,
			name: members.find((m) => m.id === viewer.memberId)?.name ?? "",
		},
		exportedAt: now,
		members,
		accounts: accountRows.map((a) => {
			const balance = latestBalance.get(a.id);
			return {
				...a,
				balanceCents: balance?.amountCents ?? null,
				balanceAt: balance ? balance.at.getTime() : null,
				owedCents: owed.get(a.id) ?? null,
			};
		}),
		transactions,
		privateTotals: [...totals.values()].sort((a, b) => a.month.localeCompare(b.month)),
		plans,
		goals: goalRows,
		bucketNames: Object.fromEntries(latestRecords.buckets.map((b) => [b.id, b.name])),
		commitmentNames: Object.fromEntries(latestRecords.commitments.map((c) => [c.id, c.name])),
		planChanges: planChanges.changes,
		removed: await listLogEvents(db, viewer),
		rules,
		owedBack: owedBackItems.map((item) => ({
			id: item.id,
			transactionId: item.transactionId,
			splitId: item.splitId,
			date: item.date,
			purchase: item.purchase,
			who: item.who,
			owedCents: item.owed,
			paidBackCents: item.paid,
		})),
		paidBackMatches: matchRows.filter((match) => owedIds.has(match.owedBackId)),
		refundLinks: await loadRefundLinksForExport(db, viewer),
		files,
	};
}
