# Minasaty System Map

**Repository:** `azzouchy12-bit/Minasaty`  
**Purpose:** Centralized architecture reference for future precise, low-context edits.  
**Scan scope:** `package.json`, Prisma schemas, root and `docs/` Markdown documentation, `server.js`, route/controller/service hierarchy, middleware, and supporting utilities.  
**Scan date:** 2026-08-30

## 1. High-level system overview

Minasaty is an Arabic online tutoring platform for mathematics and physics. It combines a server-rendered/static frontend in `public/` with a Node.js CommonJS backend. The backend exposes REST APIs through Express, persists application state with Prisma/PostgreSQL, and uses Socket.io for WebRTC signaling, classroom collaboration, private messaging, notification refreshes, and public-class workflows. WebRTC media itself is peer-to-peer; the server relays signaling messages rather than transporting the audio/video stream.[1][2]

The product supports public registration, parent and teacher accounts, student enrollment and identity documents, subscriptions and payment receipts, live classes, attendance, lesson repositories, assignments, assessments, grades, progress tracking, certificates, referrals, browser push, Telegram, Facebook Messenger, SMS hooks, YouTube uploads, Google Drive video selection, and a public free-class room. The primary runtime entry point is `server.js`; the frontend is served directly from `public/` by the same Express process.[2]

| Layer | Implementation | Main locations |
|---|---|---|
| Runtime | Node.js `>=20.18.0`, CommonJS | `package.json`, `server.js` |
| HTTP/API | Express 4, CORS, Helmet, JSON parsing, rate limiting | `server.js`, `routes/`, `middleware/` |
| Persistence | Prisma Client 6 with PostgreSQL datasource | `prisma/schema.prisma`, `lib/prisma.js` |
| Realtime | Socket.io 4; optional Redis adapter | `server.js`, `utils/socketNotifications.js` |
| Frontend | Static HTML/CSS/vanilla JavaScript pages | `public/` |
| Uploads | Multer; binary files may be stored in DB or filesystem depending on feature | `routes/studentRoutes.js`, `routes/academicRoutes.js`, `UPLOAD_DIR` |
| External services | SofizPay, YouTube/Google APIs, Telegram Bot API, Meta Graph API, SMS provider, optional Facebook relay | `controllers/paymentController.js`, `services/`, `facebook-relay/` |
| Operations | Background interval jobs, backups, audit logs, health endpoints | `utils/backgroundJobs.js`, `utils/backup.js`, `server.js` |

### Runtime lifecycle

At startup, `server.js` loads `.env`, configures Helmet and CORS, installs request metrics and JSON parsing, mounts the REST routers, serves static assets, creates Socket.io and the `/private-messages` namespace, wires notification/session-takeover callbacks, optionally configures Redis scaling, starts background jobs, listens on `PORT`, and optionally configures the Telegram webhook. Production startup first validates `DATABASE_URL`, `JWT_SECRET`, `TEACHER_PASSCODE`, and `CLIENT_ORIGIN`.[2][3]

The `npm start` script additionally runs `prisma db push --skip-generate --accept-data-loss`, the referral-level migration script, and class-registry seeding before starting the server. This is operationally significant: it is not a pure process launch and can mutate schema/data at deployment time.[1]

## 2. Database schema

The active `prisma/schema.prisma` declares a PostgreSQL datasource and contains **no Prisma enum declarations**. Workflow states, roles, subject identifiers, repository types, and payment statuses are represented as strings with application-level defaults and validation. `prisma/schema.postgresql.prisma` is a smaller PostgreSQL schema artifact; it is not equivalent to the active full schema and should not be copied over without understanding the loss of models. The Arabic README still describes a temporary SQLite workflow, so the README and active schema are inconsistent; treat the active schema and deployment notes as authoritative for the current branch.[3][4]

### Identity, access, and audit

