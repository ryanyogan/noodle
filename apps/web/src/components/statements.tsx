import type { ImportRecord } from "@noodle/db";
import {
	type Cents,
	type ClosingBalance,
	type CsvMapping,
	closingBalanceFor,
	DATE_FORMATS,
	type DateFormat,
	dayKeyAt,
	guessCsvMapping,
	parseCsv,
	readStatement,
	type Statement,
	statementFormat,
} from "@noodle/domain";
import { Alert, AlertDescription } from "@noodle/ui/components/alert";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Checkbox } from "@noodle/ui/components/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { Field } from "@noodle/ui/components/field";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { OptionSelect } from "@noodle/ui/components/select";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated, useRouteContext } from "@tanstack/react-router";
import { FileUp } from "lucide-react";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import { formatMoney, shortDay } from "../format";
import { type AccountView, useUpdateAccountBalance } from "../goals";
import { accountImportsQuery } from "../queries";
import { MAX_STATEMENT_CHARS } from "../server/imports";
import { importSummary, StatementRefused, useUploadStatement } from "../statements";

// Statements on an Account's page: its Import history, and the sheet a Parent uploads a CSV or
// OFX statement in. A CSV's columns are mapped (remembered per Account) and previewed first.

/** The latest closing balance an Account's statements report, if any do. */
export function latestClosingBalance(imports: ImportRecord[]): ClosingBalance | null {
	return imports.reduce<ClosingBalance | null>(
		(latest, i) =>
			i.closingBalance && (!latest || i.closingBalance.date > latest.date)
				? i.closingBalance
				: latest,
		null,
	);
}

/**
 * "Your latest statement ends at $X on Sep 20", or for a card or loan "ends owing $X"
 * (closingBalanceFor). The balance is only changed from it when a Parent chooses to (`onUse`,
 * offered when the statement is from the day the balance was entered or later, and says something else).
 */
export function StatementBalanceNote({
	account,
	onUse,
}: {
	account: AccountView;
	onUse?: (amountCents: Cents) => void;
}) {
	const hydrated = useHydrated();
	const { imports } = useSuspenseQuery(accountImportsQuery(account.id)).data;
	const { timeZone } = useRouteContext({ from: "/_authed/_household" }).household;
	const closing = latestClosingBalance(imports);
	if (!closing) return null;
	const { owing, amount } = closingBalanceFor(closing, account.holdsMoney);
	const newer =
		account.latestBalance === null ||
		closing.date >= dayKeyAt(new Date(account.latestBalance.at), timeZone);
	const offer = onUse && newer && amount >= 0 && amount !== account.balance;
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
			<p className="text-sm text-muted-foreground">
				Your latest statement ends {owing ? "owing" : "at"}{" "}
				<span className="font-medium text-foreground tabular-nums">{formatMoney(amount)}</span> on{" "}
				<span className="whitespace-nowrap">{shortDay(closing.date)}.</span>
			</p>
			{offer ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!hydrated}
					onClick={() => onUse(amount)}
				>
					Use {formatMoney(amount)} {owing ? "as what’s owed" : "as the balance"}
				</Button>
			) : null}
		</div>
	);
}

/** A statement chosen in the upload sheet, kept while the sheet is closed by accident. */
export type Draft = { file: ChosenFile | null; mapping: CsvMapping | null };
export const NO_DRAFT: Draft = { file: null, mapping: null };

/**
 * An Account's Imports, and its upload sheet. A connected Account's lines come from its bank
 * (ADR-0020), so it offers no upload unless the bank needs a login again, when a statement is the
 * stop-gap; lines the bank brings in later that a statement already had aren't doubled.
 */
