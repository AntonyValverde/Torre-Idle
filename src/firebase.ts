import { initializeApp, type FirebaseApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, linkWithCredential, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import type { Analytics } from 'firebase/analytics';
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
  // Solo en desarrollo con VITE_EMULATORS=1: usa los emuladores locales (no toca la base de datos real)
  if (import.meta.env.DEV && import.meta.env.VITE_EMULATORS === '1') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    const a = auth;
    // Simula vincular una cuenta de Google (el emulador acepta credenciales sin firmar)
    (window as unknown as Record<string, unknown>).__emuGoogle = (email: string) =>
      linkWithCredential(a.currentUser!, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));
  }
} else {
  console.warn('Firebase no configurado: faltan variables VITE_FIREBASE_*. Solo guardado local.');
}

type Params = Record<string, string | number | boolean>;

// La analítica se descarga aparte para no pesar en el arranque. Los eventos que llegan mientras
// tanto esperan en la cola (con tope) y se envían al cargar; si no hay analítica, se descartan.
let analytics: { a: Analytics; log: typeof import('firebase/analytics').logEvent } | null = null;
let queue: [string, Params | undefined][] | null = [];
if (app && firebaseConfig.measurementId) {
  const a = app;
  import('firebase/analytics')
    .then(async ({ getAnalytics, isSupported, logEvent }) => {
      if (!(await isSupported())) return;
      analytics = { a: getAnalytics(a), log: logEvent };
      for (const [name, params] of queue ?? []) track(name, params);
    })
    .catch(() => {})
    .finally(() => (queue = null));
} else {
  queue = null;
}

export function track(name: string, params?: Params) {
  try {
    if (analytics) analytics.log(analytics.a, name, params);
    else if (queue && queue.length < 30) queue.push([name, params]);
  } catch {
    /* la analítica nunca debe romper el juego */
  }
}
