import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ShortcutsHelp from '@/components/ShortcutsHelp';
import { UserPreferencesProvider } from '@/contexts/UserPreferencesContext';

const renderHelp = () =>
  render(
    <UserPreferencesProvider>
      <input aria-label="Message" />
      <div contentEditable aria-label="Draft">
        <span>Editable draft</span>
      </div>
      <ShortcutsHelp />
    </UserPreferencesProvider>,
  );

describe('ShortcutsHelp', () => {
  beforeEach(() => localStorage.clear());

  it('opens with Shift+? and lists shortcuts by context, with focus restored on Escape', () => {
    renderHelp();
    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: '?', shiftKey: true });

    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const name of ['Chat', 'Beneficiaries', 'Modals']) {
      expect(within(dialog).getByRole('heading', { name })).toBeVisible();
    }
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    const checkbox = within(dialog).getByRole('checkbox');
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('ignores the shortcut in inputs, inside editable content, and under another modal', () => {
    const { rerender } = renderHelp();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), {
      key: '?',
    });
    fireEvent.keyDown(screen.getByText('Editable draft'), { key: '?' });
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <UserPreferencesProvider>
        <div role="dialog" aria-modal="true" aria-label="Payment dialog" />
        <ShortcutsHelp />
      </UserPreferencesProvider>,
    );
    fireEvent.keyDown(window, { key: '?' });
    expect(
      screen.queryByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeNull();
  });

  it('remembers the preference and leaves the help button available', () => {
    const { unmount } = renderHelp();
    fireEvent.keyDown(window, { key: '?' });
    fireEvent.click(screen.getByRole('checkbox'));
    unmount();

    renderHelp();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(trigger).not.toHaveAttribute('aria-keyshortcuts');
    fireEvent.click(trigger);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
