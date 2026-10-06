import { Badge } from "@noodle/ui/components/badge";
import { Card } from "@noodle/ui/components/card";
import { RowButton } from "@noodle/ui/components/row-button";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/**
 * One prompt in the strip: what the closed strip calls it, a one-line status for its row from lg
 * ("2 of 4 done"), and the prompt itself. From lg, `action` sits at the end of the closed row, so
 * the one thing the prompt is for ("Continue setup") needs no click to open it first; `open` shows
 * the prompt under its name with no row to click, for one that is only links (the chips). `help`
 * is the prompt's one "?" from lg: it sits at the end of its row while the row is open, so the
 * prompt's own text carries none (#73).
 */
export type ToDoItem = {
	label: string;
	status?: string;
	action?: ReactNode;
	help?: ReactNode;
	open?: boolean;
	content: ReactNode;
};

/**
 * This Month's prompts (#65): Close the last month, Get started, Check-in day, Extra income and
 * the chips, in one strip under Free to Spend. On a phone, closed, it's one line with a count and
 * the names of what's in it, and a tap opens it. From lg it's one card in the rail, a row per
 * prompt (name, status, chevron), each closed until clicked, so the rail stays about as tall as
 * the main column (#73). The page decides which prompts show and passes only those, so the strip
 * never looks at what rendered. Gone when nothing is in it.
 */
export function ToDo({ className, items }: { className?: string; items: ToDoItem[] }) {
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const hydrated = useHydrated();
	const id = useId();
	if (items.length === 0) return null;
	return (
		<section aria-label="To do" className={cn("grid min-w-0 gap-3", className)}>
			<RowButton
				variant="bordered"
				aria-expanded={open}
				aria-controls={id}
				disabled={!hydrated}
				onClick={() => setOpen((o) => !o)}
				className="min-h-11 min-w-0 justify-start gap-2 bg-card lg:hidden"
			>
				<span className="text-sm font-semibold">To do</span>
				<Badge variant="count">{items.length}</Badge>
				{/* Open, each prompt names itself just below, so the names aren't said twice (#74). */}
				<span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
					{open ? null : items.map((item) => item.label).join(" · ")}
				</span>
				<ChevronDown
					aria-hidden="true"
					className={cn("size-4 shrink-0 text-muted-foreground transition-transform", {
						"rotate-180": open,
					})}
				/>
			</RowButton>
			{/* From lg one heading, lined up with Free to Spend's, over one card of rows (#73). */}
			<h2 className="text-[15px] font-semibold max-lg:hidden">To do</h2>
			{/* On a phone the card is only a wrapper (`contents`), so the prompts stack as before.
			    Every prompt stays mounted while closed, so a half-made choice survives closing it. */}
			<Card className="max-lg:contents">
				<div id={id} className={cn("grid min-w-0 gap-3 lg:gap-0", !open && "max-lg:hidden")}>
					{items.map((item, index) => {
						const shown = item.open || (expanded[item.label] ?? false);
						const panel = `${id}-${index}`;
						return (
							<div key={item.label} className="grid min-w-0 lg:border-border [&+&]:lg:border-t">
								{item.open ? (
									<p className="px-(--card-pad) pt-3 pb-2 text-sm font-medium max-lg:hidden">
										{item.label}
									</p>
								) : (
									<div className="flex min-w-0 items-center max-lg:hidden">
										<RowButton
											aria-expanded={shown}
											aria-controls={panel}
											disabled={!hydrated}
											onClick={() => setExpanded((e) => ({ ...e, [item.label]: !shown }))}
											// The card's own 20px edge, as the Free to Spend and Income cards beside it (issue 73).
											className="min-w-0 flex-1 rounded-none px-(--card-pad) py-3"
										>
											<span className="grid min-w-0 flex-1 gap-0.5">
												<span className="truncate text-sm font-medium">{item.label}</span>
												{/* Open, the status may take a second line: at 1024 it was cut beside the "?" (issue 73). */}
												{item.status ? (
													<span
														className={cn(
															"text-[13px] text-muted-foreground",
															!shown && "truncate",
														)}
													>
														{item.status}
													</span>
												) : null}
											</span>
											<ChevronDown
												aria-hidden="true"
												className={cn(
													"size-4 shrink-0 text-muted-foreground transition-transform",
													{
														"rotate-180": shown,
													},
												)}
											/>
										</RowButton>
										{shown && item.help ? <div className="shrink-0 pe-2">{item.help}</div> : null}
										{item.action ? (
											<div className="shrink-0 pe-(--card-pad) empty:hidden">{item.action}</div>
										) : null}
									</div>
								)}
								<div
									id={panel}
									className={cn("grid min-w-0 gap-3 lg:px-4 lg:pb-3", !shown && "lg:hidden")}
								>
									{item.content}
								</div>
							</div>
						);
					})}
				</div>
			</Card>
		</section>
	);
}
