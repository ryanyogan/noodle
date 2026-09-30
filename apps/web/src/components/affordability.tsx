import type { Cents, Reason, Verdict } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { cn } from "@noodle/ui/lib/utils";
import { Check, Circle, Info, Minus } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useState } from "react";
import type { CommitmentRole } from "../affordability";
import { formatMoney } from "../format";
import { MoneyInput } from "./money-input";
import { NativeSelect } from "./native-select";

// The pieces of an Affordability Check's form and its answer. Quiet by design: colour marks only
// the verdict, and Not Yet stays neutral (it's "not yet", not an alarm).

export const verdictName: Record<Verdict, string> = {
	comfortable: "Comfortable",
	stretch: "Stretch",
	"not-yet": "Not yet",
};

const verdictDot: Record<Verdict, string> = {
	comfortable: "bg-brand",
	stretch: "bg-pace",
	"not-yet": "bg-muted-foreground",
};

/** The verdict as a word with its dot. */
export function VerdictLabel({ verdict, className }: { verdict: Verdict; className?: string }) {
	return (
		<span className={cn("inline-flex items-center gap-2", className)}>
			<span
				aria-hidden="true"
				className={cn("size-2.5 shrink-0 rounded-full", verdictDot[verdict])}
			/>
			{verdictName[verdict]}
		</span>
	);
}

const toneIcon: Record<Reason["tone"], ReactNode> = {
	comfortable: <Check className="size-4 text-brand" />,
	stretch: <Circle className="size-3.5 fill-pace text-pace" />,
	"not-yet": <Minus className="size-4 text-foreground" />,
	note: <Info className="size-4 text-muted-foreground" />,
};

const toneName: Record<Reason["tone"], string> = { ...verdictName, note: "Note" };

/** The verdict, what it's for, the reasons behind it, and what else the caller shows. */
export function VerdictCard({
	verdict,
	subject,
	reasons,
	children,
}: {
	verdict: Verdict;
	subject: string;
	reasons: Reason[];
	children?: ReactNode;
}) {
	return (
		<Card className="grid gap-4 p-(--card-pad)" data-testid="affordability-verdict">
			<div className="grid gap-0.5">
				<p className="text-[13px] text-muted-foreground">{subject}</p>
				<h2 className="text-2xl font-semibold tracking-[-0.02em]">
					<VerdictLabel verdict={verdict} />
				</h2>
			</div>
			<ul className="grid gap-2.5 text-sm" aria-label="Reasons">
				{reasons.map((reason) => (
					<li
						key={reason.text}
						className={cn(
							"flex items-start gap-2.5",
							reason.tone === "note" && "text-muted-foreground",
						)}
					>
						<span aria-hidden="true" className="grid h-5 w-4 shrink-0 place-items-center">
							{toneIcon[reason.tone]}
						</span>
						<span>
							<span className="sr-only">{toneName[reason.tone]}: </span>
							{reason.text}
						</span>
					</li>
				))}
			</ul>
			{children}
		</Card>
	);
}

