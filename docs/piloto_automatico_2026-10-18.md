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

La pantalla del teléfono se actualizó a **141 lecturas**, conservando las dos noticias revisadas del paso anterior. El ensayo usa el APK 0.6.0 existente.

## Consolidación de despliegue

La rama autorizada `codex/horizon-laya-integration` está publicada en `cmaquera/andes-news`. Se configuró el servicio existente de Dokploy para usar esa rama y `./compose.dokploy.yaml`, manteniendo AutoDeploy y el proyecto/volumen. Se respaldó su configuración previa en un archivo privado del servidor, se verificó por hash la conservación de la credencial del móvil y se añadió la configuración necesaria de los servicios privados sin imprimir secretos.

La definición de fuentes está en `/etc/dokploy/compose/andes-news-api-tvq8rl/files/horizon-sources.json`, fuera del checkout, y la variable de Dokploy usa `../files/horizon-sources.json`. El origen de un próximo despliegue queda alineado con la integración. La ejecución comprobada inicialmente se hizo por CLI; el disparo desde Dokploy debe confirmarse por su registro de despliegue. La promoción futura a `main` debe actualizar también la rama del servicio después de integrar el PR.

## Comprobaciones técnicas

- **40/40** pruebas de backend; incluyen cupo, cambio de día de Bogotá, idempotencia, bloqueo por calidad/origen/rúbrica/duplicados y recorrido completo de publicación.
- **8/8** pruebas Python sobre Horizon y adaptador.
- **21/21** pruebas Flutter; `flutter analyze` sin incidencias.
- Compose plano de Dokploy generado sin interpolar credenciales; servicios, redes y volúmenes preservados. El archivo plano evita depender de la interpretación de `include` en la inyección de dominios de Dokploy.

## Límites

El control del resumen es heurístico: no demuestra fidelidad semántica ni audita traducciones antiguas. El ensayo de hasta tres noticias diarias permite observar el comportamiento con poco volumen. Siguen pendientes el corpus independiente, estabilidad de 7–14 días y selección/configuración de cuentas, canales, repositorios y watchlists.

No se declara alcanzado ningún objetivo editorial del plan. Los controles y el ensayo limitado son pasos para obtener evidencia antes de la promoción general.