export function StatementsSection({
	account,
	connected,
}: {
	account: AccountView;
	/** The Account's Bank Connection, when it has one: its name, and whether it needs a login. */
	connected?: { institution: string | null; needsLogin: boolean } | null;
}) {
	const hydrated = useHydrated();
	const { imports } = useSuspenseQuery(accountImportsQuery(account.id)).data;
	// Upload days in the Household's time zone, so the server and the browser agree.
	const { timeZone } = useRouteContext({ from: "/_authed/_household" }).household;
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<Draft>(NO_DRAFT);
	const [imported, setImported] = useState<ImportRecord | null>(null);
	// The last upload's result, kept on the page after the sheet closes (a toast goes by) (#51).
	const [result, setResult] = useState<ImportRecord | null>(null);
	const bank = connected?.institution ?? "the bank";
	const canUpload = !connected || connected.needsLogin;

	return (
		<Section aria-labelledby="account-statements">
			<SectionHeader
				id="account-statements"
				title={connected ? `Brought in from ${bank}` : "Statements"}
				count={imports.length}
				action={
					canUpload ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!hydrated}
							onClick={() => {
								setImported(null);
								setResult(null);
								setOpen(true);
							}}
						>
							<FileUp />
							Upload statement
						</Button>
					) : undefined
				}
			/>
			{connected?.needsLogin ? (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					{bank} needs you to log in again before it brings in more. Reconnect it on Accounts, or
					upload a statement for now: what the bank brings in later isn’t added twice.
				</Card>
			) : null}
			{result ? (
				<Card role="status" className="grid gap-0.5 p-(--card-pad) text-sm">
					<span className="font-medium">Uploaded {result.fileName ?? "the statement"}</span>
					<span className="text-muted-foreground">{importSummary(result)}</span>
				</Card>
			) : null}
			{imports.length === 0 ? (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					{connected
						? `${bank} brings in this Account’s Transactions on its own, every day.`
						: "Upload a CSV or OFX statement from your bank to bring in this Account’s Transactions. Uploading one again, or one that overlaps, adds nothing twice."}
				</Card>
			) : (
				<List aria-label="Imported statements">
					{imports.map((record) => (
						<ListRow
							key={record.id}
							title={
								record.source === "bank"
									? `From ${record.institution ?? "the bank"}`
									: (record.fileName ?? "Statement")
							}
							meta={[
								record.firstDate && record.lastDate
									? `${shortDay(record.firstDate)} – ${shortDay(record.lastDate)}`
									: null,
								importSummary(record),
							]
								.filter(Boolean)
								.join(" · ")}
							trailing={
								<span className="text-[13px] text-muted-foreground">
									{shortDay(dayKeyAt(record.createdAt, timeZone))}
								</span>
							}
						/>
					))}
				</List>
			)}
			<Sheet open={open} onOpenChange={setOpen}>
				{open ? (
					<SheetContent layout="side" className="lg:w-140">
						<SheetHeader
							title="Upload a statement"
							description={`A CSV, OFX or QFX file from your bank for ${account.name}.`}
						/>
						{imported ? (
							<ImportedBalance
								account={account}
								record={imported}
								onDone={() => {
									setImported(null);
									setOpen(false);
								}}
							/>
						) : (
							<UploadForm
								account={account}
								draft={draft}
								onDraft={setDraft}
								onImported={(record) => {
									setDraft(NO_DRAFT);
									setResult(record);
									// Offer the statement's balance at once, when it has a newer one.
									if (balanceOffer(account, record.closingBalance, timeZone)) setImported(record);
									else setOpen(false);
								}}
							/>
						)}
					</SheetContent>
				) : null}
			</Sheet>
		</Section>
	);
}

/**
 * The balance a statement's closing balance offers: when it's from the day the balance was entered
 * or later, and says something else. Null when there's nothing to offer.
 */
export function balanceOffer(
	account: AccountView,
	closing: ClosingBalance | null,
	timeZone: string,
): { owing: boolean; amount: Cents } | null {
	if (!closing) return null;
	const { owing, amount } = closingBalanceFor(closing, account.holdsMoney);
	const newer =
		account.latestBalance === null ||
		closing.date >= dayKeyAt(new Date(account.latestBalance.at), timeZone);
	return newer && amount >= 0 && amount !== account.balance ? { owing, amount } : null;
}