| Model | Role in the system | Key relationships/constraints |
|---|---|---|
| `Student` | Central learner record: name, parent phone, level, enrollment, payment/access state, notes, card and receipt state | Parent of attendance, messages, documents, sessions, audits, notifications, payments, grades, submissions, attempts, progress, learning path, badges, and participation; unique `(studentName, parentPhone, level)` |
| `ParentCredential` | Parent account keyed by phone; PIN lifecycle and optional BaridiMob, Telegram, and Messenger linkage | Parent of reset requests, one `ReferralProfile`, and one `MessengerLink` |
| `Session` | Server-side session record associated with JWT `tokenId` | Optional student relation; tracks role, subject, device metadata, expiry, revocation, and last-seen time |
| `PasswordResetRequest` | Parent forgot-PIN workflow and teacher-issued temporary PIN tracking | Cascades from `ParentCredential` |
| `AuditLog` | Security and operational audit trail for actor, action, entity, metadata, IP, and user agent | Optional `Student`; student deletion sets the relation null |
| `StudentDocument` | Database-backed student documents such as card/receipt binaries | Unique `(studentId, kind)`; cascades with student |

Authentication is role-based (`teacher`, `parent`, and student-facing access represented through parent-owned student records). JWTs are checked against the `Session` table by `utils/sessionAuth.js`; `verifyToken` then applies role and ownership checks, forced PIN-change handling, and optional Messenger-link enforcement through `middleware/authMiddleware.js`.[2][5]

### Academic and classroom entities

| Model | Purpose |
|---|---|
| `ScheduledClass` | Planned class by level, subject, time/month, status, Drive link, optional YouTube video, and notes |
| `TeacherAbsence` | Per-level absence state keyed by `level`; `server.js` and schedule controllers also expose global absence behavior |
| `Attendance` | Student attendance sessions and duration |
| `ClassParticipation` | Per-student/session participation count and microphone seconds |
| `LiveQuestionImage` | Uploaded question image used during live interaction |
| `Material` | Legacy/standalone level-scoped material record with a file URL |
| `LessonVideo` | Lesson repository entry with Drive identity/URL and `repositoryType` such as `MATH`, `PHYSICS`, `FREE`, or `PAID` |
| `LessonProgress` | Unique student/video watch state, duration, completion, and timestamps |
| `Assignment` | Level/subject homework with optional file and instruction-image payloads |
| `AssignmentSubmission` | Unique student submission per assignment, with answer/file, receipt state, grade, and teacher note |
| `Question` | Question bank item with serialized options/answers and difficulty/type |
| `Assessment` | Published level/subject assessment with optional time limit |
| `AssessmentQuestion` | Composite-key assessment/question join table with order and points |
| `AssessmentAttempt` | Unique student attempt per assessment, serialized answers, score, and completion state |
| `LearningPathItem` | Student-specific ordered TODO/in-progress/completed learning item |
| `StudentBadge` | Student achievement with unique `(studentId, code)` and optional image bytes |
| `Grade` | Student score by subject/category/title and maximum score |
| `Certificate` | Referenced by certificate controller/routes; verify against the active schema before future edits because it is not present in the scanned 727-line `schema.prisma` model list |

`academicController.js` is the largest academic domain controller. It aggregates grades, assignments and binary downloads, submissions and grading, question/assessment flows, progress, notifications, teacher announcements, analytics, audit access, and bulk student updates. It also exports the scheduled announcement processor and a Socket.io notification-sender setter.[6]

### Payment, referrals, and notifications

| Model | Purpose |
|---|---|
| `PaymentEvent` | Append-only-ish student payment-stage history with amount, note, receipt document, and actor metadata |
| `PaymentTransaction` | Internal electronic-payment order, provider identifiers, subscription type, amount/currency, status, URLs, provider payload, and verification timestamps |
| `Notification` | In-app recipient notification with read state, link, and optional unique dedupe key |
| `NotificationCampaign` | Teacher announcement campaign filters, scheduling, channel counts, status, and error state |
| `PushSubscription` | Web Push endpoint and keys keyed by recipient role/id and optional session |
| `ReferralProfile` | Parent referral code and referring parent relationship |
| `ReferralCommission` | Level-aware commission earned from referred subscriptions, optionally attached to a withdrawal |
| `ReferralWithdrawal` | BaridiMob withdrawal request, review/payment state, and related commissions |

### Integration and public-room entities

