import type { DayKey } from "./month";
import {
	type ClosingBalance,
	cleanDescription,
	parseStatementAmount,
	parseStatementDate,
	type Statement,
	type StatementLine,
} from "./statements";

// OFX and QFX statements: OFX 1.x is SGML, where a leaf element like <TRNAMT>-12.50 has no closing
// tag; OFX 2.x is XML, where it does. Both are read the same way, tolerantly: each <STMTTRN>
// aggregate (which is always closed) becomes a line, from its DTPOSTED, TRNAMT, FITID, and NAME or
// MEMO. Everything else in the file is ignored.

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

const decode = (text: string) =>
	text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
		if (name.startsWith("#")) {
			const code =
				name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
			return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
		}
		return ENTITIES[name.toLowerCase()] ?? entity;
	});

/** A leaf element's value inside `block`: up to the next tag or line end. */
function leaf(block: string, tag: string): string | null {
	const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
	if (!match) return null;
	const value = decode((match[1] ?? "").trim());
	return value === "" ? null : value;
}

/** Every `<tag>…</tag>` aggregate in `content`. */
const aggregates = (content: string, tag: string) =>
	[...content.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi"))].map(
		(match) => match[1] ?? "",
	);

/** An OFX date ("20260914", "20260914120000.000[-5:EST]") as the day it names. */
const ofxDate = (value: string | null): DayKey | null =>
	value && /^\d{8}/.test(value) ? parseStatementDate(value.slice(0, 8), "ymd") : null;

/** Reads an OFX or QFX statement's transactions, and its closing (ledger) balance if it has one. */
export function readOfxStatement(content: string): Statement {
	const lines: StatementLine[] = [];
	const unreadable: Statement["unreadable"] = [];
	aggregates(content, "STMTTRN").forEach((block, i) => {
		const date = ofxDate(leaf(block, "DTPOSTED")) ?? ofxDate(leaf(block, "DTUSER"));
		const amountText = leaf(block, "TRNAMT");
		const amount = amountText === null ? null : parseStatementAmount(amountText);
		if (!date || amount === null) {
			unreadable.push({ row: i + 1, reason: date ? "No amount" : "No date" });
			return;
		}
		if (amount === 0) return;
		lines.push({
			date,
			amount,
			description: cleanDescription(leaf(block, "NAME") ?? leaf(block, "MEMO") ?? ""),
			bankId: leaf(block, "FITID"),
		});
	});
	return {
		lines,
		closingBalance: closingBalance(content),
		unreadable,
		accountDigits: lastDigits(leaf(content, "ACCTID")),
	};
}

/** The last four digits of an account number, to tell accounts apart; null without four. */
function lastDigits(accountId: string | null): string | null {
	const digits = accountId?.replace(/\D/g, "") ?? "";
	return digits.length >= 4 ? digits.slice(-4) : null;
}

function closingBalance(content: string): ClosingBalance | null {
	const [ledger] = aggregates(content, "LEDGERBAL");
	if (ledger === undefined) return null;
	const amountText = leaf(ledger, "BALAMT");
	const amount = amountText === null ? null : parseStatementAmount(amountText);
	const date = ofxDate(leaf(ledger, "DTASOF"));
	return amount === null || !date ? null : { amount, date };
}