/** Right after an import: the statement's closing balance, offered as the Account's. */
function ImportedBalance({
	account,
	record,
	onDone,
}: {
	account: AccountView;
	record: ImportRecord;
	onDone: () => void;
}) {
	const hydrated = useHydrated();
	const { timeZone } = useRouteContext({ from: "/_authed/_household" }).household;
	const updateBalance = useUpdateAccountBalance();
	const offer = balanceOffer(account, record.closingBalance, timeZone);
	const closing = record.closingBalance;
	return (
		<div className="grid gap-4">
			<p role="status" className="text-sm">
				Imported: {importSummary(record)}.
			</p>
			{offer && closing ? (
				<p className="text-sm text-muted-foreground">
					This statement ends {offer.owing ? "owing" : "at"}{" "}
					<span className="font-medium text-foreground tabular-nums">
						{formatMoney(offer.amount)}
					</span>{" "}
					on {shortDay(closing.date)}.{" "}
					{account.balance === null
						? `${account.name} has no ${account.holdsMoney ? "balance" : "amount owed"} yet.`
						: `Noodle has ${formatMoney(account.balance)}${account.holdsMoney ? "" : " owed"}.`}
				</p>
			) : null}
			<div className="grid gap-2 sm:grid-flow-col sm:justify-start">
				{offer ? (
					<Button
						type="button"
						disabled={!hydrated}
						onClick={() => {
							updateBalance.mutate({
								balanceId: ulid(),
								accountId: account.id,
								amountCents: offer.amount,
							});
							onDone();
						}}
					>
						Use {formatMoney(offer.amount)} {offer.owing ? "as what’s owed" : "as the balance"}
					</Button>
				) : null}
				<Button type="button" variant="outline" disabled={!hydrated} onClick={onDone}>
					{offer && account.balance !== null ? `Keep ${formatMoney(account.balance)}` : "Done"}
				</Button>
			</div>
		</div>
	);
}

type ChosenFile = {
	name: string;
	content: string;
	/** Made when the file is chosen, so a retry imports it once. */
	importId: string;
	rows: string[][];
};

/** Whether a remembered mapping still fits this file's columns. */
const fits = (mapping: CsvMapping, rows: string[][]) => {
	const width = Math.max(0, ...rows.slice(0, 20).map((row) => row.length));
	const columns = [
		mapping.dateColumn,
		mapping.descriptionColumn,
		...(mapping.amount.kind === "signed"
			? [mapping.amount.column]
			: [mapping.amount.debitColumn, mapping.amount.creditColumn]),
	];
	return columns.every((c) => c < width);
};

