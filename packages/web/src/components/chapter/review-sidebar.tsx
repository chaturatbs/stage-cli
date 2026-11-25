import type { ContextHit } from "@stagereview/types/context";
import { useComments } from "@/lib/use-comments";
import type { LineAnchor } from "@/lib/use-diff-selection";
import { cn } from "@/lib/utils";
import { CommentsPanel } from "./comments-panel";
import { ContextPanel } from "./context-panel";

export type ReviewTab = "context" | "comments";

interface ReviewSidebarProps {
	runId: string;
	activeTab: ReviewTab;
	onTabChange: (tab: ReviewTab) => void;
	contextQuery: string | null;
	onClearContext: () => void;
	onSelectHit?: (hit: ContextHit) => void;
	onSelectComment?: (anchor: LineAnchor) => void;
}

/**
 * The right-hand "review tools" rail: a tabbed shell over the dynamic context
 * search and the comment list. Tab state is controlled by the parent so that
 * triggering an action (find context, create comment) can also switch tabs.
 */
export function ReviewSidebar({
	runId,
	activeTab,
	onTabChange,
	contextQuery,
	onClearContext,
	onSelectHit,
	onSelectComment,
}: ReviewSidebarProps) {
	const { comments } = useComments(runId);

	return (
		<aside className="sticky top-[var(--content-top)] flex h-[calc(100vh_-_var(--content-top))] w-80 shrink-0 flex-col border-border border-l bg-card/30">
			<div className="flex shrink-0 border-border border-b">
				<TabButton active={activeTab === "context"} onClick={() => onTabChange("context")}>
					Context
				</TabButton>
				<TabButton active={activeTab === "comments"} onClick={() => onTabChange("comments")}>
					Comments
					{comments.length > 0 ? (
						<span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
							{comments.length}
						</span>
					) : null}
				</TabButton>
			</div>
			<div className="flex-1 overflow-hidden">
				{activeTab === "context" ? (
					<ContextPanel
						runId={runId}
						query={contextQuery}
						onClear={onClearContext}
						onSelectHit={onSelectHit}
					/>
				) : (
					<CommentsPanel runId={runId} onSelectComment={onSelectComment} />
				)}
			</div>
		</aside>
	);
}

interface TabButtonProps {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex flex-1 items-center justify-center gap-1 border-b-2 px-3 py-2.5 text-xs transition-colors",
				active
					? "border-primary font-medium text-foreground"
					: "border-transparent text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}
