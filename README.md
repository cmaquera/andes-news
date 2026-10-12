# Andes

Aplicación Android en Flutter para seguir programación y tecnología desde Perú y Latinoamérica. Versión 0.2: diseño adaptado de TrendSpot con fondo blanco, acentos celestes, noticias destacadas, miniaturas y navegación Inicio / Descubrir / Guardados / Ajustes.

## Funcionalidad

- Feed real de seis fuentes públicas, filtros por región y tema, búsqueda y enlace original.
- Más peso a fuentes de Perú y Latinoamérica dentro de cada día; primero se ordena por fecha. Clasificación por palabras clave, no por IA. La región identifica el origen editorial, no el país del evento.
- Guardados y última carga disponibles sin conexión. Si falla una fuente, conserva sus artículos anteriores y muestra el error.
- Titulares traducidos y resúmenes en español bajo demanda mediante Qwen3-4B-Instruct-2507 Q4_K_M. Se basan exclusivamente en el extracto RSS/API, no en el artículo completo. Sin extracto, traduce el titular y aclara la limitación. El teléfono y servidor conservan los resultados.
- Acceso al servicio de Andes mediante Bearer token, almacenado con Flutter Secure Storage en Android. Ninguna credencial está incluida en el APK.
- Miniaturas de las fuentes RSS/DEV cuando existen, con una ilustración del tema como alternativa.

## Ejecutar y compilar

Se requiere Flutter y Android SDK configurados.

```powershell
flutter pub get
flutter run
flutter build apk --release --target-platform android-arm64
```

El APK queda en `build/app/outputs/flutter-apk/app-release.apk`. ARM64 cubre teléfonos modernos; para otras arquitecturas usa `flutter build apk --release`. La firma actual es de desarrollo, adecuada para pruebas personales; antes de distribuir en Play Store hay que configurar una firma propia.

## Activar resúmenes

El feed funciona sin servidor. Para desplegar los resúmenes con tu Ollama en Dokploy, sigue [server/DEPLOY.md](server/DEPLOY.md). El contenedor llega a Ollama instalado en Ubuntu mediante `host.docker.internal:11434`, usando la red interna. No utiliza un dominio público ni una variable `OLLAMA_URL`. El modelo es `qwen3:4b-instruct-2507-q4_K_M`. No instala ni descarga modelos. Node.js 22 o superior ejecuta el servicio sin dependencias adicionales.

```powershell
# Para desarrollo local: guarda el token en tu gestor de contraseñas.
$env:ANDES_API_TOKEN = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
node server/summary.mjs
```

En desarrollo fuera de Docker, el servicio busca Ollama en `127.0.0.1:11434`. En el emulador Android, guarda `http://10.0.2.2:8787` y el token en Ajustes. En un teléfono físico, usa el dominio HTTPS del servicio de Andes y el mismo token. El contenedor usa `0.0.0.0` y un puerto interno configurable con `ANDES_PORT` (8787 por defecto); configura el mismo puerto en Domains de Dokploy. Ollama debe escuchar en la interfaz privada de Docker, siguiendo la guía, antes de retirar el dominio público anterior.

Contrato: `POST /summary`, con encabezado `Authorization: Bearer TOKEN` y JSON `{ "title": "...", "excerpt": "..." }`, devuelve `{ "titleEs": "...", "summary": "...", "basis": "excerpt", "cached": false }`. `GET /health` confirma que el servicio está vivo, no prueba Ollama. El servicio limita entrada, peticiones y concurrencia. Conserva hasta 500 resúmenes durante siete días, persistidos si `CACHE_FILE` está configurado. El teléfono transmite únicamente el título y extracto seleccionados, además del token de acceso.

## Verificación

```powershell
flutter analyze
flutter test
node --test server/summary.test.mjs
dart run tool/check_sources.dart
```

Pruebas de RSS/Atom, limpieza HTML, zona horaria, enlaces inseguros, fallos parciales, deduplicación y navegación en una pantalla de 390 × 844. Pruebas del cliente de resúmenes y token; del servidor con autenticación, concurrencia, JSON estructurado, caché persistente y errores. Las pruebas automáticas del servidor usan un generador simulado y no abren sockets. Aún no se ha probado la instalación en un teléfono físico.

La consulta real de esta versión recibió 84 publicaciones. La integración real con el modelo en tu dominio devolvió titular traducido y resumen estructurado en 6,94 segundos. Esto verifica Ollama; el despliegue del gateway de Andes en Dokploy queda pendiente.

Vistas exportadas en `preview/`: Inicio, Descubrir y Ajustes. Se renderizan con noticias reales y miniaturas de sustitución porque el entorno de pruebas bloquea la carga de imágenes remotas.

## Diseño y atribución

Interfaz adaptada de [TrendSpot News App](https://www.figma.com/community/file/1339560523860969699/trendspot-news-app), de [Hameed Shah](https://www.figma.com/@hameedshah), publicado bajo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Se modificaron marca, textos, navegación, temas, fuentes y pantallas de configuración para Andes. Se inspeccionó la vista pública de las páginas Cover y Design; no se importaron las capas originales ni se copiaron fotografías de ejemplo. La atribución también aparece en Ajustes.

## Fuentes y documentación

- [Gestión: RSS oficiales](https://gestion.pe/rss/), sección Tecnología, Perú.
- [Xataka México RSS](https://www.xataka.com.mx/rss2.xml), Latinoamérica.
- [Genbeta RSS](https://www.genbeta.com/rss2.xml), tecnología y desarrollo en español.
- [GitHub Changelog RSS](https://github.blog/changelog/feed/), actualizaciones de herramientas.
- [DEV / Forem API](https://developers.forem.com/api/v1), publicaciones con etiqueta `spanish`; esa etiqueta no garantiza idioma ni ubicación.
- [API oficial de Hacker News](https://github.com/HackerNews/API), hasta 40 historias principales filtradas por tema técnico.
- [Ollama: generación de respuestas](https://docs.ollama.com/api/generate).

## Pendiente

Desplegar Andes en Dokploy y restringir el acceso directo a Ollama; probar el APK en tu teléfono; ampliar fuentes peruanas de programación; mejorar clasificación y relevancia geográfica; añadir notificaciones y actualización en segundo plano. X/Twitter no está integrado. No hay cuenta, comentarios propios, extracción del texto completo, analítica ni traducción automática de todo el feed.
