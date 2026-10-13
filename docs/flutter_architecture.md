# Arquitectura de Android

Andes 0.5 usa MVVM por funcionalidad y Riverpod 3 (`NotifierProvider`), sin generación de código. Los widgets muestran datos y manejan navegación, animación y selecciones visuales locales; los controladores gestionan operaciones asíncronas y exponen estados inmutables.

```text
lib/
├── main.dart                  # Arranque y exports compatibles para herramientas
├── app/
│   ├── andes_app.dart          # MaterialApp y ProviderScope
│   ├── providers.dart         # Dependencias y propiedad de recursos
│   └── theme.dart             # Colores y estilos comunes
├── core/
│   ├── errors/                # Errores tipados de API
│   ├── network/               # Cliente HTTPS autenticado
│   ├── storage/               # Caché y recuperación de entradas
│   └── ui/                    # Componentes compartidos
├── data/
│   ├── models/                # Artículos, bloques y metadatos inmutables
│   └── repositories/          # API, configuración y guardados
└── features/
    ├── feed/                  # Feed, filtros visuales y tarjetas reutilizables
    ├── reader/                # Lectura y componentes multimedia
    ├── bookmarks/             # Estado y operaciones de guardados
    └── settings/              # Conexión y fuentes visibles
```

`main.dart` ya no realiza peticiones ni guarda datos. `FeedController`, `ReaderController`, `BookmarksController` y `SettingsController` acceden a interfaces de repositorio mediante Riverpod. El listado de guardados reutiliza las tarjetas y filtros del feed; sus datos tienen un controlador independiente. `data/repositories` combina servicios y almacenamiento; los widgets no reciben tokens ni instancias de SharedPreferences. Los archivos antiguos `news.dart`, `reader.dart` y `article_media.dart` son exports de compatibilidad, no implementaciones duplicadas.

El proveedor que crea `NewsService` libera su cliente al cerrar el contenedor. Un cliente o servicio inyectado conserva la propiedad de quien lo creó. El lector hereda las dependencias del feed a través del navegador, por lo que mantiene el mismo estado de guardados y conexión.

## Actualización desde 0.4

Se conservan `feed`, `saved`, `updated`, `sources`, `article:v3:<id>` y el token seguro `andesApiToken`. Se lee `summaryEndpoint` como compatibilidad; las nuevas escrituras utilizan `andesEndpoint`. No hay cambios en el paquete Android, firma de desarrollo ni contrato del backend.

La recuperación de feed, guardados y cada artículo es independiente. Una entrada corrupta se omite sin descartar las demás. Las listas de artículos, contenido y tablas, y los mapas/sets de estado, son copias no modificables. El cambio de fuentes filtra el feed sin eliminar los metadatos cacheados; las noticias guardadas siguen disponibles aunque se deshabilite su fuente.

## Concurrencia y errores

Actualizaciones simultáneas del feed con la misma conexión comparten una solicitud. Si cambian URL o credenciales, se invalida la respuesta anterior; solo la generación vigente actualiza estado y caché. Las escrituras del feed y de los guardados se serializan. Guardar/quitar una noticia mientras se descarga su cuerpo no permite que una respuesta tardía restaure el guardado.

El lector conserva la copia local cuando la API falla o la noticia ya no existe. Los errores distinguen configuración, autenticación, noticia inexistente, API incompatible, conexión, servidor y datos inválidos. La UI informa también de errores al guardar configuración o caché.

Los bloques pesados del lector se construyen cuando ListView los incorpora al viewport. Imágenes y videos se cargan desde la fuente y requieren conexión; no se añadieron descargas persistentes de multimedia. La refactorización no cambia la recopilación ni el modelo: esas tareas siguen en el backend.

## Verificación

```bash
flutter pub get
dart format --output=none --set-exit-if-changed lib test integration_test
flutter analyze
flutter test
flutter build apk --release --target-platform android-arm64
```

`test/architecture_test.dart` comprueba migración de datos, caché corrupta, concurrencia, errores, propiedad del cliente e inmutabilidad. `test/app_flow_test.dart` recorre feed → lector → español/original → guardados → ajustes con API y almacenamiento simulados. Las pruebas previas de widgets y tablas siguen activas.

El mismo flujo puede ejecutarse en un dispositivo conectado:

```bash
flutter test integration_test/app_flow_test.dart -d ID_DEL_DISPOSITIVO
```

El flujo usa dobles de API y almacenamiento y no escribe las credenciales reales del usuario. La ejecución en dispositivo comprueba el contenedor Android y los widgets; no certifica una conexión real con Ollama ni la reproducción de todos los formatos de video. Para estas últimas comprobaciones utiliza el APK de producción conectado al backend.

`.github/workflows/quality.yml` ejecuta formato, análisis y pruebas de Flutter y backend en cada push a `main`, pull request o ejecución manual. Fija Flutter 3.47.4 para coincidir con el SDK de desarrollo. Las pruebas físicas necesitan un dispositivo/emulador y se ejecutan por separado.

Referencias: [recomendaciones de KeepCoding](https://keepcoding.io/blog/buenas-practicas-en-flutter-apps-escalables/), [arquitectura oficial de Flutter](https://docs.flutter.dev/app-architecture/recommendations), [Riverpod](https://riverpod.dev/docs/introduction/getting_started) e [integration_test](https://docs.flutter.dev/testing/integration-tests).
