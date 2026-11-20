# Accessibility Conformance Checklist (WCAG 2.2 AA)

This document establishes the accessibility requirements, conformance targets, reviewer checklists, and current implementation audit for the Stellar-Dex-Chat application.

---

## Table of Contents

- [Accessibility Target](#accessibility-target)
- [Chat Interface Requirements & Checklist](#chat-interface-requirements--checklist)
- [Modals & Dialogs Requirements & Checklist](#modals--dialogs-requirements--checklist)
- [Forms & Input Requirements & Checklist](#forms--input-requirements--checklist)
- [General Accessibility Requirements & Checklist](#general-accessibility-requirements--checklist)
- [Pull Request Reviewer Checklist](#pull-request-reviewer-checklist)
- [Implementation Status & Known Gaps](#implementation-status--known-gaps)

---

## Accessibility Target

Stellar-Dex-Chat targets **WCAG 2.2 Level AA** conformance across all public and authenticated user interfaces.

All user interface design and frontend code must adhere to the four core principles of the Web Content Accessibility Guidelines (WCAG):
1. **Perceivable**: Information and user interface components must be presentable to users in ways they can perceive.
2. **Operable**: User interface components and navigation must be operable using a keyboard, screen reader, or alternative input device.
3. **Understandable**: Information and the operation of the user interface must be understandable.
4. **Robust**: Content must be robust enough that it can be interpreted by a wide variety of user agents, including assistive technologies.

> [!IMPORTANT]
> Do not claim full WCAG 2.2 AA compliance until every criterion has been verified through manual assistive technology testing (e.g., VoiceOver, NVDA) and automated auditing. Features that have not undergone formal verification are tracked in [Implementation Status & Known Gaps](#implementation-status--known-gaps).

---

## Chat Interface Requirements & Checklist

The chat interface is the primary interaction point for natural language conversations, asset conversions, and transaction authorizations.

### Requirements

1. **Keyboard Navigation**:
   - Users must be able to navigate to and through the message list, input box, and action buttons using only the keyboard (`Tab`, `Shift+Tab`, `Arrow keys`, `Home`, `End`, `PageUp`, `PageDown`).
   - The message compose textarea must support standard shortcuts (e.g., `Enter` to submit, `Shift+Enter` for newline, or `Cmd/Ctrl+Enter` depending on user configuration).
2. **Screen-Reader Announcements for New Messages**:
   - The message feed should use appropriate live regions (`aria-live="polite"`, `role="log"`) so newly arriving user or assistant messages are announced automatically without interrupting current speech.
   - Message timestamps, sender roles (User vs. Assistant), and transaction state badges must be announced clearly.
3. **Accessible Message Input**:
   - The message input textarea must have an accessible label via `<label htmlFor="...">` or `aria-label`.
   - A placeholder must never be used as the sole identifier of an input field.
   - Associated shortcut hints (e.g., "Press Enter to send") must be linked using `aria-describedby`.
4. **Meaningful Labels on Interactive Elements**:
   - Icon-only buttons (copy message, insert emoji, clear chat, retry send) must include explicit `aria-label` attributes and tooltip descriptions.
5. **Focus Visibility**:
   - Every interactive element within the chat container must exhibit a prominent, high-contrast focus indicator (`focus-visible:ring-2 focus-visible:ring-offset-2`).
6. **Appropriate Contrast**:
   - Chat bubbles, background containers, sender indicators, and status badges must meet a minimum contrast ratio of **4.5:1** for standard text and **3:1** for essential non-text UI borders.
7. **Status Announcements**:
   - Transient states (typing indicator, offline banner, reconnection status, network queue count) must be exposed via `aria-live="polite"` regions with `aria-atomic="true"`.
8. **Avoiding Keyboard Traps**:
   - Navigating through the message thread, virtualized lists, or emoji pickers must never trap focus. The user must always be able to `Tab` or press `Escape` to return to the main input or viewport.

### Reviewer Checklist: Chat Interface

- [ ] Can the entire chat workflow (typing, sending, reading responses) be operated solely with the keyboard?
- [ ] Are new incoming assistant messages announced by screen readers without page reload?
- [ ] Does the message input field have an accessible label and `aria-describedby` hint?
- [ ] Do all icon buttons (copy, emoji, send, dismiss) possess informative `aria-label` attributes?
- [ ] Is keyboard focus clearly visible on all interactive elements?
- [ ] Does text contrast in both user and assistant message bubbles meet 4.5:1?
- [ ] Are typing and reconnection status indicators announced politely via live regions?
- [ ] Can the user exit the chat list or emoji picker without getting trapped?

---

## Modals and Dialogs Requirements & Checklist

Modals and dialogs are used for wallet connection, bank details entry, fiat conversion confirmation, and transaction receipts.

### Requirements

1. **Role and Modal Declaration**:
   - Every modal overlay container must include `role="dialog"` (or `role="alertdialog"` for critical confirmations) and `aria-modal="true"`.
2. **Accessible Dialog Names**:
   - The dialog must have an accessible name assigned via `aria-labelledby` pointing to the modal title element, or an explicit `aria-label`.
   - Explanatory descriptions should be linked via `aria-describedby`.
3. **Focus Management on Open**:
   - When a modal opens, focus must automatically move to the first interactive element or the dialog header/container itself.
4. **Focus Trapping**:
   - While the modal is open, keyboard focus must be trapped strictly inside the dialog. Pressing `Tab` on the last focusable element wraps to the first, and `Shift+Tab` on the first wraps to the last.
5. **Escape-Key Behavior**:
   - Pressing the `Escape` key must dismiss the modal immediately, unless a non-cancellable critical on-chain transaction is actively being submitted.
6. **Returning Focus to Triggering Element**:
   - When the modal closes (via close button, backdrop click, or `Escape`), keyboard focus must automatically return to the element that triggered the modal.
7. **Backdrop & Outside Dismiss**:
   - Clicking outside the modal backdrop or pressing the close button must provide clear, predictable dismissal.

### Reviewer Checklist: Modals and Dialogs

- [ ] Does the modal container have `role="dialog"` and `aria-modal="true"`?
- [ ] Is the dialog header linked via `aria-labelledby` or `aria-label`?
- [ ] Does opening the modal immediately move focus inside the dialog?
- [ ] Does `Tab` / `Shift+Tab` cycle strictly within modal controls without leaking to background content?
- [ ] Does pressing `Escape` dismiss the modal?
- [ ] When the modal closes, does focus return to the triggering button or link?
- [ ] Does the close button contain an explicit `aria-label="Close"`?

---

## Forms & Input Requirements & Checklist

Forms capture critical fiat banking credentials, account numbers, recipient names, and deposit/withdrawal amounts.

### Requirements

1. **Explicit Labels**:
   - Every `<input>`, `<select>`, and `<textarea>` must have an explicit associated `<label htmlFor="inputId">` element.
2. **Accessible Validation & Error Identification**:
   - Invalid fields must be flagged with `aria-invalid="true"`.
   - Error messages must have a unique `id` linked to the input via `aria-describedby` or `aria-errormessage`.
   - Error summaries or live validation updates should be announced using `aria-live="polite"`.
3. **Required-Field Indication**:
   - Fields that are mandatory must have both visual indicators (e.g., `*` or "(required)") and programmatic attributes (`required` or `aria-required="true"`).
4. **Keyboard Operation**:
   - All dropdowns, radio groups, checkboxes, and buttons must be fully operable using `Tab`, `Space`, `Enter`, and `Arrow` keys.
5. **Screen-Reader Compatibility**:
   - Helper texts, currency hints (e.g., "Amount in XLM"), and transaction fee estimates must be linked using `aria-describedby`.
6. **Appropriate Autocomplete Behavior**:
   - Form fields collecting standard personal or banking information must specify valid HTML5 `autocomplete` attributes (e.g., `autocomplete="name"`, `autocomplete="email"`, `autocomplete="tel"`, `autocomplete="transaction-amount"`).

### Reviewer Checklist: Forms

- [ ] Do all form inputs have programmatic labels linked via `htmlFor`/`id`?
- [ ] Are error messages explicitly associated with inputs via `aria-describedby`?
- [ ] Is `aria-invalid="true"` set dynamically when a field fails validation?
- [ ] Are required inputs marked with `required` or `aria-required="true"`?
- [ ] Can all form inputs and custom dropdowns be controlled entirely by keyboard?
- [ ] Are appropriate `autocomplete` attributes applied to standard user data inputs?

---

## General Accessibility Requirements & Checklist

### Requirements

1. **Semantic HTML**:
   - Use native semantic tags (`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`, `<section>`, `<article>`) rather than unsemantic `<div>` soup.
   - Maintain a logical heading structure (`<h1>` through `<h3>`) without skipping levels.
2. **Color Contrast**:
   - Normal text (below 18pt / 14pt bold): minimum **4.5:1** contrast ratio.
   - Large text (18pt+ or 14pt+ bold): minimum **3:1** contrast ratio.
   - Graphical objects, icons, and interactive element boundaries: minimum **3:1** contrast ratio against adjacent backgrounds.
   - Do not rely on color alone to convey status (e.g., combine green/red icons with text labels or icons).
3. **Responsive Text Scaling**:
   - Content and layout must remain fully readable and functional when zoomed up to **200%** in browser settings without truncation or horizontal layout breakages.
4. **Alternative Text for Graphics & Media**:
   - Informative images and QR codes (e.g., transaction receipt QR codes) must include meaningful `alt` text explaining their purpose or encoded data.
   - Purely decorative illustrations and background SVGs must have `alt=""` or `aria-hidden="true"`.
5. **Reduced-Motion Support**:
   - CSS animations, transitions, and loading spinners must respect user preferences via `@media (prefers-reduced-motion: reduce)` / Tailwind `motion-reduce:*`.
6. **Visible Focus Indicators**:
   - Never suppress outline styles with `outline: none` without providing an equal or superior visible focus replacement (`:focus-visible`).
7. **Touch Target Considerations**:
   - In accordance with WCAG 2.2 SC 2.5.8 (Target Size - Minimum), interactive touch targets must be at least **24x24 CSS pixels** with sufficient spacing, or ideally **44x44 CSS pixels** on mobile touchscreens.
8. **Accessible Navigation**:
   - Provide a "Skip to Main Content" bypass link at the top of the DOM.
   - Ensure document page titles (`<title>`) reflect current page context.

### Reviewer Checklist: General

- [ ] Does the page use valid, semantic HTML landmarks (`<main>`, `<nav>`, `<header>`)?
- [ ] Is the heading hierarchy sequential without skipped heading levels?
- [ ] Does text contrast pass WCAG AA (4.5:1 for normal text)?
- [ ] Is the UI readable and operable at 200% browser zoom?
- [ ] Do images and QR codes have descriptive `alt` text or `aria-hidden="true"`?
- [ ] Are animations disabled or calmed when `prefers-reduced-motion` is enabled?
- [ ] Is `:focus-visible` distinct and unhindered throughout the application?
- [ ] Do interactive buttons meet minimum touch target dimensions (>= 44x44px or >= 24px with clearance)?

---

## Pull Request Reviewer Checklist

When reviewing any Pull Request that modifies or introduces UI components, reviewers should verify the following concise checklist:

```markdown
### ♿ Accessibility (WCAG 2.2 AA) Checklist
- [ ] **Keyboard Operability**: All new/modified interactive elements can be reached and activated using only the keyboard.
- [ ] **Focus Management**: Focus remains visible, moves logically, and is neither trapped nor lost when dialogs/menus open or close.
- [ ] **Screen Reader Support**: Meaningful `aria-label`, `aria-describedby`, and `aria-live` attributes are used where necessary; icon buttons have accessible names.
- [ ] **Color & Contrast**: Text meets minimum 4.5:1 contrast ratio; information is not conveyed solely through color.
- [ ] **Forms & Validation**: Inputs have explicit `<label>` elements; error states set `aria-invalid="true"` and link error text.
- [ ] **Touch Targets & Scaling**: Interactive targets are adequately sized (>= 24px minimum, 44px ideal) and content scales to 200% zoom.
```

---

## Implementation Status & Known Gaps

The table below provides an accurate, unembellished assessment of current implementation status versus WCAG 2.2 AA requirements.

| Component / Area | Status | Implemented Features | Known Gaps / Pending Verification |
|---|---|---|---|
| `ChatInput` | Partial Conformance | Explicit `aria-label`, shortcut descriptions linked via `aria-describedby`, emoji picker with `aria-expanded` and item labels, polite live region for status. | Needs VoiceOver / NVDA keyboard verification for multi-line auto-grow edge cases. |
| `ChatMessages` | Partial Conformance | Virtualized list support, shortcut hints (`aria-keyshortcuts`), message dismissal buttons labeled, polite loading announcement. | Virtualized scrolling (`react-window`) can skip screen reader cursor navigation if not carefully managed; needs live region testing for batch replayed messages. |
| `OfflineStatusBanner` | Implemented | `aria-live="polite"`, `aria-atomic="true"`, accessible pagination controls for queued messages, decorative SVGs hidden with `aria-hidden="true"`. | High-contrast border visibility in Windows High Contrast Mode requires formal testing. |
| `BankDetailsModal` | Partial Conformance | `role="dialog"`, `aria-modal="true"`, `aria-label="Fiat payout"`, error messages linked with `aria-describedby`, `aria-invalid` set on validation failure. | Complete focus trapping and returning focus to original trigger on dismissal needs end-to-end focus retention test. |
| `StellarFiatModal` | Partial Conformance | `aria-modal="true"`, dynamic `aria-label` for deposit/withdraw modes, `aria-invalid` for amount errors, close button labeled. | Escape key handler and focus trapping currently rely on browser defaults; focus return to trigger element needs verification. |
| `ToastProvider` | Implemented | `role="status"` / `aria-live="polite"`, dismiss button labeled with `aria-label="Dismiss toast"`. | Multiple stacked toasts need rate limiting so screen readers are not overwhelmed. |
| `ReceiptQrCode` | Partial Conformance | SVG QR code includes wrapper container. | QR code image requires explicit `alt` text describing the encoded transaction hash or receipt link. |
| Global Navigation & Layout | Partial Conformance | Semantic HTML header and main content areas, dark mode color styling. | Missing "Skip to Main Content" skip link at the top of the layout; needs automated axe-core scanning. |
