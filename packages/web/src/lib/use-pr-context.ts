import type { PullRequestResponse } from "@stagereview/types/pr";
import { skipToken, useQuery } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

async function fetchPrContext(runId: string): Promise<PullRequestResponse> {
	return jsonFetch<PullRequestResponse>(`/api/runs/${encodeURIComponent(runId)}/pr`);
}

/**
 * Resolves the GitHub PR for a run's branch via the server's `gh` round-trip.
 * Returns `{ pr: null, reason }` rather than erroring when there's no PR, no
 * branch, or no `gh` — callers render the absence, they don't crash on it.
 */
export function usePrContext(runId: string | null) {
	return useQuery<PullRequestResponse>({
		queryKey: ["pr-context", runId],
		queryFn: runId === null ? skipToken : () => fetchPrContext(runId),
		staleTime: 5 * 60_000,
	});
}
