import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";

// Months of history for Reports, written straight into the local D1 the dev server uses: entering
// half a year of Transactions through Quick Add would take minutes per test. Call it after
// createPlannedHousehold; it moves that Plan back to the first seeded month so every month has one.

type Seeded = { bucket: string; note: string; dollars: number; day: number; monthsAgo: number };

const MERCHANTS: Record<string, [note: string, dollars: number][]> = {
	Groceries: [
		["Costco", 212],
		["Trader Joe's", 86],
		["Safeway", 64],
		["Farmers market", 38],
	],
	"Eating out": [
		["Chipotle", 34],
		["Pizza night", 52],
		["Blue Bottle", 14],
	],
	Kids: [
		["Soccer club", 120],
		["Target", 58],
		["School supplies", 41],
	],
	Fun: [
		["Movie tickets", 48],
		["Bookshop", 27],
	],
};

const BIG: Omit<Seeded, "monthsAgo">[] = [
	{ bucket: "Fun", note: "Flights to Denver", dollars: 1860, day: 9 },
	{ bucket: "Kids", note: "Dentist", dollars: 680, day: 14 },
	{ bucket: "Groceries", note: "Costco stock-up", dollars: 420, day: 3 },
	{ bucket: "Fun", note: "Car repair", dollars: 1240, day: 21 },
	{ bucket: "Kids", note: "Summer camp", dollars: 950, day: 6 },
	{ bucket: "Eating out", note: "Anniversary dinner", dollars: 310, day: 17 },
];

const COMMITMENTS = [
	{ name: "Mortgage", dollars: 2400, cadence: "monthly", day: 1 },
	{ name: "Car insurance", dollars: 1150, cadence: "annual", day: 12 },
	{ name: "Internet", dollars: 70, cadence: "monthly", day: 8 },
	{ name: "Streaming", dollars: 23, cadence: "monthly", day: 18 },
] as const;

/** A deterministic wobble, so screenshots don't change between runs. */
const wobble = (seed: number) => 0.7 + ((seed * 7919) % 61) / 100;

// Today as the browser sees it (local time): in the evening west of UTC, the UTC date is already
// tomorrow, and a Transaction dated tomorrow falls outside the Reports period.
const monthOf = (monthsAgo: number, day: number) => {
	const now = new Date();
	const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsAgo, 1));
	const last = monthsAgo === 0 ? now.getDate() : 28;
	return `${date.toISOString().slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
};

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Seeds `months` months of spending and income (this month included) for the Parent's Household. */
export function seedReportHistory(clerkUserId: string, months = 6) {
	const household = `(select household_id from members where clerk_user_id = ${q(clerkUserId)})`;
	const member = `(select id from members where clerk_user_id = ${q(clerkUserId)})`;
	const bucket = (name: string) =>
		`(select id from buckets where household_id = ${household} and name = ${q(name)})`;
	const first = monthOf(months - 1, 1).slice(0, 7);
	const rows: Seeded[] = [];
	for (let monthsAgo = months - 1; monthsAgo >= 0; monthsAgo--) {
		for (const [name, merchants] of Object.entries(MERCHANTS)) {
			merchants.forEach(([note, dollars], i) => {
				for (let visit = 0; visit < (i === 0 ? 3 : 2); visit++) {
					const seed = monthsAgo * 31 + i * 7 + visit * 3 + name.length;
					rows.push({
						bucket: name,
						note,
						dollars: Math.round(dollars * wobble(seed)),
						day: 2 + ((seed * 5) % 26),
						monthsAgo,
					});
				}
			});
		}
		const big = BIG[monthsAgo % BIG.length];
		if (big) rows.push({ ...big, monthsAgo });
	}
	const commitments = COMMITMENTS.map((c) => ({ ...c, id: ulid() }));
	const statements = [
		...commitments.flatMap((c) => [
			`insert into commitments (id, household_id, name, from_month) values (${q(c.id)}, ${household}, ${q(c.name)}, ${q(first)});`,
			`insert into commitment_terms (household_id, commitment_id, month, amount_cents, cadence, due_date) values (${household}, ${q(c.id)}, ${q(first)}, ${c.dollars * 100}, ${q(c.cadence)}, ${q(monthOf(months - 1, c.day))});`,
			...Array.from({ length: months }, (_, monthsAgo) => monthsAgo)
				.filter((monthsAgo) => c.cadence === "monthly" || monthsAgo === months - 1)
				.map(
					(monthsAgo) =>
						`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id, commitment_id) values (${q(ulid())}, ${household}, 'quick-add', ${q(monthOf(monthsAgo, c.day))}, ${c.dollars * 100}, ${q(c.name)}, ${member}, ${q(c.id)});`,
				),
		]),
		`update buckets set from_month = ${q(first)} where household_id = ${household};`,
		`update bucket_allowances set month = ${q(first)} where household_id = ${household};`,
		`update baselines set month = ${q(first)} where household_id = ${household};`,
		...rows.map(
			(row) =>
				`insert into transactions (id, household_id, source, date, amount_cents, bucket_id, note, created_by_member_id) values (${q(ulid())}, ${household}, 'quick-add', ${q(monthOf(row.monthsAgo, row.day))}, ${row.dollars * 100}, ${bucket(row.bucket)}, ${q(row.note)}, ${member});`,
		),
		...Array.from({ length: months }, (_, monthsAgo) =>
			[1, 15].map(
				(day) =>
					`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, ${q(monthOf(monthsAgo, day))}, ${Math.round(4100 * wobble(monthsAgo + day)) * 100}, 'Paycheck', ${member});`,
			),
		).flat(),
	];
	const file = join(mkdtempSync(join(tmpdir(), "noodle-reports-")), "seed.sql");
	writeFileSync(file, statements.join("\n"));
	execFileSync("bunx", ["wrangler", "d1", "execute", "noodle", "--local", `--file=${file}`], {
		stdio: "ignore",
	});
}
