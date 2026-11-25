import type { Comment, GitHubComment } from "@stagereview/types/comment";
import {
	CheckCircle2,
	Circle,
	CornerDownRight,
	Github,
	MessageSquare,
	Send,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useComments } from "@/lib/use-comments";
import type { LineAnchor } from "@/lib/use-diff-selection";
import { useGitHubComments } from "@/lib/use-github-comments";
import { cn } from "@/lib/utils";

interface CommentsPanelProps {
	runId: string;
	onSelectComment?: (anchor: LineAnchor) => void;
}

/** Content-only — the surrounding `<aside>` + tab chrome lives in `ReviewSidebar`. */
export function CommentsPanel({ runId, onSelectComment }: CommentsPanelProps) {
	const { comments, draftCount, isLoading, deleteComment, submitReview, isSubmitting } =
		useComments(runId);
	const {
		data: githubData,
		replyToComment,
		isReplying,
		resolveThread,
		isResolving,
	} = useGitHubComments(runId);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [hideResolved, setHideResolved] = useState(true);

	const drafts = comments.filter((c) => !c.published);
	const threads = groupIntoThreads(githubData?.comments ?? []);
	const resolvedCount = threads.filter((t) => t[0].isResolved).length;
	const visibleThreads = hideResolved ? threads.filter((t) => !t[0].isResolved) : threads;

	const handleSubmit = async () => {
		setSubmitError(null);
		const result = await submitReview();
		if (!result.submitted) setSubmitError(result.reason ?? "Couldn't submit the review.");
	};

	const handleReply = async (commentId: number, body: string) => {
		const result = await replyToComment({ commentId, body });
		if (!result.replied) throw new Error(result.reason ?? "Couldn't post the reply.");
	};

	const handleResolve = async (threadId: string, resolved: boolean) => {
		const result = await resolveThread({ threadId, resolved });
		if (result.reason !== null) throw new Error(result.reason);
	};

	if (isLoading) {
		return <div className="px-4 py-3 text-muted-foreground text-xs">Loading comments…</div>;
	}

	const isEmpty = drafts.length === 0 && threads.length === 0;
	if (isEmpty) {
		return (
			<div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
				<MessageSquare className="mb-3 size-6 text-muted-foreground/50" />
				<p className="text-muted-foreground text-xs leading-relaxed">
					Highlight code in the diff and choose <span className="font-medium">Comment</span> to
					leave a note anchored to those lines.
				</p>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			{draftCount > 0 ? (
				<div className="flex shrink-0 items-center justify-between gap-2 border-border border-b bg-muted/30 px-4 py-2">
					<span className="text-muted-foreground text-xs">
						{draftCount} draft{draftCount === 1 ? "" : "s"}
					</span>
					<Button type="button" size="sm" onClick={handleSubmit} disabled={isSubmitting}>
						<Send className="size-3" />
						{isSubmitting ? "Submitting…" : "Submit to GitHub"}
					</Button>
				</div>
			) : null}
			{submitError ? (
				<div className="shrink-0 border-border border-b px-4 py-2 text-rose-600 text-xs dark:text-rose-400">
					{submitError}
				</div>
			) : null}

			{drafts.length > 0 ? (
				<Section label="Drafts">
					{drafts.map((comment) => (
						<DraftCard
							key={comment.id}
							comment={comment}
							onSelect={onSelectComment}
							onDelete={() => deleteComment(comment.id)}
						/>
					))}
				</Section>
			) : null}

			{threads.length > 0 ? (
				<Section
					label="On GitHub"
					headerAction={
						resolvedCount > 0 ? (
							<button
								type="button"
								onClick={() => setHideResolved((v) => !v)}
								className="text-[10px] text-muted-foreground normal-case tracking-normal hover:text-foreground"
							>
								{hideResolved ? `Show resolved (${resolvedCount})` : "Hide resolved"}
							</button>
						) : null
					}
				>
					{visibleThreads.map((thread) => (
						<GitHubThread
							key={thread[0].threadId}
							thread={thread}
							onSelect={onSelectComment}
							onReply={handleReply}
							isReplying={isReplying}
							onResolve={handleResolve}
							isResolving={isResolving}
						/>
					))}
				</Section>
			) : null}
		</div>
	);
}

/** A thread is always non-empty — its first element is the root comment. */
type CommentThread = [GitHubComment, ...GitHubComment[]];

/**
 * Groups flat GitHub review comments into threads by their `threadId` (the
 * authoritative grouping from the GraphQL `reviewThreads` query). Within a
 * thread the root sorts first, then replies by creation time; threads
 * themselves sort by their root's creation time.
 */
function groupIntoThreads(comments: GitHubComment[]): CommentThread[] {
	const byThread = new Map<string, CommentThread>();
	for (const comment of comments) {
		const list = byThread.get(comment.threadId);
		if (list) list.push(comment);
		else byThread.set(comment.threadId, [comment]);
	}

	const threads = [...byThread.values()].map((list): CommentThread => {
		list.sort((a, b) => {
			if (a.inReplyToId === null && b.inReplyToId !== null) return -1;
			if (a.inReplyToId !== null && b.inReplyToId === null) return 1;
			return a.createdAt.localeCompare(b.createdAt);
		});
		return list;
	});
	threads.sort((a, b) => a[0].createdAt.localeCompare(b[0].createdAt));
	return threads;
}

function Section({
	label,
	headerAction,
	children,
}: {
	label: string;
	headerAction?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section>
			<h3 className="sticky top-0 z-10 flex items-center justify-between gap-2 border-border border-b bg-card/95 px-4 py-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide backdrop-blur">
				<span>{label}</span>
				{headerAction}
			</h3>
			<ul className="flex flex-col divide-y divide-border">{children}</ul>
		</section>
	);
}

function lineLabel(side: string, startLine: number, endLine: number): string {
	const prefix = side === "deletions" ? "L" : "R";
	return `${prefix}${startLine}${endLine !== startLine ? `–${endLine}` : ""}`;
}

function DraftCard({
	comment,
	onSelect,
	onDelete,
}: {
	comment: Comment;
	onSelect?: (anchor: LineAnchor) => void;
	onDelete: () => void;
}) {
	return (
		<li className="flex flex-col gap-1.5 px-4 py-3">
			<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
				<button
					type="button"
					onClick={
						onSelect
							? () =>
									onSelect({
										filePath: comment.filePath,
										side: comment.side,
										startLine: comment.startLine,
										endLine: comment.endLine,
									})
							: undefined
					}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-foreground"
				>
					<span className="truncate font-mono">{comment.filePath}</span>
					<span className="shrink-0 text-muted-foreground/60">
						{lineLabel(comment.side, comment.startLine, comment.endLine)}
					</span>
				</button>
				<button
					type="button"
					onClick={onDelete}
					className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-rose-500"
					aria-label="Delete comment"
				>
					<Trash2 className="size-3" />
				</button>
			</div>
			<p className="whitespace-pre-wrap break-words text-foreground text-xs leading-snug">
				{comment.body}
			</p>
		</li>
	);
}

function GitHubThread({
	thread,
	onSelect,
	onReply,
	isReplying,
	onResolve,
	isResolving,
}: {
	thread: CommentThread;
	onSelect?: (anchor: LineAnchor) => void;
	onReply: (commentId: number, body: string) => Promise<void>;
	isReplying: boolean;
	onResolve: (threadId: string, resolved: boolean) => Promise<void>;
	isResolving: boolean;
}) {
	const [root, ...replies] = thread;
	const [composerOpen, setComposerOpen] = useState(false);
	const [replyText, setReplyText] = useState("");
	const [actionError, setActionError] = useState<string | null>(null);

	const hasAnchor = root.startLine !== null && root.endLine !== null;
	const isResolved = root.isResolved;

	const submitReply = async () => {
		const trimmed = replyText.trim();
		if (trimmed.length === 0 || isReplying) return;
		setActionError(null);
		try {
			await onReply(root.id, trimmed);
			setReplyText("");
			setComposerOpen(false);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Couldn't post the reply.");
		}
	};

	const toggleResolved = async () => {
		if (isResolving) return;
		setActionError(null);
		try {
			await onResolve(root.threadId, !isResolved);
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Couldn't update the thread.");
		}
	};

	return (
		<li className={cn("flex flex-col gap-1.5 px-4 py-3", isResolved && "opacity-60")}>
			<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
				<button
					type="button"
					disabled={!hasAnchor || !onSelect}
					onClick={
						hasAnchor && onSelect
							? () =>
									onSelect({
										filePath: root.filePath,
										side: root.side,
										startLine: root.startLine as number,
										endLine: root.endLine as number,
									})
							: undefined
					}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left enabled:hover:text-foreground disabled:cursor-default"
				>
					<span className="truncate font-mono">{root.filePath}</span>
					{hasAnchor ? (
						<span className="shrink-0 text-muted-foreground/60">
							{lineLabel(root.side, root.startLine as number, root.endLine as number)}
						</span>
					) : (
						<span className="shrink-0 text-muted-foreground/60 italic">outdated</span>
					)}
				</button>
				{isResolved ? (
					<span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
						resolved
					</span>
				) : null}
				<button
					type="button"
					onClick={toggleResolved}
					disabled={isResolving}
					className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
					aria-label={isResolved ? "Unresolve thread" : "Resolve thread"}
				>
					{isResolved ? (
						<CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
					) : (
						<Circle className="size-3" />
					)}
				</button>
				<a
					href={root.url}
					target="_blank"
					rel="noopener noreferrer"
					className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					aria-label="Open on GitHub"
				>
					<Github className="size-3" />
				</a>
			</div>

			<CommentBody author={root.author} body={root.body} />

			{replies.length > 0 ? (
				<ul className="flex flex-col gap-1.5 border-border border-l-2 pl-2.5">
					{replies.map((reply) => (
						<li key={reply.id} className="flex items-start gap-1">
							<CornerDownRight className="mt-0.5 size-3 shrink-0 text-muted-foreground/50" />
							<CommentBody author={reply.author} body={reply.body} />
						</li>
					))}
				</ul>
			) : null}

			{actionError ? (
				<p className="text-rose-600 text-xs dark:text-rose-400">{actionError}</p>
			) : null}

			{composerOpen ? (
				<div className="flex flex-col gap-1.5 pt-1">
					<textarea
						// biome-ignore lint/a11y/noAutofocus: composer is opened by an explicit click — focusing it is the expected affordance.
						autoFocus
						value={replyText}
						onChange={(e) => setReplyText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") setComposerOpen(false);
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								void submitReply();
							}
						}}
						placeholder="Reply…"
						rows={3}
						className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<div className="flex items-center justify-end gap-2">
						<Button type="button" variant="ghost" size="sm" onClick={() => setComposerOpen(false)}>
							Cancel
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={submitReply}
							disabled={replyText.trim().length === 0 || isReplying}
						>
							{isReplying ? "Posting…" : "Reply"}
						</Button>
					</div>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setComposerOpen(true)}
					className="self-start text-muted-foreground text-xs hover:text-foreground"
				>
					Reply
				</button>
			)}
		</li>
	);
}

function CommentBody({ author, body }: { author: string; body: string }) {
	return (
		<p className="min-w-0 whitespace-pre-wrap break-words text-foreground text-xs leading-snug">
			<span className="font-medium">{author}</span> {body}
		</p>
	);
}
