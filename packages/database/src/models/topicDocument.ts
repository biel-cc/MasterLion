import { and, desc, eq } from 'drizzle-orm';

import type { DocumentItem, NewTopicDocument } from '../schemas';
import { documents, topicDocuments } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export interface TopicDocumentWithDetails extends DocumentItem {
  associatedAt: Date;
}

export interface TopicDocumentSummary
  extends Pick<
    DocumentItem,
    | 'createdAt'
    | 'description'
    | 'fileType'
    | 'filename'
    | 'id'
    | 'title'
    | 'totalCharCount'
    | 'totalLineCount'
    | 'updatedAt'
  > {
  associatedAt: Date;
}

export interface TopicDocumentPlanMetadata {
  id: string;
  metadata: DocumentItem['metadata'];
}

export interface TopicDocumentPlan
  extends Pick<
    DocumentItem,
    | 'content'
    | 'createdAt'
    | 'description'
    | 'fileType'
    | 'id'
    | 'metadata'
    | 'title'
    | 'totalCharCount'
    | 'totalLineCount'
    | 'updatedAt'
  > {
  associatedAt: Date;
}

export class TopicDocumentModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topicDocuments);

  /**
   * Associate a document with a topic.
   *
   * Idempotent: the primary key is `(documentId, topicId)`, so re-binding the
   * same pair is a no-op via `ON CONFLICT DO NOTHING` instead of a
   * unique-violation. Callers can safely retry or call this on every save
   * without checking existence first.
   */
  associate = async (
    params: Omit<NewTopicDocument, 'userId'>,
  ): Promise<{ documentId: string; topicId: string }> => {
    await this.db
      .insert(topicDocuments)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .onConflictDoNothing();

    return { documentId: params.documentId, topicId: params.topicId };
  };

  /**
   * Remove association between a document and a topic
   */
  disassociate = async (documentId: string, topicId: string) => {
    return this.db
      .delete(topicDocuments)
      .where(
        and(
          eq(topicDocuments.documentId, documentId),
          eq(topicDocuments.topicId, topicId),
          this.ownership(),
        ),
      );
  };

  /**
   * Get all documents associated with a topic
   */
  findByTopicId = async (
    topicId: string,
    filter?: { type?: string },
  ): Promise<TopicDocumentWithDetails[]> => {
    const results = await this.db
      .select({
        associatedAt: topicDocuments.createdAt,
        document: documents,
      })
      .from(topicDocuments)
      .innerJoin(documents, eq(topicDocuments.documentId, documents.id))
      .where(
        and(
          eq(topicDocuments.topicId, topicId),
          this.ownership(),
          filter?.type ? eq(documents.fileType, filter.type) : undefined,
        ),
      )
      .orderBy(desc(topicDocuments.createdAt));

    return results.map((r) => ({
      ...r.document,
      associatedAt: r.associatedAt,
    }));
  };

  /**
   * Get bounded document summaries for a topic list.
   *
   * Keep this projection explicit: selecting the complete `documents` row here
   * would pull content, editor data, pages and metadata into the database
   * backend and Node process even though the human-facing list does not use it.
   */
  findSummariesByTopicId = async (
    topicId: string,
    filter?: { type?: string },
  ): Promise<TopicDocumentSummary[]> => {
    return this.db
      .select({
        associatedAt: topicDocuments.createdAt,
        createdAt: documents.createdAt,
        description: documents.description,
        fileType: documents.fileType,
        filename: documents.filename,
        id: documents.id,
        title: documents.title,
        totalCharCount: documents.totalCharCount,
        totalLineCount: documents.totalLineCount,
        updatedAt: documents.updatedAt,
      })
      .from(topicDocuments)
      .innerJoin(documents, eq(topicDocuments.documentId, documents.id))
      .where(
        and(
          eq(topicDocuments.topicId, topicId),
          this.ownership(),
          filter?.type ? eq(documents.fileType, filter.type) : undefined,
        ),
      )
      .orderBy(desc(topicDocuments.createdAt));
  };

  /** Get the most recently associated full Agent plan for runtime context injection. */
  findLatestPlanByTopicId = async (topicId: string): Promise<TopicDocumentPlan | null> => {
    const [result] = await this.db
      .select({
        associatedAt: topicDocuments.createdAt,
        content: documents.content,
        createdAt: documents.createdAt,
        description: documents.description,
        fileType: documents.fileType,
        id: documents.id,
        metadata: documents.metadata,
        title: documents.title,
        totalCharCount: documents.totalCharCount,
        totalLineCount: documents.totalLineCount,
        updatedAt: documents.updatedAt,
      })
      .from(topicDocuments)
      .innerJoin(documents, eq(topicDocuments.documentId, documents.id))
      .where(
        and(
          eq(topicDocuments.topicId, topicId),
          this.ownership(),
          eq(documents.fileType, 'agent/plan'),
        ),
      )
      .orderBy(
        desc(topicDocuments.createdAt),
        desc(documents.updatedAt),
        desc(documents.id),
      )
      .limit(1);

    return result ?? null;
  };

  /**
   * Get only Agent plan metadata needed by pre-summary Electron clients.
   *
   * Old clients render plan todos from the topic list response. Keeping this as
   * a narrow compatibility query avoids restoring content, pages or editor data
   * to the human-facing list while the old clients age out.
   */
  findPlanMetadataByTopicId = async (topicId: string): Promise<TopicDocumentPlanMetadata[]> => {
    return this.db
      .select({ id: documents.id, metadata: documents.metadata })
      .from(topicDocuments)
      .innerJoin(documents, eq(topicDocuments.documentId, documents.id))
      .where(
        and(
          eq(topicDocuments.topicId, topicId),
          this.ownership(),
          eq(documents.fileType, 'agent/plan'),
        ),
      )
      .orderBy(
        desc(topicDocuments.createdAt),
        desc(documents.updatedAt),
        desc(documents.id),
      );
  };

  /** Get ordered document ids for callers that only need topic membership. */
  findDocumentIdsByTopicId = async (topicId: string): Promise<string[]> => {
    const results = await this.db
      .select({ documentId: topicDocuments.documentId })
      .from(topicDocuments)
      .where(and(eq(topicDocuments.topicId, topicId), this.ownership()))
      .orderBy(desc(topicDocuments.createdAt));

    return results.map(({ documentId }) => documentId);
  };

  /**
   * Get all topics associated with a document
   */
  findByDocumentId = async (documentId: string): Promise<string[]> => {
    const results = await this.db
      .select({ topicId: topicDocuments.topicId })
      .from(topicDocuments)
      .where(and(eq(topicDocuments.documentId, documentId), this.ownership()));

    return results.map((r) => r.topicId);
  };

  /**
   * Check if a document is associated with a topic
   */
  isAssociated = async (documentId: string, topicId: string): Promise<boolean> => {
    const result = await this.db.query.topicDocuments.findFirst({
      where: and(
        eq(topicDocuments.documentId, documentId),
        eq(topicDocuments.topicId, topicId),
        this.ownership(),
      ),
    });

    return !!result;
  };

  /**
   * Remove all associations for a topic
   */
  deleteByTopicId = async (topicId: string) => {
    return this.db
      .delete(topicDocuments)
      .where(and(eq(topicDocuments.topicId, topicId), this.ownership()));
  };

  /**
   * Remove all associations for a document
   */
  deleteByDocumentId = async (documentId: string) => {
    return this.db
      .delete(topicDocuments)
      .where(and(eq(topicDocuments.documentId, documentId), this.ownership()));
  };
}
