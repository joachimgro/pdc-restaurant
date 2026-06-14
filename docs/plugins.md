# PDC Plugin Development Guide

Plugins add new sections to the platform without modifying core files.
Each plugin lives on a feature branch of `pdc-template` and is merged
into client repos on demand.

## How plugins work

The plugin registry (`apps/web/src/plugins/registry.ts`) holds the list
of active plugins. Core components (NavRail, InboxPage) read from it at
render time. Plugins register themselves by calling `registerPlugin()`.

The plugin loader (`apps/web/src/plugins/index.ts`) is the single file
a plugin branch edits in the core — it adds one import line per plugin.

## Creating a new plugin

### 1. Create the branch

```bash
git checkout main
git checkout -b feat/your-plugin-name
```

### 2. Add the plugin entry point file

Create `apps/web/src/plugins/your-plugin-name/index.tsx`:

```tsx
import { registerPlugin } from "@/plugins/registry";
import { YourIcon } from "./icon";
import { YourWorkspace } from "./workspace";

registerPlugin({
  id: "your-plugin-name",
  label: "Your Plugin Label",
  order: 10,
  railPosition: "top", // or "bottom"
  Icon: YourIcon,
  Workspace: YourWorkspace,
});
```

### 3. Add your icon and workspace components

- `apps/web/src/plugins/your-plugin-name/icon.tsx` — SVG icon component
- `apps/web/src/plugins/your-plugin-name/workspace.tsx` — the full workspace

### 4. Register the plugin in the loader

In `apps/web/src/plugins/index.ts`, add:

```typescript
import "./your-plugin-name";
```

This is the only core file your plugin edits.

### 5. Add a backend route (if needed)

Add your route file to `workers/api/src/routes/`.
Register it in `workers/api/src/index.ts` — plugins may need to add
one route registration line here too. Keep it clearly marked with a comment.

### 6. Add a migration (if needed)

Create the next numbered migration in `workers/api/migrations/`.
Update `EXPECTED_SCHEMA_VERSION` in `workers/api/src/meta.ts`.
Document the minimum schema version in `FEATURE_REQUIREMENTS.md`.

### 7. Create FEATURE_REQUIREMENTS.md

```markdown
# FEATURE_REQUIREMENTS.md — [Plugin Name]

- **Feature name:** Your plugin name
- **Minimum schema version:** NNNN
- **Built against base commit:** [SHA]
- **New migrations introduced:** [list]
```

## Installing a plugin on a client repo

```bash
# In the client repo
git fetch upstream
git merge upstream/feat/your-plugin-name
pnpm deploy:remote
```

That's it. The migration runs automatically, the plugin registers itself,
and the nav item appears.

## Plugin rules

- Plugins only ADD files — they do not edit core files except `plugins/index.ts`
- Plugin IDs must be unique and kebab-case
- Plugins must declare their minimum schema version in `FEATURE_REQUIREMENTS.md`
- Plugins must not import from other plugins

## Capability flags (built-in, not nav plugins)

Scheduling, multi-location, and demo tools are gated by Worker env flags
(`ENABLE_SIMPLE_SCHEDULING`, `ENABLE_MULTI_LOCATION`, `ENABLE_DEMO_TOOLS`).
See [client-setup.md](./client-setup.md) for profiles and `apply-profile.mjs`.
