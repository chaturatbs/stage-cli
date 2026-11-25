import { spawn } from "node:child_process";
import type { ContextHit, ContextResponse } from "@stagereview/types/context";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";

const MAX_QUERY_LENGTH = 200;
const MAX_HITS_PER_FILE = 3;
const MAX_TOTAL_HITS = 50;
const MAX_COLUMN_WIDTH = 200;
const RG_TIMEOUT_MS = 5_000;
const CONTEXT_LINES = 1;

export function contextRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/context",
			handler: async (req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}

				const url = new URL(req.url ?? "/", "http://internal");
				const query = (url.searchParams.get("q") ?? "").trim();
				const excludePath = url.searchParams.get("filePath")?.trim();

				if (query.length === 0) {
					writeJson(res, 400, { error: "Missing query 'q'" });
					return;
				}
				if (query.length > MAX_QUERY_LENGTH) {
					writeJson(res, 400, {
						error: `Query exceeds max length (${MAX_QUERY_LENGTH})`,
					});
					return;
				}

				const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
				if (!run) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}

				try {
					const result = await runRipgrep({
						query,
						repoRoot: run.repoRoot,
						excludePath: excludePath ?? null,
					});
					writeJson(res, 200, result satisfies ContextResponse);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					writeJson(res, 500, { error: `Context lookup failed: ${message}` });
				}
			},
		},
	];
}

interface RipgrepInput {
	query: string;
	repoRoot: string;
	excludePath: string | null;
}

/**
 * Runs `rg --json` with safe defaults. Spawned with array args (no shell),
 * so the query is never interpreted as shell metacharacters; `-F` makes it
 * a literal search rather than a regex.
 */
async function runRipgrep(input: RipgrepInput): Promise<ContextResponse> {
	const args = [
		"--json",
		"--fixed-strings",
		"--max-count",
		String(MAX_HITS_PER_FILE),
		"--max-columns",
		String(MAX_COLUMN_WIDTH),
		"--context",
		String(CONTEXT_LINES),
		"--ignore-vcs",
		"--no-heading",
		"--smart-case",
		"--",
		input.query,
		input.repoRoot,
	];

	return new Promise((resolve, reject) => {
		const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		const errChunks: Buffer[] = [];

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`ripgrep timed out after ${RG_TIMEOUT_MS}ms`));
		}, RG_TIMEOUT_MS);

		child.stdout.on("data", (data) => chunks.push(data));
		child.stderr.on("data", (data) => errChunks.push(data));

		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			// rg exits 1 when no matches found — that's a valid empty result, not an error.
			if (code !== 0 && code !== 1) {
				const stderr = Buffer.concat(errChunks).toString("utf8");
				reject(new Error(`ripgrep exited ${code}: ${stderr.slice(0, 500)}`));
				return;
			}
			const stdout = Buffer.concat(chunks).toString("utf8");
			resolve(parseRipgrepOutput(stdout, input));
		});
	});
}

interface RgMatchLine {
	type: "match";
	data: {
		path: { text: string };
		lines: { text: string };
		line_number: number;
	};
}

interface RgContextLine {
	type: "context";
	data: {
		path: { text: string };
		lines: { text: string };
		line_number: number;
	};
}

type RgEvent = RgMatchLine | RgContextLine | { type: string };

function parseRipgrepOutput(stdout: string, input: RipgrepInput): ContextResponse {
	const lines = stdout.split("\n").filter((l) => l.length > 0);
	const hitsByFile = new Map<string, ContextHit[]>();
	const linesByFile = new Map<string, Map<number, { text: string; isMatch: boolean }>>();

	for (const raw of lines) {
		let event: RgEvent;
		try {
			event = JSON.parse(raw) as RgEvent;
		} catch {
			continue;
		}

		if (event.type !== "match" && event.type !== "context") continue;
		const data = (event as RgMatchLine | RgContextLine).data;
		const fullPath = data.path.text;
		const relative = stripPrefix(fullPath, input.repoRoot);

		if (input.excludePath && relative === input.excludePath) continue;

		const byLine = linesByFile.get(relative) ?? new Map();
		byLine.set(data.line_number, {
			text: data.lines.text.replace(/\n$/, ""),
			isMatch: event.type === "match",
		});
		linesByFile.set(relative, byLine);
	}

	let truncated = false;
	for (const [relative, byLine] of linesByFile) {
		const sortedNumbers = [...byLine.keys()].sort((a, b) => a - b);
		const fileHits: ContextHit[] = [];
		for (const lineNum of sortedNumbers) {
			const entry = byLine.get(lineNum);
			if (!entry?.isMatch) continue;
			const before = [byLine.get(lineNum - 1)?.text].filter(isString);
			const after = [byLine.get(lineNum + 1)?.text].filter(isString);
			fileHits.push({
				filePath: relative,
				lineNumber: lineNum,
				snippet: entry.text,
				context: { before, after },
			});
		}
		hitsByFile.set(relative, fileHits);
	}

	const hits: ContextHit[] = [];
	for (const fileHits of hitsByFile.values()) {
		for (const hit of fileHits) {
			if (hits.length >= MAX_TOTAL_HITS) {
				truncated = true;
				break;
			}
			hits.push(hit);
		}
		if (truncated) break;
	}

	return { query: input.query, hits, truncated };
}

function stripPrefix(path: string, prefix: string): string {
	const normalisedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
	return path.startsWith(normalisedPrefix) ? path.slice(normalisedPrefix.length) : path;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
