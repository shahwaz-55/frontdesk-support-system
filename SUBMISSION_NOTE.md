# Submission note — what is not finished

The agent-facing ticket workflow, PostgreSQL schema, atomic claim operation, internal-note separation, audit history, and working-hours SLA helper are implemented in this handoff.

The following are intentionally not finished:
- **Live hosting and the one-week uptime window:** these require deployment access to a hosting provider and a managed PostgreSQL account owned by the submitter. No credentials or hosting account were provided, so I have not claimed a live URL.
- **Customer portal, customer authentication, email delivery, and attachments:** the brief asks for a simple screen for support agents; these are outside the agent-facing MVP delivered here.
- **Complete festival calendar:** the schema supports configurable holidays, but Arvo's actual holiday list was not supplied. Add the correct dates to `holidays` before relying on production SLA dates.
- **Priority-change policy:** the assignment leaves this unanswered. I chose to reset unmet targets from the time the priority changes and documented that assumption in the README.

The backend SLA unit tests pass. A frontend production build could not be verified in this environment because dependency installation did not complete; run `npm install && npm run build` in `frontend` before deployment.
