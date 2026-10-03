import { sql } from "drizzle-orm";
import { accounts } from "./schema";

/** accountLabel (@noodle/domain) in SQL: "Chase ••1234", or the name when it shows the digits. */
export const accountLabelSql = sql<string>`case when ${accounts.mask} is null
	or instr(${accounts.name}, ${accounts.mask}) > 0 then ${accounts.name}
	else ${accounts.name} || ' ••' || ${accounts.mask} end`;