export function UploadForm({
	account,
	draft,
	onDraft,
	onImported,
}: {
	account: AccountView;
	draft: Draft;
	onDraft: (draft: Draft) => void;
	onImported: (record: ImportRecord) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const { csvMapping: remembered, imports } = useSuspenseQuery(
		accountImportsQuery(account.id),
	).data;
	// The account earlier statement files said they were for, to catch a file for another one.
	const pastDigits = imports.find((i) => i.accountDigits !== null)?.accountDigits ?? null;
	// Kept above the sheet, so closing it by accident loses neither the file nor the columns.
	const { file, mapping } = draft;
	const setFile = (next: ChosenFile | null) => onDraft({ file: next, mapping: null });
	const setMapping = (next: CsvMapping | null) => onDraft({ file, mapping: next });
	const [fileError, setFileError] = useState<string | null>(null);
	// Open while nothing reads, so the columns can be fixed; otherwise folded unless asked for.
	const [mappingOpen, setMappingOpen] = useState(false);
	const upload = useUploadStatement(onImported);
	const format = file ? statementFormat(file.content) : null;
	const statement = useMemo(
		() => (file ? readStatement(file.content, mapping).statement : null),
		[file, mapping],
	);

	async function choose(chosen: File | undefined) {
		upload.reset();
		setFileError(null);
		if (!chosen) return;
		const content = await chosen.text();
		if (content.length > MAX_STATEMENT_CHARS) {
			setFile(null);
			return setFileError("That file is too large to be a statement.");
		}
		const rows = statementFormat(content) === "csv" ? parseCsv(content) : [];
		// The Account's last mapping, unless this file is laid out differently (a different export,
		// or another Account's file): then its columns are guessed afresh.
		onDraft({
			file: { name: chosen.name, content, importId: ulid(), rows },
			mapping:
				rows.length === 0
					? null
					: remembered &&
							fits(remembered, rows) &&
							readStatement(content, remembered).statement.lines.length > 0
						? remembered
						: guessCsvMapping(rows),
		});
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!file || !statement || statement.lines.length === 0) return;
		upload.mutate({
			importId: file.importId,
			accountId: account.id,
			fileName: file.name,
			content: file.content,
			csvMapping: format === "csv" ? mapping : null,
		});
	}

	const lines = statement?.lines.length ?? 0;
	return (
		<form onSubmit={onSubmit} className="grid grid-cols-[minmax(0,1fr)] gap-4">
			{/* One line on a phone too: the file's name gives way (truncated) before Clear wraps. */}
			<div className="flex items-center gap-3">
				<input
					ref={input}
					id={`${id}-file`}
					type="file"
					accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
					aria-label="Statement file"
					className="sr-only"
					tabIndex={-1}
					onChange={(event) => void choose(event.currentTarget.files?.[0])}
				/>
				<Button
					type="button"
					variant={file ? "outline" : "default"}
					disabled={!hydrated || upload.isPending}
					className="shrink-0"
					onClick={() => input.current?.click()}
				>
					<FileUp />
					{file ? "Choose another file" : "Choose a file"}
				</Button>
				{file ? <span className="min-w-0 truncate text-sm font-medium">{file.name}</span> : null}
				{file ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="shrink-0"
						disabled={upload.isPending}
						onClick={() => {
							upload.reset();
							setFile(null);
						}}
					>
						Clear
					</Button>
				) : null}
			</div>
			{fileError ? (
				<Alert variant="destructive" role="alert">
					<AlertDescription>{fileError}</AlertDescription>
				</Alert>
			) : null}

			{file && format === "csv" && mapping ? (
				// The guess is usually right: the columns stay folded away unless nothing reads.
				<Collapsible
					open={mappingOpen || lines === 0}
					onOpenChange={setMappingOpen}
					className="group grid gap-3"
				>
					<CollapsibleTrigger className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline">
						Columns look wrong?
					</CollapsibleTrigger>
					<CollapsibleContent keepMounted>
						<div className="pt-3">
							<CsvMappingFields rows={file.rows} mapping={mapping} onChange={setMapping} />
						</div>
					</CollapsibleContent>
				</Collapsible>
			) : null}

			{file && statement ? (
				<StatementPreview
					statement={statement}
					account={account}
					format={format}
					pastDigits={pastDigits}
				/>
			) : null}

			{upload.isError ? (
				<Alert variant="destructive" role="alert">
					<AlertDescription>
						{upload.error instanceof StatementRefused
							? upload.error.reason === "no-account"
								? "This Account no longer exists."
								: "Nothing in this file could be read."
							: "Couldn’t import the statement. Check your connection and try again."}
					</AlertDescription>
				</Alert>
			) : null}

			{file ? (
				<Button type="submit" disabled={!hydrated || lines === 0 || upload.isPending}>
					{upload.isPending
						? "Importing…"
						: upload.isError
							? "Try again"
							: `Import ${lines} ${lines === 1 ? "line" : "lines"}`}
				</Button>
			) : null}
		</form>
	);
}

/** A column's name for the pickers: its header, or its number, with a sample value. */
function columnOptions(rows: string[][], hasHeader: boolean) {
	const width = Math.max(0, ...rows.slice(0, 20).map((row) => row.length));
	const sample = rows[hasHeader ? 1 : 0] ?? [];
	return Array.from({ length: width }, (_, i) => {
		const name = (hasHeader ? rows[0]?.[i] : "") || `Column ${i + 1}`;
		const value = sample[i]?.slice(0, 24);
		return { value: i, label: value ? `${name} (${value})` : name };
	});
}

