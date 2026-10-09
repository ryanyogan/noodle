import {
	type Cents,
	defaultOwedBack,
	monthOfDay,
	OWED_BACK_NAME_MAX,
	owedBackLeft,
	owedBackRuleText,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { HandCoins } from "lucide-react";
import { useId, useState } from "react";
import { dayName, formatMoney } from "../format";
import type { MoneyInLine } from "../money-in";
import {
	type OwedBackItem,
	owedBackOnQuery,
	owedBackRuleQuery,
	owedBackText,
	paidBackOfferQuery,
	useClearOwedBack,
	useConfirmPaidBack,
	useOwedBackRule,
	useOwedBackSaidOn,
	useSayOwedBack,
	useWriteOffOwedBack,
} from "../owed-back";
import { MoneyInput } from "./money-input";
import { OwedBackListLink } from "./owed-back-list";

// Paid back and Owed back (issue 132, ADR-0058): saying on a purchase that someone's paying part
// of it back, and confirming which of those a Paid back money-in line settles.

type Child = { id: string; name: string };

/** Who's paying it back, as the fields hold it: a name or a Child, and how much. */
export type OwedBackSaying = { who: string; memberId: string | null; amount: number };

/** Whether it names someone, and is no more than what it is said on. */
export const owedBackSayable = (said: OwedBackSaying, amountCents: number) => ({
	named: said.memberId !== null || said.who.trim() !== "",
	fits: said.amount > 0 && said.amount <= amountCents,
});

/**
 * Who and how much: a name or one of the Children, and an amount up to what it is said on. The
 * one set of fields wherever it is said: an open Transaction, a Review card, Quick Add.
 */
export function OwedBackFields({
	value,
	onChange,
	amountCents,
	people,
	whole = "the purchase",
}: {
	value: OwedBackSaying;
	onChange: (next: OwedBackSaying) => void;
	amountCents: number;
	people: Child[];
	/** What it can be no more than, in words. */
	whole?: string;
}) {
	const id = useId();
	const { fits } = owedBackSayable(value, amountCents);
	return (
		<>
			<div className="grid items-start gap-3 sm:grid-cols-2">
				<Field label="Who’s paying it back" htmlFor={`${id}-who`}>
					<Input
						id={`${id}-who`}
						autoComplete="off"
						maxLength={OWED_BACK_NAME_MAX}
						placeholder="A name, like Casey"
						value={value.memberId ? "" : value.who}
						disabled={value.memberId !== null}
						onChange={(event) => onChange({ ...value, who: event.currentTarget.value })}
					/>
				</Field>
				<Field label="How much" htmlFor={`${id}-amount`}>
					<MoneyInput
						id={`${id}-amount`}
						value={value.amount}
						onCommit={(amount) => onChange({ ...value, amount })}
						aria-invalid={!fits || undefined}
					/>
				</Field>
			</div>
			{people.length > 0 ? (
				// biome-ignore lint/a11y/useSemanticElements: a fieldset's legend can't sit in this row.
				<div role="group" aria-label="Or one of the Children" className="flex flex-wrap gap-2">
					{people.map((child) => (
						<Button
							key={child.id}
							type="button"
							size="sm"
							variant={value.memberId === child.id ? "default" : "outline"}
							aria-pressed={value.memberId === child.id}
							onClick={() =>
								onChange({ ...value, memberId: value.memberId === child.id ? null : child.id })
							}
						>
							{child.name}
						</Button>
					))}
				</div>
			) : null}
			{fits ? null : (
				<p role="alert" className="text-xs font-medium text-over">
					Up to {formatMoney(amountCents)}, what {whole} came to.
				</p>
			)}
		</>
	);
}

/** Who and how much, for a purchase: a name or a Child, and half unless said. */
function OwedBackForm({
	transactionId,
	splitId,
	amountCents,
	item,
	people,
	onDone,
}: {
	transactionId: string;
	splitId: string | null;
	amountCents: number;
	item: OwedBackItem | undefined;
	people: Child[];
	onDone: () => void;
}) {
	const say = useSayOwedBack();
	const [said, setSaid] = useState<OwedBackSaying>({
		who: item && !item.memberId ? item.who : "",
		memberId: item?.memberId ?? null,
		amount: item?.owed ?? defaultOwedBack(amountCents as Cents),
	});
	const { named, fits } = owedBackSayable(said, amountCents);
	const save = () => {
		if (!named || !fits || say.isPending) return;
		say.mutate(
			{
				transactionId,
				splitId,
				who: said.who,
				memberId: said.memberId,
				amountCents: said.amount as Cents,
			},
			{ onSuccess: onDone },
		);
	};
	return (
		// Not a form of its own: in Review's sheet it sits inside the editor's form. Enter saves it.
		// biome-ignore lint/a11y/useSemanticElements: a form can't sit inside the editor's form.
		<div
			role="group"
			aria-label="Who’s paying part of this back"
			className="grid gap-3"
			data-testid="owed-back-form"
			onKeyDown={(event) => {
				// Enter in "How much" keeps what was typed, as it does everywhere; in the name it saves.
				if (event.key !== "Enter" || event.defaultPrevented) return;
				if (!(event.target instanceof HTMLInputElement)) return;
				// Never the form around it: Enter here saves who and how much, nothing else.
				event.preventDefault();
				save();
			}}
		>
			<OwedBackFields
				value={said}
				onChange={setSaid}
				amountCents={amountCents}
				people={people}
				whole={splitId ? "this Split" : "the purchase"}
			/>
			<div className="flex flex-wrap gap-2">
				<Button type="button" size="sm" disabled={!named || !fits || say.isPending} onClick={save}>
					Save
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onDone}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

/**
 * Under "Owed back $600 · Casey": the purchase's Rule can remember it ("Tuition: Casey pays back
 * half"), so it's said on what the Rule files from then on. Nothing when no Rule matches.
 */
function OwedBackRuleOffer({ item }: { item: OwedBackItem }) {
	const rule = useQuery(owedBackRuleQuery(item.transactionId)).data;
	const { remember, forget } = useOwedBackRule();
	if (!rule) return null;
	const said = {
		who: item.who,
		percent: Math.min(100, Math.max(1, Math.round((item.owed * 100) / item.purchaseAmount))),
	};
	const kept = rule.remembered;
	const same = kept !== null && kept.who === said.who && kept.percent === said.percent;
	return (
		<div
			className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground"
			data-testid="owed-back-rule"
		>
			{kept ? (
				<>
					<span>Rule: {owedBackRuleText(rule.pattern, kept.who, kept.percent)}</span>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={forget.isPending}
						onClick={() => forget.mutate(rule.ruleId)}
					>
						Stop remembering
					</Button>
				</>
			) : null}
			{same ? null : (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={remember.isPending}
					onClick={() => remember.mutate(item.id)}
				>
					Remember “{owedBackRuleText(rule.pattern, said.who, said.percent)}”
				</Button>
			)}
		</div>
	);
}

/**
 * "Someone's paying part of this back" for a whole purchase or one of its Splits, and once said,
 * "Owed back $600 · Casey" with a way to change it or take it off.
 */
function OwedBackOn({
	transactionId,
	splitId,
	amountCents,
	label,
	item,
	people,
	canMoveToWhole = false,
	asking = false,
}: {
	transactionId: string;
	/** The Split it is said on; null for the whole purchase. */
	splitId: string | null;
	amountCents: number;
	/** Which part of the purchase this is, when it is split. */
	label?: string | undefined;
	item: OwedBackItem | undefined;
	people: Child[];
	/**
	 * Its Split is gone and nothing else is said on the purchase: it can be put on the whole
	 * purchase, as the one item it was (issue 141).
	 */
	canMoveToWhole?: boolean;
	/** Starts on who and how much when nothing is said yet: the Parent has already asked for it. */
	asking?: boolean;
}) {
	const clear = useClearOwedBack();
	const say = useSayOwedBack();
	const writeOff = useWriteOffOwedBack();
	const [editing, setEditing] = useState(asking && !item);
	return (
		<div className="grid gap-3" data-testid={splitId ? "owed-back-split" : "owed-back-whole"}>
			{item ? (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<p className="text-sm font-medium" data-testid="owed-back-text">
						{label ? <span className="font-normal text-muted-foreground">{label}: </span> : null}
						{owedBackText(item)}
					</p>
					<OwedBackListLink month={monthOfDay(item.date)}>All that’s Owed back</OwedBackListLink>
					{editing ? null : item.writtenOffOn ? (
						// Written off: undone before anything else about it changes.
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={writeOff.isPending}
							onClick={() => writeOff.mutate({ owedBackId: item.id, undo: true })}
						>
							Undo the write-off
						</Button>
					) : (
						<>
							<Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
								Change
							</Button>
							{item.owed > item.paid ? (
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={writeOff.isPending}
									onClick={() => writeOff.mutate({ owedBackId: item.id })}
								>
									{item.paid > 0 ? "Write off the rest" : "Write it off"}
								</Button>
							) : null}
							{canMoveToWhole ? (
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={say.isPending}
									onClick={() =>
										say.mutate({
											owedBackId: item.id,
											transactionId,
											splitId: null,
											who: item.who,
											memberId: item.memberId,
											amountCents: item.owed,
										})
									}
								>
									Put it on the whole purchase
								</Button>
							) : null}
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={clear.isPending}
								onClick={() => clear.mutate(item.id)}
							>
								Nobody’s paying this back
							</Button>
						</>
					)}
				</div>
			) : editing ? (
				label ? (
					<p className="text-[13px] text-muted-foreground">{label}</p>
				) : null
			) : (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					{label ? <span className="text-[13px] text-muted-foreground">{label}</span> : null}
					<Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
						Someone’s paying part of this back
					</Button>
				</div>
			)}
			{/* A Rule remembers it for a whole purchase only. */}
			{item && !editing && !item.splitId ? <OwedBackRuleOffer item={item} /> : null}
			{editing ? (
				<OwedBackForm
					transactionId={transactionId}
					splitId={splitId}
					amountCents={amountCents}
					item={item}
					people={people}
					onDone={() => setEditing(false)}
				/>
			) : null}
		</div>
	);
}

/**
 * On a purchase: "Someone's paying part of this back", and once said, "Owed back $600 · Casey".
 * Money out only. A split purchase is asked Split by Split ("The $45 Split"), each with its own
 * person and amount; what was said on the whole of it before it was split stays, to change or
 * take off.
 */
export function OwedBackOnPurchase({
	transaction,
	members,
	asking = false,
	className = "mt-4 border-t border-border pt-4",
}: {
	transaction: {
		id: string;
		amountCents: number;
		splits?: { id: string; amountCents: number; goal?: unknown }[];
	};
	members: { id: string; name: string; kind: string }[];
	/** Opened to say it (a Review card's sheet): who and how much show at once. */
	asking?: boolean;
	/** How it is set off from what is over it. */
	className?: string;
}) {
	const items = useQuery(owedBackOnQuery(transaction.id)).data;
	if (transaction.amountCents <= 0 || !items) return null;
	const children = members.filter((member) => member.kind === "child");
	// Nothing restores a Goal, so a Split spent from one isn't offered.
	const splits = (transaction.splits ?? []).filter((split) => split.amountCents > 0 && !split.goal);
	const whole = items.find((one) => one.splitId === null);
	// Said on a Split that a later re-split replaced: still owed, so still shown.
	// On the whole purchase or on its Splits, never both: once it's on the whole, no Split offers it.
	const offered = splits.filter((split) => !whole || items.some((one) => one.splitId === split.id));
	const loose = items.filter(
		(one) => one.splitId !== null && !splits.some((split) => split.id === one.splitId),
	);
	return (
		<div className={cn("grid gap-3", className)} data-testid="owed-back">
			{/* An item whose Split is gone is the only thing said: it offers the whole purchase itself. */}
			{(splits.length === 0 || whole) && !(loose.length > 0 && items.length === loose.length) ? (
				<OwedBackOn
					transactionId={transaction.id}
					splitId={null}
					amountCents={transaction.amountCents}
					label={splits.length > 0 ? "The whole purchase" : undefined}
					item={whole}
					people={children}
					asking={asking}
				/>
			) : null}
			{offered.map((split) => (
				<OwedBackOn
					key={split.id}
					transactionId={transaction.id}
					splitId={split.id}
					amountCents={split.amountCents}
					label={`The ${formatMoney(split.amountCents)} Split`}
					item={items.find((one) => one.splitId === split.id)}
					people={children}
				/>
			))}
			{loose.map((item) => (
				<OwedBackOn
					key={item.id}
					transactionId={transaction.id}
					splitId={item.splitId}
					amountCents={transaction.amountCents}
					label="A Split that has changed since"
					item={item}
					people={children}
					// Only when nothing else is said on the purchase: on the whole or its Splits, never both.
					canMoveToWhole={items.length === loose.length}
				/>
			))}
		</div>
	);
}

/**
 * On a Review card (issue 158): "Someone's paying part of this back" in a button the size of
 * Edit, which opens who and how much in a sheet, so a short phone's card is no taller for it.
 * Money out only. Once said the card reads "$300 owed back by Casey" (OwedBackSaidOnCard).
 */
export function OwedBackOnCard({
	transaction,
	label,
	members,
	disabled,
}: {
	transaction: { id: string; amountCents: number };
	/** What the purchase is called on its card. */
	label: string;
	members: { id: string; name: string; kind: string }[];
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const said = useOwedBackSaidOn(transaction.id);
	if (transaction.amountCents <= 0) return null;
	return (
		<>
			<Button
				variant={said ? "secondary" : "ghost"}
				size="icon"
				aria-label={
					said ? `${said} on ${label}: change it` : `Someone’s paying part of ${label} back`
				}
				title="Someone’s paying part of this back"
				data-testid="review-owed-back"
				disabled={disabled}
				onClick={() => setOpen(true)}
			>
				<HandCoins />
			</Button>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent>
					<SheetHeader title="Someone’s paying part of this back" description={label} />
					{open ? (
						<div className="grid gap-4">
							<p className="text-sm text-muted-foreground">
								Their part is Owed back until it comes, and never counts as your spending.
							</p>
							<OwedBackOnPurchase transaction={transaction} members={members} asking className="" />
							<SheetFooter>
								<Button type="button" variant="outline" onClick={() => setOpen(false)}>
									Done
								</Button>
							</SheetFooter>
						</div>
					) : null}
				</SheetContent>
			</Sheet>
		</>
	);
}

/** Under a Review card's choices, once it is said: "$300 owed back by Casey". Nothing before. */
export function OwedBackSaidOnCard({ transactionId }: { transactionId: string }) {
	const said = useOwedBackSaidOn(transactionId);
	if (!said) return null;
	return (
		<p
			className="text-[13px] text-muted-foreground tabular-nums"
			data-testid="review-owed-back-said"
		>
			{said}
		</p>
	);
}

/**
 * Under a Paid back money-in line: what it's offered against, oldest first, for a Parent to
 * adjust and confirm. What it settles nothing with waits as "Paid back, not matched yet".
 */
export function PaidBackMatching({ line, today }: { line: MoneyInLine; today: string }) {
	const id = useId();
	const offered = useQuery(paidBackOfferQuery(line.id)).data;
	const confirm = useConfirmPaidBack();
	// What the Parent typed over the offer, by Owed back item.
	const [typed, setTyped] = useState<Record<string, number>>({});
	if (!offered) return null;
	const matched = line.amount - offered.unmatched;
	const offer = new Map(offered.offer.matches.map((match) => [match.owedBackId, match.amount]));
	const amountFor = (item: OwedBackItem) => typed[item.id] ?? offer.get(item.id) ?? 0;
	const placing = offered.open.reduce((sum, item) => sum + amountFor(item), 0);
	const waits = offered.unmatched - placing;
	const tooMuch = offered.open.some((item) => amountFor(item) > owedBackLeft(item));
	// Matches of months still running are sent again with the new ones: confirming replaces them.
	const running = `${today.slice(0, 7)}-01`;
	const kept = offered.matches.filter((match) => match.countsOn >= running);
	const settles = new Map(offered.settles.map((item) => [item.id, item]));
	/** The matches of running months as sent: one amount an item, without `skip`. */
	const keptWithout = (skip?: string) => {
		const total = new Map<string, number>();
		for (const match of kept)
			if (match.id !== skip)
				total.set(match.owedBackId, (total.get(match.owedBackId) ?? 0) + match.amount);
		return total;
	};
	return (
		<div className="grid gap-3" data-testid="paid-back-matching">
			<p id={`${id}-q`} className="text-sm text-muted-foreground">
				{matched > 0 ? `${formatMoney(matched)} is matched to what was Owed back. ` : ""}
				{offered.unmatched === 0
					? "Nothing is left to match."
					: offered.open.length === 0
						? `${formatMoney(offered.unmatched)} is Paid back, not matched yet. Nothing is Owed back right now; it isn’t counted as Income.`
						: `What is this ${formatMoney(offered.unmatched)} paying back${offered.who ? ` from ${offered.who}` : ""}? Oldest first; change any amount.`}
			</p>
			{offered.matches.length > 0 ? (
				<ul className="grid gap-2" aria-label="Matched to" data-testid="paid-back-matched">
					{offered.matches.map((match) => {
						const item = settles.get(match.owedBackId);
						const name = item?.purchase?.trim() || "Purchase";
						return (
							<li
								key={match.id}
								// The words wrap, never the button: every "Take off" stays beside its line.
								className="flex items-center justify-between gap-x-4"
								data-testid="paid-back-match"
							>
								<span className="min-w-0 text-sm">
									<span className="font-medium">{name}</span>
									<span className="text-muted-foreground">
										{" "}
										· {item ? `${dayName(item.date, today)} · ` : ""}
										{formatMoney(match.amount)} matched
									</span>
								</span>
								{match.countsOn >= running ? (
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className="shrink-0"
										disabled={confirm.isPending}
										aria-label={`Take ${formatMoney(match.amount)} off ${name}`}
										onClick={() =>
											confirm.mutate({
												incomeId: line.id,
												matches: [...keptWithout(match.id)].map(([owedBackId, amount]) => ({
													owedBackId,
													amount: amount as Cents,
												})),
												takenOff: true,
											})
										}
									>
										Take off
									</Button>
								) : (
									<span className="text-[13px] text-muted-foreground">
										Counted in a month that has ended
									</span>
								)}
							</li>
						);
					})}
				</ul>
			) : null}
			{offered.unmatched > 0 && offered.open.length > 0 ? (
				<>
					<ul className="grid gap-2" aria-labelledby={`${id}-q`}>
						{offered.open.map((item) => (
							<li
								key={item.id}
								className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
								data-testid="paid-back-item"
							>
								<label htmlFor={`${id}-${item.id}`} className="min-w-0 text-sm">
									<span className="font-medium">{item.purchase?.trim() || "Purchase"}</span>
									<span className="text-muted-foreground">
										{" "}
										· {dayName(item.date, today)} · {formatMoney(owedBackLeft(item))} owed by{" "}
										{item.who}
									</span>
								</label>
								<MoneyInput
									id={`${id}-${item.id}`}
									className="w-28"
									value={amountFor(item)}
									onCommit={(cents) => setTyped((now) => ({ ...now, [item.id]: cents }))}
									aria-invalid={amountFor(item) > owedBackLeft(item) || undefined}
								/>
							</li>
						))}
					</ul>
					<p
						className={
							waits < 0 ? "text-sm font-medium text-over" : "text-sm text-muted-foreground"
						}
						role={waits < 0 ? "alert" : undefined}
						data-testid="paid-back-waits"
					>
						{waits < 0
							? `That’s ${formatMoney(-waits)} more than was Paid back.`
							: waits > 0
								? `${formatMoney(waits)} waits as Paid back, not matched yet.`
								: "All of it is matched."}
					</p>
					<div>
						<Button
							type="button"
							size="sm"
							disabled={waits < 0 || tooMuch || placing === 0 || confirm.isPending}
							onClick={() => {
								const total = keptWithout();
								for (const item of offered.open)
									if (amountFor(item) > 0)
										total.set(item.id, (total.get(item.id) ?? 0) + amountFor(item));
								confirm.mutate(
									{
										incomeId: line.id,
										matches: [...total].map(([owedBackId, amount]) => ({
											owedBackId,
											amount: amount as Cents,
										})),
									},
									{ onSuccess: () => setTyped({}) },
								);
							}}
						>
							Confirm
						</Button>
					</div>
				</>
			) : null}
		</div>
	);
}
