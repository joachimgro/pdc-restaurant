# Plugin Registry — Changelog

Infrastructure-only change: adds extension points so feature branches can register new nav sections without editing core sidebar/workspace files.

## Files created

| File | What was added | Edited by plugins? |
|------|----------------|-------------------|
| `apps/web/src/plugins/registry.ts` | `PluginDefinition` interface, `registerPlugin()`, `getPlugins()`, `getPlugin()`, `isPluginSection()` | **No** — read-only for plugins |
| `apps/web/src/plugins/index.ts` | Plugin loader (empty on main; one import per plugin on feature branches) | **Yes** — plugins add `import "./your-plugin-name"` here |
| `docs/plugins.md` | Plugin development guide (replaces capability-only stub) | **No** |
| `PLUGIN_REGISTRY_CHANGELOG.md` | This file | **No** |

## Files changed

| File | What changed | Edited by plugins? |
|------|--------------|-------------------|
| `apps/web/src/components/inbox/app-section.ts` | Added `CoreSection` type; `AppSection` extended with `(string & {})`; `parseAppSection()` accepts registered plugin IDs via `isPluginSection()` | **No** |
| `apps/web/src/components/inbox/NavRail.tsx` | Imports `getPlugins()`; renders `topPlugins` after Inbox button and `bottomPlugins` before Settings button | **No** |
| `apps/web/src/components/inbox/InboxPage.tsx` | First import: `@/plugins/index`; imports `getPlugin()`; renders plugin `Workspace` when active section matches a registered plugin | **No** |

## Files unchanged (plugins must not edit)

- `apps/web/src/components/inbox/icons.tsx` — core icons only; plugins supply their own
- `apps/web/src/app/inbox/page.tsx` — route wrapper unchanged
- All other inbox components (`LeadsPanel`, `SettingsWorkspace`, `KnowledgeWorkspace`, etc.)

## Behaviour

- With zero plugins registered (main branch default), inbox / settings / knowledge behave identically to before.
- Core sections are not registered in the plugin registry; they remain hardcoded in `NavRail` and `InboxPage`.
- Plugin nav items sort by `order` within their `railPosition` group (`top` below inbox, `bottom` above settings).

## Verification

- TypeScript: `pnpm --filter @lead-intake/web exec tsc --noEmit`
- Existing sections: inbox, settings, knowledge — no registry entries required

---

## Files a plugin branch may edit

Legitimate plugin touch points:

1. **`apps/web/src/plugins/index.ts`** — add one `import "./your-plugin-name"` line (required for web nav/workspace)
2. **`apps/web/src/plugins/your-plugin-name/**`** — new files only (entry, icon, workspace, API client helpers)
3. **`workers/api/src/routes/your-route.ts`** — new route file (if backend needed)
4. **`workers/api/src/index.ts`** — one route registration line (if backend needed; mark with plugin comment)
5. **`workers/api/migrations/NNNN_*.sql`** — new migration (if schema needed)
6. **`workers/api/src/meta.ts`** — `EXPECTED_SCHEMA_VERSION` bump (if migration added)
7. **`FEATURE_REQUIREMENTS.md`** — plugin metadata at repo root (recommended)

Core files plugins **must never** edit:

- `apps/web/src/components/inbox/NavRail.tsx`
- `apps/web/src/components/inbox/InboxPage.tsx`
- `apps/web/src/components/inbox/app-section.ts`
- `apps/web/src/components/inbox/icons.tsx`
- `apps/web/src/plugins/registry.ts`
