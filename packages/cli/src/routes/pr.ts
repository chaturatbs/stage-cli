import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	FileViewedSyncResult,
	PullRequestContext,
	PullRequestResponse,
	ReviewState,
} from "@stagereview/types/pr";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import type { Route } from "../server.js";
import { readJsonBody, writeJson } from "./json.js";

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 10_000;

const PR_VIEW_FIELDS = "number,url,title,id,reviewDecision,latestReviews";

export function prRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/pr",
			handler: async (_req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}

				const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
				if (!run) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}

				const result = await lookupPullRequest(run.repoRoot, run.headBranch);
				writeJson(res, 200, result satisfies PullRequestResponse);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/files-viewed-sync",
			handler: async (req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}

				const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
				if (!run) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}

				let body: unknown;
				try {
					body = await readJsonBody(req);
				} catch (err) {
					writeJson(res, 400, {
						error: err instanceof Error ? err.message : "Invalid JSON body",
					});
					return;
				}

				const parsed = parseSyncBody(body);
				if (!parsed) {
					writeJson(res, 400, {
						error: "Expected body { prId: string, filePath: string, viewed: boolean }",
					});
					return;
				}

				const result = await syncFileViewed(run.repoRoot, parsed);
				// Sync is best-effort — local view state is authoritative. A failed
				// GitHub mutation still returns 200 with `synced: false` so the client
				// can surface a soft warning rather than rolling back the local toggle.
				writeJson(res, 200, result satisfies FileViewedSyncResult);
			},
		},
	];
}

/**
 * Resolves just the PR number for a run's branch — used by the comment routes
 * which call `gh api` (with `{owner}`/`{repo}` auto-filled from the cwd) and
 * only need the number to complete the path.
 */
export async function resolvePrNumber(
	repoRoot: string,
	headBranch: string | null,
): Promise<{ number: number | null; reason: string | null }> {
	const result = await lookupPullRequest(repoRoot, headBranch);
	return { number: result.pr?.number ?? null, reason: result.reason };
}

export interface PrTarget {
	number: number;
	owner: string;
	repo: string;
}

/**
 * Resolves owner/repo/number for a run's branch. GraphQL calls (unlike REST
 * paths) can't use `gh api`'s `{owner}`/`{repo}` placeholders, so owner and repo
 * are parsed out of the PR's html URL.
 */
export async function resolvePrTarget(
	repoRoot: string,
	headBranch: string | null,
): Promise<{ target: PrTarget | null; reason: string | null }> {
	const result = await lookupPullRequest(repoRoot, headBranch);
	if (!result.pr) return { target: null, reason: result.reason };

	const match = result.pr.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//);
	if (!match?.[1] || !match[2]) {
		return { target: null, reason: `Could not parse owner/repo from PR URL: ${result.pr.url}` };
	}
	return {
		target: { number: result.pr.number, owner: match[1], repo: match[2] },
		reason: null,
	};
}

export { describeGhError };

async function lookupPullRequest(
	repoRoot: string,
	headBranch: string | null,
): Promise<PullRequestResponse> {
	if (!headBranch) {
		return { pr: null, reason: "No branch recorded for this run (detached HEAD)." };
	}

	try {
		const { stdout } = await execFileAsync(
			"gh",
			["pr", "view", headBranch, "--json", PR_VIEW_FIELDS],
			{ cwd: repoRoot, timeout: GH_TIMEOUT_MS },
		);
		const pr = parsePrViewOutput(stdout);
		if (!pr) return { pr: null, reason: "Could not parse `gh pr view` output." };
		return { pr, reason: null };
	} catch (err) {
		return { pr: null, reason: describeGhError(err) };
	}
}

interface SyncBody {
	prId: string;
	filePath: string;
	viewed: boolean;
}

function parseSyncBody(body: unknown): SyncBody | null {
	if (typeof body !== "object" || body === null) return null;
	const record = body as Record<string, unknown>;
	if (typeof record.prId !== "string" || record.prId.length === 0) return null;
	if (typeof record.filePath !== "string" || record.filePath.length === 0) return null;
	if (typeof record.viewed !== "boolean") return null;
	return { prId: record.prId, filePath: record.filePath, viewed: record.viewed };
}

async function syncFileViewed(repoRoot: string, body: SyncBody): Promise<FileViewedSyncResult> {
	const mutation = body.viewed
		? "mutation($pullRequestId:ID!,$path:String!){markFileAsViewed(input:{pullRequestId:$pullRequestId,path:$path}){clientMutationId}}"
		: "mutation($pullRequestId:ID!,$path:String!){unmarkFileAsViewed(input:{pullRequestId:$pullRequestId,path:$path}){clientMutationId}}";

	try {
		await execFileAsync(
			"gh",
			[
				"api",
				"graphql",
				"-f",
				`query=${mutation}`,
				"-f",
				`pullRequestId=${body.prId}`,
				"-f",
				`path=${body.filePath}`,
			],
			{ cwd: repoRoot, timeout: GH_TIMEOUT_MS },
		);
		return { synced: true, reason: null };
	} catch (err) {
		return { synced: false, reason: describeGhError(err) };
	}
}

interface PrViewOutput {
	number: number;
	url: string;
	title: string;
	id: string;
	reviewDecision: string | null;
	latestReviews?: Array<{ author?: { login?: string } | null; state?: string }>;
}

function parsePrViewOutput(stdout: string): PullRequestContext | null {
	let raw: PrViewOutput;
	try {
		raw = JSON.parse(stdout) as PrViewOutput;
	} catch {
		return null;
	}
	if (typeof raw.number !== "number" || typeof raw.id !== "string") return null;

	const reviewers = (raw.latestReviews ?? [])
		.map((review) => {
			const login = review.author?.login;
			if (!login) return null;
			return { login, state: normaliseReviewState(review.state) };
		})
		.filter((r): r is { login: string; state: ReviewState } => r !== null);

	return {
		number: raw.number,
		url: raw.url,
		title: raw.title,
		id: raw.id,
		reviewDecision: normaliseReviewDecision(raw.reviewDecision),
		reviewers,
	};
}

function normaliseReviewState(state: string | undefined): ReviewState {
	switch (state) {
		case "APPROVED":
		case "CHANGES_REQUESTED":
		case "COMMENTED":
		case "DISMISSED":
		case "PENDING":
			return state;
		default:
			return "COMMENTED";
	}
}

function normaliseReviewDecision(decision: string | null): PullRequestContext["reviewDecision"] {
	switch (decision) {
		case "APPROVED":
		case "CHANGES_REQUESTED":
		case "REVIEW_REQUIRED":
			return decision;
		default:
			return null;
	}
}

function describeGhError(err: unknown): string {
	if (err instanceof Error && "code" in err && err.code === "ENOENT") {
		return "GitHub CLI (`gh`) is not installed.";
	}
	const stderr =
		err instanceof Error && "stderr" in err && typeof err.stderr === "string" ? err.stderr : "";
	if (stderr.includes("no pull requests found") || stderr.includes("no open pull requests")) {
		return "No pull request found for this branch.";
	}
	if (stderr.toLowerCase().includes("authentication") || stderr.includes("gh auth login")) {
		return "GitHub CLI is not authenticated — run `gh auth login`.";
	}
	const message = err instanceof Error ? err.message : String(err);
	return `gh command failed: ${message.slice(0, 200)}`;
}
