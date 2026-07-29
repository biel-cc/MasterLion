import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConsentClient from './index';

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  Result: ({ icon, title }: { icon: ReactNode; title: ReactNode }) => (
    <div>
      {icon}
      {title}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: () => <span>loading</span>,
}));

vi.mock('@/features/AuthCard', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../OAuthApplicationLogo', () => ({
  default: () => null,
}));

describe('ConsentClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits the interaction uid when auto-approving a built-in client', async () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const { container } = render(
      <ConsentClient
        clientId="lobehub-desktop"
        clientMetadata={{ clientName: 'Masterino Desktop', isFirstParty: true }}
        scopes={['openid', 'profile']}
        uid="interaction-uid-123"
      />,
    );

    const form = container.querySelector<HTMLFormElement>('form[action="/oidc/consent"]');
    const uidInput = form?.querySelector<HTMLInputElement>('input[name="uid"]');

    expect(form).not.toBeNull();
    expect(uidInput).toHaveValue('interaction-uid-123');
    expect(uidInput).not.toHaveValue('lobehub-desktop');
    await waitFor(() => expect(submitSpy).toHaveBeenCalledOnce());
    expect(submitSpy).toHaveBeenCalledWith();
  });
});
