import { AGENT_PLAN_FILE_TYPE } from '@lobechat/const';
import { type NotebookDocument, type NotebookDocumentSummary } from '@lobechat/types';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { NotebookRuntimeService } from '@/server/services/notebook';
import {
  recordNotebookSummaryRead,
  recordNotebookSummaryReadError,
} from '@/server/services/notebook/telemetry';
import { runNotebookDatabaseRead } from '@/server/services/notebook/transientDatabaseError';

const notebookProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, wsId),
      notebookService: new NotebookRuntimeService({
        serverDB: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: wsId,
      }),
      topicDocumentModel: new TopicDocumentModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

const toNotebookDocument = (doc: {
  associatedAt: Date;
  content: string | null;
  createdAt: Date;
  description: string | null;
  fileType: string;
  id: string;
  metadata: Record<string, any> | null;
  title: string | null;
  totalCharCount: number;
  totalLineCount: number;
  updatedAt: Date;
}): NotebookDocument => ({
  associatedAt: doc.associatedAt,
  content: doc.content,
  createdAt: doc.createdAt,
  description: doc.description,
  fileType: doc.fileType,
  id: doc.id,
  metadata: doc.metadata,
  title: doc.title,
  totalCharCount: doc.totalCharCount,
  totalLineCount: doc.totalLineCount,
  updatedAt: doc.updatedAt,
});

const toLegacyNotebookDocument = (
  doc: NotebookDocumentSummary,
  planMetadata: Map<string, Record<string, any> | null>,
): NotebookDocument => ({
  ...doc,
  content: null,
  metadata: planMetadata.get(doc.id) ?? null,
});

export const notebookRouter = router({
  createDocument: notebookProcedure
    .use(withScopedPermission('document:create'))
    .input(
      z.object({
        content: z.string(),
        description: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        source: z.string().optional().default('notebook'),
        sourceType: z.enum(['file', 'web', 'api', 'topic']).optional().default('api'),
        title: z.string(),
        topicId: z.string(),
        type: z
          .enum(['article', 'markdown', 'note', 'report', 'agent/plan'])
          .optional()
          .default('markdown'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Create the document
      const document = await ctx.documentModel.create({
        content: input.content,
        description: input.description,
        fileType: input.type,
        metadata: input.metadata,
        source: input.source,
        sourceType: input.sourceType,
        title: input.title,
        totalCharCount: input.content.length,
        totalLineCount: input.content.split('\n').length,
      });

      // Associate with topic
      await ctx.topicDocumentModel.associate({
        documentId: document.id,
        topicId: input.topicId,
      });

      return document;
    }),

  deleteDocument: notebookProcedure
    .use(withScopedPermission('document:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.notebookService.deleteDocument(input.id);

      return { success: true };
    }),

  getDocument: notebookProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.documentModel.findById(input.id);
    }),

  getLatestPlan: notebookProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }): Promise<NotebookDocument | null> => {
      const plan = await runNotebookDatabaseRead(() =>
        ctx.topicDocumentModel.findLatestPlanByTopicId(input.topicId),
      );

      return plan ? toNotebookDocument(plan) : null;
    }),

  listDocumentSummaries: notebookProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }): Promise<{ data: NotebookDocumentSummary[]; total: number }> => {
      const startedAt = Date.now();
      try {
        const documents = await runNotebookDatabaseRead(() =>
          ctx.topicDocumentModel.findSummariesByTopicId(input.topicId),
        );
        recordNotebookSummaryRead('canonical', startedAt, documents);

        return { data: documents, total: documents.length };
      } catch (error) {
        recordNotebookSummaryReadError('canonical', error);
        throw error;
      }
    }),

  listDocuments: notebookProcedure
    .input(
      z.object({
        topicId: z.string(),
        type: z.enum(['article', 'markdown', 'note', 'report', 'agent/plan']).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<{ data: NotebookDocument[]; total: number }> => {
      // Keep old agent/plan callers compatible until all shipped clients use
      // getLatestPlan. Human-facing lists are slimmed here as well as in the
      // canonical summary procedure so old Electron versions stop loading full
      // document rows immediately after the server rollout.
      if (input.type !== AGENT_PLAN_FILE_TYPE) {
        const startedAt = Date.now();
        try {
          const summaries = await runNotebookDatabaseRead(() =>
            ctx.topicDocumentModel.findSummariesByTopicId(input.topicId, { type: input.type }),
          );
          // Do not double the per-request connection demand during recovery.
          // This compatibility read is deliberately sequential and disappears
          // for canonical summary callers and typed legacy callers.
          const planMetadata =
            input.type === undefined
              ? await runNotebookDatabaseRead(() =>
                  ctx.topicDocumentModel.findPlanMetadataByTopicId(input.topicId),
                )
              : [];
          const planMetadataById = new Map(
            planMetadata.map(({ id, metadata }) => [id, metadata] as const),
          );
          const data = summaries.map((summary) =>
            toLegacyNotebookDocument(summary, planMetadataById),
          );
          recordNotebookSummaryRead('legacy', startedAt, data);

          return { data, total: data.length };
        } catch (error) {
          recordNotebookSummaryReadError('legacy', error);
          throw error;
        }
      }

      const documents = await runNotebookDatabaseRead(() =>
        ctx.topicDocumentModel.findByTopicId(input.topicId, { type: input.type }),
      );

      return {
        data: documents.map(toNotebookDocument),
        total: documents.length,
      };
    }),

  updateDocument: notebookProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        append: z.boolean().optional(),
        content: z.string().optional(),
        description: z.string().optional(),
        id: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        title: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let contentToUpdate = input.content;

      // Handle append mode
      if (input.append && input.content) {
        const existing = await ctx.documentModel.findById(input.id);
        if (existing?.content) {
          contentToUpdate = existing.content + '\n\n' + input.content;
        }
      }

      await ctx.documentModel.update(input.id, {
        ...(contentToUpdate !== undefined && {
          content: contentToUpdate,
          totalCharCount: contentToUpdate.length,
          totalLineCount: contentToUpdate.split('\n').length,
        }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
        ...(input.title && { title: input.title }),
      });

      return ctx.documentModel.findById(input.id);
    }),
});