| Model | Purpose |
|---|---|
| `MessengerLink` | Parent-to-Meta-Page linking state, PSID, expiring state/fallback hashes, and interaction timestamps |
| `MessengerWebhookEvent` | Idempotency ledger for received Meta webhook events |
| `MessengerSettings` | Singleton-like Messenger safety, quota, retry, interval, and linking policy configuration |
| `MessengerQuota` | Per-page/per-day attempted, sent, failed, skipped, and paused counters |
| `PublicRoomArchive` | Archived public room metadata, recording, attendee count, and chat archive |
| `PublicRoomAttendance` | Guest attendance/approval/leave records for public rooms |
| `AnalyticsEvent` | Event-type analytics with optional student, level, subject, and serialized value |
| `YouTubeCredential` | Singleton encrypted YouTube OAuth access/refresh credential and expiry timestamp |

Most foreign keys use `onDelete: Cascade` for student-owned data. The notable exceptions are `AuditLog.student` (`SetNull`) and `ReferralCommission.withdrawal` (`SetNull`). Important composite uniqueness rules include student/video progress, assignment/student submissions, assessment/student attempts, assessment/question membership, student/session participation, parent/document kind, and page/date Messenger quotas.[4]

## 3. REST routing and controller hierarchy

`server.js` mounts thin route modules under `/api`. Routes generally apply `verifyToken` and then `isTeacher`, parent ownership, or a feature-specific role guard before delegating to controllers. The exact endpoint families are summarized below.[2][7]

| Mount | Route/controller responsibility |
|---|---|
| `/api/auth` → `authRoutes`/`authController` | Teacher and parent login, logout, session status/list/revocation, parent PIN changes, forgot-PIN requests, teacher issuance of temporary PINs |
| `/api/students` → `studentRoutes`/`studentController` | Public registration; parent student lookup; teacher roster, identity-card review, receipt review, contact/subscription updates, replacement uploads, and deletion |
| `/api/attendance` → `attendanceRoutes`/`attendanceController` | Student attendance retrieval |
| `/api/live-chat` → `liveChatRoutes`/`liveChatController` | Live question-image upload and retrieval; broader live chat signaling is in `server.js` |
| `/api/schedules` → `scheduleRoutes`/`scheduleController` | Calendar export, class registry, scheduled-class CRUD, global/level absence |
| `/api/lesson-videos` → `lessonVideoRoutes`/`lessonVideoController` | Level repository list, teacher create, teacher delete; access is filtered by level, subject enrollment, and payment/repository type |
| `/api/youtube` → `youtubeRoutes`/`services/youtubeService` | Teacher YouTube status/OAuth connect/callback/list/upload; upload handling can attach a video to a scheduled class and repository |
| `/api/messages` → `messageRoutes`/`messageController` | Authenticated conversations, unread counts, student-scoped message list/send/read state; realtime transport uses `/private-messages` |
| `/api/academic` → `academicRoutes`/`academicController` | Grades, assignments/files/submissions, progress, payments history, assessments, questions, notifications, announcements, analytics, audit logs, bulk updates |
| `/api/materials` → `materialRoutes`/`materialController` | Teacher material creation and level-scoped retrieval/file download |
| `/api/certificates` → `certificateRoutes`/`certificateController` | Certificate list/image retrieval and teacher create/delete; schema alignment should be checked before modifying |
| `/api/payments` → `paymentRoutes`/`paymentController` | SofizPay webhook, parent start/reconcile/status, teacher electronic-payment list/reconcile/dismiss |
| `/api/referrals` → `referralRoutes`/`referralController` | Parent referral summary, BaridiMob details, balance/withdrawal; teacher referral activity and withdrawal review |
| `/api/messenger` → `messengerRoutes` + `messengerService` | Teacher settings/students/campaigns, parent link status/start/unlink, Meta webhook verification and ingestion |
| `/api/telegram` → `telegramRoutes` + `telegramService` | Parent Telegram status/link/unlink and bot webhook |
| `/api/push` → `pushRoutes`/`pushController` | VAPID public key, subscription create, subscription delete |
| `/api/site-analytics` → `siteAnalyticsRoutes`/`siteAnalyticsController` | Rate-limited public visit recording |

Additional direct routes in `server.js` provide Google Picker configuration for teachers, basic and detailed health checks, teacher-only database backup, public-class status/archive access, and a Facebook-relay session endpoint. Static pages are served from `public/`; `/public-class.html`, `/teacher-chat`, and `/student-chat` also have explicit send-file routes.[2]

## 4. Core modules

