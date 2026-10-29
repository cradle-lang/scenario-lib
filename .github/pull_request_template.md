<!-- Suggested PR title: Add <scenario-id> scenario (or Update <scenario-id> scenario).
Replace the placeholders below. Check only items you have completed and mark
unneeded fields as N/A. Record checks you did not run, including the reason. -->

## Scenario

- **Scenario ID:** `<scenario-id>` (for example, `railway-demo`)
- **Folder:** `scenarios/<scenario-id>/`
- **Main CRADLE file:** `<scenario.cradle or named entrypoint>`
- **Change:** New scenario / Update to an existing scenario
- **Publication status:** Draft / Ready for website publication

## Summary

Describe what the scenario demonstrates, its intended audience and learning
objectives. For updates, explain what changed and why.

## Included files and requirements

List the specification and supporting configs, heuristics, scripts, images and
artifacts. Describe the topology, supported backend/testbed, required images,
external dependencies and any setup needed to reproduce the exercise.

## Validation

Record actual results, failures or reasons for skipping each check. Keep runtime
evidence separate: repository checks and compilation do not deploy a cyber range
or execute its assets.

| Check | Result / evidence / reason not run |
| --- | --- |
| `npm run catalog:update` | |
| `npm run check` | |
| `npm run library:catalog` | |
| CXC and dependency validation (command below) | |
| Compilation, if run | |
| Runtime exercise, if run (backend/version and observed results) | |

```sh
npm run library:validate -- --library .reference-cradle-lib --cve-library .reference-cradle-lib-cve --scenario <scenario-id>
```

<!-- The command requires CXC and local shared-library checkouts. Adjust their
paths as needed. If relying on GitHub CI, say so and link the run when available.
Include compiler/library versions or revisions with validation evidence. -->

## Submission checklist

- [ ] The scenario and its supporting files are inside `scenarios/<scenario-id>/`, and the main CRADLE file contains a complete specification.
- [ ] The article (`index.md`) or native `README.md` documents purpose, topology, setup, requirements and expected results.
- [ ] Metadata and local file links follow the [contributor workflow](../README.md#3-complete-the-source-and-article).
- [ ] For an article, `draft: true` is retained while preparing it, or `draft: false` is set when ready for publication (N/A for a native README).
- [ ] `catalog.json` is refreshed and included if changed.
- [ ] Validation results above distinguish completed checks from unverified behavior.
- [ ] Original authors and redistribution licenses are documented for included code and assets.
- [ ] The diff excludes credentials, `.env`, `node_modules`, generated reports and website export bundles.

## Known limitations or reviewer notes

Describe unresolved issues, unavailable dependencies, expected failures or areas
that need particular review. Write `None` if there are none.
