import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfig.apiKey || !firebaseConfig.appId || !firebaseConfig.projectId) return null;
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export async function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (!firebaseConfig.measurementId) return null;
  const app = getFirebaseApp();
  if (!app) return null;
  return (await isSupported()) ? getAnalytics(app) : null;
}
