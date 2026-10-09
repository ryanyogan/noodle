import { loadMoneyIn, loadParentPay } from "@noodle/db";
import { addMonths, PAY_HISTORY_MONTHS, type PayHistory, payHistory } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";

// What a Parent's pay has been, on Plan › Income (issue 159, phase b; ADR-0067). Like Income
// itself it is the Household's: both Parents read it.

/** One Parent whose pay varies, and their Income by month. */
export type ParentPayHistory = { memberId: string; name: string; history: PayHistory };

/**
 * The last twelve months of Income of each Parent who isn't on a salary, as `month` reads them.
 * A Parent with no Income of their own in those months or in `month` is left out.
 */
export const getPayHistory = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<ParentPayHistory[]> => {
		const db = getDb();
		const [parents, lines] = await Promise.all([
			loadParentPay(db, context.household.id),
			loadMoneyIn(db, context.household.id, {
				from: `${addMonths(data.month, -PAY_HISTORY_MONTHS)}-01`,
				until: `${addMonths(data.month, 1)}-01`,
			}),
		]);
		const income = lines.filter((line) => line.kind === "income" && !line.needsReview);
		return parents
			.filter((parent) => parent.pay === null)
			.map((parent) => ({
				memberId: parent.memberId,
				name: parent.name,
				history: payHistory(income, parent.memberId, data.month),
			}))
			.filter(({ history }) => history.months.some((m) => m.total > 0));
	});
