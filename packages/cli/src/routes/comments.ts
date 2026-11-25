import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type {
	Comment,
	CommentsResponse,
	CreateCommentInput,
	GitHubComment,
	GitHubCommentsResponse,
	GitHubReplyResult,
	ResolveThreadResult,
	SubmitReviewResult,
} from "@stagereview/types/comment";
import { and, asc, eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { type CommentRow, chapterRun, comment } from "../db/schema/index.js";
import { DIFF_SIDE } from "../schema.js";
import type { Route } from "../server.js";
import { readJsonBody, writeJson } from "./json.js";
import { describeGhError, resolvePrNumber, resolvePrTarget } from "./pr.js";

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 15_000;
const MAX_BODY_LENGTH = 10_000;

function mapComment(row: CommentRow): Comment {
	return {
		id: row.id,
		filePath: row.filePath,
		side: row.side,
		startLine: row.startLine,
		endLine: row.endLine,
		body: row.body,
		published: row.published,
		githubCommentId: row.githubCommentId,
		createdAt: row.createdAt.getTime(),
	};
}

export function commentRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/comments",
			handler: (_req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}

				const rows = db
					.select()
					.from(comment)
					.where(eq(comment.runId, runId))
					.orderBy(asc(comment.createdAt))
					.all();

				writeJson(res, 200, { comments: rows.map(mapComment) } satisfies CommentsResponse);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/comments",
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

				const input = parseCreateCommentInput(body);
				if (!input) {
					writeJson(res, 400, {
						error: "Expected { filePath, side: 'additions'|'deletions', startLine, endLine, body }",
					});
					return;
				}

				const [row] = db
					.insert(comment)
					.values({
						runId,
						filePath: input.filePath,
						side: input.side,
						startLine: input.startLine,
						endLine: input.endLine,
						body: input.body,
					})
					.returning()
					.all();
				if (!row) {
					writeJson(res, 500, { error: "comment insert returned no row" });
					return;
				}

				writeJson(res, 201, mapComment(row));
			},
		},
		{
			method: "DELETE",
			pattern: "/api/comments/:commentId",
			handler: (_req, res, params) => {
				const commentId = params.commentId;
				if (!commentId) {
					writeJson(res, 400, { error: "Missing commentId" });
					return;
				}

				const deleted = db.delete(comment).where(eq(comment.id, commentId)).returning().all();
				if (deleted.length === 0) {
					writeJson(res, 404, { error: `Comment ${commentId} not found` });
					return;
				}

				writeJson(res, 200, {});
			},
		},
		{
			method: "GET",
			pattern: "/api/runs/:runId/github-comments",
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

				const result = await fetchGitHubComments(run.repoRoot, run.headBranch);
				writeJson(res, 200, result satisfies GitHubCommentsResponse);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/submit-review",
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

				const drafts = db
					.select()
					.from(comment)
					.where(and(eq(comment.runId, runId), eq(comment.published, false)))
					.all();

				if (drafts.length === 0) {
					writeJson(res, 200, {
						submitted: false,
						count: 0,
						reason: "No draft comments to submit.",
					} satisfies SubmitReviewResult);
					return;
				}

				const result = await submitReview(run.repoRoot, run.headBranch, drafts);
				if (result.submitted) {
					// Mark every just-pushed draft as published. The POST /reviews
					// response doesn't surface per-comment IDs, so githubCommentId
					// stays null — it isn't needed until reply/delete sync exists.
					db.update(comment)
						.set({ published: true })
						.where(and(eq(comment.runId, runId), eq(comment.published, false)))
						.run();
				}
				writeJson(res, 200, result satisfies SubmitReviewResult);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/github-comments/:commentId/reply",
			handler: async (req, res, params) => {
				const runId = params.runId;
				const commentIdRaw = params.commentId;
				if (!runId || !commentIdRaw) {
					writeJson(res, 400, { error: "Missing runId or commentId" });
					return;
				}

				const commentId = Number.parseInt(commentIdRaw, 10);
				if (!Number.isInteger(commentId) || commentId <= 0) {
					writeJson(res, 400, { error: "commentId must be a positive integer" });
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

				const text = parseReplyBody(body);
				if (!text) {
					writeJson(res, 400, { error: "Expected { body: non-empty string }" });
					return;
				}

				const result = await replyToGitHubComment(run.repoRoot, run.headBranch, commentId, text);
				writeJson(res, 200, result satisfies GitHubReplyResult);
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/resolve-thread",
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

				const parsed = parseResolveBody(body);
				if (!parsed) {
					writeJson(res, 400, {
						error: "Expected { threadId: string, resolved: boolean }",
					});
					return;
				}

				const result = await resolveThread(run.repoRoot, parsed.threadId, parsed.resolved);
				writeJson(res, 200, result satisfies ResolveThreadResult);
			},
		},
	];
}

