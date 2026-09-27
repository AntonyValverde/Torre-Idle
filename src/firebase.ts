import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAnalytics, isSupported, logEvent, type Analytics } from 'firebase/analytics';
import { ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Sin configuración el juego sigue funcionando, pero solo con guardado local.
export const cloudEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
export let auth: Auth | null = null;
export let db: Firestore | null = null;

if (cloudEnabled) {
  app = initializeApp(firebaseConfig);
  // App Check (opcional): con una clave de reCAPTCHA v3, Firebase solo acepta peticiones de esta web,
  // no de scripts externos que usen tu configuración para llenar el ranking de trampas.
  const recaptchaKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (recaptchaKey) {
    if (import.meta.env.DEV) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(recaptchaKey), isTokenAutoRefreshEnabled: true });
  }
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  console.warn('Firebase no configurado: faltan variables VITE_FIREBASE_*. Solo guardado local.');
}

let analytics: Analytics | null = null;
if (app && firebaseConfig.measurementId) {
  const a = app;
  isSupported()
    .then((ok) => {
      if (ok) analytics = getAnalytics(a);
    })
    .catch(() => {});
}

export function track(name: string, params?: Record<string, string | number | boolean>) {
  try {
    if (analytics) logEvent(analytics, name, params);
  } catch {
    /* la analítica nunca debe romper el juego */
  }
}
