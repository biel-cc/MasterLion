import { NextResponse } from 'next/server';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';

/**
 * Public desktop authentication metadata.
 *
 * The desktop client uses this endpoint before starting OIDC so it can fail
 * fast when the configured remote origin does not match the server's APP_URL.
 * No credentials or provider secrets are exposed here.
 */
export const GET = async () => {
  if (!authEnv.ENABLE_OIDC) {
    return NextResponse.json(
      { error: 'OIDC is not enabled on this server' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 },
    );
  }

  if (!appEnv.APP_URL) {
    return NextResponse.json(
      { error: 'APP_URL is not configured on this server' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 },
    );
  }

  try {
    const appUrl = new URL(appEnv.APP_URL);

    return NextResponse.json(
      {
        appUrl: appUrl.toString(),
        redirectUri: new URL('/oidc/callback/desktop', appUrl).toString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'APP_URL is invalid on this server' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 },
    );
  }
};
