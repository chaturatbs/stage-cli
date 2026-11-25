import type { ContextHit } from "@stagereview/types/context";
import { FileText, Loader2, Search, X } from "lucide-react";
import { useContextSearch } from "@/lib/use-context-search";
import { cn } from "@/lib/utils";

interface ContextPanelProps {
	runId: string;
	query: string | null;
	excludePath?: string;
	onClear: () => void;
	onSelectHit?: (hit: ContextHit) => void;
}

/** Content-only — the surrounding `<aside>` + tab chrome lives in `ReviewSidebar`. */
export function ContextPanel({
	runId,
	query,
	excludePath,
	onClear,
	onSelectHit,
}: ContextPanelProps) {
	const { data, isLoading, error } = useContextSearch({ runId, query, excludePath });

	return (
		<div className="flex h-full flex-col">
			{query ? (
				<div className="flex shrink-0 items-start justify-between gap-2 border-border border-b px-4 py-2">
					<div className="min-w-0">
						<div className="text-muted-foreground text-xs">Looking for:</div>
						<div className="line-clamp-2 font-mono text-foreground text-xs leading-snug">
							{query}
						</div>
					</div>
					<button
						type="button"
						onClick={onClear}
						className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						aria-label="Clear context search"
					>
						<X className="size-3.5" />
					</button>
				</div>
			) : null}
			<div className="flex-1 overflow-y-auto">
				{!query ? <EmptyState /> : null}
				{query && isLoading ? <LoadingState /> : null}
				{query && error ? <ErrorState message={String(error)} /> : null}
				{query && data ? (
					<HitsList hits={data.hits} truncated={data.truncated} onSelectHit={onSelectHit} />
				) : null}
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
			<Search className="mb-3 size-6 text-muted-foreground/50" />
			<p className="text-muted-foreground text-xs leading-relaxed">
				Highlight code in the diff to find other places in the repo that reference the same symbols
				or text.
			</p>
		</div>
	);
}

function LoadingState() {
	return (
		<div className="flex items-center gap-2 px-4 py-3 text-muted-foreground text-xs">
			<Loader2 className="size-3.5 animate-spin" />
			Searching repo…
		</div>
	);
}

function ErrorState({ message }: { message: string }) {
	return (
		<div className="px-4 py-3 text-rose-600 text-xs dark:text-rose-400">
			Couldn't search the repo: {message}
		</div>
	);
}

interface HitsListProps {
	hits: ContextHit[];
	truncated: boolean;
	onSelectHit?: (hit: ContextHit) => void;
}

function HitsList({ hits, truncated, onSelectHit }: HitsListProps) {
	if (hits.length === 0) {
		return (
			<div className="px-4 py-3 text-muted-foreground text-xs">
				No other references found in the repo.
			</div>
		);
	}

	return (
		<ul className="flex flex-col divide-y divide-border">
			{hits.map((hit) => (
				<li key={`${hit.filePath}:${hit.lineNumber}`}>
					<HitCard hit={hit} onSelect={onSelectHit} />
				</li>
			))}
			{truncated ? (
				<li className="px-4 py-2 text-muted-foreground text-xs italic">
					Results were trimmed — refine the selection for more specific matches.
				</li>
			) : null}
		</ul>
	);
}

function HitCard({ hit, onSelect }: { hit: ContextHit; onSelect?: (hit: ContextHit) => void }) {
	const Tag = onSelect ? "button" : "div";
	return (
		<Tag
			type={onSelect ? "button" : undefined}
			onClick={onSelect ? () => onSelect(hit) : undefined}
			className={cn(
				"flex w-full flex-col gap-1 px-4 py-2 text-left",
				onSelect ? "transition-colors hover:bg-accent" : "",
			)}
		>
			<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
				<FileText className="size-3 shrink-0" />
				<span className="truncate font-mono">{hit.filePath}</span>
				<span className="shrink-0 text-muted-foreground/60">:{hit.lineNumber}</span>
			</div>
			<pre className="overflow-x-hidden whitespace-pre-wrap break-words font-mono text-[11px] text-foreground leading-snug">
				{hit.context.before.length > 0 ? (
					<span className="text-muted-foreground/60">
						{hit.context.before.join("\n")}
						{"\n"}
					</span>
				) : null}
				<span>{hit.snippet}</span>
				{hit.context.after.length > 0 ? (
					<span className="text-muted-foreground/60">
						{"\n"}
						{hit.context.after.join("\n")}
					</span>
				) : null}
			</pre>
		</Tag>
	);
}
