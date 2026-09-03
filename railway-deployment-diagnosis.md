# Railway deployment diagnosis

Date observed: 2026-08-18 UTC.

Project: Railway project `a8120ac3-4ed5-4686-979b-3a279ddd13dc`, environment `79b191ff-1213-4343-b8ee-1b6218ab95f2`, service `Minasaty`, domain `dr.africacold.fr`.

Observed live page before recovery: `https://dr.africacold.fr/student-live.html` served `rotate-pan-8`, with no `Final portrait order` marker and no `body > #chat-compose-modal` marker. Local `origin/main` was commit `86399a9`, intended cache marker `rotate-pan-12`.

Railway deployment UI showed the active deployment `Reset zoom and stabilize landscape stream layout` (old active version), while later deployments were stuck in `BUILDING` or `QUEUED`/waiting for build slot. Old queued/building deployments were removed/aborted with user confirmation. A redeploy of the active service was started, but Railway still showed a public incident and the new redeploy remained queued/initializing.

Official incident URL: https://status.railway.com/incident/YYU63JUO
Incident title: `Deployments are slow to progress`
Status observed: `Degraded Performance`, `Investigating`.
Incident text: Railway was aware of an issue causing deployments to remain in an initializing state longer than expected; users may experience delays in new deployments progressing. Timestamp shown: August 18, 23:19 UTC.

After starting redeploy and waiting, live page still served `rotate-pan-8`; the new deployment was still queued/waiting for build slot. This indicates the remaining blocker was Railway deployment infrastructure, not the project CSS/DOM code.

Relevant local code status: latest `origin/main` commit `86399a9` titled `Arrange portrait viewer into display chat and controls rows`. The intended portrait override is `grid-template-rows: minmax(0, 1fr) 400px auto` with areas `video`, `chat`, `divider`, and the intended modal root CSS uses `body > #chat-compose-modal`.

Source: Railway status incident page above; Railway project dashboard/service deployment UI; live HTML curl checks to `https://dr.africacold.fr/student-live.html` with cache-busting query strings.
