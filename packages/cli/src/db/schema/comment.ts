import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { DIFF_SIDE } from "../../schema.js";
import { LOCAL_USER_ID } from "../local-user.js";
import { chapterRun } from "./chapter-run.js";
import { baseColumns } from "./columns.js";

/**
 * A reviewer comment anchored to a line range in a run's diff. Local-first:
 * `published` tracks whether the comment has been pushed to GitHub yet, and
 * `githubCommentId` is filled in once it has.
 */
export const comment = sqliteTable(
	"comment",
	{
		...baseColumns(),
		userId: text().notNull().default(LOCAL_USER_ID),
		runId: text()
			.notNull()
			.references(() => chapterRun.id, { onDelete: "cascade" }),
		filePath: text().notNull(),
		side: text({ enum: [DIFF_SIDE.ADDITIONS, DIFF_SIDE.DELETIONS] }).notNull(),
		startLine: integer().notNull(),
		endLine: integer().notNull(),
		body: text().notNull(),
		/** False until the comment has been pushed to GitHub as a PR review comment. */
		published: integer({ mode: "boolean" }).notNull().default(false),
		/** GitHub review-comment node ID, set once published. */
		githubCommentId: text(),
	},
	(table) => [index("comment_run_id_idx").on(table.runId)],
);

export type CommentRow = typeof comment.$inferSelect;
export type CommentInsert = typeof comment.$inferInsert;
