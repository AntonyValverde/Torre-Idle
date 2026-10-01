# Torre Idle

Juego idle/clicker para móvil (PWA) con minijuegos. Está hecho con React, Vite y TypeScript, usa Firebase (Auth anónima, Firestore y Analytics) y se despliega en Vercel.

## Minijuegos

| Juego | Entrada | Premio |
|---|---|---|
| 🌃 **Apagón diario**: enciende todas las ventanas | Gratis, uno al día | Gemas, racha y ranking del día |
| 🛣️ **Conecta las calles**: gira tramos hasta unir las casas con el ayuntamiento | Gratis, uno al día | Gemas, racha y ranking del día |
| 🎡 **Rueda de la fortuna** | 1 giro gratis al día, luego 🎟️ | Monedas, gemas, boosts o edificios raros |
| 🦹 **Atrapa al ladrón**: 30 s de reflejos | 🎟️ | Monedas y gemas |
| 🏗️ **Stack Tower**: apila pisos | 🎟️ | Monedas y boost de producción |
| 🚦 **Semáforo**: cambia el semáforo sin que choquen los coches | 🎟️ | Monedas y boost de producción (se multiplica con el de Stack) |
| 🧠 **Memoria de ventanas**: repite la secuencia de luces | 🎟️ | Monedas y hasta 4 🎟️ (sin pasar del máximo) |
| 🧱 **Fusión** (tipo 2048) | 🎟️ | Gemas y edificios raros |
| 📈 **Bolsa de la ciudad** | Libre | Ganancias que no cuentan para estrellas ni rankings |

Los dos retos diarios generan el mismo tablero para todos a partir de la fecha. En Semáforo, un coche que espera demasiado en rojo pierde la paciencia y se lo salta, así que no se puede dejar el semáforo fijo.

## Progresión (sin final)

- **Ciudad animada**: se dibuja en canvas a partir de tus edificios y sigue la hora real (día, atardecer y noche).
- **16 edificios**. Los 6 últimos se desbloquean en eras avanzadas.
- **Hitos infinitos**: cada edificio produce x2 al llegar a 25, 50, 100… y después cada 100, sin límite.
- **Eras y prestigio**: al refundar la ciudad ganas ⭐ estrellas de legado (raíz cúbica de lo ganado en total) que dan +3% de producción cada una. Se gastan en el árbol de legado, que tiene niveles infinitos.
- **Logros infinitos**: 15 categorías sin nivel máximo. Cada logro da +2% de producción y gemas.
- **Decretos del consejo**: cada pocos minutos eliges entre dos ventajas (festival, lotería, horas extra…).
- **Boosts combinables**: fuentes distintas se multiplican entre sí; la misma fuente solo se alarga.
- Los números usan K, M, B… y luego aa, ab, ac… hasta ~1e308.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests de la lógica (economía y minijuegos)
npm run build    # build de producción en dist/
```

La configuración de Firebase está en `.env.local`, que no se sube al repositorio. `.env.example` sirve de plantilla.

## Configurar Firebase (una sola vez)

En la [consola de Firebase](https://console.firebase.google.com/project/game-f5ffa):

1. **Authentication → Sign-in method**:
   - Activa **Anónimo** (obligatorio: así juega cualquiera sin registrarse).
   - Activa **Google** (para el botón "Vincular con Google" del perfil).
   - En **Settings → Authorized domains**, añade tu dominio de Vercel (por ejemplo `torre-idle.vercel.app`).
2. **Firestore Database → Crear base de datos** en modo producción.
3. **Reglas de Firestore**: copia el contenido de `firestore.rules` en la pestaña *Reglas* y publícalas. También puedes hacerlo desde la terminal:
   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules
   ```

## Desplegar en Vercel

1. Sube el proyecto a GitHub.
2. En Vercel, **Add New → Project** e importa el repositorio. Vercel detecta Vite automáticamente.
3. En **Settings → Environment Variables**, añade las 7 variables `VITE_FIREBASE_*` de `.env.local`.
4. Pulsa **Deploy**. Cada `git push` vuelve a desplegar.

## Seguridad

### Qué protege el juego
- **Reglas de Firestore** ([firestore.rules](firestore.rules)):
  - Cada jugador solo puede leer y escribir sus propios datos.
  - Solo el servidor pone las marcas de tiempo.
  - El progreso total no puede bajar: un dispositivo con una partida vieja no sobrescribe la buena, y el juego carga la más avanzada.
  - Las puntuaciones tienen límites realistas y solo pueden subir, con un máximo de una subida cada 5 s.
  - Los nombres solo aceptan letras, números y `_ . -`.
  - Los retos diarios solo admiten resultados del día actual y con tiempos humanos.
