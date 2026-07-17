<!-- SPECKIT START -->
Active plan: specs/014-source-query-client/plan.md
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the active plan above.
<!-- SPECKIT END -->

## Commandments

- **All UX/UI work MUST go through `/frontend-design:frontend-design`. NO EXCEPTIONS.** Never off-road and implement design work without it. Any task that creates or reshapes user-facing UI (layout, components, visual design, typography, styling) begins by invoking the frontend-design skill — before writing markup or CSS. This is non-negotiable and overrides any inclination to "just quickly" build UI directly.
- **Every query against an external online source MUST go through `/fetching-online-sources`. NO EXCEPTIONS.** Any query to a source repository or website whose content you will cite — discovery search, reconnaissance, metadata lookup, OCR/content read, or checking whether a source holds something — begins by invoking the fetching-online-sources skill, which mandates ONE sanctioned mechanism: a governed real-browser session (Playwright MCP) with raw-page persistence before analysis (constitution Principle XII). Never off-road with `curl`, `WebFetch`, `WebSearch`-to-fetch-content, the raw `HttpClient`, or an ad-hoc/ungoverned browser call against a source URL — even for a "quick public GET", even when a source seems walled, even when a browser seems like overkill. If the mechanism seems not to fit a case, fix the skill; never improvise a side channel.
