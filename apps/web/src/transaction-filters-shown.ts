import { createContext } from "react";
import type { TransactionFilters } from "./transactions";

/**
 * The filters the Transactions list on screen was loaded with, for the Transaction open in it.
 *
 * After a search or filter change the list keeps showing what it has until the new rows arrive
 * (issue 52). The open Transaction reads the same rows, so it must read them by the same filters:
 * by the ones just asked for it had nothing yet, and showed its own loading state in the middle
 * of a list that had not moved (issue 129). Null outside the list's page.
 */
export const ShownFilters = createContext<TransactionFilters | null>(null);
