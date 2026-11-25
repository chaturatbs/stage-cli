import { MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const POPUP_OFFSET_PX = 8;
const POPUP_WIDTH_PX = 200;

interface TextSelectionPopupProps {
	selectedText: string;
	rect: DOMRect;
	onFindContext: (text: string) => void;
	/** Provided only when the selection resolved to a line anchor a comment can attach to. */
	onComment?: () => void;
	onDismiss: () => void;
}

export function TextSelectionPopup({
	selectedText,
	rect,
	onFindContext,
	onComment,
	onDismiss,
}: TextSelectionPopupProps) {
	const popupRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismiss();
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [onDismiss]);

	const top = Math.max(rect.top - POPUP_OFFSET_PX - 40, 8);
	const left = Math.max(
		8,
		Math.min(
			rect.left + rect.width / 2 - POPUP_WIDTH_PX / 2,
			window.innerWidth - POPUP_WIDTH_PX - 8,
		),
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: onMouseDown only preventDefaults to keep the text selection alive while the popup's buttons are clicked — the interactive elements are the buttons inside.
		<div
			ref={popupRef}
			className={cn(
				"fixed z-50 flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-md",
				"animate-in fade-in zoom-in-95 duration-100",
			)}
			style={{ top, left, width: POPUP_WIDTH_PX }}
			onMouseDown={(e) => e.preventDefault()}
		>
			<button
				type="button"
				onClick={() => onFindContext(selectedText)}
				className="inline-flex flex-1 items-center gap-1.5 rounded px-2 py-1 text-foreground text-xs hover:bg-accent"
			>
				<Sparkles className="size-3.5" />
				Find context
			</button>
			{onComment ? (
				<button
					type="button"
					onClick={onComment}
					className="inline-flex flex-1 items-center gap-1.5 rounded px-2 py-1 text-foreground text-xs hover:bg-accent"
				>
					<MessageSquare className="size-3.5" />
					Comment
				</button>
			) : null}
		</div>
	);
}