interface ResolveBody {
	threadId: string;
	resolved: boolean;
}

function parseResolveBody(body: unknown): ResolveBody | null {
	if (typeof body !== "object" || body === null) return null;
	const record = body as Record<string, unknown>;
	if (typeof record.threadId !== "string" || record.threadId.length === 0) return null;
	if (typeof record.resolved !== "boolean") return null;
	return { threadId: record.threadId, resolved: record.resolved };
}

/**
 * Resolves or unresolves a review thread. The GraphQL mutation only needs the
 * thread's node ID — no PR number, owner, or repo — so this skips the PR lookup
 * entirely.
 */
async function resolveThread(
	repoRoot: string,
	threadId: string,
	resolved: boolean,
): Promise<ResolveThreadResult> {
	const mutation = resolved
		? "mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}"
		: "mutation($threadId:ID!){unresolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}";

	try {
		await execFileAsync(
			"gh",
			["api", "graphql", "-f", `query=${mutation}`, "-f", `threadId=${threadId}`],
			{ cwd: repoRoot, timeout: GH_TIMEOUT_MS },
		);
		return { resolved, reason: null };
	} catch (err) {
		return { resolved: !resolved, reason: describeGhError(err) };
	}
}

function parseReplyBody(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const text = (body as Record<string, unknown>).body;
	if (typeof text !== "string" || text.trim().length === 0) return null;
	if (text.length > MAX_BODY_LENGTH) return null;
	return text;
}

async function replyToGitHubComment(
	repoRoot: string,
	headBranch: string | null,
	commentId: number,
	body: string,
): Promise<GitHubReplyResult> {
	const { number, reason } = await resolvePrNumber(repoRoot, headBranch);
	if (number === null) {
		return { replied: false, reason: reason ?? "No pull request for this run." };
	}

	try {
		await execFileAsync(
			"gh",
			[
				"api",
				"--method",
				"POST",
				`repos/{owner}/{repo}/pulls/${number}/comments/${commentId}/replies`,
				"-f",
				`body=${body}`,
			],
			{ cwd: repoRoot, timeout: GH_TIMEOUT_MS },
		);
		return { replied: true, reason: null };
	} catch (err) {
		return { replied: false, reason: describeGhError(err) };
	}
}

