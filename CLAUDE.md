<!-- SPECKIT START -->
Active plan: specs/014-source-query-client/plan.md
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the active plan above.
<!-- SPECKIT END -->

## Commandments

- **All UX/UI work MUST go through `/frontend-design:frontend-design`. NO EXCEPTIONS.** Never off-road and implement design work without it. Any task that creates or reshapes user-facing UI (layout, components, visual design, typography, styling) begins by invoking the frontend-design skill — before writing markup or CSS. This is non-negotiable and overrides any inclination to "just quickly" build UI directly.
- **Every query against an external online source MUST go through `/fetching-online-sources`. NO EXCEPTIONS.** Any query to a source repository or website whose content you will cite — discovery search, reconnaissance, metadata lookup, OCR/content read, or checking whether a source holds something — begins by invoking the fetching-online-sources skill, which mandates ONE sanctioned mechanism: the shipped `bib query-source` CLI client, which persists the raw page before returning, grounds every cited fact in the persisted bytes, paces and bounds the query, and gates exit-node escalation behind explicit operator approval (all enforced in code, constitution Principle XII). Never off-road with `curl` or shell HTTP, `WebFetch`, `WebSearch`-to-fetch-content, the raw `HttpClient`, or any ad-hoc/ungoverned browser call against a source URL — including driving the Playwright MCP browser directly for sources the client already supports — even for a "quick public GET", even when a source seems walled, even when a browser seems like overkill. The Playwright MCP browser remains only a governed manual fallback for sources not yet registered as a SourceConfig. If the mechanism seems not to fit a case, fix the skill; never improvise a side channel.
