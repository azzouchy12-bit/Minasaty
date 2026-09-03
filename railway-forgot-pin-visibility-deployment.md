# Forgot PIN visibility fix deployment

Latest Git commit: `d6d9c0a` — `Show forgotten PIN requests in teacher dashboard`.

Observed Railway state after opening the service dashboard:

- `ce3c1f7` — `Add secure forgotten parent PIN workflow` is ACTIVE and Deployment successful.
- `d6d9c0a` — `Show forgotten PIN requests in teacher dashboard` is BUILDING with progress through snapshot, image build, publishing, dependencies, migration, and container creation.

Local tests passed before push: JavaScript syntax checks, Prisma validation using a PostgreSQL-shaped DATABASE_URL, 3 project tests, and git diff check.

This commit adds:
- academic-level aliases in the teacher forgot-PIN API (short and long level labels both match);
- a 15-second polling refresh for open requests;
- a red badge count on the teacher tab;
- refresh of the list after issuing a temporary PIN.

The live site should be rechecked after `d6d9c0a` becomes ACTIVE.
