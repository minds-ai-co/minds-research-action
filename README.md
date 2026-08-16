# Minds Research Review for GitHub Actions

Run reviewable synthetic market research from a GitHub workflow with the hosted
[Minds MCP server](https://getminds.ai/mcp/setup).

The action can:

- list saved research audiences;
- prepare a non-executing structured study plan for review;
- ask one existing Group a respondent-visible question;
- retrieve Panel progress; and
- retrieve or refresh a Panel summary in the GitHub job summary.

`plan-study` is the default operation. It prepares a draft and does not start a
study. `ask-group` starts a private one-Group Panel and consumes the connected
Minds account's allowance.

## Quick start

Create a Minds API key under **Settings, API Keys**, then save it as the
`MINDS_API_KEY` repository or organization secret.

```yaml
name: Research review

on:
  workflow_dispatch:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: minds-ai-co/minds-research-action@v1
        with:
          api-key: ${{ secrets.MINDS_API_KEY }}
          operation: plan-study
          panel-id: ${{ vars.MINDS_PANEL_ID }}
          request: >-
            Prepare a concept test covering clarity, relevance, objections,
            credibility, and concrete improvements.
          stimulus-file: docs/proposed-homepage-copy.md
          stimulus-label: Proposed homepage copy
          study-locale: en
```

The complete result is available as `result-json`. Common identifiers and the
Minds result URL are also exposed as dedicated outputs. A readable result is
written to the GitHub job summary.

## Ask an existing audience

The `ask-group` operation starts asynchronous research. Keep the question free
of workflow or model instructions because it is respondent-visible.

```yaml
- id: minds
  uses: minds-ai-co/minds-research-action@v1
  with:
    api-key: ${{ secrets.MINDS_API_KEY }}
    operation: ask-group
    group-name: European B2B SaaS founders
    question: >-
      Review this positioning statement. What is clear, what is not credible,
      and what would make you consider a demo?

- run: echo "Panel ${{ steps.minds.outputs.panel-id }} was submitted"
```

Use a later workflow invocation with `get-panel-status` or `get-panel-summary`
to retrieve the durable result.

## Operations

| Operation           | Required inputs                        | Effect                                           |
| ------------------- | -------------------------------------- | ------------------------------------------------ |
| `list-groups`       | none                                   | Lists the authenticated account's saved Groups.  |
| `plan-study`        | `panel-id` or `panel-name`, `request`  | Creates a reviewable draft without executing it. |
| `ask-group`         | `group-id` or `group-name`, `question` | Starts a private asynchronous one-Group Panel.   |
| `get-panel-status`  | `panel-id` or `panel-name`             | Returns composition and current progress.        |
| `get-panel-summary` | `panel-id` or `panel-name`             | Reads or refreshes the semantic summary.         |

The action intentionally does not expose `run_panel_study` in version 1. A
structured study must be confirmed against an exact stored draft revision, and
that consequential confirmation should remain an explicit human decision.

## Inputs

See [action.yml](action.yml) for the complete input and output contract. Important
details:

- `stimulus` and `stimulus-file` are mutually exclusive.
- `stimulus-file` must remain within `GITHUB_WORKSPACE` and cannot exceed 20 KB.
- the endpoint must use HTTPS;
- only supported Minds locales are accepted by the server; and
- a result larger than 500 KB is not placed in a GitHub Actions output.

## Security

- Store the Minds API key in GitHub Actions secrets and pass it only through the
  `api-key` input.
- Do not use this action with `pull_request_target` to evaluate untrusted fork
  content while exposing repository secrets.
- Pin production workflows to a release tag or full commit SHA.
- The action masks the API key and does not place it in logs, outputs, summaries,
  or files.
- The action has no runtime dependencies and requests no GitHub token permission.

## Scope

Minds provides early, directional synthetic research. It does not replace
representative human fieldwork for high-stakes decisions. Review disagreement,
limitations, and evidence before acting on a result.

## Links

- [Minds](https://getminds.ai/)
- [MCP setup](https://getminds.ai/mcp/setup)
- [API overview](https://getminds.ai/api/overview)
- Support: developers@getminds.ai
