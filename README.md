# MFT Worker Portal (`mft-monkeys`)

Next.js (App Router) worker portal: login, registration, and dashboard with Firebase Auth + Firestore. Replaces the legacy HTML pages (kept under `legacy/` for reference). UI uses a shared **WorkerAuthShell** (gradient + glass card), a **3-step registration** flow with password strength, and a **dashboard** with welcome stats, session chip, and tab badges (including unread alerts).

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and set all `NEXT_PUBLIC_FIREBASE_*` variables from your Firebase project (same app as admin dashboard).
3. `npm run dev` — runs on **port 3002** (avoids clashes with `modern-site` :3000 and `mft-admin-dashboard` :3001).

## Scripts

- `npm run dev` — development on port 3002
- `npm run build` — production build
- `npm run start` — start production server on port 3002
- `npm run lint` — ESLint

## Routes

| Path           | Description        |
| -------------- | ------------------ |
| `/`            | Worker login       |
| `/register`    | Worker registration |
| `/dashboard`   | Authenticated dashboard (profile, time, tasks, alerts, exceptions) |

## Task photos

Optional filenames on tasks resolve to `NEXT_PUBLIC_TASK_PHOTOS_BASE/<filename>` or `/photos/<filename>` in this app. Add images under `public/photos/` if you use local files.

## Firestore

See `docs/firestore-worker-app-notes.md` for collections and suggested security rules alignment.

## Legacy HTML

The original static pages live in `legacy/` — see `legacy/README.md`.