// Review-thread resolution state only exists in GraphQL — the REST
// /pulls/{n}/comments endpoint can't see it — so the fetch goes through a
// `reviewThreads` query, which also hands us the thread structure natively.
const REVIEW_THREADS_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      reviewThreads(first:100){
        nodes{
          id
          isResolved
          comments(first:100){
            nodes{
              databaseId
              author{login}
              body
              path
              line
              startLine
              diffSide
              url
              createdAt
              replyTo{databaseId}
            }
          }
        }
      }
    }
  }
}`;

async function fetchGitHubComments(
	repoRoot: string,
	headBranch: string | null,
): Promise<GitHubCommentsResponse> {
	const { target, reason } = await resolvePrTarget(repoRoot, headBranch);
	if (!target) {
		return { comments: [], reason: reason ?? "No pull request for this run." };
	}

	try {
		const { stdout } = await execFileAsync(
			"gh",
			[
				"api",
				"graphql",
				"-f",
				`query=${REVIEW_THREADS_QUERY}`,
				"-f",
				`owner=${target.owner}`,
				"-f",
				`repo=${target.repo}`,
				"-F",
				`number=${target.number}`,
			],
			{ cwd: repoRoot, timeout: GH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
		);
		return { comments: parseReviewThreads(stdout), reason: null };
	} catch (err) {
		return { comments: [], reason: describeGhError(err) };
	}
}

interface RawReviewThreadComment {
	databaseId: number;
	author?: { login?: string } | null;
	body: string;
	path: string;
	diffSide?: string | null;
	line?: number | null;
	startLine?: number | null;
	url: string;
	createdAt: string;
	replyTo?: { databaseId?: number } | null;
}

interface RawReviewThread {
	id: string;
	isResolved: boolean;
	comments?: { nodes?: RawReviewThreadComment[] } | null;
}

function parseReviewThreads(stdout: string): GitHubComment[] {
	let parsed: {
		data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: RawReviewThread[] } } } };
	};
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return [];
	}

	const threads = parsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
	const comments: GitHubComment[] = [];
	for (const thread of threads) {
		for (const c of thread.comments?.nodes ?? []) {
			const side = c.diffSide === "LEFT" ? DIFF_SIDE.DELETIONS : DIFF_SIDE.ADDITIONS;
			// `line` is null for comments GitHub considers outdated.
			const endLine = typeof c.line === "number" ? c.line : null;
			const startLine = typeof c.startLine === "number" ? c.startLine : endLine;
			comments.push({
				id: c.databaseId,
				author: c.author?.login ?? "unknown",
				body: c.body,
				filePath: c.path,
				side,
				startLine,
				endLine,
				url: c.url,
				createdAt: c.createdAt,
				inReplyToId: typeof c.replyTo?.databaseId === "number" ? c.replyTo.databaseId : null,
				threadId: thread.id,
				isResolved: thread.isResolved,
			});
		}
	}
	return comments;
}

async function submitReview(
	repoRoot: string,
	headBranch: string | null,
	drafts: CommentRow[],
): Promise<SubmitReviewResult> {
	const { number, reason } = await resolvePrNumber(repoRoot, headBranch);
	if (number === null) {
		return { submitted: false, count: 0, reason: reason ?? "No pull request for this run." };
	}

	const payload = {
		event: "COMMENT",
		comments: drafts.map((draft) => {
			const side = draft.side === DIFF_SIDE.DELETIONS ? "LEFT" : "RIGHT";
			const base = { path: draft.filePath, body: draft.body, side, line: draft.endLine };
			// GitHub only accepts start_line when the comment spans multiple lines.
			return draft.startLine === draft.endLine
				? base
				: { ...base, start_line: draft.startLine, start_side: side };
		}),
	};

	try {
		await runGhWithStdin(
			["api", "--method", "POST", `repos/{owner}/{repo}/pulls/${number}/reviews`, "--input", "-"],
			repoRoot,
			JSON.stringify(payload),
		);
		return { submitted: true, count: drafts.length, reason: null };
	} catch (err) {
		return { submitted: false, count: 0, reason: describeGhError(err) };
	}
}

/**
 * Runs `gh` with a JSON body piped to stdin. `execFile` (async) has no `input`
 * option, so the push path needs `spawn` to feed `gh api --input -`.
 */
function runGhWithStdin(args: string[], cwd: string, stdin: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("gh", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
		const out: Buffer[] = [];
		const errOut: Buffer[] = [];
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`gh timed out after ${GH_TIMEOUT_MS}ms`));
		}, GH_TIMEOUT_MS);

		child.stdout.on("data", (d) => out.push(d));
		child.stderr.on("data", (d) => errOut.push(d));
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve(Buffer.concat(out).toString("utf8"));
				return;
			}
			const stderr = Buffer.concat(errOut).toString("utf8");
			const error = new Error(`gh exited ${code}`) as Error & { stderr: string };
			error.stderr = stderr;
			reject(error);
		});

		child.stdin.write(stdin);
		child.stdin.end();
	});
}

function parseCreateCommentInput(body: unknown): CreateCommentInput | null {
	if (typeof body !== "object" || body === null) return null;
	const record = body as Record<string, unknown>;

	const { filePath, side, startLine, endLine } = record;
	const text = record.body;

	if (typeof filePath !== "string" || filePath.length === 0) return null;
	if (side !== DIFF_SIDE.ADDITIONS && side !== DIFF_SIDE.DELETIONS) return null;
	if (!isPositiveInt(startLine) || !isPositiveInt(endLine)) return null;
	if (endLine < startLine) return null;
	if (typeof text !== "string" || text.trim().length === 0) return null;
	if (text.length > MAX_BODY_LENGTH) return null;

	return { filePath, side, startLine, endLine, body: text };
}

function isPositiveInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}
