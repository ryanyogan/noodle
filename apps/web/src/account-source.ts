import type { BankConnectionSummary } from "@noodle/db";
import { shortDay, shortDayAt } from "./format";
import type { AccountView } from "./goals";

// Where an Account's numbers come from (#47): its bank, statements a Parent uploads, or what a
// Parent types in. Said on every Account's row and page, so a beginner can tell a live balance
// from one they keep up to date themselves.

export type AccountSource =
	| {
			kind: "connected";
			connection: BankConnectionSummary;
			/** The bank wants a Parent to log in again; nothing comes in meanwhile. */
			needsLogin: boolean;
	  }
	| { kind: "statements"; lastDate: string }
	| { kind: "hand" };

export function accountSource(
	account: Pick<AccountView, "bankConnectionId" | "lastStatementDate">,
	connections: readonly BankConnectionSummary[],
): AccountSource {
	const connection = connections.find((c) => c.id === account.bankConnectionId);
	if (connection) {
		return { kind: "connected", connection, needsLogin: connection.status === "reconnect" };
	}
	if (account.lastStatementDate) return { kind: "statements", lastDate: account.lastStatementDate };
	return { kind: "hand" };
}

/**
 * "Connected · Chase · up to date Sep 30", "From statements · last Aug 27", "Entered by hand".
 * `brief` leaves out when it was last up to date, for a row in a list.
 */
export function accountSourceText(source: AccountSource, brief = false): string {
	switch (source.kind) {
		case "connected": {
			const bank = source.connection.institution ?? "the bank";
			// A row in a list leaves the lapsed login to its Bank Connection, which says it once.
			if (source.needsLogin && !brief) return `${bank} needs you to log in again`;
			if (source.connection.status === "choosing") return `Connecting to ${bank}`;
			const at = source.connection.lastImportedAt;
			if (brief || !at) return `Connected · ${bank}`;
			return `Connected · ${bank} · up to date ${shortDayAt(at.getTime())}`;
		}
		case "statements":
			return `From statements · last ${shortDay(source.lastDate)}`;
		case "hand":
			return "Entered by hand";
	}
}
