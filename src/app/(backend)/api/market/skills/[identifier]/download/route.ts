import { getSessionUser } from '@/libs/trusted-client';
import { MarketService } from '@/server/services/market';

type Params = Promise<{ identifier: string }>;

const safeFilename = (value: string) =>
  value.replaceAll(/[^\w.-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'market-skill';

/**
 * Authenticated same-origin proxy for Market skill archives.
 * The browser never receives the trusted-client token or the internal Market URL.
 */
export const GET = async (request: Request, segmentData: { params: Params }) => {
  const userInfo = await getSessionUser();
  if (!userInfo) return new Response('Unauthorized', { status: 401 });

  try {
    const { identifier } = await segmentData.params;
    const version = new URL(request.url).searchParams.get('version') || undefined;
    const archive = await new MarketService({ userInfo }).downloadSkill(identifier, version);
    const filename = archive.filename || `${safeFilename(identifier)}.zip`;

    return new Response(Buffer.from(archive.buffer), {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
        'Content-Type': 'application/zip',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[MarketSkillDownload] Failed to download skill archive', error);
    return new Response('Market skill download failed', { status: 502 });
  }
};

export const dynamic = 'force-dynamic';
