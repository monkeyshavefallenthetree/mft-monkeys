import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";
import { getAnalytics, type Analytics, isSupported } from "firebase/analytics";

export type FirebaseInit = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  analytics?: Analytics;
};

function readConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAszc76bGqYvAOSqZ5ZuxWDQNqdw8We2uc";
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "monkeys-have-fallen-tree.firebaseapp.com";
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "monkeys-have-fallen-tree";
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "monkeys-have-fallen-tree.firebasestorage.app";
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "585775814693";
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:585775814693:web:fdab2f5af6a0a1e39687cc";

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-YTQ38QQFEL",
  };
}

let cached: FirebaseInit | null | undefined;

/** Returns null when env is incomplete (show setup UI). */
export function getFirebase(): FirebaseInit | null {
  if (cached !== undefined) return cached;

  const config = readConfig();
  if (!config) {
    cached = null;
    return null;
  }

  const app = getApps().length === 0 ? initializeApp(config) : getApps()[0]!;
  const db = (() => {
    try {
      return initializeFirestore(app, {
        ignoreUndefinedProperties: true,
        experimentalAutoDetectLongPolling: true,
      });
    } catch {
      return getFirestore(app);
    }
  })();

  cached = {
    app,
    auth: getAuth(app),
    db,
  };

  if (typeof window !== "undefined") {
    isSupported().then((supported) => {
      if (supported && cached) {
        cached.analytics = getAnalytics(app);
      }
    });
  }

  return cached;
}

export function isFirebaseConfigured(): boolean {
  return readConfig() !== null;
}