### Authentication and authorization

`authController.js` implements teacher login using `TEACHER_PASSCODE` and parent login using phone plus PIN. Parent login returns the parent’s available students and referral context. `sessionAuth.js` issues HS256 JWTs with issuer/audience claims while persisting the active session in Prisma; it supports takeover notifications, last-seen updates, expiry, and revocation. `authMiddleware.js` resolves the session on every protected request and can require a parent PIN change or linked Messenger account.[5]

The Socket.io private-message namespace independently authenticates the handshake token. Teachers join a shared `teacher` room; parents may join only a room for a student whose `parentPhone` matches the decoded parent phone. Classroom control events separately revalidate teacher sessions, rather than trusting mutable socket role state.[2]

### Messenger notifications

`services/messengerService.js` is a Meta Messenger integration with environment-derived Page configuration. It provides secure parent linking through `m.me` state values and numeric fallback codes, verifies webhook tokens/signatures, tracks idempotent webhook events, records last interaction times, sends Graph API messages with retry/rate-limit handling, and maintains daily quotas/settings. `academicController.js` uses this service alongside browser notifications, Web Push, Telegram, and SMS for teacher campaigns. `NotificationCampaign` records channel outcomes and scheduled delivery state; `utils/backgroundJobs.js` processes scheduled campaigns.[6][8]

Messenger enforcement is disabled by default through `ENFORCE_PARENT_MESSENGER_LINK=false`. When enabled, protected parent routes and relevant Socket.io flows can require a `LINKED` `MessengerLink` before platform/class access. This is a deliberate operational gate and should not be enabled until the linking flow is validated end-to-end.[2][3]

### YouTube and Google Drive video integration

`services/youtubeService.js` manages YouTube OAuth, encrypts stored access/refresh tokens with AES-256-GCM using a key derived from `YOUTUBE_TOKEN_ENCRYPTION_KEY` or `JWT_SECRET`, stores one credential row, lists channel uploads, and uploads videos as unlisted and embeddable. `youtubeRoutes.js` restricts management to teachers except for the OAuth callback. The upload flow can associate the official video with the nearest scheduled class and insert it into the lesson repository during the configured recording window.[9]

The teacher dashboard’s current Google Drive flow uses Google Identity Services and Drive API v3 rather than the failing Google Picker builder. It requests `drive.file` and `drive.metadata.readonly`, displays Drive video metadata, and saves the selected link/metadata without proxying video bytes through Railway.[10][11]

A documented YouTube embedding issue is associated with `referrerPolicy`: the production server uses `strict-origin-when-cross-origin`, and the iframe should retain a valid origin/referrer policy. Do not treat ordinary YouTube playback as proof that embedding is allowed; `status.embeddable` and the final iframe configuration remain the authoritative checks.[12]

### SofizPay gateway

`paymentController.js` implements the electronic-payment state machine. A parent starts a payment for a supported subscription product, creating a local `PaymentTransaction` with an internal order ID and expected amount. The provider order/transaction identifiers and raw provider payload are persisted. Reconciliation and webhook paths verify the provider transaction server-side, validate amount and receiving account, apply idempotency, mark the transaction paid, update student subscription/live-access fields, append a `PaymentEvent`, award eligible referral commission, and send operational notifications.[13]

The official SofizPay flow documented in repository notes uses payment-link or CIB transaction endpoints, a return URL, optional webhook URL, and a transaction-check endpoint. Success must be confirmed server-side rather than inferred from a browser redirect. The transaction check uses the provider order number and documents success indicators including `orderStatus: 2` and `respCode: "00"`; operation details is a fallback when an operation UUID must be resolved.[14]

The three documented fixed products are `MATH` for 1,030 DZD, `PHYSICS` for 1,030 DZD, and `BOTH` for 2,030 DZD. These values are product configuration, not a reason to perform a live payment during development or future edits. Never expose the encrypted merchant secret or webhook secret to the frontend.[13][14]

### Teacher and student/parent dashboards

The static dashboards in `public/` consume the REST APIs and Socket.io events. The teacher dashboard manages roster and identity review, subscriptions and receipts, schedules and absences, lesson repositories, Google Drive/YouTube content, academic records, announcements, referrals, live classrooms, and operational views. The parent dashboard selects among the parent’s students and presents schedule/registry, attendance, repository access, assignments, assessments, progress, grades, certificates, notifications, payment, referrals, and messaging. Student-facing live and chat pages are separate static entry points and are intentionally excluded from some landing-page widgets.

