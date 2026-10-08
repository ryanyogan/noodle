import { Input } from "@noodle/ui/components/input";
import { cn } from "@noodle/ui/lib/utils";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { type DocsArticle, docsBySection, searchDocs } from "../docs";
import type { Block, Inline } from "../docs/markdown";

// The Docs' own pieces (issue 126): the search, the list of articles and an article's text.

const linkLook = "font-medium text-foreground underline underline-offset-2 hover:text-brand";

/**
 * Finds articles as you type: every word must be in the article, the title counting most. ↓ and ↑
 * move through the matches, Enter opens the marked one, Esc clears the field.
 */
export function DocsSearch({ className }: { className?: string }) {
	const id = useId();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const hits = useMemo(() => searchDocs(query), [query]);
	const open = query.trim().length > 0;
	const marked = hits[Math.min(active, hits.length - 1)];
	const go = (slug: string) => {
		setQuery("");
		void navigate({ to: "/docs/$slug", params: { slug } });
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape" && open) {
			event.preventDefault();
			setQuery("");
		} else if (event.key === "ArrowDown" && hits.length > 0) {
			event.preventDefault();
			setActive((at) => (at + 1) % hits.length);
		} else if (event.key === "ArrowUp" && hits.length > 0) {
			event.preventDefault();
			setActive((at) => (at - 1 + hits.length) % hits.length);
		} else if (event.key === "Enter" && marked) {
			event.preventDefault();
			go(marked.article.slug);
		}
	};
	return (
		<search className={cn("relative", className)}>
			<label htmlFor={id} className="sr-only">
				Search the Docs
			</label>
			<Search
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
			/>
			<Input
				id={id}
				type="search"
				role="combobox"
				enterKeyHint="search"
				placeholder="Search the Docs"
				autoComplete="off"
				aria-autocomplete="list"
				aria-expanded={open}
				aria-controls={open ? `${id}-results` : undefined}
				aria-activedescendant={open && marked ? `${id}-${marked.article.slug}` : undefined}
				value={query}
				onChange={(event) => {
					setQuery(event.currentTarget.value);
					setActive(0);
				}}
				onKeyDown={onKeyDown}
				className="ps-9"
			/>
			{open ? (
				<div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[min(70dvh,28rem)] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
					{hits.length === 0 ? (
						<p
							id={`${id}-results`}
							role="status"
							className="px-3 py-2 text-sm text-muted-foreground"
						>
							Nothing in the Docs matches “{query.trim()}”.
						</p>
					) : (
						<div
							id={`${id}-results`}
							role="listbox"
							aria-label="Matching articles"
							className="grid"
						>
							{hits.map(({ article, snippet }) => (
								<Link
									key={article.slug}
									id={`${id}-${article.slug}`}
									role="option"
									tabIndex={-1}
									aria-selected={article === marked?.article}
									to="/docs/$slug"
									params={{ slug: article.slug }}
									onClick={() => setQuery("")}
									className="grid gap-0.5 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
								>
									<span className="font-medium text-foreground">{article.title}</span>
									<span className="text-[13px] text-muted-foreground">{snippet}</span>
								</Link>
							))}
						</div>
					)}
				</div>
			) : null}
		</search>
	);
}

/** Every article under its section; the one being read is marked. */
export function DocsNav({ onPick, label }: { onPick?: () => void; label: string }) {
	const nav = useRef<HTMLElement>(null);
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	// The list is longer than the screen: bring the article being read into view in it, when the
	// list is first drawn (the phone's sheet opening) and when another article is opened.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is when to look again.
	useEffect(() => {
		nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
	}, [pathname]);
	return (
		<nav ref={nav} aria-label={label} className="grid gap-6">
			{docsBySection.map(({ section, articles }) => (
				<div key={section} className="grid gap-1">
					<p className="px-3 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">
						{section}
					</p>
					<ul className="grid">
						{articles.map((article) => (
							<li key={article.slug}>
								<Link
									to="/docs/$slug"
									params={{ slug: article.slug }}
									onClick={onPick}
									className="flex min-h-9 items-center rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground max-lg:min-h-11"
								>
									{article.title}
								</Link>
							</li>
						))}
					</ul>
				</div>
			))}
			{/* The words themselves are explained once, in the app's Glossary (ADR-0018). */}
			<a href="/glossary" className={cn(linkLook, "px-3 text-sm max-lg:py-2.5")}>
				Glossary (in the app)
			</a>
		</nav>
	);
}

function InlineText({ inline }: { inline: Inline[] }) {
	return inline.map((part, at) => {
		const key = at;
		if (typeof part === "string") return part;
		if ("bold" in part) return <strong key={key}>{part.bold}</strong>;
		const doc = /^\/docs\/([\w-]+)$/.exec(part.href);
		return doc?.[1] ? (
			<Link key={key} to="/docs/$slug" params={{ slug: doc[1] }} className={linkLook}>
				{part.text}
			</Link>
		) : (
			<a key={key} href={part.href} className={linkLook}>
				{part.text}
			</a>
		);
	});
}

/** One block of an article, or of a release in the Changelog. */
export function BlockView({ block }: { block: Block }): ReactNode {
	if (block.kind === "heading") {
		return block.level === 2 ? (
			<h2 id={block.id} className="mt-6 scroll-mt-32 text-xl font-semibold tracking-[-0.02em]">
				{block.text}
			</h2>
		) : (
			<h3 id={block.id} className="mt-2 scroll-mt-32 text-base font-semibold">
				{block.text}
			</h3>
		);
	}
	if (block.kind === "list") {
		const List = block.ordered ? "ol" : "ul";
		return (
			<List className={cn("grid gap-2 ps-6", block.ordered ? "list-decimal" : "list-disc")}>
				{block.items.map((item, at) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: an article's words never reorder.
					<li key={at} className="ps-1">
						<InlineText inline={item} />
					</li>
				))}
			</List>
		);
	}
	if (block.kind === "note") {
		return (
			<p className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-[15px]">
				<InlineText inline={block.inline} />
			</p>
		);
	}
	return (
		<p>
			<InlineText inline={block.inline} />
		</p>
	);
}

/** An article's text, in a column narrow enough to read (about 70 characters). */
export function ArticleBody({ article }: { article: DocsArticle }) {
	return (
		<div className="grid gap-4 text-base leading-7 text-foreground">
			{article.blocks.map((block, at) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: an article's words never reorder.
				<BlockView key={at} block={block} />
			))}
		</div>
	);
}
