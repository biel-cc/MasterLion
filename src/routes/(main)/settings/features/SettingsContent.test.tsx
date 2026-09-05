import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import SettingsContent from './SettingsContent';

vi.mock('@/features/NavHeader', () => ({
  default: () => <div data-testid="nav-header" />,
}));

vi.mock('@/features/ProductFeatureGate/FeatureDisabledPage', () => ({
  default: () => <div>feature-disabled</div>,
}));

vi.mock('@/features/Setting/SettingContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableBusinessFeatures: vi.fn() },
  useServerConfigStore: () => false,
}));

vi.mock('./componentMap', () => ({
  componentMap: {
    skill: () => <div>skill-settings-content</div>,
    memory: () => <div>memory-settings-content</div>,
  },
}));

describe('SettingsContent', () => {
  it('renders skill management reached from the composer', () => {
    render(<SettingsContent activeTab={SettingsTabs.Skill} mobile={false} />);
    expect(screen.getByText('skill-settings-content')).toBeInTheDocument();
    expect(screen.queryByText('feature-disabled')).not.toBeInTheDocument();
  });
  it('renders the converged memory settings page', () => {
    render(<SettingsContent activeTab={SettingsTabs.Memory} mobile={false} />);

    expect(screen.getByText('memory-settings-content')).toBeInTheDocument();
    expect(screen.queryByText('feature-disabled')).not.toBeInTheDocument();
  });

  it('keeps unsupported settings tabs behind the disabled page', () => {
    render(<SettingsContent activeTab={SettingsTabs.Advanced} mobile={false} />);

    expect(screen.getByText('feature-disabled')).toBeInTheDocument();
    expect(screen.queryByText('memory-settings-content')).not.toBeInTheDocument();
  });
});
