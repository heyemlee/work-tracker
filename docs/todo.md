# To do

Work that is deferred or not done yet. Decisions and their reasons live in [design.md](design.md).

## On hold (decided 2026-09-24)

- [ ] **Workers Paid ($5/month).** Staying on the free plan for now. The free plan allows 10 ms of CPU per
      request; measured in production, API requests take 2–13 ms. They succeed today, but Cloudflare doesn't
      promise that.
- [ ] **Milestone 4: agent v1.** Paste a recruiting email → classify it, match the application, update it;
      anything ambiguous goes to a review queue. An eval set of about 100 synthetic emails picks the cheapest
      model that reaches 97% accuracy. Needs an Anthropic API key, and Workers Paid for the CPU and
      subrequest limits.
- [ ] **Milestone 5: Gmail sync.** Read-only OAuth per account; sync on open and every 30 minutes.
- [ ] **Milestone 6 (optional).** Conversational queries over the data.

## Waiting on the owner

- [ ] Make the GitHub repository public, so the README and the code can back the portfolio.
- [ ] GitHub Actions has never run the CI workflow: check that Actions is enabled for the repository.

## Backlog

- [ ] Split the bundle (537 kB, 170 kB gzipped): lazy-load the settings dialog and the tweak panel.
- [ ] Playwright tests for the core flows: sign-in screen, quick add, stage change.
- [ ] Keep the scripts that captured the README screenshots and animation in the repository, so the media can
      be regenerated after UI changes.
