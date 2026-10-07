import { loadRestoreMonths } from "@noodle/db";
import type { MonthKey } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { ulidSchema } from "./schemas";

/**
 * The months the money back on one row counted in, for the sentence on a line the bank took back
 * (issue 141): read when that line's detail is opened, never for a list.
 */
export const getBankTookBackMonths = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.union([z.object({ transactionId: ulidSchema }), z.object({ incomeId: ulidSchema })]))
	.handler(
		({ data, context }): Promise<MonthKey[]> => loadRestoreMonths(getDb(), viewerOf(context), data),
	);
