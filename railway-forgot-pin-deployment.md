# Forgotten PIN deployment status

Latest Git commit: `ce3c1f7` — `Add secure forgotten parent PIN workflow`.

Railway project/service: Minasaty / `dr.africacold.fr`.

Observed after opening the service dashboard on 2026-08-19:

- Previous deployment `Add teacher electronic and manual payment tabs` is ACTIVE and marked Deployment successful.
- New deployment `Add secure forgotten parent PIN workflow` is in BUILDING (about 4 minutes old at observation), with progress text: Taking a snapshot, building image, publishing image, waiting for dependencies, migrating volume, running pre-deploy, creating containers, tidying previous deployments.
- A prior old deployment `Reset zoom and stabilize landscape stream layout` is FAILED from a long build and is historical; it is not the current blocker.
- Railway banner no longer showed the earlier incident in the captured page, but new deployment was still building.

The new schema uses the existing start command `npx prisma db push --skip-generate`, so the new ParentCredential fields and PasswordResetRequest table should sync during deployment startup once the build completes.

The live site was not rechecked after the new build began; until this deployment becomes ACTIVE, the public site remains on the prior deployed code.
