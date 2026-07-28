import { and, eq, lt, sql } from 'drizzle-orm';

import type { NewOAuthHandoff, OAuthHandoffItem } from '../schemas';
import { oauthHandoffs } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class OAuthHandoffModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /**
   * Create a new OAuth handoff record
   * @param params Credential data
   * @returns Created record
   */
  create = async (params: NewOAuthHandoff): Promise<OAuthHandoffItem> => {
    const [result] = await this.db
      .insert(oauthHandoffs)
      .values(params)
      .onConflictDoNothing()
      .returning();

    return result;
  };

  /**
   * Fetch and consume OAuth credentials
   * Deletes and returns the record atomically so concurrent pollers cannot
   * receive the same authorization code.
   * @param id Credential ID
   * @param client Client type
   * @returns Credential data, or null if it doesn't exist or has expired
   */
  fetchAndConsume = async (id: string, client: string): Promise<OAuthHandoffItem | null> => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const [handoff] = await this.db
      .delete(oauthHandoffs)
      .where(
        and(
          eq(oauthHandoffs.id, id),
          eq(oauthHandoffs.client, client),
          sql`${oauthHandoffs.createdAt} > ${fiveMinutesAgo}`,
        ),
      )
      .returning();

    return handoff ?? null;
  };

  /**
   * Clean up expired OAuth handoff records
   * This method should be called periodically (e.g., via a cron job) to clean up expired records
   * @returns Number of records cleaned up
   */
  cleanupExpired = async (): Promise<number> => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const result = await this.db
      .delete(oauthHandoffs)
      .where(lt(oauthHandoffs.createdAt, fiveMinutesAgo));

    return result.rowCount || 0;
  };

  /**
   * Check if a credential exists (without consuming it)
   * Primarily used for testing and debugging
   * @param id Credential ID
   * @param client Client type
   * @returns Whether it exists and is not expired
   */
  exists = async (id: string, client: string): Promise<boolean> => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const handoff = await this.db.query.oauthHandoffs.findFirst({
      where: and(
        eq(oauthHandoffs.id, id),
        eq(oauthHandoffs.client, client),
        sql`${oauthHandoffs.createdAt} > ${fiveMinutesAgo}`,
      ),
    });

    return !!handoff;
  };
}
