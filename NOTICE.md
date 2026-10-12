# NOTICE

## Linguist Agent

Copyright (C) 2026 Henry Wang (wangyu-sg) and contributors.

Linguist Agent is a derivative work of **Proma** and is licensed under the
**GNU Affero General Public License, version 3 (AGPL-3.0)**. See `LICENSE`
for the full license text.

This product is not a closed-source commercial product. All new code added
by the Linguist Agent project is released as part of the whole product under
AGPL-3.0.

## Upstream: Proma

- **Proma** — Copyright (C) ErlichLiu and contributors.
- Source: https://github.com/proma-ai/Proma
- License: GNU Affero General Public License, version 3 (AGPL-3.0)
- Upstream baseline pinned in `docs/architecture/UPSTREAM_BASELINE.md`
  (baseline SHA `f99edbdb594407ab190b97ae073889c5d96637ab`).

The original Proma `LICENSE` file and all upstream copyright notices are
preserved unmodified. Proma copyright and license headers must not be
removed from any upstream file.

## Modifications

Linguist Agent modifies Proma. A summary of the modification categories
is maintained in `ATTRIBUTION.md`; every modified upstream file keeps the
original copyright header and adds a modification notice.

## Source code

The Corresponding Source of this application is available at:
https://github.com/wangyu-sg/linguist-agent-public

## Third-party code copied into this repository

When code is copied from the reference repositories below, its original
license and copyright are retained with the copied code, and the copy is
registered in `docs/attribution/SOURCE_PROVENANCE.md`:

- **OpenWorker** (https://github.com/andrewyng/openworker) — MIT License.
  Copied code must retain its copyright notice and the MIT license text.
- **openai/codex** (https://github.com/openai/codex) — Apache License 2.0.
  Copied code must retain the Apache-2.0 license, any `NOTICE` content,
  and a statement of modifications.

Note: the Apache-2.0 `openai/codex` open-source repository is **not** the
same thing as OpenAI's closed-source desktop client. No code, asset, copy
text, logo, font, or file name from any closed-source client may enter
this repository. See `docs/attribution/PRIVATE_RESEARCH_POLICY.md`.

## DeepSeek Harness

The Linguist native preset in `cordis.patch.yml` is adapted from DeepSeek
Harness 0.2.0-rc.2's standard preset. The role picker follows its native
AgentPresetSeat theme values and uses the public Menu component.
Source: https://github.com/deepseek-ai/deepseek-harness

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
