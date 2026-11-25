import { useEffect, useState } from "react";
import { DIFF_SIDE, type DiffSide } from "@/lib/diff-types";

export interface LineAnchor {
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
}

export interface DiffSelection {
	text: string;
	rect: DOMRect;
	/** Resolved line range when the selection sits on diff lines; null otherwise. */
	anchor: LineAnchor | null;
}

/**
 * Watches text selection inside Pierre's diff viewer. Pierre renders each file
 * into its own open shadow root, so a single page can have many. The hook tries
 * the window selection first (catches content rendered outside any shadow root —
 * file headers, summaries) then walks every shadow root inside the container.
 *
 * Beyond the raw text + rect, it resolves a {@link LineAnchor} from the Range's
 * DOM position so callers can anchor comments to `(file, side, line range)`.
 *
 * Listens on `mouseup` rather than `selectionchange` because the latter fires
 * once per character during drag; we only want the final state.
 */
export function useDiffSelection(containerRef: React.RefObject<HTMLElement | null>) {
	const [selection, setSelection] = useState<DiffSelection | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleMouseUp = () => {
			setSelection(captureSelection(container));
		};

		document.addEventListener("mouseup", handleMouseUp);
		return () => document.removeEventListener("mouseup", handleMouseUp);
	}, [containerRef]);

	const clear = () => {
		setSelection(null);
		// Also drop the browser-level selection so the popup doesn't reappear
		// on the next mouseup. Walk shadow roots in case the selection lives
		// in one of Pierre's per-file shadow DOMs.
		window.getSelection()?.removeAllRanges();
		const container = containerRef.current;
		if (!container) return;
		for (const root of collectShadowRoots(container)) {
			const getter = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection;
			if (typeof getter === "function") getter.call(root)?.removeAllRanges();
		}
	};

	return { selection, clear };
}

function captureSelection(container: HTMLElement): DiffSelection | null {
	const fromWindow = extractSelection(window.getSelection());
	if (fromWindow) return fromWindow;

	for (const root of collectShadowRoots(container)) {
		const getter = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection;
		if (typeof getter !== "function") continue;
		const result = extractSelection(getter.call(root));
		if (result) return result;
	}
	return null;
}

function collectShadowRoots(root: Element): ShadowRoot[] {
	const result: ShadowRoot[] = [];
	const queue: Element[] = [root];
	while (queue.length > 0) {
		const node = queue.shift();
		if (!node) continue;
		const shadow = (node as HTMLElement).shadowRoot;
		if (shadow) {
			result.push(shadow);
			queue.push(...Array.from(shadow.children));
		}
		queue.push(...Array.from(node.children));
	}
	return result;
}

function extractSelection(sel: Selection | null): DiffSelection | null {
	if (!sel || sel.isCollapsed) return null;
	const text = sel.toString().trim();
	if (text.length === 0) return null;

	const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
	if (!range) return null;
	const rect = range.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return null;

	return { text, rect, anchor: resolveLineAnchor(range) };
}

interface LinePoint {
	filePath: string;
	side: DiffSide;
	line: number;
}

/**
 * Resolves a Range to a line anchor by walking from each endpoint up to the
 * nearest `[data-line]` element. When the endpoints land in different files we
 * keep only the start file (a comment can't span files); within one file the
 * line numbers are clamped to a min/max range.
 */
function resolveLineAnchor(range: Range): LineAnchor | null {
	const start = resolveLinePoint(range.startContainer);
	if (!start) return null;
	const end = resolveLinePoint(range.endContainer);

	if (!end || end.filePath !== start.filePath) {
		return {
			filePath: start.filePath,
			side: start.side,
			startLine: start.line,
			endLine: start.line,
		};
	}

	return {
		filePath: start.filePath,
		side: start.side,
		startLine: Math.min(start.line, end.line),
		endLine: Math.max(start.line, end.line),
	};
}

function resolveLinePoint(node: Node): LinePoint | null {
	const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
	if (!element) return null;

	const lineEl = element.closest<HTMLElement>("[data-line]");
	if (!lineEl) return null;

	const line = Number.parseInt(lineEl.getAttribute("data-line") ?? "", 10);
	if (!Number.isInteger(line) || line <= 0) return null;

	const filePath = resolveFilePath(node);
	if (!filePath) return null;

	return { filePath, side: resolveSide(lineEl), line };
}

function resolveSide(lineEl: HTMLElement): DiffSide {
	if (lineEl.closest("[data-deletions]")) return DIFF_SIDE.DELETIONS;
	if (lineEl.closest("[data-additions]")) return DIFF_SIDE.ADDITIONS;
	// Unified view: side comes from the line type. Context lines exist on both
	// sides — anchor them to the new-file (additions) side, matching GitHub.
	if (lineEl.getAttribute("data-line-type") === "change-deletion") return DIFF_SIDE.DELETIONS;
	return DIFF_SIDE.ADDITIONS;
}

/**
 * Crosses out of Pierre's shadow root (`getRootNode()` → `ShadowRoot.host` is
 * the `<diffs-container>` in light DOM) and finds the enclosing
 * `<div id="file-<path>">` that `FileDiffList` wraps each file in.
 */
function resolveFilePath(node: Node): string | null {
	const rootNode = node.getRootNode();
	const host = rootNode instanceof ShadowRoot ? rootNode.host : null;
	const fileEl = (host ?? (node as Element))?.closest?.<HTMLElement>('[id^="file-"]');
	if (!fileEl) return null;
	return fileEl.id.slice("file-".length);
}