- **Reloj de confianza**: se ancla a la hora del servidor y nunca retrocede con el juego abierto, así que cambiar la hora o la zona horaria del móvil no da ventaja.
- **Guardado robusto**:
  - Hay una copia de seguridad local, y una partida corrupta se aparta sin borrarla.
  - Solo puede haber una pestaña abierta a la vez.
  - No se sube nada a la nube hasta haber leído la nube.
  - Si la interfaz falla, aparece una pantalla de error que guarda la partida.
- **Bolsa**: tiene un límite de inversión, y sus ganancias no cuentan para estrellas ni rankings.

### Pruebas de las reglas
`npm run test:rules` ejecuta [tests/firestore.rules.test.mjs](tests/firestore.rules.test.mjs) contra el emulador local de Firestore, sin tocar la base de datos real. Son 48 casos, permitidos y de ataque. Necesita Java instalado.

### Pasos recomendados en la consola (una vez)
1. **Restringir la API key**:
   - Dónde: Google Cloud Console → APIs y servicios → Credenciales → *Browser key (auto created by Firebase)*.
   - Qué hacer: en *Restricciones de aplicaciones*, elige *Sitios web* y añade `https://TU-DOMINIO.vercel.app/*`, `http://localhost:5173/*` y `https://game-f5ffa.firebaseapp.com/*`.
   - Resultado: la clave solo funciona desde tu web.
2. **App Check** (opcional, frena bots que llenen el ranking):
   - Crea una clave de reCAPTCHA v3.
   - Regístrala en Firebase → App Check.
   - Pon `VITE_RECAPTCHA_SITE_KEY` en Vercel.
   - Cuando veas que el tráfico está verificado, activa *Aplicar* para Firestore.
3. **Google en iPhone** (Safari bloquea el inicio de sesión si el dominio de autenticación es otro). [vercel.json](vercel.json) ya redirige `/__/auth/*` a Firebase. Para usarlo:
   - En Vercel, pon `VITE_FIREBASE_AUTH_DOMAIN=TU-DOMINIO.vercel.app`.
   - En Google Cloud → Credenciales → *Web client (auto created by Google Service)* → *URIs de redireccionamiento autorizados*, añade `https://TU-DOMINIO.vercel.app/__/auth/handler`.
4. **Cabeceras**: [vercel.json](vercel.json) incluye una política CSP en modo *solo informe*.
   - Después de publicar, abre la consola del navegador (F12) y juega un rato.
   - Si no aparece ningún aviso `Content-Security-Policy`, cambia `Content-Security-Policy-Report-Only` por `Content-Security-Policy` para aplicarla.

### Límites conocidos
El juego corre en el navegador del jugador, así que alguien con conocimientos puede modificar su propia partida. Las reglas bloquean lo imposible y lo que afecta a otros jugadores, pero no pueden verificar que una puntuación "posible" se consiguió jugando. Para eso haría falta validar en servidor con Cloud Functions (plan Blaze).

## Estructura

```
src/
  game/          economía, estado, store (zustand), reloj del servidor, nube y rankings
  minigames/     stack/ y traffic/ (canvas), merge/ (2048), daily/ (Apagón), roads/ (Calles),
                 memory/, thief/, wheel/, stocks/
  ui/            pestañas, barra superior, modales, globo dorado
firestore.rules  seguridad: cada jugador solo escribe lo suyo; los rankings solo suben
```

## Datos en Firestore

| Ruta | Contenido |
|---|---|
| `users/{uid}` | partida guardada (solo la lee y escribe su dueño) |
| `leaderboards/{stack\|merge\|city\|stars\|thief\|traffic\|memory}/scores/{uid}` | mejor puntuación de cada jugador |
| `daily/{AAAA-MM-DD}/scores/{uid}` | resultado del Apagón diario (un intento registrado) |
| `roads/{AAAA-MM-DD}/scores/{uid}` | resultado de Conecta las calles (un intento registrado) |

La partida se guarda en `localStorage` cada 5 s y en Firestore cada 60 s, y también al minimizar la app. Las ganancias offline y los tickets usan la hora del servidor, así que adelantar el reloj del móvil no da ventaja.

> Las puntuaciones las envía el cliente. Las reglas bloquean los valores imposibles y la escritura en datos ajenos, pero no un tramposo decidido. Para validar en servidor hacen falta Cloud Functions (plan Blaze).