type AmountLayout = "negative" | "positive" | "debit-credit";

function CsvMappingFields({
	rows,
	mapping,
	onChange,
}: {
	rows: string[][];
	mapping: CsvMapping;
	onChange: (mapping: CsvMapping) => void;
}) {
	const id = useId();
	const hydrated = useHydrated();
	const options = columnOptions(rows, mapping.hasHeader);
	const layout: AmountLayout =
		mapping.amount.kind === "signed" ? mapping.amount.moneyOut : "debit-credit";
	const firstAmountColumn =
		mapping.amount.kind === "signed" ? mapping.amount.column : mapping.amount.debitColumn;

	function setLayout(next: AmountLayout) {
		onChange({
			...mapping,
			amount:
				next === "debit-credit"
					? {
							kind: "debit-credit",
							debitColumn: firstAmountColumn,
							creditColumn: Math.min(firstAmountColumn + 1, options.length - 1),
						}
					: { kind: "signed", column: firstAmountColumn, moneyOut: next },
		});
	}

	const columnSelect = (
		label: string,
		key: string,
		value: number,
		set: (value: number) => void,
	) => (
		<Field label={label} htmlFor={`${id}-${key}`}>
			<OptionSelect
				id={`${id}-${key}`}
				value={String(value)}
				disabled={!hydrated}
				onValueChange={(next) => set(Number(next))}
				choices={options.map((option) => ({ value: String(option.value), label: option.label }))}
			/>
		</Field>
	);

	return (
		<fieldset className="grid gap-3">
			<legend className="mb-1 text-[13px] font-medium text-muted-foreground">
				Which columns are which
			</legend>
			<label htmlFor={`${id}-has-header`} className="flex items-center gap-2 text-sm">
				<Checkbox
					id={`${id}-has-header`}
					checked={mapping.hasHeader}
					disabled={!hydrated}
					onCheckedChange={(checked) => onChange({ ...mapping, hasHeader: checked === true })}
				/>
				The first row names the columns
			</label>
			<div className="grid gap-3 sm:grid-cols-2">
				{columnSelect("Date", "date", mapping.dateColumn, (dateColumn) =>
					onChange({ ...mapping, dateColumn }),
				)}
				<Field label="Date format" htmlFor={`${id}-date-format`}>
					<OptionSelect
						id={`${id}-date-format`}
						value={mapping.dateFormat}
						disabled={!hydrated}
						onValueChange={(value) => onChange({ ...mapping, dateFormat: value as DateFormat })}
						choices={Object.entries(DATE_FORMATS).map(([value, label]) => ({ value, label }))}
					/>
				</Field>
			</div>
			{columnSelect("Description", "description", mapping.descriptionColumn, (descriptionColumn) =>
				onChange({ ...mapping, descriptionColumn }),
			)}
			<Field label="Amounts" htmlFor={`${id}-layout`}>
				<OptionSelect
					id={`${id}-layout`}
					value={layout}
					disabled={!hydrated}
					onValueChange={(value) => setLayout(value as AmountLayout)}
					choices={[
						{ value: "negative", label: "One column, money out is negative" },
						{ value: "positive", label: "One column, money out is positive" },
						{ value: "debit-credit", label: "Two columns: money out, money in" },
					]}
				/>
			</Field>
			{mapping.amount.kind === "signed" ? (
				columnSelect("Amount", "amount", mapping.amount.column, (column) =>
					onChange({ ...mapping, amount: { ...(mapping.amount as Signed), column } }),
				)
			) : (
				<div className="grid gap-3 sm:grid-cols-2">
					{columnSelect("Money out", "debit", mapping.amount.debitColumn, (debitColumn) =>
						onChange({ ...mapping, amount: { ...(mapping.amount as DebitCredit), debitColumn } }),
					)}
					{columnSelect("Money in", "credit", mapping.amount.creditColumn, (creditColumn) =>
						onChange({ ...mapping, amount: { ...(mapping.amount as DebitCredit), creditColumn } }),
					)}
				</div>
			)}
		</fieldset>
	);
}

