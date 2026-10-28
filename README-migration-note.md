# Layout and workflow fixes

All scenario folders now live under `scenarios/`, including imported Railway.
Scripts no longer discover `library/scenarios/`. Existing article templates stay
in `library/_templates/`; configuration/heuristic documentation stays under
`library/configurations/` and `library/heuristics/`.

Both scenario formats are supported:

- A native `README.md` with `id`, `title`, `description`, `tags`, `version` and
  `entrypoint` metadata, such as `scenarios/hello-world/HelloWorld.cradle`.
- An imported `index.md`/`index.mdx` article beside `scenario.cradle`, with the
  source README and supporting files preserved.

`index.md` takes precedence as the article when present. Native README metadata
still supplies its entrypoint. Website exports convert README articles into
`index.md`, remove source-only metadata and rename the exported source to
`scenario.cradle`. Missing native website fields use explicit defaults:
`source: Not documented`, `category: Community`, and a requirements pointer to
the README. Add those fields to your source article for more specific wording.

## Railway example

```powershell
npm ci
npm run library:new -- scenario railway-example --from "$HOME/Downloads/Railway"
# Complete scenarios/railway-example/index.md manually, or optionally run:
npm run library:describe -- railway-example --force
npm run catalog:update
npm run check
npm run library:validate -- --library .reference-cradle-lib --scenario railway-example
$env:SOURCE_REVISION = git rev-parse HEAD
npm run library:export-website
```

The import skips TOML and cache files, preserves nested configs/artifacts, and
does not alter Downloads. It never overwrites an existing scenario. LLM article
generation remains optional and uses the ignored `.env` file only when requested.
CLI imports and LLM generation refresh an existing root catalogue automatically.
After manual article edits, run `npm run catalog:update` before checking.

`catalog.json` lists all scenarios, including drafts with their draft flag.
`npm run library:catalog` writes the published-article catalogue to ignored `dist/`.
The compatibility command `python scripts/validate.py --update` updates the same
root catalogue; `--skip-cxc` explicitly limits that command to metadata/assets.

## GitHub Actions

`Validate scenarios` (`.github/workflows/validate.yml`) is the automatic source
validation pipeline. It runs tests and metadata/catalogue checks, installs
`cxc-core`, runs mandatory `cxc validate`, checks all config/heuristic references
against bundled content and cradle-lib, then uploads `website-scenarios`.
The copied `validate-sources.yml` remains a manual diagnostic workflow to avoid
two automatic full compiler jobs. `Check library contributions` still checks
metadata and tests on PRs.

After a successful push to `main`, `notify-website.yml` sends the source SHA and
run ID to `cradle-lang/cradle-lang.github.io`. Configure `WEBSITE_SYNC_TOKEN`
in **this repository's** Actions secrets with Contents write on the website.
Tokens and `.env` are never committed.

The website receiver must also be configured for this new source. The earlier
receiver was hard-coded to `mashmllo/scenario_library`; update its source-run
allowlist and importer to `cradle-lang/scenario-lib`, and its expected workflow
path to `.github/workflows/validate.yml`. Its read token must have Actions read
and Contents read access to `cradle-lang/scenario-lib`. Until that receiver change
is made, it will deliberately reject notifications from this repository.

The website review PR will contain only `scenario.cradle` and `index.md` inside
each `library/scenarios/<id>/`. Source files remain under this repository's
`scenarios/<id>/`. Supporting-file links point to the new repository at the
validated commit; draft flags remain unchanged. No live website update happens
while these changes are only local.
