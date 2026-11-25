import type {
	Comment,
	CommentsResponse,
	CreateCommentInput,
	SubmitReviewResult,
} from "@stagereview/types/comment";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { githubCommentsQueryKey } from "@/lib/use-github-comments";
import { jsonFetch } from "@/lib/use-view-state";

function commentsQueryKey(runId: string): readonly unknown[] {
	return ["comments", runId];
}

async function fetchComments(runId: string): Promise<CommentsResponse> {
	return jsonFetch<CommentsResponse>(`/api/runs/${encodeURIComponent(runId)}/comments`);
}

/**
 * Comments for a run: a list query plus create/delete mutations. Mutations
 * invalidate the list rather than patching optimistically — comment volume is
 * low and the round-trip is local, so the simpler path is the right one here.
 */
export function useComments(runId: string) {
	const queryClient = useQueryClient();
	const queryKey = commentsQueryKey(runId);

	const { data, isLoading } = useQuery<CommentsResponse>({
		queryKey,
		queryFn: () => fetchComments(runId),
		enabled: runId !== "",
	});

	const createMutation = useMutation<Comment, Error, CreateCommentInput>({
		mutationFn: (input) =>
			jsonFetch<Comment>(`/api/runs/${encodeURIComponent(runId)}/comments`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(input),
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const deleteMutation = useMutation<unknown, Error, string>({
		mutationFn: (commentId) =>
			jsonFetch<unknown>(`/api/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const submitMutation = useMutation<SubmitReviewResult, Error, void>({
		mutationFn: () =>
			jsonFetch<SubmitReviewResult>(`/api/runs/${encodeURIComponent(runId)}/submit-review`, {
				method: "POST",
			}),
		onSuccess: () => {
			// Local list gains `published: true`; the GitHub list gains the new comments.
			void queryClient.invalidateQueries({ queryKey });
			void queryClient.invalidateQueries({ queryKey: githubCommentsQueryKey(runId) });
		},
	});

	const comments = data?.comments ?? [];

	return {
		comments,
		draftCount: comments.filter((c) => !c.published).length,
		isLoading,
		createComment: createMutation.mutateAsync,
		isCreating: createMutation.isPending,
		deleteComment: deleteMutation.mutate,
		submitReview: submitMutation.mutateAsync,
		isSubmitting: submitMutation.isPending,
	};
}