The academic data path is student-centric: `Student` is loaded with relationships or queried through controllers, while access decisions are applied by role, parent phone ownership, level, subject enrollment, and payment/repository type. The lesson repository supports `MATH`/`PHYSICS` for secondary levels and `FREE`/`PAID` for university-level flows, as recorded in the integration notes.[6][10]

### Live classroom and public class

The main Socket.io engine in `server.js` maintains process-local classroom state for active rooms, teacher/student presence, WebRTC signaling, attendance, participation, whiteboard events, chat, and class control. Public rooms add guest name validation, teacher approval before WebRTC/microphone/chat access, archive records, attendance, and chat capture. The optional `facebook-relay/` service receives authenticated WebM chunks over WebSocket and forwards them to Facebook Live through FFmpeg/RTMPS.[2][15]

Because live room state is process-local, the deployment notes recommend one application replica unless shared state and a properly coordinated Socket.io adapter are introduced. `REDIS_URL` enables the Socket.io Redis adapter for cross-instance messaging, but it does not automatically make every classroom-state structure shared.[16]

## 5. Background jobs and operational utilities

`utils/backgroundJobs.js` runs a minute-level scheduler that sends class reminders approximately one hour before classes, produces weekly parent reports, deletes expired sessions, reconciles SofizPay transactions, and processes scheduled teacher announcements. `utils/backup.js` supports the teacher-only JSON database snapshot endpoint; `utils/audit.js` centralizes audit logging; `utils/metrics.js` records request/socket metrics; `utils/push.js` sends Web Push; `utils/publicArchive.js` persists public-room archives; and `utils/referral.js` contains referral calculations/migration support.[2][16]

The global Express error handler creates an incident ID, logs a sanitized audit record, avoids returning stack traces/database details, and returns a localized 500 response. Health endpoints are `/api/health` and teacher-protected `/api/health/detailed`; the latter checks Prisma connectivity and reports whether the Facebook relay is configured.[2]

## 6. Entry points and critical environment variables

### Application entry points

| Entry point | Function |
|---|---|
| `server.js` | Express/Socket.io bootstrap, route mounting, static serving, classroom engine, startup/shutdown |
| `lib/prisma.js` | Shared Prisma Client singleton |
| `routes/*.js` | HTTP boundary and authorization composition |
| `controllers/*.js` | Domain operations and Prisma writes/reads |
| `services/*.js` | External-service adapters and notification transports |
| `public/*.html` and `public/js/*.js` | Static user interfaces for landing, registration, parent, teacher, student, live, chat, and university flows |
| `scripts/check-syntax.js` | Low-cost syntax validation |
| `test/*.test.js` | Node test-runner smoke and behavior tests |
| `facebook-relay/server.js` | Optional separately deployable RTMPS relay |

### Environment variable checklist

