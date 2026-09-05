/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Body, { ChatSidebarKey } from './Body';

const taskProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children }: { children?: ReactNode }) => (
    <div data-testid="accordion">{children}</div>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./Task', () => ({
  default: (props: Record<string, unknown>) => {
    taskProps.push(props);
    return <div data-testid="task-list" />;
  },
}));

vi.mock('./Topic', () => ({
  default: () => <div data-testid="topic-list" />,
}));

describe('Sidebar Body', () => {
  it('keeps Task above Topic and passes Task its unchanged item key', () => {
    render(<Body />);

    const accordion = screen.getByTestId('accordion');
    const order = [...accordion.querySelectorAll('[data-testid]')].map((node) =>
      node.getAttribute('data-testid'),
    );
    expect(order).toEqual(['task-list', 'topic-list']);

    expect(taskProps).toHaveLength(1);
    expect(taskProps[0]).toEqual({ itemKey: ChatSidebarKey.Tasks });
  });
});
