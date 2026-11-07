# Attribution

## DeepSeek Harness: current Host and Agent runtime

Linguist Agent is a native DSH Host + Client plugin. DSH provides sessions,
models, permissions, general tools, subagents and scheduling. LA provides
CAT editing, localization resources, format handling and professional workflows.
The supported DSH SDK version is declared in `packages/dsh-linguist/package.json`.

The native preset was initially adapted from the DSH standard preset; native
UI integrations use its public SDK and components. DSH copyright and the MIT
license text are retained in [NOTICE.md](NOTICE.md).

Source: https://github.com/deepseek-ai/deepseek-harness

## Earlier Linguist Agent: CAT module lineage

The CAT domain, format adapters, resource storage, QA, proposals, delivery and
legacy data import were carried forward from earlier Linguist Agent code.
They remain distributed under AGPL-3.0 as part of this project.

That earlier codebase recorded **Proma** as an upstream source. Its historical
copyright attribution is retained in [NOTICE.md](NOTICE.md):

- Copyright (C) ErlichLiu and contributors.
- Source: https://github.com/proma-ai/Proma
- License: GNU Affero General Public License, version 3.

## BrowserSkill

The companion adaptation uses the official BrowserSkill plugin, CLI and
extension. Its fixed source version, changes and upgrade steps are recorded
in [the BrowserSkill integration](integrations/browser-skill/README.md).

Source: https://github.com/Tencent/BrowserSkill — MIT License,
Copyright (c) 2026 Tencent.

Other components are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
