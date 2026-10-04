import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Spinner } from "@noodle/ui/components/spinner";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { RotateCw, SearchX, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Shown only when a route is slow to load (router `defaultPendingMs`), and then for at least
 * `defaultPendingMinMs` so it never flashes. Shaped like a page: header, then sections of rows.
 */
export function PagePending() {
	return (
		<div role="status" aria-label="Loading" className="animate-enter">
			{/* The header's own height and space under it (PageHeader), so the page doesn't move when it
			    arrives. */}
			<div className="mb-4 grid min-h-13 content-center gap-2 lg:mb-8 lg:min-h-0">
				<Skeleton className="h-3.5 w-20" />
				<Skeleton className="h-7 w-44 lg:h-8" />
			</div>
			<div className="grid gap-8">
				<Card className="grid gap-3 p-(--card-pad)">
					<Skeleton className="h-3.5 w-24" />
					<Skeleton className="h-10 w-36" />
					<Skeleton className="h-3.5 w-52" />
				</Card>
				<div className="grid gap-3">
					<Skeleton className="h-4 w-28" />
					<Card>
						{[0, 1, 2].map((row) => (
							<div
								key={row}
								className="flex items-center gap-3 border-t px-(--card-pad) py-3.5 first:border-t-0"
							>
								<Skeleton className="size-9 rounded-xl" />
								<div className="grid flex-1 gap-2">
									<Skeleton className="h-3.5 w-1/3" />
									<Skeleton className="h-3 w-1/2" />
								</div>
								<Skeleton className="h-4 w-14" />
							</div>
						))}
					</Card>
				</div>
			</div>
		</div>
	);
}

/** Says what went wrong and retries by re-running the route's loaders. */
export function PageError({ error }: ErrorComponentProps) {
	const router = useRouter();
	const [retrying, setRetrying] = useState(false);
	// What failed is for the console: the text a load fails with is the framework's or the
	// program's ("Invariant failed: …", "(intermediate value) is not a function"), never words for
	// a Parent.
	useEffect(() => {
		console.error(error);
	}, [error]);
	return (
		<div role="alert" className="animate-enter">
			<EmptyState
				icon={<TriangleAlert />}
				title="This page didn’t load"
				description="Something went wrong loading it, on our side or with the connection. Try again in a moment."
				action={
					<Button
						variant="outline"
						disabled={retrying}
						onClick={async () => {
							setRetrying(true);
							try {
								await router.invalidate();
							} finally {
								setRetrying(false);
							}
						}}
					>
						{retrying ? <Spinner /> : <RotateCw />}
						Try again
					</Button>
				}
			/>
		</div>
	);
}

export function PageNotFound() {
	return (
		<EmptyState
			icon={<SearchX />}
			title="There’s nothing here"
			description="The link may be old, or the page may have moved."
			action={
				<Button variant="outline" asChild>
					<Link to="/month">Go to This Month</Link>
				</Button>
			}
		/>
	);
}
