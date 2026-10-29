# CRADLE Scenario Library

Contribute portable CRADLE scenarios with their configuration modules, heuristics,
scripts and artifacts to [cradle-lang/scenario-lib](https://github.com/cradle-lang/scenario-lib).
This repository provides import commands, article templates, optional LLM article
generation, catalogue checks, compiler validation and a website review handoff.

**All scenario folders live in `scenarios/`. Writing `index.md` yourself is the
default.** LLM generation is optional; manual contributions need no `.env`, API
key or LLM server. Validation does not deploy a cyber range or execute its assets.

## Repository layout

```text
scenario-lib/
  scenarios/
    hello-world/
      README.md
      HelloWorld.cradle
      configs/
      heuristics/
      objects/
    my-range/                 # Example imported scenario
      index.md
      scenario.cradle
      README.md
      configs/
      artifact/
  library/
    _templates/
    configurations/
    heuristics/
  scripts/
  .github/workflows/
  catalog.json
  package.json
  .env.example
```

The `library/` folder holds templates and optional configuration/heuristic
articles. Scenario discovery uses only `scenarios/`, not `library/scenarios/`.
Keep each scenario's supporting files inside its own folder.

## Contributor workflow

### 1. Prepare your checkout

Install Git, Node.js 22 or newer, and npm. You need a GitHub account to submit a
PR. A local CXC installation is needed only for actual compiler checks or builds;
the GitHub validation workflow installs it on the runner.

Fork the repository if you do not have write access, then clone your fork and
create a branch. Contributors with write access can clone the upstream instead.

```powershell
git clone https://github.com/YOUR-GITHUB-USERNAME/scenario-lib.git
cd scenario-lib
git switch -c add-railway-demo
npm ci
```

Run the commands below from the repository root unless otherwise stated.

### 2. Create or import a scenario

Create a draft from the template:

```powershell
npm run library:new -- scenario my-range
```

Or import Railway from Downloads:

```powershell
npm run library:new -- scenario railway-demo --from "$HOME/Downloads/Railway"
```

This creates `scenarios/railway-demo/`. The example uses a new ID because
`scenarios/railway/` may already exist. Folder IDs use lowercase letters, digits
and hyphens. Existing entries are never overwritten; edit them directly or choose
a different ID. The original Downloads folder is unchanged.

Scenario imports select:

- Top-level `.cradle` files, README, optional `index.md`/`index.mdx`, images and
  shell, PowerShell, batch, Python or JavaScript scripts.
- `config/`, `configs/`, `configuration/`, `configurations/`.
- `heuristic/`, `heuristics/`, `artifact/`, `artifacts/`.
- `script/`, `scripts/`, `img/`, `imgs/`, `image/`, `images/`.

Selected folders are copied recursively, including binary supporting files.
TOML files, `.git`, `node_modules` and `__pycache__` are skipped. Other top-level
files/folders are not imported. For example, add an `objects/` folder manually
if your scenario uses it. Symbolic links in selected content are rejected.

The source must contain `scenario.cradle` or exactly one top-level `.cradle`
file. The imported filename is preserved: `Railway.cradle` stays `Railway.cradle`.
If there are multiple specifications, the importer uses `scenario.cradle` as the
main specification. Authored README entrypoints and article links are preserved.
Only the website export uses the fixed filename `scenario.cradle` and adapts
article links for the website copy. The original source folder is left unchanged.

An existing article is preserved. Otherwise a draft `index.md` template is
created. Add `--mdx` to use MDX locally; convert it to `index.md` before website
export. Neither copying supporting files nor publishing an article installs
those dependencies on a backend.

### 3. Complete the source and article

Replace a template's comment-only `.cradle` stub with a complete specification.
For the imported example, edit `scenarios/railway-demo/index.md` yourself, or use
the optional LLM workflow below.

Fill in the article's front matter:

```yaml
---
title: Railway Demo
description: Describe what this scenario demonstrates.
source: Original author or organization
category: ICS
tags: [Railway, Training]
requirements: Document the backend, images, configs and artifact dependencies.
draft: true
---
```

All six descriptive fields are required for a published `index.md` scenario;
`tags` must be a non-empty list. Do not add `id` or `slug` to the article: the
scenario folder supplies the ID. Missing `draft` means published.

Complete the template sections with purpose, topology, exercise sequence,
requirements, setup, expected results, validation evidence, authorship and
licensing. Distinguish recorded tests from unverified behavior. Keep credentials
outside the folder and include only assets you can redistribute.

Retain the specification link and link relevant supporting files:

```markdown
[Download the specification](./scenario.cradle)
[Setup script](./scripts/setup.sh)
![Topology](./images/topology.png)
```

Optional artwork choices are `auto`, `network`, `enterprise` or `monitoring`.
A custom `thumbnail` must be a PNG/JPEG/WebP/GIF/SVG/AVIF inside the scenario and
needs `thumbnailAlt`. The LLM generator receives an explicit list of local
images and can select one as the thumbnail. If it omits a thumbnail, the generator
automatically picks a local image, preferring preview/thumbnail/cover/topology/diagram
filenames, then shallower paths and alphabetical order. A neutral alt label is
used because image contents are not inspected. Without images, built-in artwork
remains available. Website export uses built-in artwork rather than copying images.

Keep `draft: true` while preparing the article; change it to `draft: false` when
ready for website publication. Drafts remain in the root catalogue and undergo
compiler/dependency checks, but are excluded from the published-article catalogue.
Their required source file must still exist for catalogue and compiler checks.

### Native README scenarios

Existing scenarios can use metadata in `README.md` instead of an article, with a
named entrypoint such as `HelloWorld.cradle`:

```yaml
---
schema_version: 1
id: hello-world
title: Hello World
description: A portable example scenario.
tags: [Example, Ubuntu]
version: 0.1.0
entrypoint: HelloWorld.cradle
preview: preview.svg
---
```

The README `id` must match the folder, and `entrypoint` must stay inside it.
When an `index.md` article is also present, it takes precedence for article
content/metadata while the native metadata can still supply the entrypoint.

Website export converts a native README to `index.md` and exports the named
entrypoint as `scenario.cradle`. Add `source`, `category` and `requirements` to
the article/README for specific website metadata. If omitted from a native
README, export uses `Not documented`, `Community`, and a requirements pointer to
the source README. Source-only metadata such as `id` and `entrypoint` is removed
from the website article. A native `preview` is not a website thumbnail.

### 4. Update the catalogue and check locally

After manual metadata edits:

```powershell
npm run catalog:update
npm run check
npm run library:catalog
```

CLI imports and LLM generation refresh an existing root catalogue automatically.
`npm run check` validates articles, checks the root catalogue and runs the script
tests. It does not itself run CXC or a simulation.

| Output | Purpose |
| --- | --- |
| `catalog.json` | Tracked catalogue of all scenarios, including drafts and their entrypoints. Commit updates with your scenario. |
| `dist/catalog.json` | Generated catalogue of published articles, created by `library:catalog` and ignored by Git. |
| `scenario-output/` | Ignored compiler/reference reports and temporary output. |
| `website-export/bundle.json` | Ignored snapshot containing scenario file contents and a searchable metadata catalogue. |

Article checks cover folder structure, YAML, required metadata, duplicate resource
keys, published source presence, comment-only scenario stubs, download links,
ordinary inline Markdown file/image links and custom thumbnail paths. Local
article links must stay inside the entry; symbolic links are rejected. Review
reference-style links, MDX imports, external URLs, prose and licensing yourself.
MDX is never evaluated or rendered by these checks.

The Python compatibility command uses the same catalogue checker and requires
Node dependencies to be installed:

```powershell
python scripts/validate.py --skip-cxc
python scripts/validate.py --update --skip-cxc
```

Without `--skip-cxc`, it also runs `cxc validate` if CXC is installed. For complete
config/heuristic resolution against a shared library checkout, use the next command.

### 5. Validate with CXC and the shared libraries

With `cxc` on your PATH, clone the shared libraries or use existing checkouts:

```powershell
git clone https://github.com/cradle-lang/cradle-lib.git .reference-cradle-lib
git clone https://github.com/cradle-lang/cradle-lib-cve.git .reference-cradle-lib-cve
npm run library:validate -- --library .reference-cradle-lib --cve-library .reference-cradle-lib-cve --scenario railway-demo
```

Skip each clone if that folder already exists. Omit `--scenario railway-demo`
to check every scenario, including drafts. This command requires CXC and fails
if the compiler is unavailable. See the
[CradleXC installation guide](https://cradle-lang.org/docs/getting-started/install-cradlexc).

Validation runs `cxc validate -i <entrypoint>` for syntax and structure. It checks
literal config/heuristic calls in the source and recursive includes, ignoring
comments and quoted examples. Includes must stay inside the scenario folder.

Config lookup checks the scenario's `configs/`, `config/`, `configurations/`,
`configuration/` folders before `cradle-lib/configs/`. Each module needs a
non-empty `ansible/<name>.j2`, `.yml` or `.yaml` template. Legacy aliases and
compiler-provided `linux-routing`/`win-routing` configs are recognized.

Heuristic lookup checks local `heuristics/` then `heuristic/`, followed by
the shared library for its framework: CVE modules come from the root of
`cradle-lib-cve/`; TTP modules come from `cradle-lib/heuristics/ttp/`.
CVE lookup does not fall back to `cradle-lib/heuristics/cve/`.
Each referenced module needs a template and matching
`manifest.json`. The manifest's `framework`/`value` must match the path;
`os` and `os_version` must both be strings or both null/omitted. Any configs
listed by the manifest are checked through the same config lookup.

A malformed local module fails rather than silently falling back to a shared
one. Missing references, invalid manifests, and compiler errors fail validation.
Other scenarios are still checked. Results are written to
`scenario-output/validation.json` and `scenario-output/validation.md`, recording
the compiler version and source commits plus both shared library commits.

These checks do not render or execute Ansible templates, run entry scripts,
verify runtime images, provision infrastructure or execute events.

### 6. Submit a pull request

```powershell
git add scenarios/railway-demo/ catalog.json
git diff --cached
git status --short
git commit -m "Add railway-demo scenario"
git push -u origin add-railway-demo
```

Open a PR into `cradle-lang/scenario-lib`'s `main`. Include checks actually run
and state compiler/runtime checks not run. Resolve failing CI before merge.
Do not commit `.env`, `node_modules`, generated reports or the export bundle.

The [scenario PR template](.github/pull_request_template.md) fills in the PR
description automatically. Replace its placeholders with your scenario details,
record validation results and complete the submission checklist.

## Optional: generate index.md with an LLM

Skip this section if you prefer manual authoring. The generator follows the
remote-server configuration pattern used by
[CTI-demo](https://github.com/ChinJY/CTI-demo) and calls an OpenAI-compatible
Chat Completions endpoint. The selected scenario text is sent to that server.

Create `.env` beside `package.json` without overwriting an existing file:

```powershell
if (!(Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
notepad .env
```

Enter your connection details and full key locally:

```dotenv
SERVER="https://soclaas-api.comp.nus.edu.sg/v1"
REMOTE_LLM_MODEL="qwen3.6:35b"
REMOTE_LLM_API_KEY="your-key-here"
```

`.env` is ignored by Git; keep committed `.env.example` credentials blank.
Shell environment variables take precedence. The key can be empty only for a
server that permits unauthenticated access. If `REMOTE_LLM_MODEL` is omitted,
the first model returned by the server's `/models` endpoint is selected.

`SERVER` selects remote mode. Use the API base URL, including `/v1` if required
by your server. Generation uses `POST /chat/completions`; model discovery uses
`GET /models`. No Python backend or additional npm dependency is required.

Generate during a new import:

```powershell
npm run library:new -- scenario railway-ai --from "$HOME/Downloads/Railway" --generate-index
```

Or generate an article for the scenario imported in step 2:

```powershell
npm run library:describe -- railway-demo --force
```

When present, the imported README (including an extensionless `README`) is sent
to the LLM and prioritized after the CRADLE specification. The prompt asks the
model to use its purpose, setup, dependencies, usage, limitations and attribution
when writing `index.md`, and to flag conflicts with source files. README content
is subject to the same input limits as other files.

Imported authored articles are preserved during import. `--force` explicitly
allows the describe command to replace an existing article. Without it, existing
articles are preserved. Failed generation leaves copied source files and the
current article intact; invalid formatting/links get one correction attempt.

Generated articles always use `draft: true`. Review facts, dependencies, links,
validation claims and licensing before publishing. Text input is bounded by
`LLM_MAX_INPUT_CHARS` (default 100000); the command reports omitted/truncated
files. Binary/image contents are not sent; images are listed by filename only.
No scenario scripts are executed by generation.

TOML and hidden files are excluded from the text sent to the server. Individual
files may be truncated and large files omitted to fit the input limit. The
generator accepts introductory text, reasoning tags and Markdown wrappers around
an otherwise valid article. If formatting or local-link validation fails, it
requests one correction before reporting an error. The article is replaced only
after the generated output passes those checks.

For the connector's OpenAI mode, leave `SERVER` empty and set `OPENAI_API_KEY`
and `OPENAI_MODEL` in `.env`; `OPENAI_BASE_URL` is optional. Direct in-process
model loading with `LOCAL_LLM_MODEL` is not implemented. To use a local model,
serve it through an OpenAI-compatible endpoint and set `SERVER` to its base URL.

## GitHub Actions

| Workflow | Trigger and purpose |
| --- | --- |
| **Validate scenarios** | Pushes, PRs and manual runs. Installs `cxc-core`, checks metadata/catalogue/tests, runs mandatory compiler and dependency checks, and uploads a website snapshot only on success. |
| **Check library contributions** | PRs and pushes to `main`; checks articles/tests and uploads the published-article catalogue. |
| **Validate CRADLE sources, configs and heuristics** | Manual diagnostic workflow for a scenario/source revision; avoids a duplicate automatic compiler job. |
| **Validate and compile scenario** | Manual validation and compilation of a published scenario. Does not deploy it. |
| **Notify website after validated main update** | Runs after **Validate scenarios** succeeds on a push to the latest `main` revision; sends the website handoff notification. |

For a manual source check, open **Actions → Validate scenarios → Run workflow**
and enter a scenario ID or leave it empty for all scenarios. The workflow must
be committed to the default branch for manual dispatch to appear.

`scenario-validation` contains the compiler/reference reports. `website-scenarios`
contains the two-file snapshot and is retained for 14 days. Scenario failures
produce failed checks and reports; installation/setup failures appear in logs.
Use branch protection to require the relevant checks before merging.

### Optional compilation report

Open **Actions → Validate and compile scenario → Run workflow** and enter a
published scenario's folder ID and the committed source revision to compile
(a commit SHA is recommended; tags and branches are also accepted). The workflow
must exist on the default branch before manual dispatch is available.

The workflow loads tooling from the default branch and content from the selected
revision. It installs CradleXC from the project APT repository, runs `cxc validate`
and `cxc compile`, and records the source commit and compiler version in a success
summary. Compiler or installation errors appear in the failing step's log.

Compilation does not verify runtime images, configuration availability or artifact
access. Compiled YAML is temporary runner output and is not uploaded. Download
the specification and supporting files from the source repository.

With CradleXC, Node dependencies, Bash and Git installed, run the same compilation
locally from the repository root using a published scenario ID:

```sh
bash scripts/compile-scenario.sh my-range "$PWD" "$PWD/scenario-output"
```

## Website handoff after merging to main

The intended flow is:

1. Merge a scenario PR into this repository's `main`.
2. **Validate scenarios** checks every scenario, including drafts.
3. The validation run bundles every scenario in `scenarios/`, including drafts,
   except `validation-smoke-test`. Each entry contains its website `index.md`
   article and CRADLE source, exported as `scenario.cradle`. The excluded smoke
   test still runs through validation.
   Only after success, the notifier triggers the website with the validated SHA
   and run ID. Failed validation, stale revisions and PR-only runs do not hand off.
4. The website verifies/downloads the snapshot, checks its build and opens or
   updates a review PR. It does not merge or publish automatically.
5. Review and merge the website PR; its Pages workflow publishes non-draft entries.

```text
scenario-lib/scenarios/railway/
  scenario.cradle
  index.md
  configs/...
  artifact/...
          ↓ validated snapshot → website review PR
cradle-lang.github.io/library/scenarios/railway/
  scenario.cradle
  index.md
```

Each synced website folder contains exactly `scenario.cradle` and `index.md`.
`validation-smoke-test` is never included in the website bundle.
The JSON bundle keeps two arrays sorted by stable folder ID:

- `scenarios`: `{id, spec, article}`, the contents of the two website files.
- `catalog`: `{id, sourceUrl, title, description, source, category, requirements, tags, draft, searchText}`,
  for search results and filters without parsing Markdown or CRADLE.

Both arrays contain the same IDs, with one entry per scenario. The `catalog`
entry's `sourceUrl` links directly to the original scenario folder on GitHub,
for example `https://github.com/cradle-lang/scenario-lib/tree/<commit>/scenarios/railway`.
Use it for the website's GitHub/source link. The exported article front matter
contains the same URL, replacing stale authored source URLs. The commit in the
link matches the validated snapshot and provides access to supporting files.
The `catalog`
field is an additive extension to bundle schema version 1; the existing
`scenarios` records retain their original shape. Missing tags become `[]` and
missing draft flags become `false`. Display metadata preserves its case;
`searchText` combines the metadata, visible article text and CRADLE source,
normalized with Unicode NFKC, lowercase and collapsed whitespace. Link URLs
and the generated repository footer are not indexed.

The website receiver can save `catalog` as its search index and join matching
entries to `scenarios` by `id` when it needs the full files. For example:

```js
const terms = query.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
const results = bundle.catalog.filter(entry =>
  !entry.draft &&
  (!category || entry.category === category) &&
  (!tag || entry.tags.includes(tag)) &&
  terms.every(term => entry.searchText.includes(term))
);
const filesById = new Map(bundle.scenarios.map(entry => [entry.id, entry]));
```

The CRADLE contents and folder ID are preserved, including when a native named
entrypoint is exported. Native README articles are converted to the website
format. Supporting-file links point to the source commit, image embeds become
source-image links, and custom thumbnails are omitted. Draft flags remain intact.
An MDX article must be converted to `index.md` before export.

Other website entries are preserved. Removing a source scenario does not remove
an already merged website entry automatically. Merge a website PR to remove it
when required. New successful main updates refresh the same website review branch.

Preview the bundle locally without sending a notification:

```powershell
$env:SOURCE_REVISION = git rev-parse HEAD
npm run library:export-website
```

### One-time website integration setup

The website receiver must trust **`cradle-lang/scenario-lib`** and the source
workflow **`.github/workflows/validate.yml`**. If it still trusts the earlier
`mashmllo/scenario_library` repository, update both its run allowlist and bundle
importer before enabling this handoff.

| Repository | Actions secret | Required access |
| --- | --- | --- |
| `cradle-lang/scenario-lib` | `WEBSITE_SYNC_TOKEN` | Contents write on `cradle-lang/cradle-lang.github.io`, for repository dispatch. |
| `cradle-lang/cradle-lang.github.io` | `SCENARIO_LIBRARY_READ_TOKEN` | Actions read and Contents read on `cradle-lang/scenario-lib`, for run verification and artifact download. |
| Website, optional | `WEBSITE_PR_TOKEN` | Contents write and Pull requests write on the website, for the review PR. |

Configure these under **Settings → Secrets and variables → Actions** in the
named repositories. They are GitHub credentials, separate from the LLM `.env`.
Do not commit their values. With the receiver's built-in `GITHUB_TOKEN` fallback,
enable bot-created PRs in the website's Actions settings; GitHub may require
approval to run checks on those PRs. The optional PR token supports automatic CI.

Merge/configure the website receiver before activating source notifications.
To retry, rerun the notification workflow or use the website receiver's manual
run with a successful source-main validation run ID. The run must still match
source `main` and have an unexpired bundle; revalidate if the bundle expired.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Import says the entry exists | Edit the existing folder or choose a new ID; imports never overwrite it. |
| Catalogue is stale after editing | Run `npm run catalog:update`, then `npm run check`. |
| CXC is unavailable locally | Install it for real compiler checks, or use the GitHub validation Action. `npm test` alone does not prove source syntax is valid. |
| Missing config or heuristic | Check exact names and the required bundled/shared module templates and manifests. |
| LLM generation fails | Check `.env`, endpoint/model access and API response; retry with `library:describe -- <id> --force`. |
| MDX export fails | Convert the article to `index.md`. |
| Website rejects a handoff | Check the trusted source repo/workflow, GitHub token permissions, validated main SHA and artifact expiry. |
| A synced entry is hidden | Review its `draft` flag and the website PR/build/deployment status. |

## Configuration and heuristic articles

Optional standalone documentation entries use the existing template commands:

```powershell
npm run library:new -- configuration my-config
npm run library:new -- heuristic my-heuristic
```

Use `--from <directory>` to import existing configuration or heuristic content.
These imports retain the source contents except TOML files, `.git`, `node_modules`
and `__pycache__`; selected symbolic links are rejected. They do not require a
`.cradle` file. An existing `index.md`/`index.mdx` is preserved; otherwise the
command supplies a draft template. Use `--mdx` for an MDX article. Existing entries
are never overwritten.

These articles live in `library/configurations/` and `library/heuristics/`, not
in the scenario directory. Configuration metadata needs `config` and `os`
(`Linux`, `Windows`, `Cross-platform` or `Unspecified`). Heuristic article
metadata needs `framework` and `identifier`. Both need a title and description.
Implementation modules used by a scenario belong in its `configs/` or
`heuristics/` folder, or in cradle-lib; a documentation article alone does not
make a module available to CXC. The scenario website handoff exports scenarios,
not these standalone resource articles.
