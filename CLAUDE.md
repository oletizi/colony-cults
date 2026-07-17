<!-- SPECKIT START -->
Active plan: specs/013-archiveorg-acquisition-path/plan.md
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the active plan above.
<!-- SPECKIT END -->

## Commandments

- **All UX/UI work MUST go through `/frontend-design:frontend-design`. NO EXCEPTIONS.** Never off-road and implement design work without it. Any task that creates or reshapes user-facing UI (layout, components, visual design, typography, styling) begins by invoking the frontend-design skill — before writing markup or CSS. This is non-negotiable and overrides any inclination to "just quickly" build UI directly.
- **All access to external online sources MUST go through `/fetching-online-sources`. NO EXCEPTIONS.** Any HTTP request to a source repository or website whose content you will cite — discovery search, reconnaissance, metadata lookup, OCR read, or asset download — begins by invoking the fetching-online-sources skill, which mandates the shipped rate-limited `HttpClient` and raw-response persistence (constitution Principle XII). Never off-road with `curl`, `WebFetch`, or `WebSearch`-to-fetch-content against a source URL, even for a "quick public GET". This overrides any inclination to "just quickly" fetch something directly.
