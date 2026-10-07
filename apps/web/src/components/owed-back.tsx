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
import { useQuery } from "@tanstack/react-query";
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
	useSayOwedBack,
} from "../owed-back";
import { MoneyInput } from "./money-input";
import { OwedBackListLink } from "./owed-back-list";

// Paid back and Owed back (issue 132, ADR-0058): saying on a purchase that someone's paying part
// of it back, and confirming which of those a Paid back money-in line settles.

type Child = { id: string; name: string };

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
	const id = useId();
	const say = useSayOwedBack();
	const [who, setWho] = useState(item && !item.memberId ? item.who : "");
	const [memberId, setMemberId] = useState<string | null>(item?.memberId ?? null);
	const [amount, setAmount] = useState<number>(item?.owed ?? defaultOwedBack(amountCents as Cents));
	const named = memberId !== null || who.trim() !== "";
	const fits = amount > 0 && amount <= amountCents;
	return (
		<form
			className="grid gap-3"
			data-testid="owed-back-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (!named || !fits) return;
				say.mutate(
					{ transactionId, splitId, who, memberId, amountCents: amount as Cents },
					{ onSuccess: onDone },
				);
			}}
		>
			<div className="grid items-start gap-3 sm:grid-cols-2">
				<Field label="Who’s paying it back" htmlFor={`${id}-who`}>
					<Input
						id={`${id}-who`}
						autoComplete="off"
						maxLength={OWED_BACK_NAME_MAX}
						placeholder="A name, like Casey"
						value={memberId ? "" : who}
						disabled={memberId !== null}
						onChange={(event) => setWho(event.currentTarget.value)}
					/>
				</Field>
				<Field label="How much" htmlFor={`${id}-amount`}>
					<MoneyInput
						id={`${id}-amount`}
						value={amount}
						onCommit={setAmount}
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
							variant={memberId === child.id ? "default" : "outline"}
							aria-pressed={memberId === child.id}
							onClick={() => setMemberId(memberId === child.id ? null : child.id)}
						>
							{child.name}
						</Button>
					))}
				</div>
			) : null}
			{fits ? null : (
				<p role="alert" className="text-xs font-medium text-over">
					Up to {formatMoney(amountCents)}, what {splitId ? "this Split" : "the purchase"} came to.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" size="sm" disabled={!named || !fits || say.isPending}>
					Save
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onDone}>
					Cancel
				</Button>
			</div>
		</form>
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
}: {
	transactionId: string;
	/** The Split it is said on; null for the whole purchase. */
	splitId: string | null;
	amountCents: number;
	/** Which part of the purchase this is, when it is split. */
	label?: string | undefined;
	item: OwedBackItem | undefined;
	people: Child[];
}) {
	const clear = useClearOwedBack();
	const [editing, setEditing] = useState(false);
	return (
		<div className="grid gap-3" data-testid={splitId ? "owed-back-split" : "owed-back-whole"}>
			{item ? (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<p className="text-sm font-medium" data-testid="owed-back-text">
						{label ? <span className="font-normal text-muted-foreground">{label}: </span> : null}
						{owedBackText(item)}
					</p>
					<OwedBackListLink month={monthOfDay(item.date)}>All that’s Owed back</OwedBackListLink>
					{editing ? null : (
						<>
							<Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
								Change
							</Button>
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
}: {
	transaction: {
		id: string;
		amountCents: number;
		splits?: { id: string; amountCents: number; goal?: unknown }[];
	};
	members: { id: string; name: string; kind: string }[];
}) {
	const items = useQuery(owedBackOnQuery(transaction.id)).data;
	if (transaction.amountCents <= 0 || !items) return null;
	const children = members.filter((member) => member.kind === "child");
	// Nothing restores a Goal, so a Split spent from one isn't offered.
	const splits = (transaction.splits ?? []).filter((split) => split.amountCents > 0 && !split.goal);
	const whole = items.find((one) => one.splitId === null);
	// Said on a Split that a later re-split replaced: still owed, so still shown.
	const loose = items.filter(
		(one) => one.splitId !== null && !splits.some((split) => split.id === one.splitId),
	);
	return (
		<div className="mt-4 grid gap-3 border-t border-border pt-4" data-testid="owed-back">
			{splits.length === 0 || whole ? (
				<OwedBackOn
					transactionId={transaction.id}
					splitId={null}
					amountCents={transaction.amountCents}
					label={splits.length > 0 ? "The whole purchase" : undefined}
					item={whole}
					people={children}
				/>
			) : null}
			{splits.map((split) => (
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
				/>
			))}
		</div>
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
								className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
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