| Variable/group | Required or optional | Use |
|---|---|---|
| `NODE_ENV`, `PORT` | `NODE_ENV` required for production behavior; `PORT` platform-provided | Runtime mode and listener port |
| `DATABASE_URL` | Required in production | Prisma PostgreSQL connection |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | `JWT_SECRET` required; expiry configurable | Session-backed JWT signing and nominal token lifetime |
| `TEACHER_PASSCODE` | Required in production | Teacher login credential |
| `CLIENT_ORIGIN`, `ENABLE_OPEN_CORS` | `CLIENT_ORIGIN` required; open CORS discouraged | Browser origin allowlist and prototype escape hatch |
| `UPLOAD_DIR` | Optional locally; production deployment should set it to persistent volume path | Filesystem uploads |
| `SOFIZPAY_BASE_URL`, `SOFIZPAY_ACCOUNT`, `SOFIZPAY_ENCRYPTED_SECRET_KEY`, `APP_BASE_URL`, `SOFIZPAY_WEBHOOK_SECRET` | Payment integration configuration | Payment URL generation, server-side verification, return/webhook security |
| `GOOGLE_PICKER_API_KEY` | Required for teacher picker configuration endpoint | Browser-restricted Google Drive selection configuration |
| YouTube OAuth and storage variables | Required only for YouTube feature: client ID/secret, redirect URI as implemented, and `YOUTUBE_TOKEN_ENCRYPTION_KEY` or fallback `JWT_SECRET` | OAuth, token encryption, upload/list operations |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | Optional | Parent linking, admin/parent notifications, webhook |
| Meta Messenger variables | Optional until configured: `META_APP_ID`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_MESSENGER_PAGE_NAME`, `META_PAGE_MME_NAME`, `ENFORCE_PARENT_MESSENGER_LINK` | Parent linking, webhook verification, campaigns, optional access gate |
| SMS variables | Optional: `SMS_PROVIDER`, `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_CLIENT_ID`, `SMS_CLIENT_SECRET`, `SMS_TOKEN_URL` | Provider-specific announcement delivery |
| `REDIS_URL` | Optional | Socket.io Redis adapter; absent means single-instance mode |
| `FACEBOOK_RELAY_URL`, `RELAY_JWT_SECRET` | Optional | Public-class Facebook relay integration |

Production deployment notes recommend Railway PostgreSQL, a persistent volume mounted at `/data/uploads`, `UPLOAD_DIR=/data/uploads`, a strict `CLIENT_ORIGIN`, and no committed `.env`, uploads, tokens, or generated database files. The current active schema is PostgreSQL even though the Arabic README describes a local SQLite preview; verify schema selection before any deployment change.[3][4]

## 7. Safe future-editing rules

Treat `server.js` as the integration spine and avoid broad edits to it when a route/controller/service-level change is sufficient. For data changes, inspect both the active Prisma schema and every controller that reads/writes the model, then preserve relation deletion behavior and composite uniqueness. For authentication changes, trace `authController.js` → `sessionAuth.js` → `authMiddleware.js` and separately trace Socket.io handshake authorization. For payment changes, preserve internal-order/provider-ID mapping, server-side verification, amount/account validation, idempotency, and entitlement updates. For notification changes, preserve dedupe keys, channel quotas, recent-interaction rules, and scheduled-job behavior. For live-room changes, account for process-local state and the one-replica deployment assumption.

Do not run `npm start` merely to inspect the code: it performs database push, migration, and seeding. Low-cost validation is `npm run check`, targeted `node --check`, or the existing `npm test` suite after a requested edit. Before editing certificate functionality, reconcile the apparent `Certificate` controller/schema mismatch. Before replacing either Prisma schema file, compare all models and datasource assumptions.

## References

[1]: `package.json` — runtime, scripts, dependencies, and deployment lifecycle  
[2]: `server.js` — application bootstrap, REST mounts, Socket.io, live rooms, startup, and shutdown  
[3]: `.env.example` and `RAILWAY_DEPLOYMENT.md` — environment and deployment requirements  
[4]: `prisma/schema.prisma` and `prisma/schema.postgresql.prisma` — datasource, models, fields, relations, indexes, and defaults  
[5]: `controllers/authController.js`, `middleware/authMiddleware.js`, `utils/sessionAuth.js` — authentication/session implementation  
[6]: `controllers/academicController.js` — academic domain, announcements, notifications, analytics, and audit behavior  
[7]: `routes/*.js` — endpoint declarations and authorization composition  
[8]: `services/messengerService.js` — Meta linking, webhook, quota, retry, and sending implementation  
[9]: `services/youtubeService.js` and `routes/youtubeRoutes.js` — YouTube OAuth and upload integration  
[10]: `docs/google-picker-debug-status.md` and `docs/lesson-repository-access-test.md` — Drive picker and repository behavior  
[11]: `docs/google-picker-integration-notes.md` — Google API scopes and browser integration notes  
[12]: `youtube-error153-findings.md` — embedding/referrer-policy diagnosis  
[13]: `controllers/paymentController.js` and `routes/paymentRoutes.js` — local payment state machine and endpoint wiring  
[14]: `sofizpay-integration-notes.md` and `sofizpay-official-docs-findings.md` — SofizPay endpoint and verification findings  
[15]: `facebook-relay/README.md` — optional Facebook RTMPS relay architecture  
[16]: `RAILWAY_DEPLOYMENT.md` and `utils/backgroundJobs.js` — scaling and scheduled-job operational notes
