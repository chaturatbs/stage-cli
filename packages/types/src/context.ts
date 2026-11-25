export interface ContextHit {
	/** Path relative to the repo root. */
	filePath: string;
	/** 1-indexed line number of the match. */
	lineNumber: number;
	/** The matching line as rendered (trimmed to a max column width). */
	snippet: string;
	/** Optional surrounding lines for visual context. */
	context: { before: string[]; after: string[] };
}

export interface ContextResponse {
	/** Echo of the query that was searched. */
	query: string;
	/** Hits ranked by file then line; capped server-side. */
	hits: ContextHit[];
	/** True when results were trimmed to the server's cap. */
	truncated: boolean;
}
