import type { Page } from "@playwright/test";
import { ulid } from "ulid";
import { seedReportHistory } from "./reports-seed";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold } from "./session";

// The one realistic Household the picture specs share: page-shots.spec.ts (every page, for looking
// at a redesign) and video-capture.spec.ts (the intro video's stills, #54). Both only run on GitHub.

/** A value as a SQL string. */
export const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** A day `monthsAgo` months back, never after today. */
export function dayOf(monthsAgo: number, day: number) {
	const now = new Date();
	const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsAgo, 1));
	const last = monthsAgo === 0 ? now.getDate() : 28;
	return `${date.toISOString().slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * Makes the Household for the signed-in `page` (the Parent with Clerk id `userId`) and fills it:
 * the Plan, six months of history, four Accounts (two from a bank), Goals, this month's spending,
 * six lines waiting in Review, Extra income and three Insights. Ends on This Month.
 */
export async function seedShotsHousehold(page: Page, userId: string) {
	// Two Parents, two Children, 14 Buckets and 7 Commitments (seedReportHistory adds Mortgage, Car
	// insurance, Internet and Streaming, so those names aren't used here).
	const created = await createPlannedHousehold(page, {
		baseline: "9,400",
		buckets: [
			["Groceries", "1,100"],
			["Eating out", "350"],
			["Kids", "450"],
			["Fun", "300"],
			["Gas", "240"],
			["Household", "200"],
			["Clothing", "150"],
			["Pets", "90"],
			["Health", "120"],
			["Gifts", "100"],
			["Subscriptions", "60"],
			["Travel", "250"],
		],
		commitments: [
			{ name: "Daycare", amountCents: 90_000, cadence: "monthly", dueDay: 5 },
			{ name: "Electricity", amountCents: 14_200, cadence: "monthly", dueDay: 10 },
			{ name: "Gym", amountCents: 4_500, cadence: "monthly", dueDay: 12 },
			{ name: "Water", amountCents: 6_500, cadence: "monthly", dueDay: 15 },
			{ name: "Phones", amountCents: 12_000, cadence: "monthly", dueDay: 20 },
			{ name: "Life insurance", amountCents: 48_000, cadence: "annual", dueDay: 22 },
			{ name: "Amazon Prime", amountCents: 13_900, cadence: "annual", dueDay: 26 },
		],
		children: ["Maya", "Leo"],
		finishSetup: true,
		personalAllowanceCents: 15_000,
		otherParent: { name: "Sam", personalAllowanceCents: 15_000 },
		rules: [
			{ pattern: "Costco", bucket: "Groceries" },
			{ pattern: "Shell", bucket: "Gas" },
			{ pattern: "Chewy", bucket: "Pets" },
		],
	});
	if (!created) throw new Error("The Household wasn't made through /api/dev/household");
	const { householdId, parentId, month, bucketIds, commitmentIds } = created;

	// Six months of spending, income and four more Commitments.
	seedReportHistory(userId, 6);

	const h = q(householdId);
	const m = q(parentId);
	const first = dayOf(5, 1).slice(0, 7);
	const ids = {
		bank: ulid(),
		checking: ulid(),
		sapphire: ulid(),
		amex: ulid(),
		savings: ulid(),
		emergency: ulid(),
		vacation: ulid(),
		car: ulid(),
		college: ulid(),
		roof: ulid(),
		openTransaction: ulid(),
	};
	const bucket = (name: string) => q(bucketIds[name] ?? "");
	const statements: string[] = [
		// A Bank Connection that needs the Parent to log in again, with two of the four Accounts.
		`insert into bank_connections (id, household_id, provider, external_id, institution, credential, status, last_imported_at, notice, created_by_member_id) values (${q(ids.bank)}, ${h}, 'plaid', ${q(`page-shots-${ids.bank}`)}, 'Chase', 'page-shots-not-a-credential', 'reconnect', ${Date.now() - 4 * 86_400_000}, null, ${m});`,
	];
	const accounts: [
		id: string,
		name: string,
		kind: string,
		cents: number,
		bank: boolean,
		mask: string | null,
	][] = [
		[ids.checking, "Chase Checking", "checking", 642_318, true, "4821"],
		[ids.sapphire, "Chase Sapphire Reserve", "credit-card", 184_672, true, "0093"],
		[ids.amex, "Amex Platinum", "credit-card", 96_240, false, null],
		[ids.savings, "Ally Savings", "savings", 2_315_000, false, null],
	];
	for (const [id, name, kind, cents, bank, mask] of accounts) {
		statements.push(
			`insert into accounts (id, household_id, name, kind, bank_connection_id, external_id, mask) values (${q(id)}, ${h}, ${q(name)}, ${q(kind)}, ${bank ? q(ids.bank) : "null"}, ${bank ? q(`acct-${id}`) : "null"}, ${mask ? q(mask) : "null"});`,
			`insert into account_balances (id, household_id, account_id, amount_cents, created_by_member_id) values (${q(ulid())}, ${h}, ${q(id)}, ${cents}, ${m});`,
		);
	}
	// An Account nobody has given a balance yet ("No balance yet").
	statements.push(
		`insert into accounts (id, household_id, name, kind, bank_connection_id, external_id, mask) values (${q(ids.college)}, ${h}, 'College savings', 'savings', null, null, null);`,
	);
	// A Goal with a long History, as goal-side-sticky.spec.ts seeds it: three small fundings a month
	// for 14 months, so the twelve months shown are far taller than the window (#73).
	const longAgo = 14;
	statements.push(
		`insert into goals (id, household_id, account_id, name, target_cents, target_date, from_month) values (${q(ids.roof)}, ${h}, ${q(ids.savings)}, 'New roof', 900000, null, ${q(dayOf(longAgo - 1, 1).slice(0, 7))});`,
		...Array.from(
			{ length: longAgo * 3 },
			(_, i) =>
				`insert into moves (id, household_id, kind, month, amount_cents, created_by_member_id, to_goal_id) values (${q(ulid())}, ${h}, 'goal-funding', ${q(dayOf(Math.floor(i / 3), 1).slice(0, 7))}, ${1_000 + (i % 3) * 500}, ${m}, ${q(ids.roof)});`,
		),
	);
	// Three Goals on the savings Account, funded a little each month.
	const goals: [id: string, name: string, target: number, date: string | null, monthly: number][] =
		[
			[ids.emergency, "Emergency fund", 1_500_000, null, 40_000],
			[ids.vacation, "Hawaii trip", 600_000, dayOf(-9, 15), 30_000],
			[ids.car, "Next car", 1_200_000, dayOf(-26, 1), 25_000],
		];
	for (const [id, name, target, date, monthly] of goals) {
		statements.push(
			`insert into goals (id, household_id, account_id, name, target_cents, target_date, from_month) values (${q(id)}, ${h}, ${q(ids.savings)}, ${q(name)}, ${target}, ${date ? q(date) : "null"}, ${q(first)});`,
		);
		for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
			statements.push(
				`insert into moves (id, household_id, kind, month, amount_cents, created_by_member_id, to_goal_id) values (${q(ulid())}, ${h}, 'goal-funding', ${q(dayOf(monthsAgo, 1).slice(0, 7))}, ${monthly}, ${m}, ${q(id)});`,
			);
		}
	}
	// Card and bank lines for the Buckets seedReportHistory leaves empty, four months of them.
	const lines: [bucket: string, merchant: string, cents: number, day: number, account: string][] = [
		["Gas", "Shell", 5_840, 4, ids.sapphire],
		["Gas", "Chevron", 6_210, 17, ids.sapphire],
		["Household", "Home Depot", 8_730, 8, ids.amex],
		["Household", "Target", 4_415, 22, ids.sapphire],
		["Clothing", "Old Navy", 6_890, 11, ids.amex],
		["Pets", "Chewy", 5_299, 6, ids.sapphire],
		["Pets", "Vet visit", 3_500, 19, ids.checking],
		["Health", "CVS Pharmacy", 2_860, 13, ids.sapphire],
		["Gifts", "Etsy", 4_200, 24, ids.amex],
		["Subscriptions", "Spotify", 1_699, 2, ids.sapphire],
		["Subscriptions", "NYTimes", 1_700, 9, ids.sapphire],
		["Travel", "Marriott", 21_840, 15, ids.amex],
		["Alex’s Personal Allowance", "Bike shop", 6_400, 7, ids.checking],
		["Sam’s Personal Allowance", "Yarn store", 3_850, 16, ids.checking],
	];
	for (let monthsAgo = 3; monthsAgo >= 0; monthsAgo--) {
		lines.forEach(([name, merchant, cents, day, account], index) => {
			if (!bucketIds[name]) return;
			// Travel only every other month, and amounts that differ a little month to month.
			if (name === "Travel" && monthsAgo % 2 === 1) return;
			const amount = Math.round(cents * (0.85 + ((monthsAgo * 13 + index * 7) % 30) / 100));
			statements.push(
				`insert into transactions (id, household_id, source, date, amount_cents, bucket_id, note, merchant, account_id, created_by_member_id) values (${q(ulid())}, ${h}, 'import', ${q(dayOf(monthsAgo, day))}, ${amount}, ${bucket(name)}, ${q(merchant)}, ${q(merchant)}, ${q(account)}, ${m});`,
			);
		});
	}
	// The Transaction opened on its own page.
	statements.push(
		`insert into transactions (id, household_id, source, date, amount_cents, bucket_id, note, merchant, account_id, created_by_member_id) values (${q(ids.openTransaction)}, ${h}, 'import', ${q(dayOf(0, 3))}, 18462, ${bucket("Groceries")}, 'Whole Foods', 'Whole Foods', ${q(ids.sapphire)}, ${m});`,
	);
	// Seven lines waiting in Review: three with a guess, three with none, and a payment to the Amex
	// out of checking, which Review offers as a card payment.
	const review: [
		merchant: string,
		cents: number,
		day: number,
		guess: string | null,
		account?: string,
	][] = [
		["AMZN Mktp US*2K4L81", 3_499, 2, "Household"],
		["SQ *BLUE DOOR COFFEE", 1_150, 3, "Eating out"],
		["VENMO PAYMENT 1029", 6_000, 4, null],
		["TST* THE RUSTY ANCHOR", 8_640, 5, "Eating out"],
		["PAYPAL *STEAMGAMES", 2_999, 6, null],
		["CITY OF OAKLAND PARKING", 1_200, 7, null],
		["AMEX EPAYMENT ACH PMT", 40_000, 8, null, ids.checking],
	];
	for (const [merchant, cents, day, guess, account = ids.sapphire] of review) {
		const id = ulid();
		statements.push(
			`insert into transactions (id, household_id, source, date, amount_cents, note, merchant, account_id, created_by_member_id) values (${q(id)}, ${h}, 'import', ${q(dayOf(0, day))}, ${cents}, ${q(merchant)}, ${q(merchant)}, ${q(account)}, ${m});`,
			`insert into categorizations (transaction_id, household_id, member_id, outcome, method, bucket_id, confidence, merchant) values (${q(id)}, ${h}, ${m}, 'review', ${guess ? "'model'" : "'none'"}, ${guess ? bucket(guess) : "null"}, ${guess ? "0.62" : "null"}, ${q(merchant)});`,
		);
	}
	// An archived Account: Accounts folds it away under "Archived".
	const archivedId = ulid();
	statements.push(
		`insert into accounts (id, household_id, name, kind, bank_connection_id, external_id, mask, archived_at) values (${q(archivedId)}, ${h}, 'Old Wells Fargo Checking', 'checking', null, null, null, ${Date.now() - 20 * 86_400_000});`,
		`insert into account_balances (id, household_id, account_id, amount_cents, created_by_member_id) values (${q(ulid())}, ${h}, ${q(archivedId)}, 0, ${m});`,
	);
	// Extra income this month, and three Insights.
	statements.push(
		`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${h}, ${q(dayOf(0, 2))}, 184000, 'Tax refund', ${m});`,
		`insert into insights (id, household_id, kind, title, body, yearly_impact_cents, transaction_ids, commitment_ids, fingerprint) values (${q(ulid())}, ${h}, 'price-increase', 'Phones went up $15', 'It was $105 a month through July and has been $120 since.', 18000, '[]', ${q(JSON.stringify([commitmentIds.Phones].filter(Boolean)))}, ${q(ulid())});`,
		`insert into insights (id, household_id, kind, title, body, yearly_impact_cents, transaction_ids, commitment_ids, fingerprint) values (${q(ulid())}, ${h}, 'duplicate-service', 'Spotify and Amazon Prime may overlap', 'Amazon Prime includes Amazon Music; Spotify is $17 a month on its own.', 20400, '[]', '[]', ${q(ulid())});`,
		`insert into insights (id, household_id, kind, title, body, yearly_impact_cents, transaction_ids, commitment_ids, fingerprint) values (${q(ulid())}, ${h}, 'unused', 'The Gym hasn’t been visited lately', 'Nothing near the gym in three months; it’s $45 a month.', 54000, '[]', ${q(JSON.stringify([commitmentIds.Gym].filter(Boolean)))}, ${q(ulid())});`,
	);
	await seedSql(statements);
	return { householdId, parentId, month, bucketIds, commitmentIds, ids };
}

/**
 * A small second Household for the pictures of what a month's Income brings up (#86, #87): $5,000
 * take-home pay, three Buckets, Hockey $50 over and covered from Groceries, and last month ended
 * with $600 of Extra income and nothing spent, so it waits to be closed. `setIncome` replaces this
 * month's Income: above take-home pay for the Extra income prompt, below it for the low month.
 */
export async function seedIncomeHousehold(page: Page) {
	const created = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
			["Fun", "300"],
		],
	});
	if (!created) throw new Error("The Household wasn't made through /api/dev/household");
	const { householdId, parentId, month, bucketIds } = created;
	const h = q(householdId);
	const m = q(parentId);
	const last = q(dayOf(1, 1).slice(0, 7));
	await seedSql([
		// The Plan starts last month, as seedReportHistory moves it back.
		`update buckets set from_month = ${last} where household_id = ${h};`,
		`update bucket_allowances set month = ${last} where household_id = ${h};`,
		`update baselines set month = ${last} where household_id = ${h};`,
		`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${h}, ${q(dayOf(1, 15))}, 560000, 'Paychecks', ${m});`,
		`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id, bucket_id) values (${q(ulid())}, ${h}, 'quick-add', ${q(dayOf(0, 2))}, 45000, 'Skates', ${m}, ${q(bucketIds.Hockey ?? "")});`,
		`insert into moves (id, household_id, kind, month, from_bucket_id, to_bucket_id, amount_cents, created_by_member_id) values (${q(ulid())}, ${h}, 'cover', ${q(month)}, ${q(bucketIds.Groceries ?? "")}, ${q(bucketIds.Hockey ?? "")}, 5000, ${m});`,
	]);
	const setIncome = (cents: number) =>
		seedSql([
			`delete from income where household_id = ${h} and date >= ${q(`${month}-01`)};`,
			`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${h}, ${q(dayOf(0, 2))}, ${cents}, 'Paychecks', ${m});`,
		]);
	return { month, bucketIds, setIncome };
}

/**
 * Money between the two Parents, for the "Between us" pictures: a $1,500 Zelle from Sam that came
 * in looking like Income, and $400 sent to Sam out of `accountId`, in no Bucket yet. Gives back
 * the money-out line's id. Kept out of seedShotsHousehold so the intro video's figures stay put.
 */
export async function seedBetweenUs(householdId: string, parentId: string, accountId: string) {
	const h = q(householdId);
	const m = q(parentId);
	const sent = ulid();
	await seedSql([
		`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${h}, ${q(dayOf(0, 3))}, 150000, 'Zelle from Sam', ${m});`,
		`insert into transactions (id, household_id, source, date, amount_cents, note, merchant, account_id, created_by_member_id) values (${q(sent)}, ${h}, 'import', ${q(dayOf(0, 4))}, 40000, 'Zelle to Sam', 'Zelle to Sam', ${q(accountId)}, ${m});`,
	]);
	return sent;
}
