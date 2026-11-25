import type { PullRequestContext } from "@stagereview/types/pr";
import { ExternalLink, GitPullRequest } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { useChapters } from "@/lib/use-chapters";
import { usePrContext } from "@/lib/use-pr-context";

export function Topbar({ runId }: { runId: string | null }) {
	const { data } = useChapters(runId);
	const repoName = data?.run.repoName;
	const { data: prData } = usePrContext(runId);
	const pr = prData?.pr ?? null;

	return (
		<header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-border border-b bg-background px-6 lg:px-8">
			<div className="flex min-w-0 items-center gap-2 text-sm">
				{repoName && <span className="truncate font-medium text-foreground">{repoName}</span>}
				{repoName && pr ? <span className="text-muted-foreground">/</span> : null}
				{pr ? <PrPill pr={pr} /> : null}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<Button asChild variant="outline" size="sm">
					<a href="https://stagereview.app" target="_blank" rel="noopener noreferrer">
						Try the full Stage experience
						<ExternalLink />
					</a>
				</Button>
				<ThemeToggle />
			</div>
		</header>
	);
}

function PrPill({ pr }: { pr: PullRequestContext }) {
	return (
		<a
			href={pr.url}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
		>
			<GitPullRequest className="size-3" />
			<span className="font-medium">#{pr.number}</span>
			{pr.reviewDecision ? (
				<span className={reviewDecisionClass(pr.reviewDecision)}>
					· {formatReviewDecision(pr.reviewDecision)}
				</span>
			) : null}
		</a>
	);
}

function reviewDecisionClass(decision: NonNullable<PullRequestContext["reviewDecision"]>): string {
	switch (decision) {
		case "APPROVED":
			return "text-emerald-600 dark:text-emerald-400";
		case "CHANGES_REQUESTED":
			return "text-rose-600 dark:text-rose-400";
		case "REVIEW_REQUIRED":
			return "text-amber-600 dark:text-amber-400";
	}
}

function formatReviewDecision(decision: NonNullable<PullRequestContext["reviewDecision"]>): string {
	switch (decision) {
		case "APPROVED":
			return "approved";
		case "CHANGES_REQUESTED":
			return "changes requested";
		case "REVIEW_REQUIRED":
			return "review required";
	}
}
