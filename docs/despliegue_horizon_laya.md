# Integración Horizon + Laya: uso y despliegue

Backend 0.5.0 y Android 0.6.0. La activación es opcional mediante `compose.intelligence.yaml`; usar solo `compose.yaml` conserva el procesamiento por reglas. Durante esta sesión se construyeron los servicios en Ubuntu y se inició el piloto en sombra; consultar [el informe de validación](validacion_horizon_laya.md) para su estado y límites.

## Componentes entregados

- Adaptador Python sobre Horizon, fijado al commit `8f5446bf45c2d7763d17423d97d17906add85da1`, con diez tipos de fuente, texto nativo y comentarios separados.
- Cola de entrega SQLite propia del adaptador; confirma lotes completos, conserva rechazos y reintenta entregas sin cambiar el ID del lote.
- Listener privado de Andes en 8788, con token distinto al móvil, sin puerto publicado al host. Solo Node escribe `andes.db`.
- Tablas aditivas para lotes, apariciones y última evaluación editorial. Los IDs y el contenido antiguo siguen disponibles. El cuerpo de un mensaje editado invalida su abstracto anterior y vuelve a la cola.
- Cliente HTTP de Laya 0.4.11, modelo multilingüe explícito, pesos revisados según el manifiesto de ese paquete. Clasifica por ventanas de 2500 bytes y utiliza todas las partes del texto recuperado. La caché depende del texto completo, la rúbrica y la revisión declarada. La relevancia de la rúbrica v2 usa categorías `software`, `ai` y `other`, tras detectar fallos con la pregunta binaria inicial en pruebas reales.
- Score `0..10` separado de votos; rúbrica inicial `0.40 relevancia + 0.25 contenido técnico + 0.20 evidencia + 0.15 utilidad`. No está calibrada todavía con etiquetas humanas. La novedad se trata mediante deduplicación, sin prometer un estimador de novedad histórica.
- Duplicados por URL, texto idéntico y, opcionalmente, pares semánticos de títulos parecidos. Solo compara representantes preparados/aceptados de las últimas 72 horas, hasta 100. Evita pares con versiones distintas. La comparación semántica utiliza fragmentos acotados; es conservadora y puede dejar duplicados sin detectar, especialmente entre idiomas.
- Flutter consulta `/sources`, conserva el catálogo en caché y mantiene fuentes desactivadas por el usuario. Las nuevas se habilitan inicialmente. Muestra puntuación y motivos cuando la evaluación acepta la noticia; distingue mensajes/releases de artículos web. El feed conserva el límite actual de 200 entradas por consulta.

La extracción y los resúmenes de artículos web conservan el flujo de Andes. Un extracto RSS o una descripción de Google News no se presenta como artículo completo. La versión inicial todavía no incluye un digest equilibrado por cuotas ni un panel gráfico de revisión: la operación y evaluación se hacen por API privada y scripts.

## Configurar las diez fuentes

Copiar `services/horizon_bridge/sources.example.json` a `services/horizon_bridge/sources.json`. El archivo de trabajo está excluido de Git. Contiene ejemplos de fuentes públicas y lugares reservados para las selecciones que aún no se han definido.