/** Rows of amounts, the last one (a total) in bold. */
export function Breakdown({
	caption,
	rows,
}: {
	caption: string;
	rows: { label: string; amount: Cents; total?: boolean }[];
}) {
	return (
		<table className="w-full text-sm tabular-nums">
			<caption className="pb-1.5 text-start text-[13px] font-medium text-muted-foreground">
				{caption}
			</caption>
			<tbody>
				{rows.map((row) => (
					<tr key={row.label} className={cn("[&>*]:py-1.5", row.total && "border-t font-semibold")}>
						<th
							scope="row"
							className={cn("text-start font-normal", !row.total && "text-muted-foreground")}
						>
							{row.label}
						</th>
						<td className="text-end">{formatMoney(row.amount)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** How the Check works its numbers out, in a few plain lines. */
export function Assumptions({ lines }: { lines: string[] }) {
	return (
		<div className="grid gap-1.5 text-xs text-subtle-foreground">
			<p className="font-medium text-muted-foreground">How this is worked out</p>
			<ul className="grid list-disc gap-1 ps-4">
				{lines.map((line) => (
					<li key={line}>{line}</li>
				))}
			</ul>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Fields

export function MoneyField({
	label,
	hint,
	value,
	onChange,
}: {
	label: string;
	hint?: ReactNode;
	value: Cents;
	onChange: (cents: Cents) => void;
}) {
	const id = useId();
	return (
		<Field label={label} htmlFor={id} hint={hint}>
			<MoneyInput id={id} value={value} onCommit={onChange} />
		</Field>
	);
}

/**
 * A rate as a % (up to two decimals) that saves when the Parent leaves the field or presses
 * Enter, like MoneyInput; anything else is flagged and not saved.
 */
export function PercentField({
	label,
	hint,
	value,
	max = 100,
	onChange,
}: {
	label: string;
	hint?: ReactNode;
	value: number;
	max?: number;
	onChange: (value: number) => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState<string | null>(null);
	const parse = (text: string) => {
		const match = /^\s*(\d{1,3}(?:\.\d{0,3})?|\.\d{1,3})\s*%?\s*$/.exec(text);
		const number = match ? Number(match[1]) : Number.NaN;
		return Number.isFinite(number) && number <= max ? number : null;
	};
	const invalid = draft !== null && parse(draft) === null;
	const commit = () => {
		if (draft === null) return;
		const number = parse(draft);
		if (number === null) return;
		setDraft(null);
		if (number !== value) onChange(number);
	};
	return (
		<Field label={label} htmlFor={id} hint={hint}>
			<div className="relative">
				<Input
					id={id}
					type="text"
					inputMode="decimal"
					autoComplete="off"
					enterKeyHint="done"
					className="pe-7 text-end tabular-nums"
					value={draft ?? String(value)}
					aria-invalid={invalid || undefined}
					onFocus={(event) => {
						setDraft(String(value));
						event.currentTarget.select();
					}}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
						} else if (event.key === "Escape") {
							setDraft(null);
						}
					}}
				/>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-muted-foreground text-sm"
				>
					%
				</span>
			</div>
		</Field>
	);
}

export function SelectField<T extends string | number>({
	label,
	hint,
	value,
	options,
	onChange,
}: {
	label: string;
	hint?: ReactNode;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	const id = useId();
	return (
		<Field label={label} htmlFor={id} hint={hint}>
			<NativeSelect
				id={id}
				value={String(value)}
				onChange={(event) => {
					const chosen = options.find((o) => String(o.value) === event.currentTarget.value);
					if (chosen) onChange(chosen.value);
				}}
			>
				{options.map((o) => (
					<option key={String(o.value)} value={String(o.value)}>
						{o.label}
					</option>
				))}
			</NativeSelect>
		</Field>
	);
}

/** A group of fields under a small heading. */
export function FieldGroup({
	legend,
	children,
	className,
	...props
}: ComponentProps<"fieldset"> & { legend: string }) {
	return (
		// A fieldset, and a grid's auto column, are as wide as their longest unbreakable content by
		// default: min-w-0 and a minmax(0,1fr) column keep long names within the form's column.
		<fieldset className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4", className)} {...props}>
			<legend className="mb-3 text-[13px] font-medium text-muted-foreground">{legend}</legend>
			{children}
		</fieldset>
	);
}

/** Which Goals' Earmarks go toward it (their money is set aside for it), and other cash. */
export function EarmarkPicker({
	goals,
	chosen,
	onChosen,
	single = false,
	otherCash,
	onOtherCash,
}: {
	goals: { id: string; name: string; saved: Cents }[];
	chosen: string[];
	onChosen: (ids: string[]) => void;
	/** Only one Goal may be chosen. */
	single?: boolean;
	otherCash: Cents;
	onOtherCash: (cents: Cents) => void;
}) {
	return (
		<FieldGroup legend="Set aside for it">
			{goals.length > 0 ? (
				<div className="grid grid-cols-[minmax(0,1fr)] gap-2">
					{goals.map((goal) => (
						<label
							key={goal.id}
							className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm"
						>
							<input
								type="checkbox"
								className="size-4 accent-(--brand)"
								checked={chosen.includes(goal.id)}
								onChange={(event) => {
									const on = event.currentTarget.checked;
									onChosen(
										on
											? single
												? [goal.id]
												: [...chosen, goal.id]
											: chosen.filter((id) => id !== goal.id),
									);
								}}
							/>
							<span className="min-w-0 flex-1 truncate">{goal.name}</span>
							<span className="shrink-0 text-muted-foreground tabular-nums">
								{formatMoney(goal.saved)}
							</span>
						</label>
					))}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">No Goals with money set aside yet.</p>
			)}
			<MoneyField
				label="Other cash"
				hint="Savings not claimed by a Goal that could go toward it."
				value={otherCash}
				onChange={onOtherCash}
			/>
		</FieldGroup>
	);
}

const roleName: Record<CommitmentRole, string> = {
	stays: "Stays",
	replaced: "Replaced",
	debt: "Debt payment",
};

/** What each Commitment is to the Check: kept, replaced by the new cost, or a debt. */
export function CommitmentRoles({
	commitments,
	roles,
	allowed,
	hint,
	onRole,
}: {
	commitments: { id: string; name: string; monthly: Cents }[];
	roles: Record<string, CommitmentRole>;
	allowed: CommitmentRole[];
	hint: string;
	onRole: (commitmentId: string, role: CommitmentRole) => void;
}) {
	if (commitments.length === 0) return null;
	return (
		<FieldGroup legend="Commitments">
			<p className="-mt-2 text-xs text-subtle-foreground">{hint}</p>
			<div className="grid grid-cols-[minmax(0,1fr)] gap-2">
				{commitments.map((c) => (
					<div key={c.id} className="flex items-center gap-3 text-sm">
						<span className="min-w-0 flex-1">
							<span className="block truncate">{c.name}</span>
							<span className="text-[13px] text-muted-foreground tabular-nums">
								{formatMoney(c.monthly)} a month
							</span>
						</span>
						<NativeSelect
							className="w-40 shrink-0"
							aria-label={`${c.name} is`}
							value={roles[c.id] ?? "stays"}
							onChange={(event) => onRole(c.id, event.currentTarget.value as CommitmentRole)}
						>
							{allowed.map((role) => (
								<option key={role} value={role}>
									{roleName[role]}
								</option>
							))}
						</NativeSelect>
					</div>
				))}
			</div>
		</FieldGroup>
	);
}
