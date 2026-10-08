import { PageLayout } from "@noodle/ui/components/layout";
import { createFileRoute, Link } from "@tanstack/react-router";
import { changelog, type Release } from "../../../changelog";
import { BlockView } from "../../../components/docs";

// Household settings › Changelog (issue 157): what changed in Noodle, release by release, newest
// first. The words are src/changelog/changelog.md, read when the app is built. Each release's
// heading is a link to itself, so its address (the page, a # and its day) can be copied and sent.
export const Route = createFileRoute("/_authed/_household/household/changelog")({
	component: ChangelogPage,
});

const longDay = new Intl.DateTimeFormat("en-US", {
	month: "long",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

function ReleaseSection({ release }: { release: Release }) {
	const headingId = `${release.id}-title`;
	return (
		// Clear of the header a phone keeps on top when a link lands here.
		<section id={release.id} aria-labelledby={headingId} className="grid scroll-mt-20 gap-3">
			<div className="grid gap-0.5">
				<p className="text-sm text-muted-foreground">
					<time dateTime={release.date}>
						{longDay.format(new Date(`${release.date}T00:00:00Z`))}
					</time>
				</p>
				<h2 id={headingId} className="text-lg font-semibold tracking-[-0.01em] wrap-anywhere">
					<Link
						to="/household/changelog"
						hash={release.id}
						className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						{release.title}
					</Link>
				</h2>
			</div>
			<div className="grid gap-3 text-[15px] leading-6 text-foreground">
				{release.blocks.map((block, at) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a release's words never reorder.
					<BlockView key={at} block={block} />
				))}
			</div>
		</section>
	);
}

function ChangelogPage() {
	return (
		<PageLayout width="reading">
			<div className="grid gap-8">
				<p className="text-sm text-muted-foreground">
					What changed in Noodle, newest first. Nothing here needs you to do anything.
				</p>
				{changelog.map((release) => (
					<ReleaseSection key={release.id} release={release} />
				))}
			</div>
		</PageLayout>
	);
}
