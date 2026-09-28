import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// IDs are client-generated ULIDs (they double as idempotency keys).
// Every Household-owned table carries household_id.

export const households = sqliteTable("households", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	// IANA zone; decides which month "today" is for this Household. Always set by
	// the app; the default only exists so SQLite can add the column.
	timeZone: text("time_zone").notNull().default("UTC"),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

export const members = sqliteTable(
	"members",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		kind: text("kind", { enum: ["parent", "child"] }).notNull(),
		name: text("name").notNull(),
		// Set only for Parents. Unique so a Parent belongs to exactly one Household.
		clerkUserId: text("clerk_user_id").unique(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("members_household_idx").on(t.householdId)],
);

export type Household = typeof households.$inferSelect;
export type Member = typeof members.$inferSelect;
