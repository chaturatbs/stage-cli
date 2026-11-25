import type {
	GitHubCommentsResponse,
	GitHubReplyResult,
	ResolveThreadResult,
} from "@stagereview/types/comment";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jsonFetch } from "@/lib/use-view-state";

export function githubCommentsQueryKey(runId: string): readonly unknown[] {
	return ["github-comments", runId];
}

interface ReplyArgs {
	commentId: number;
	body: string;
}

interface ResolveArgs {
	threadId: string;
	resolved: boolean;
}

/**
 * Read-only mirror of the PR's existing review comments, plus a `replyToComment`
 * mutation. Returns `{ comments: [], reason }` rather than erroring when there's
 * no PR / no `gh`.
 */
export function useGitHubComments(runId: string | null) {
	const queryClient = useQueryClient();

	const query = useQuery<GitHubCommentsResponse>({
		queryKey: runId === null ? ["github-comments", null] : githubCommentsQueryKey(runId),
		queryFn:
			runId === null
				? skipToken
				: () =>
						jsonFetch<GitHubCommentsResponse>(
							`/api/runs/${encodeURIComponent(runId)}/github-comments`,
						),
		staleTime: 60_000,
	});

	const replyMutation = useMutation<GitHubReplyResult, Error, ReplyArgs>({
		mutationFn: ({ commentId, body }) => {
			if (runId === null) throw new Error("replyToComment called without a runId");
			return jsonFetch<GitHubReplyResult>(
				`/api/runs/${encodeURIComponent(runId)}/github-comments/${commentId}/reply`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ body }),
				},
			);
		},
		onSuccess: (result) => {
			// Only refetch when the reply actually landed — a failed reply leaves
			// the thread unchanged, so there's nothing new to pull.
			if (result.replied && runId !== null) {
				void queryClient.invalidateQueries({ queryKey: githubCommentsQueryKey(runId) });
			}
		},
	});

	const resolveMutation = useMutation<ResolveThreadResult, Error, ResolveArgs>({
		mutationFn: ({ threadId, resolved }) => {
			if (runId === null) throw new Error("resolveThread called without a runId");
			return jsonFetch<ResolveThreadResult>(
				`/api/runs/${encodeURIComponent(runId)}/resolve-thread`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ threadId, resolved }),
				},
			);
		},
		onSuccess: (result) => {
			if (result.reason === null && runId !== null) {
				void queryClient.invalidateQueries({ queryKey: githubCommentsQueryKey(runId) });
			}
		},
	});

	return {
		data: query.data,
		isLoading: query.isLoading,
		replyToComment: replyMutation.mutateAsync,
		isReplying: replyMutation.isPending,
		resolveThread: resolveMutation.mutateAsync,
		isResolving: resolveMutation.isPending,
	};
}
