export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

export interface PullRequestReviewer {
	login: string;
	state: ReviewState;
}

export interface PullRequestContext {
	number: number;
	url: string;
	title: string;
	/** GraphQL node ID — required for the file-viewed mutations. */
	id: string;
	reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	reviewers: PullRequestReviewer[];
}

export interface PullRequestResponse {
	pr: PullRequestContext | null;
	/** When `pr` is null, a short human-readable reason (no branch, no PR, gh missing…). */
	reason: string | null;
}

export interface FileViewedSyncResult {
	/** True when the GitHub mutation succeeded. Local state is authoritative regardless. */
	synced: boolean;
	reason: string | null;
}
