import type { PullRequestContext } from "@stagereview/types/pr";
import { CheckCircle2, ExternalLink, GitPullRequest, MessageSquare, XCircle } from "lucide-react";
import { usePrContext } from "@/lib/use-pr-context";
import { cn } from "@/lib/utils";

interface ReviewContextPanelProps {
	runId: string;
}

export function ReviewContextPanel({ runId }: ReviewContextPanelProps) {
	const { data, isLoading } = usePrContext(runId);
	const pr = data?.pr ?? null;

	// No PR (or still resolving) — render nothing rather than an empty shell.
	if (isLoading || !pr) return null;

	return (
		<a
			href={pr.url}
			target="_blank"
			rel="noopener noreferrer"
			className={cn(
				"group flex flex-col gap-1.5 border-border border-b bg-muted/30 px-6 py-3 lg:pl-8",
				"transition-colors hover:bg-muted/60",
			)}
		>
			<div className="flex items-center gap-2 text-muted-foreground text-xs">
				<GitPullRequest className="size-3.5" />
				<span className="font-medium text-foreground">PR #{pr.number}</span>
				<ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />
			</div>
			<div className="line-clamp-1 font-medium text-foreground text-sm">{pr.title}</div>
			<ReviewSummary pr={pr} />
		</a>
	);
}

function ReviewSummary({ pr }: { pr: PullRequestContext }) {
	const decision = pr.reviewDecision;
	const reviewerCount = pr.reviewers.length;

	return (
		<div className="flex items-center gap-3 text-muted-foreground text-xs">
			{decision === "APPROVED" ? (
				<span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
					<CheckCircle2 className="size-3" />
					Approved
				</span>
			) : null}
			{decision === "CHANGES_REQUESTED" ? (
				<span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
					<XCircle className="size-3" />
					Changes requested
				</span>
			) : null}
			{decision === "REVIEW_REQUIRED" ? (
				<span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
					<MessageSquare className="size-3" />
					Review required
				</span>
			) : null}
			{reviewerCount > 0 ? (
				<span>
					{reviewerCount} {reviewerCount === 1 ? "reviewer" : "reviewers"}
				</span>
			) : null}
		</div>
	);
}
