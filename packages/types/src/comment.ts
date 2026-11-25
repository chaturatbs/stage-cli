import type { DiffSide } from "./chapters.ts";

export interface Comment {
	id: string;
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
	body: string;
	/** False until pushed to GitHub as a PR review comment. */
	published: boolean;
	githubCommentId: string | null;
	/** Epoch milliseconds. */
	createdAt: number;
}

export interface CreateCommentInput {
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
	body: string;
}

export interface CommentsResponse {
	comments: Comment[];
}

/** A review comment fetched from the GitHub PR (read-only mirror). */
export interface GitHubComment {
	id: number;
	author: string;
	body: string;
	filePath: string;
	side: DiffSide;
	/** Null when GitHub considers the comment outdated (its line no longer exists). */
	startLine: number | null;
	endLine: number | null;
	url: string;
	createdAt: string;
	/** The review comment this is a reply to, or null when it's a thread root. */
	inReplyToId: number | null;
	/** GraphQL node ID of the review thread this comment belongs to. */
	threadId: string;
	/** Resolution state of the comment's thread (shared by every comment in it). */
	isResolved: boolean;
}

export interface GitHubReplyResult {
	replied: boolean;
	reason: string | null;
}

export interface ResolveThreadResult {
	/** The thread's resolution state after the mutation. */
	resolved: boolean;
	reason: string | null;
}

export interface GitHubCommentsResponse {
	comments: GitHubComment[];
	/** Null on success; a human-readable reason when the PR/`gh` lookup failed. */
	reason: string | null;
}

export interface SubmitReviewResult {
	submitted: boolean;
	/** How many local drafts were pushed in this review. */
	count: number;
	reason: string | null;
}
