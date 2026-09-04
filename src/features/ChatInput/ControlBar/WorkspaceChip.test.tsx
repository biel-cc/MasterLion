/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceChip from './WorkspaceChip';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Tag: ({ children, ...props }: { children?: ReactNode }) => <span {...props}>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_target, property) => String(property) }),
  cssVar: new Proxy({}, { get: (_target, property) => String(property) }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./DirIcon', () => ({ default: () => null }));
vi.mock('./WorkspacePicker', () => ({ default: () => null }));

describe('WorkspaceChip', () => {
  it('renders a workspace-group draft as a non-interactive full path', () => {
    render(
      <WorkspaceChip
        bind={{ canStartReferencedTopic: false } as any}
        effective={
          {
            cwd: '/projects/acme',
            isDraft: true,
            state: 'bound',
            workspace: {
              deviceId: 'device-1',
              displayName: 'Acme workspace',
              kind: 'device',
              rootPath: '/projects/acme',
            },
          } as any
        }
      />,
    );

    expect(screen.getByText('/projects/acme')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
