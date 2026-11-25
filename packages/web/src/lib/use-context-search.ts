import type { ContextResponse } from "@stagereview/types/context";
import { skipToken, useQuery } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

interface UseContextSearchArgs {
	runId: string;
	query: string | null;
	excludePath?: string;
}

async function fetchContext(args: UseContextSearchArgs): Promise<ContextResponse> {
	if (!args.query) throw new Error("fetchContext called without a query");
	const params = new URLSearchParams({ q: args.query });
	if (args.excludePath) params.set("filePath", args.excludePath);
	return jsonFetch<ContextResponse>(
		`/api/runs/${encodeURIComponent(args.runId)}/context?${params.toString()}`,
	);
}

export function useContextSearch(args: UseContextSearchArgs) {
	return useQuery<ContextResponse>({
		queryKey: ["context", args.runId, args.query, args.excludePath ?? null],
		queryFn: args.query === null ? skipToken : () => fetchContext(args),
		staleTime: 60_000,
	});
}