| Tipo en `sources` | Qué definir | Configuración inicial |
| --- | --- | --- |
| `hackernews` | Número de historias y score social mínimo; comentarios de Horizon | Activado, 30 historias inspeccionadas, mínimo 0 para que el filtro editorial vea candidatos |
| `rss` | Una entrada con nombre y URL por feed | GitHub Changelog y Genbeta; las seis fuentes antiguas siguen en el recopilador de Andes |
| `reddit` | `subreddits`, `users`, límites y `fetch_comments` | Desactivado, pendiente de listas |
| `telegram` | `channels`, cada uno con `channel` sin `@` y `fetch_limit` | Desactivado, pendiente de canales públicos |
| `twitter` | `users`, `keywords`, `APIFY_TOKEN`, límites de replies | Desactivado, pendiente de cuentas/búsquedas y credencial; el adaptador usa Apify |
| `github` | Entradas `user_events` con `username` o `repo_releases` con `owner` y `repo` | Lista vacía; no confundir con GitHub Changelog RSS |
| `openbb` | `watchlists`, símbolos y proveedor; sus credenciales cuando correspondan | Desactivado, pendiente de empresas relacionadas con software/IA y proveedor |
| `ossinsight` | Periodo, lenguajes, mínimo de estrellas y límite | Activado, últimas 24 horas, Python/TypeScript, hasta 20 |
| `gdelt` | Consulta, ventana y límites; idioma/país opcionales | Activado, software/IA, hasta 30 noticias |
| `google_news` | Consulta RSS, idioma, país y límite | Activado en el ejemplo, software/IA, español/Perú, hasta 30; comprobar bloqueo de robots desde Ubuntu |

La selección editorial acordada es **solo software, IA y empresas relacionadas**. OpenBB no amplía el producto a noticias bursátiles generales. Los nombres/canales/empresas exactos siguen como tarea de configuración, no se inventaron selecciones personales.

Ejemplos de entradas que se pueden añadir sustituyendo los valores:

```json
{
  "github": [{"type": "repo_releases", "owner": "PROPIETARIO", "repo": "REPOSITORIO", "enabled": true}],
  "reddit": {"enabled": true, "subreddits": [{"subreddit": "SUBREDDIT", "fetch_limit": 20}], "users": [], "fetch_comments": 5},
  "telegram": {"enabled": true, "channels": [{"channel": "CANAL_PUBLICO", "fetch_limit": 20}]},
  "openbb": {"enabled": true, "watchlists": [{"name": "software-ai", "symbols": ["SIMBOLO"], "provider": "PROVEEDOR", "fetch_limit": 20}], "fetch_filings": false}
}
```

Es un fragmento para editar las claves correspondientes; el archivo completo debe declarar los diez tipos. `--validate` comprueba el esquema y rechaza campos desconocidos. La disponibilidad, credenciales, costes y resultados se comprueban mediante captura real. Apify puede solicitar al menos 100 tweets por ejecución aunque `fetch_limit` sea menor; las búsquedas y replies generan llamadas adicionales.

Para OpenBB, construir con `INSTALL_OPENBB=1`. Añadir sus variables de credenciales a `.env.horizon`, archivo opcional excluido de Git y cargado solo por el trabajador. Los nombres dependen del proveedor escogido y deben verificarse con su documentación. Para X/GitHub se usan `APIFY_TOKEN` y `GITHUB_TOKEN` del entorno de Compose.

## Arranque de prueba en Ubuntu/Dokploy

Requisitos: Docker Engine y Compose 2.24 o superior; red `dokploy-network` existente; Ollama existente accesible como en `server/DEPLOY.md`. Reservar capacidad adicional para Laya CPU: el Compose limita su contenedor a 8 GB/2 CPU, además de lo que consumen Andes, el trabajador y Ollama. La primera descarga necesita salida a Hugging Face y espacio de disco. No se ha medido todavía el consumo en el Ubuntu del usuario.

1. Conservar el volumen `andes-cache`, proyecto Compose, token móvil y dominio actuales. Respaldar SQLite de forma consistente antes de actualizar. No usar `down -v`.
2. Crear `services/horizon_bridge/sources.json` a partir del ejemplo y revisar sus selecciones.
3. Conservar las variables actuales y añadir dos secretos **distintos**: `ANDES_INGESTION_TOKEN` y `LAYA_API_KEY`, de al menos 32 caracteres. Generarlos en el servidor y guardarlos en Dokploy/gestor de secretos. No incluirlos en Git ni en el APK.
4. Usar inicialmente `INGESTION_MODE=shadow`, `EDITORIAL_MODE=shadow`, `SEMANTIC_DEDUP_MODE=shadow`, `EDITORIAL_THRESHOLD=7`, `LAYA_REVISION=reviewed`. El manifiesto de revisiones está dentro del paquete Laya fijado. Comparar `/health` privado de Laya para conocer el dispositivo y SHA realmente cargados.
5. Ejecutar desde la raíz del repositorio:

```bash
cp services/horizon_bridge/sources.example.json services/horizon_bridge/sources.json
# Editar sources.json y configurar las variables en Dokploy o .env.
docker compose -f compose.yaml -f compose.intelligence.yaml config --quiet
docker compose -f compose.yaml -f compose.intelligence.yaml up -d --build
docker compose -f compose.yaml -f compose.intelligence.yaml exec -T horizon-bridge /opt/horizon/.venv/bin/python bridge.py --validate
docker compose -f compose.yaml -f compose.intelligence.yaml exec -T andes-api node scripts/check_laya.mjs
```

No repetir `cp` sobre un archivo ya personalizado. Para usar ese archivo, definir `HORIZON_SOURCES_FILE=./services/horizon_bridge/sources.json`. En Dokploy seleccionar **`./compose.dokploy.yaml`**, que contiene el resultado combinado y muestra los servicios directamente para que Dokploy aplique dominios y redes. Se regenera sin resolver secretos con `python server/scripts/render_compose.py` (PyYAML 6.0.3); comprobar sincronía con `--check`. No usar un wrapper `include` como archivo de Dokploy: su procesamiento de dominios requiere el mapa `services` en la raíz.

Para configuración personalizada persistente en Dokploy, usar `HORIZON_SOURCES_FILE=../files/horizon-sources.json` y un File Mount/archivo persistente con ese contenido. El bind requiere que el archivo ya exista, evitando crear un directorio accidentalmente. El valor por defecto del repositorio utiliza el ejemplo versionado. La documentación oficial explica la [persistencia de archivos y el comportamiento de AutoDeploy](https://docs.dokploy.com/docs/core/docker-compose).

El healthcheck confirma el servicio; `check_laya` hace una inferencia real y falla si el contrato no responde correctamente. No basta con un HTTP 200 de salud para dar el modelo por probado.

La imagen de Horizon instala las dependencias del `uv.lock` del commit fijado. La de Laya fija el paquete y PyTorch CPU y ejecuta `pip check`; ambas se construyeron correctamente en el Ubuntu revisado. No se inicia otro Ollama ni se descarga otro modelo generativo.

Captura sin entregar/publicar:

```bash
docker compose -f compose.yaml -f compose.intelligence.yaml run --rm --no-deps horizon-bridge /opt/horizon/.venv/bin/python bridge.py --probe
docker compose -f compose.yaml -f compose.intelligence.yaml run --rm --no-deps horizon-bridge /opt/horizon/.venv/bin/python bridge.py --probe --source hackernews
```

Mantener una sola réplica de cada servicio. El trabajador usa una ejecución secuencial por instancia y espera dos horas entre capturas completadas. Tras un reinicio captura otra vez una ventana de 24 horas; Andes conserva identidades idempotentes. Si falla la entrega, primero vacía la cola pendiente antes de capturar de nuevo. La cola pendiente y sus rechazos se conservan en `horizon-outbox`; los errores de red no descartan esos lotes. El registro por fuente distingue vacío, fallo y resultado parcial; ciertos errores absorbidos internamente por SDKs pueden requerir diagnóstico adicional del proveedor.

Los scrapers HTTP pasan por DNS comprobado/fijado, límite de 2 MB y robots para accesos públicos no API. OpenBB usa su propio SDK: no hereda ese transporte y requiere revisar sus proveedores y restricciones de red al activarlo. El adaptador no usa Playwright ni cookies de X. No publicar el puerto 8788 ni el servicio Laya en el proxy del dominio.

## Consulta, revisión y promoción

La API móvil conserva `/articles`, `/articles/:id`, `/sources` y `/status`. `/status` añade el modo editorial y último lote; los logs y `state.last_run` del SQLite del adaptador contienen el diagnóstico de captura por fuente.

Listener privado, con `Authorization: Bearer ANDES_INGESTION_TOKEN`:

- `POST /batches`: esquema v1, hasta 50 elementos/2 MB; respuesta por índice con aceptado, repetido o rechazado. Un ID reutilizado con contenido diferente devuelve 409.
- `GET /evaluations`: últimas 1000 decisiones, estado de ingestión y conteos. No es un endpoint público ni un historial ilimitado.
- `POST /reviews/<id>` con `{"status":"accepted"}` o `{"status":"rejected"}`: revisión explícita del operador, conserva detalle y prepara el contenido si hace falta. Aceptar publica ese documento individual aunque proceda de sombra (`ingestionShadow=false`); no promueve otros candidatos. No vuelve a ejecutar el modelo hasta una revaluación explícita o una edición del contenido.

Las decisiones inciertas van a `review`; no aparecen en el feed activo ni se confunden con errores del modelo. La revisión puede aceptar o rechazar esos casos. Los fallos en modo activo usan la política existente de tres intentos con espera y quedan como no disponibles si se agotan. En sombra, un fallo de Laya conserva la decisión de las reglas para el feed habitual.

Los candidatos ocultos del piloto que Laya rechaza, deja en revisión o no puede evaluar conservan cuerpo y decisión para auditoría, pero no consumen inferencia de resumen/traducción. Su estado de trabajo es `filtered`; la decisión editorial distingue `rejected`, `review` y `error`. Una aceptación manual puede volver a prepararlos.

El botón de actualización del celular consulta el feed preparado y el catálogo. No inicia una captura externa: el colector habitual revisa fuentes cada dos horas y Horizon sigue su propio ciclo. Durante el piloto los candidatos nuevos de Horizon permanecen ocultos salvo publicación individual tras revisión. El número de `ready` de `/status` incluye documentos ocultos y no equivale al total visible del feed.

Para promover tras evaluar calidad y capacidad, cambiar `INGESTION_MODE=active` y `EDITORIAL_MODE=laya`; activar `SEMANTIC_DEDUP_MODE=active` solo después de auditar falsas fusiones. El feed activo incluye únicamente contenido `ready` y aceptado, ordenado por día y puntuación editorial. El modo de ingestión controla candidatos nuevos; para promover los ya capturados en sombra hay que reencolarlos explícitamente.

### Publicación automática limitada del piloto

`PUBLICATION_MODE=reviewed` mantiene la publicación individual por revisión. `PUBLICATION_MODE=canary` permite publicar documentos ocultos después de prepararlos, con estos controles acumulativos:

- Fuente Horizon incluida en `PILOT_SOURCE_TYPES` (por defecto solo `hackernews`).
- Rúbrica editorial v3, decisión aceptada, puntuación al menos `PILOT_MIN_SCORE` (8.5 por defecto) y acuerdo de las reglas sobre el cuerpo original.
- Resumen y cuerpo presentes; control `summary-check-v1` aprobado; sin candidato a duplicado ni revisión manual previa.
- Hasta `PILOT_DAILY_LIMIT` publicaciones automáticas por día de Bogotá (3 por defecto; rango 1–20). El registro SQLite es transaccional y persiste tras reinicios; una noticia no vuelve a consumir cupo. Las publicaciones manuales no consumen ese cupo.

El documento publicado conserva `publicationKind=pilot_auto`, fecha y la razón visible «Selección automática de prueba». `/status.publication` muestra modo, fecha local, cupo, fuentes, umbral, total automático del día y fecha de última publicación en milisegundos Unix. Los documentos bloqueados siguen ocultos; no se publican automáticamente los archivos históricos al cambiar el flag.

La rúbrica v3 evalúa primero el tema del título y comienzo. Si la pertinencia es menor que 0.8, registra rechazo/revisión sin inferir sobre el cuerpo completo (`bodyEvaluated=false`, `windowCount=0`). Para los que pasan, evalúa todas las ventanas del cuerpo y usa pertinencia media limitada por el tema inicial, en lugar del máximo de una sola ventana. Los resúmenes generados no alimentan su propia clasificación.

El control de resumen señala números no encontrados en la fuente, ciertos juicios genéricos de fiabilidad inventados, escritura inesperada para el resumen español y falta/exceso de contenido. **No prueba veracidad, equivalencia semántica, idioma correcto ni fidelidad de traducción**; puede pedir revisión de contenido válido. El modo limitado es un experimento de publicación, no la promoción general ni el cumplimiento de las metas editoriales del plan. Desactivarlo evita publicaciones automáticas futuras; lo ya publicado conserva su estado hasta revisión explícita.

Para revaluar y regenerar solo candidatos ocultos concretos, detener antes el trabajador y usar `node scripts/reprocess_pilot.mjs --ids=<id1>,<id2>` para vista previa; `--apply` reencola y borra su resumen, sin publicar, borrar el cuerpo o editar documentos revisados. Las traducciones existentes se conservan. La selección vuelve a pasar por el filtro y controles actuales. Mantener API detenida durante esta herramienta, que abre el almacén de mantenimiento.

Mantenimiento con API y trabajador detenidos para evitar abrir SQLite desde otro proceso mientras el servidor procesa:

```bash
docker compose -f compose.yaml -f compose.intelligence.yaml stop horizon-bridge andes-api
docker compose -f compose.yaml -f compose.intelligence.yaml run --rm --no-deps andes-api node scripts/requeue_editorial.mjs --promote-shadow
# Revisar el conteo; para aplicar:
docker compose -f compose.yaml -f compose.intelligence.yaml run --rm --no-deps andes-api node scripts/requeue_editorial.mjs --promote-shadow --apply
docker compose -f compose.yaml -f compose.intelligence.yaml up -d andes-api horizon-bridge
```

El script preserva IDs, cuerpos y abstractos, borra la selección/revisión anterior y reinicia intentos para que el trabajador reevalúe antes de publicar. Sin `--promote-shadow` conserva ocultos los candidatos de sombra. La carga antigua no se reevalúa automáticamente al cambiar de modo: ejecutar este mantenimiento y esperar la preparación antes de considerar completo el cambio.

Reversión: detener el trabajador, configurar `EDITORIAL_MODE=rules`, `SEMANTIC_DEDUP_MODE=off` y ejecutar el mantenimiento con `--rules --apply` para recalcular relevancia por reglas. Sin `--promote-shadow` no incorpora capturas ocultas. Si se restauran datos, usar la copia consistente y preservar previamente los posteriores al respaldo. No borrar el volumen para resolver un fallo de modelo.

## Evaluar calidad real

Crear un JSONL con etiquetas humanas, una publicación por línea: `title`, `contentText`, `sourceId` opcional y `valuable` booleano. Separar corpus de ajuste y prueba; incluir descartes y fuentes/idiomas distintos. Desde el contenedor de Andes con el corpus montado:

```bash
node scripts/evaluate_editorial.mjs /evaluation/test.jsonl /evaluation/report.json
```

El script consulta Laya real, compara clasificación con las reglas actuales y escribe precisión, recuperación, revisión, errores y resultados por fila. Un error de inferencia produce código de salida 1. No valida fidelidad de resúmenes ni deduplicación: auditar esas dimensiones con el protocolo de `integracion_horizon_laya.md`. La comparación con el análisis generativo nativo de Horizon, nDCG y la observación de 7–14 días siguen siendo pasos del piloto; no se presentan como mediciones completadas.

Consulta [el informe de validación local](validacion_horizon_laya.md) para distinguir pruebas con respuestas simuladas, contratos sobre Horizon real y capturas externas reales.
