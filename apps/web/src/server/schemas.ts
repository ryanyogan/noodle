import type { DayKey } from "@noodle/domain";
import { z } from "zod";

export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Expected a ULID");

/** A real calendar day as "YYYY-MM-DD". */
export const dayKeySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
	.refine((day) => new Date(`${day}T00:00:00Z`).toISOString().startsWith(day), "Not a real day")
	.transform((day) => day as DayKey);