type Signed = Extract<CsvMapping["amount"], { kind: "signed" }>;
type DebitCredit = Extract<CsvMapping["amount"], { kind: "debit-credit" }>;

const PREVIEW_LINES = 5;

/** What the file will bring in, before it does: totals, the first few lines, and what's skipped. */
function StatementPreview({
	statement,
	account,
	format,
	pastDigits,
}: {
	statement: Statement;
	account: AccountView;
	format: "csv" | "ofx" | null;
	pastDigits: string | null;
}) {
	const { lines, unreadable } = statement;
	const otherAccount =
		statement.accountDigits && pastDigits && statement.accountDigits !== pastDigits
			? statement.accountDigits
			: null;
	if (lines.length === 0) {
		return (
			<Alert variant="destructive">
				<AlertDescription>
					{format === "csv"
						? "No lines can be read with these columns. Check the date, its format, and the amount."
						: "No transactions were found in this file."}
				</AlertDescription>
			</Alert>
		);
	}
	const moneyOut = lines.reduce((sum, l) => sum + (l.amount < 0 ? -l.amount : 0), 0);
	const moneyIn = lines.reduce((sum, l) => sum + (l.amount > 0 ? l.amount : 0), 0);
	const dates = lines.map((l) => l.date).sort();
	return (
		<section aria-label="Preview" className="grid gap-2">
			{otherAccount ? (
				<Alert variant="destructive" role="alert">
					<AlertDescription>
						This file is for an account ending {otherAccount}, but earlier statements for{" "}
						{account.name} were for one ending {pastDigits}. Check it’s the right Account before
						importing.
					</AlertDescription>
				</Alert>
			) : null}
			<p role="status" className="text-sm">
				<span className="font-medium">
					{lines.length} {lines.length === 1 ? "line" : "lines"}
				</span>{" "}
				from {shortDay(dates[0] ?? "")} to {shortDay(dates.at(-1) ?? "")}: money out{" "}
				<span className="tabular-nums">{formatMoney(moneyOut)}</span>, money in{" "}
				<span className="tabular-nums">{formatMoney(moneyIn)}</span>.
			</p>
			<ul className="grid divide-y rounded-xl border bg-surface-2/40 text-[13px]">
				{lines.slice(0, PREVIEW_LINES).map((line, i) => (
					<li
						// Lines have no ID of their own until they're imported.
						// biome-ignore lint/suspicious/noArrayIndexKey: the preview never reorders.
						key={i}
						className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-3 px-3 py-2"
					>
						<span className="text-muted-foreground tabular-nums">{shortDay(line.date)}</span>
						<span className="truncate">{line.description || "No description"}</span>
						<span className={cn("tabular-nums", line.amount > 0 && "text-muted-foreground")}>
							{line.amount > 0 ? `+${formatMoney(line.amount)}` : formatMoney(-line.amount)}
						</span>
					</li>
				))}
			</ul>
			{lines.length > PREVIEW_LINES ? (
				<p className="text-[13px] text-muted-foreground">
					And {lines.length - PREVIEW_LINES} more.
				</p>
			) : null}
			<p className="text-[13px] text-muted-foreground">
				Money out comes in as Transactions to assign.{" "}
				{account.holdsMoney
					? "Money in is recorded as income."
					: "Payments to the card and refunds are brought in, but don’t count as spending."}{" "}
				If it ends with a balance, you can use it once it’s in.
			</p>
			{unreadable.length > 0 ? (
				<p className="text-[13px] text-muted-foreground">
					{unreadable.length} {unreadable.length === 1 ? "row" : "rows"} can’t be read and will be
					skipped (row{" "}
					{unreadable
						.slice(0, 5)
						.map((u) => u.row)
						.join(", ")}
					{unreadable.length > 5 ? "…" : ""}).
				</p>
			) : null}
		</section>
	);
}
