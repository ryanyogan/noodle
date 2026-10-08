import type { BellRow } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@noodle/ui/components/popover";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Bell as BellIcon } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { shortDay } from "../format";
import { bellQuery } from "../queries";
import { markBellSeen } from "../server/bell";

/** How many of the bell's rows this Parent hasn't read; 0 until it has loaded. */
export function useBellUnread() {
	return useQuery(bellQuery()).data?.unread ?? 0;
}

const unreadWords = (unread: number) =>
	unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

/**
 * The bell (issue 157, ADR-0065): the releases this Parent hasn't seen and the Nudges sent to
 * them, newest first, each leading somewhere. In the Sidebar it is an icon with a dot while
 * something is unread; in the More sheet on a phone it is a row with the count. Opening it reads
 * what it lists: the dot goes at once, and on this Parent's other screens once the server has it.
 */
export function NotificationBell({ place }: { place: "sidebar" | "more" }) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const data = useQuery(bellQuery()).data;
	const [open, setOpen] = useState(false);
	// The rows as they were when it opened: reading them takes a release off the list, which
	// mustn't happen under the Parent's eyes.
	const [shown, setShown] = useState<BellRow[] | null>(null);
	// Inside the More sheet the list is part of the sheet, so the sheet doesn't take its focus back.
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	const seen = useMutation({ mutationFn: markBellSeen });
	const unread = data?.unread ?? 0;
	const rows = shown ?? data?.rows ?? [];

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		setShown(next ? (data?.rows ?? null) : null);
		if (!next || !data || data.unread === 0) return;
		const { queryKey } = bellQuery();
		void queryClient.cancelQueries({ queryKey });
		queryClient.setQueryData(queryKey, {
			...data,
			unread: 0,
			rows: data.rows.map((row) => ({ ...row, unread: false })),
		});
		seen.mutate({ data: data.seen });
	};

	const follow = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
		// A modified click opens a new tab; this one stays where it is.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		onOpenChange(false);
		// From the More sheet the page takes the sheet's place in history, as picking a page does.
		void router.navigate({ href: url, replace: place === "more" });
	};

	return (
		<div ref={setHost} className={place === "more" ? "grid" : "contents"}>
			<Popover open={open} onOpenChange={onOpenChange}>
				<PopoverTrigger asChild>
					{place === "sidebar" ? (
						<Button variant="ghost" size="icon" className="relative" data-bell="">
							<BellIcon className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
							{unread > 0 ? (
								<span
									aria-hidden="true"
									data-bell-dot=""
									className="absolute end-1.5 top-1.5 size-2 rounded-full bg-brand"
								/>
							) : null}
							<span className="sr-only">{unreadWords(unread)}</span>
						</Button>
					) : (
						<Button
							variant="ghost"
							className="min-w-0 justify-start gap-2.5 px-3 text-left text-sm leading-tight font-medium"
							data-bell=""
						>
							<BellIcon strokeWidth={1.75} aria-hidden="true" />
							<span aria-hidden="true">Notifications</span>
							<span className="sr-only">{unreadWords(unread)}</span>
							{unread > 0 ? (
								<Badge variant="count" className="ms-auto" aria-hidden="true" data-bell-dot="">
									{unread}
								</Badge>
							) : null}
						</Button>
					)}
				</PopoverTrigger>
				<PopoverContent
					container={place === "more" ? host : undefined}
					aria-label="Notifications"
					data-bell-list=""
					side="bottom"
					align="start"
					collisionPadding={16}
					className="max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-32px))] gap-1 p-1.5"
				>
					<p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-subtle-foreground">
						Notifications
					</p>
					{rows.length === 0 ? (
						<p className="px-2.5 py-3 text-sm text-muted-foreground">Nothing new</p>
					) : (
						<ul className="grid min-h-0 gap-0.5 overflow-y-auto overscroll-contain">
							{rows.map((row) => (
								<li key={row.key}>
									<a
										href={row.url}
										onClick={(event) => follow(event, row.url)}
										className={cn(
											"grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2.5 py-2 outline-none",
											"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring",
										)}
									>
										<span className="grid min-w-0 gap-0.5">
											<span className="text-xs text-muted-foreground">
												{row.type === "release" ? "Changelog · " : null}
												{shortDay(row.day)}
											</span>
											<span className="font-medium text-foreground">{row.title}</span>
											{row.body ? (
												<span className="truncate text-[13px] text-muted-foreground">
													{row.body}
												</span>
											) : null}
										</span>
										{row.unread ? (
											<span className="mt-1.5 flex items-center">
												<span aria-hidden="true" className="size-2 rounded-full bg-brand" />
												<span className="sr-only">unread</span>
											</span>
										) : null}
									</a>
								</li>
							))}
						</ul>
					)}
					<Button
						asChild
						variant="link"
						size="sm"
						className="justify-start px-2.5"
						onClick={() => onOpenChange(false)}
					>
						<Link to="/household/changelog" replace={place === "more"}>
							See the Changelog
						</Link>
					</Button>
				</PopoverContent>
			</Popover>
		</div>
	);
}
