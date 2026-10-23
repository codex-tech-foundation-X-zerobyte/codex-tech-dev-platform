# Design system (draft v0.1)
Direction: monochrome with a restrained orange accent. Always use semantic tokens, never raw hex in components.

| Semantic token | Light | Dark |
|---|---|---|
| `--bg` | #FFFFFF | #0A0A0A |
| `--surface` | #F5F5F5 | #141414 |
| `--elevated` | #FAFAFA | #1C1C1C |
| `--text` | #171717 | #FAFAFA |
| `--muted` | #737373 | #A3A3A3 |
| `--border` | #E5E5E5 | #303030 |
| `--accent` | #F2650D | #F2650D |
| `--btn-primary-bg / fg` | #171717 / #FFFFFF | #FAFAFA / #0A0A0A |
| `--focus-ring` | accent | accent |
| `--danger`, `--warning`, `--success`, `--info` | to be tuned for contrast in both themes | same |

Rules: status is never color alone (icon plus text label). Mono font for keys, IDs, logs. Theme follows OS on first visit, persisted, no flash on load. Respect `prefers-reduced-motion`. Server-side pagination for every list that can grow. No emoji icons.
Logo: `../../branding/` (white C, orange dot, near-black tile).
