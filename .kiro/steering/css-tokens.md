---
inclusion: always
---

# CSS Tokens & Styling Guidelines

All UI contributions **must** use the design tokens defined in `src/app/globals.css`.  
Direct Tailwind colour utilities (e.g. `bg-blue-600`) and raw hex values (e.g. `#3b82f6`) are **not allowed** for theme-aware colours.

## Why

The project supports light and dark themes via `[data-theme='dark']`.  
Tokens automatically flip between their light and dark values; hardcoded colours do not.

---

## Available Tokens

### Backgrounds / Surfaces
| Token | Usage |
|---|---|
| `var(--background)` | Page-level background |
| `var(--color-surface)` | Card / panel background |
| `var(--color-surface-muted)` | Subtle inset areas, inputs |
| `var(--color-surface-elevated)` | Modals, dropdowns, tooltips |

### Text
| Token | Usage |
|---|---|
| `var(--color-text-primary)` | Body copy, headings |
| `var(--color-text-secondary)` | Supporting labels |
| `var(--color-text-muted)` | Placeholders, disabled text |

### Borders
| Token | Usage |
|---|---|
| `var(--color-border)` | All dividers and input borders |

### Brand / Interactive
| Token | Usage |
|---|---|
| `var(--color-primary)` | Primary buttons, links, focus rings |
| `var(--color-primary-hover)` | Hover state of primary elements |
| `var(--color-primary-soft)` | Tinted backgrounds behind primary icons |

### Semantic
| Token | Usage |
|---|---|
| `var(--color-success)` | Success text / icons |
| `var(--color-success-soft)` | Success badge / alert background |
| `var(--color-warning)` | Warning text / icons |
| `var(--color-warning-soft)` | Warning badge / alert background |
| `var(--color-danger)` | Error text / icons |
| `var(--color-danger-soft)` | Error badge / alert background |

### Overlays & Scrollbars
| Token | Usage |
|---|---|
| `var(--color-overlay)` | Modal backdrops |
| `var(--color-scrollbar-track)` | Scrollbar track |
| `var(--color-scrollbar-thumb)` | Scrollbar thumb |

---

## Pre-built Utility Classes

`globals.css` ships semantic utility classes that wrap the tokens.  
Prefer these over inline `style={}` props.

```
.theme-app               – page background + primary text
.theme-surface           – card background + primary text
.theme-surface-muted     – muted surface background
.theme-border            – border colour
.theme-text-primary      – primary text colour
.theme-text-secondary    – secondary text colour
.theme-text-muted        – muted text colour
.theme-input             – input background, border, text + placeholder
.theme-primary-button    – primary CTA (bg + hover)
.theme-secondary-button  – secondary CTA (muted bg + border)
.theme-overlay           – modal backdrop
.theme-soft-success      – success badge (bg + text + border)
.theme-soft-warning      – warning badge (bg + text + border)
.theme-soft-danger       – danger badge (bg + text + border)
```

---

## Rules

1. **Never** use `bg-blue-*`, `text-blue-*`, `border-blue-*` (or any raw Tailwind colour scale) for theme-aware colours.
2. **Never** hardcode hex values like `#3b82f6` or `rgba(59,130,246,…)` in component files.
3. Use `style={{ color: 'var(--color-primary)' }}` or the utility classes above.
4. Recharts / SVG `stroke` and `fill` props that need theme colours must also reference tokens via `getComputedStyle` or CSS variables — not hardcoded hex.
5. Non-semantic, layout-only Tailwind classes (`p-4`, `flex`, `gap-2`, `rounded-md`, etc.) are fine as-is.

---

## Examples

```tsx
// ✅ correct
<button className="theme-primary-button px-4 py-2 rounded-md">Send</button>

// ✅ correct – inline when a utility class doesn't exist
<div style={{ background: 'var(--color-primary-soft)' }}>...</div>

// ❌ wrong – bypasses theme
<button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md">Send</button>

// ❌ wrong – hardcoded hex
<div style={{ background: '#3b82f6' }}>...</div>
```
