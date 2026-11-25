import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LineAnchor } from "@/lib/use-diff-selection";
import { cn } from "@/lib/utils";

const COMPOSER_WIDTH_PX = 380;
const COMPOSER_OFFSET_PX = 8;

interface CommentComposerProps {
	anchor: LineAnchor;
	rect: DOMRect;
	isSubmitting: boolean;
	onSubmit: (body: string) => void;
	onCancel: () => void;
}

export function CommentComposer({
	anchor,
	rect,
	isSubmitting,
	onSubmit,
	onCancel,
}: CommentComposerProps) {
	const [body, setBody] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "Escape") {
			onCancel();
			return;
		}
		// Cmd/Ctrl+Enter submits — matches the muscle memory from GitHub's box.
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			submit();
		}
	};

	const submit = () => {
		const trimmed = body.trim();
		if (trimmed.length === 0 || isSubmitting) return;
		onSubmit(trimmed);
	};

	const top = Math.min(rect.bottom + COMPOSER_OFFSET_PX, window.innerHeight - 220);
	const left = Math.max(
		8,
		Math.min(
			rect.left + rect.width / 2 - COMPOSER_WIDTH_PX / 2,
			window.innerWidth - COMPOSER_WIDTH_PX - 8,
		),
	);

	return (
		<div
			className={cn(
				"fixed z-50 flex flex-col gap-2 rounded-lg border border-border bg-popover p-3 shadow-lg",
				"animate-in fade-in zoom-in-95 duration-100",
			)}
			style={{ top, left, width: COMPOSER_WIDTH_PX }}
		>
			<div className="flex items-center gap-1.5 font-mono text-muted-foreground text-xs">
				<span className="truncate text-foreground">{anchor.filePath}</span>
				<span className="shrink-0">
					{anchor.side === "deletions" ? "L" : "R"}
					{anchor.startLine}
					{anchor.endLine !== anchor.startLine ? `–${anchor.endLine}` : ""}
				</span>
			</div>
			<textarea
				ref={textareaRef}
				value={body}
				onChange={(e) => setBody(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Leave a comment…"
				rows={4}
				className={cn(
					"w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm",
					"placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
				)}
			/>
			<div className="flex items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					size="sm"
					onClick={submit}
					disabled={body.trim().length === 0 || isSubmitting}
				>
					{isSubmitting ? "Saving…" : "Comment"}
				</Button>
			</div>
		</div>
	);
}
