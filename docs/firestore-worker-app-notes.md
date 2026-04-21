# Firestore: worker portal assumptions

The worker Next app (`mft-monkeys`) uses the same Firebase project as `mft-admin-dashboard`. Collections and main behaviors:

| Collection | Worker usage |
| ---------- | ----------- |
| `workers/{uid}` | Read/update own profile (`expectedSalary`, `lastLogin`, `currentLoginTime`, `isOnline`, `lastLogout`). Document id = Auth uid. |
| `workSessions` | Create/update own sessions: `workerId`, `date` (YYYY-MM-DD), `startTime`, `loginTime`, `isActive`, `totalWorkTime`, etc. |
| `alerts` | Read where `recipients` **array-contains** uid. Update own read state (`isRead`, `readBy` with `arrayUnion`). |
| `exceptionRequests` | Create docs with `workerId`, `workerName`, `workerEmail`, `type`, `reason`, `createdAt`, etc. List own via `workerId == uid` (prefer `orderBy('createdAt','desc')`; app falls back without composite index). |
| `tasks` | Read tasks assigned via `assignedTo` array-contains uid or `assignedTo == uid` (legacy string). Create/update tasks (team self-service) with same field shapes as legacy dashboard. |
| `projects` | Read for task creation / grouping. |

## Security rules

Production rules must allow authenticated workers to perform the above without exposing admin-only data. Start from:

`mft-admin-dashboard/docs/firestore-rules-recommended.rules`

Extend with **least privilege**, for example:

- **`workers`**: a user may read/update only `workers/{userId}` where `request.auth.uid == userId` (field-level validation optional for sensitive fields).
- **`workSessions`**: create/update where `request.resource.data.workerId == request.auth.uid`; reads scoped to own `workerId` (and any rules needed for admin reporting).
- **`alerts`**: read if uid in `recipients`; update only safe fields (e.g. `isRead`, `readBy`) for documents where uid is in `recipients`.
- **`exceptionRequests`**: create with `workerId == request.auth.uid`; read/list own `workerId`.
- **`tasks` / `projects`**: read rules for assigned workers; **writes** for task create/update must match your product policy—if workers should create tasks, allow creates/updates only when `createdBy` / `assignedTo` includes the uid or similar. If rules block writes, update rules in Firebase Console; code cannot bypass them.

## Indexes

- `exceptionRequests`: composite `workerId` + `createdAt` (desc) if you use server-side ordering (recommended).
- `workSessions`: composite `workerId` + `date` for the “today’s session” query (app has a fallback path if missing).
