# Legacy worker HTML (reference)

These files are the pre–Next.js worker UI. Use them to verify **behavior parity** with the React app:

| File | Purpose |
| ---- | ------- |
| `index.html` | Login, worker doc checks (`pending` / `rejected`), last login / online flags |
| `worker-register-firebase.html` | Registration + `workers/{uid}` document shape |
| `worker-dashboard-firebase.html` | Dashboard: profile, `workSessions`, alerts, exceptions, tasks/projects |

The Next app intentionally **does not** replicate the legacy dashboard’s insecure “guess password from localStorage” auth path—only Firebase Auth is used.
