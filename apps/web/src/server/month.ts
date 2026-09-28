import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { householdMiddleware } from "./household";

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");

/** This Month for the signed-in Parent's Household. Empty until the Plan ticket lands. */
export const getThisMonth = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(async ({ data }) => ({
		month: data.month,
		buckets: [] as const,
	}));
