# Publicación automática limitada — 18 de octubre de 2026

Esta etapa continúa la prueba física del APK. Mantiene la ingestión y clasificación en sombra y añade un mecanismo separado para publicar un número limitado de noticias nuevas aceptadas, preparadas y verificadas contra errores conocidos de generación. No constituye una validación de precisión general.

## Auditoría con Laya real

Se congeló una copia de **269 documentos** del servidor. Se seleccionaron **18 casos de diagnóstico**, nueve técnicos y nueve ajenos al foco. Las expectativas son una evaluación de Codex, elegida tras observar fallos; **no son etiquetas humanas independientes ni una partición de prueba representativa**.

La rúbrica anterior aceptaba cuatro de los nueve casos ajenos al tema. Con la v3, ninguno fue aceptado: tres rechazados y seis en revisión. Entre los nueve técnicos, cuatro fueron aceptados, cuatro quedaron en revisión y uno fue rechazado. Esto demuestra que el control es conservador y que todavía pierde cobertura; no satisface las metas de recuperación del plan ni justifica activar el filtrado general.

Se completaron las 18 evaluaciones sin error de inferencia. Cuatro resúmenes existentes activaron el detector de juicios de fiabilidad no sustentados; diez candidatos no tenían resumen, por lo que el control pidió revisión por falta de contenido, no por un defecto de un resumen generado.

Evidencia con decisiones, tiempos, hash de la captura y procedencia: [auditoría JSON](evidencias/auditoria_piloto_2026-10-18.json). Los cuerpos completos permanecen fuera de Git. Los IDs y expectativas están en `server/fixtures/pilot_cases.json`; `server/scripts/audit_pilot.mjs` repite el diagnóstico sobre la captura congelada sin editar la base de producción.

## Controles implementados

- Tema principal antes de evaluar todas las ventanas; ninguna mención aislada determina por sí sola la pertinencia.
- Exclusión de resúmenes generados como evidencia de clasificación.
- Revisión de errores conocidos del resumen y mejores instrucciones sobre atribución y limitaciones explícitas.
- Publicación de prueba restringida por origen, rúbrica, puntuación, acuerdo de reglas, preparación, resumen y ausencia de duplicados.
- Cupo SQLite transaccional y persistente por día de Bogotá; etiqueta visible de selección automática de prueba.
- Estado operativo autenticado y reprocesado selectivo sin promover todo el archivo.

Configuración activada para el ensayo: `INGESTION_MODE=shadow`, `EDITORIAL_MODE=shadow`, `SEMANTIC_DEDUP_MODE=shadow`, `PUBLICATION_MODE=canary`, `PILOT_DAILY_LIMIT=3`, `PILOT_MIN_SCORE=8.5`, `PILOT_SOURCE_TYPES=hackernews`.

## Ensayo real de publicación

Se respaldó SQLite en `/data/before-canary-20261018.db`. Con el trabajador detenido, se reencoló únicamente el candidato oculto de KillSwitch (`7b7b800d55fc8f257f96f14a839d2774`). El trabajador volvió a evaluar el cuerpo, generó un nuevo resumen y publicó el documento automáticamente el **18/10 a las 19:17:46 de Bogotá**. La API registró `publicationKind=pilot_auto`, score **9.15**, control de resumen aprobado y `automaticToday=1`. No se utilizó la ruta de aceptación manual para esa publicación.

La revisión posterior encontró un error semántico que el control heurístico **no detectó**: el resumen atribuía 66,8 puntos a los modelos evaluados en conjunto, mientras que el texto los atribuía al mejor modelo. Se corrigieron resumen y puntos clave, registrando `summaryBasis=human_review`, fecha, `summaryReviewIssues=[metric_attribution]` y una razón visible de revisión posterior. Se conserva la procedencia de publicación automática. **Este fallo impide presentar el ensayo como generación autónoma fiable** y confirma que hace falta auditoría semántica independiente.

La pantalla del teléfono se actualizó a **141 lecturas**, conservando las dos noticias revisadas del paso anterior. Se buscó la nueva noticia por su titular y se abrió el lector: muestra «Selección automática de prueba» y la revisión posterior. El ensayo usa el APK 0.6.0 existente. La búsqueda actual consulta titular, extracto y fuente; no indexa el abstracto ni el cuerpo, por lo que buscar únicamente «KillSwitch» no devolvía esta noticia cuyo titular no incluye ese nombre.

## Consolidación de despliegue

La rama autorizada `codex/horizon-laya-integration` está publicada en `cmaquera/andes-news`. Se configuró el servicio existente de Dokploy para usar esa rama y `./compose.dokploy.yaml`, manteniendo AutoDeploy y el proyecto/volumen. Se respaldó su configuración previa en un archivo privado del servidor, se verificó por hash la conservación de la credencial del móvil y se añadió la configuración necesaria de los servicios privados sin imprimir secretos.

La definición de fuentes está en `/etc/dokploy/compose/andes-news-api-tvq8rl/files/horizon-sources.json`, fuera del checkout, y la variable de Dokploy usa `../files/horizon-sources.json`. Los primeros intentos de AutoDeploy clonaron la rama correcta, pero fallaron antes de recrear servicios porque no resolvían las dos credenciales privadas. El bloque de variables estaba cifrado: añadir texto a ese bloque conservaba la lectura de la configuración anterior. Se reconstruyó el bloque conservando las variables originales y usando `encryptValue`/`decryptValue` de la versión instalada de Dokploy, más los valores efectivos del contenedor en funcionamiento, sin imprimirlos ni rotarlos.

**Verificación posterior:** Dokploy registró `done` para los despliegues de los commits `ee52a7c` y `25579fa` (18/10 a las 19:32:49 y 19:33:11 de Bogotá). Tras la recreación de los servicios, la API autenticada conservó **141 noticias**, `automaticToday=1`, el cupo de tres y la corrección del resumen. `PRAGMA integrity_check` devolvió `ok`; API y Laya estaban saludables, Horizon en ejecución y la inferencia real de comprobación de Laya terminó en **984 ms**. Esta inferencia comprueba conectividad/contrato, no precisión editorial. Backend y Flutter de GitHub Actions estaban aprobados para `25579fa`.

La promoción futura a `main` debe actualizar también la rama del servicio después de integrar el PR en borrador [#1](https://github.com/cmaquera/andes-news/pull/1).

## Comprobaciones técnicas

- **40/40** pruebas de backend; incluyen cupo, cambio de día de Bogotá, idempotencia, bloqueo por calidad/origen/rúbrica/duplicados y recorrido completo de publicación.
- **8/8** pruebas Python sobre Horizon y adaptador.
- **21/21** pruebas Flutter; `flutter analyze` sin incidencias.
- Compose plano de Dokploy generado sin interpolar credenciales; servicios, redes y volúmenes preservados. El archivo plano evita depender de la interpretación de `include` en la inyección de dominios de Dokploy.

## Límites

El control del resumen es heurístico: no demuestra fidelidad semántica ni audita traducciones antiguas. El ensayo de hasta tres noticias diarias permite observar el comportamiento con poco volumen. Siguen pendientes el corpus independiente, estabilidad de 7–14 días y selección/configuración de cuentas, canales, repositorios y watchlists.

No se declara alcanzado ningún objetivo editorial del plan. Los controles y el ensayo limitado son pasos para obtener evidencia antes de la promoción general.
