# Validación de Horizon + Laya

Fecha: 18 de octubre de 2026. Separar pruebas de integración de calidad editorial: que los servicios funcionen no demuestra todavía que el feed alcance las metas de precisión/recuperación del plan.

## Código y aplicación

| Verificación | Resultado |
| --- | --- |
| Backend Node/Fastify | 32/32 pruebas aprobadas |
| Adaptador sobre el código real de Horizon fijado | 8/8 pruebas aprobadas |
| Flutter | 21/21 pruebas aprobadas; incluye lector nativo a 390 px, catálogo remoto, caché y preferencias |
| `flutter analyze` | Sin incidencias |
| Formato de JavaScript | Aprobado |
| Compose base + integración | Configuración válida |
| APK Android arm64 | Compilación release completada, versión 0.6.0+6 |

Las pruebas de Node comprueban autenticación, idempotencia, URL insegura, límites, captura nativa sin extracción web, persistencia/reinicio, score separado de votos, incertidumbre, error de modelo, lectura completa por ventanas y deduplicación conservando detalle. Las respuestas del modelo en esa suite están simuladas. Python utiliza los modelos y constructores reales de los diez scrapers de Horizon; la obtención de HN en su prueba de contrato usa respuestas HTTP controladas. OpenBB se prueba en el límite del SDK, sin credenciales de proveedor.

## Capturas externas reales desde desarrollo

Ejecutadas con `bridge.py --probe`, sin entregar ni publicar contenido:

| Fuente | Resultado observado |
| --- | --- |
| Hacker News | 22 publicaciones recuperadas, con comentarios separados |
| Genbeta RSS | 1 publicación en la ventana de 24 horas |
| GitHub Changelog RSS | 0 publicaciones en esa ventana; no prueba un fallo |
| OSS Insight | 0 publicaciones para lenguajes/límites del ejemplo; pendiente de ampliar prueba |
| GDELT | Primer intento parcial; segundo intento recuperó 30 noticias |
| Google News | Captura bloqueada por `robots_denied`; queda diagnosticada y no se elude la restricción |
| Reddit, Telegram, X, GitHub eventos/releases, OpenBB | Pendientes de selecciones concretas y credenciales cuando correspondan; no se presentan como capturas reales completadas |

## Ubuntu y modelo real

Servidor inspeccionado mediante SSH autorizado: Ubuntu 26.04.1 x86_64, aproximadamente 15 GB de RAM, 62 GB libres y GTX 1650 de 4 GB. Se eligió CPU para Laya. La API existente contenía inicialmente 126 artículos preparados, 39 filtrados, 1 pendiente y 11 no disponibles.

Respaldo consistente de SQLite creado mediante `node:sqlite.backup()`; también se guardaron la imagen previa y el código/configuración anterior, con permisos restringidos. Directorio de despliegue: `/home/maque/andes-intelligence`; proyecto Compose conservado: `andes-news-api-tvq8rl`; volumen existente: `andes-news-api-tvq8rl_andes-cache`. Las credenciales se generaron en Ubuntu y no se copiaron al repositorio ni al APK.

Las tres imágenes se construyeron correctamente en Ubuntu. Horizon validó su configuración de diez fuentes dentro de su contenedor. Laya arrancó y su healthcheck quedó saludable. Se verificó el paquete publicado `laya==0.4.11`, su contrato HTTP nativo y su mecanismo de fijación de pesos `LAYA_REVISION=reviewed`.

La primera inferencia real tardó **883 ms**, con modelo multilingüe explícito. Reveló un error de rúbrica: la pregunta larga de relevancia dio probabilidad 0.0295 a un ejemplo positivo sobre la API del intérprete Python. Este resultado impide considerar validado el filtrado automático de esa versión.

Se contrastaron preguntas cortas con ejemplos sintéticos y apareció otro fallo: una pregunta amplia asignó 0.9774 a una noticia de subida bursátil genérica. Se cambió la relevancia a una clasificación explícita `software / ai / other`, con versión de rúbrica `andes-software-ai-v2` para invalidar la caché anterior.

En cuatro ejemplos sintéticos, esa clasificación eligió correctamente `software` para Python en inglés/español y `other` para una oferta de teléfono y una subida bursátil. Las probabilidades de la categoría elegida fueron 0.6312, 0.8770, 0.8817 y 0.9768 respectivamente. **Son ejemplos de diagnóstico seleccionados, no un benchmark ni etiquetas humanas independientes.** No justifican afirmar 100% de precisión ni activar descartes definitivos.

La consulta de comprobación con la rúbrica corregida respondió en **772 ms**, clasificó el ejemplo Python como software y dio probabilidad de pertinencia 0.9739. No se extrapola esa latencia de una solicitud corta a documentos completos.

El piloto quedó iniciado con `INGESTION_MODE=shadow`, `EDITORIAL_MODE=shadow` y `SEMANTIC_DEDUP_MODE=shadow`. La API respondió en la dirección LAN original con versión 0.5.0; API y Laya estaban saludables y el trabajador en ejecución. El primer ciclo desde Ubuntu capturó **53 apariciones**: 22 de HN, 1 de Genbeta y 30 de GDELT; los otros conectores públicos tuvieron los mismos resultados vacíos/bloqueo descritos arriba.

Se verificó recepción de lotes en la API privada y registro persistente de una evaluación real de la rúbrica v2: estado aceptado, score 9.84/10, una ventana, 4866 ms. El contenido todavía requería preparación generativa: este dato prueba el recorrido de captura/ingestión/evaluación, no certifica la calidad de la noticia ni el tiempo completo hasta publicación. El feed mantuvo inicialmente sus 126 noticias preparadas mientras los documentos nuevos se procesaban ocultos.

Una muestra puntual de memoria de los contenedores mostró aproximadamente **82 MiB para Andes, 57 MiB para Horizon y 1.75 GiB para Laya**. Son observaciones de ese momento, no picos bajo carga ni una prueba de capacidad diaria. Ollama conserva la GPU existente.

Al finalizar la comprobación del recorrido completo se observaron **7 evaluaciones persistidas y 4 artículos de sombra en estado preparado**. Los conteos globales eran 130 preparados (incluyen esos 4 ocultos), 41 filtrados, 44 pendientes, 1 en proceso y 11 no disponibles. API y Laya estaban saludables; Horizon seguía activo. El endpoint público `/status` sin token devolvió 401. Solo se publica el puerto existente de Andes, no los servicios privados.

El respaldo se abrió en modo de solo lectura: `PRAGMA integrity_check` devolvió `ok` y conservaba 177 artículos. El listado autenticado confirmó que no mostraba documentos marcados de sombra. También se añadió una prueba específica para mantener ocultos los candidatos de las fuentes antiguas que las reglas rechazan mientras Laya los evalúa en paralelo.

## Pendiente para aceptar calidad editorial

La [prueba posterior con el celular físico](prueba_celular_2026-10-18.md) documenta el diagnóstico del feed sin novedades, tres correcciones desplegadas, dos publicaciones individuales revisadas y 34 pruebas de backend aprobadas. Esa prueba no cambia el estado de sombra del piloto ni valida publicación automática general.

- Configurar usuarios, canales, feeds adicionales, repositorios, watchlists y proveedores solicitados.
- Evaluar al menos el corpus humano independiente definido en el plan; fijar umbrales sobre calibración y medir una partición final sin ajustar después.
- Medir precisión, recuperación, ranking, falsas fusiones, calidad de resúmenes, cobertura por idioma/fuente y cola durante 7–14 días.
- Comparar contra reglas y contra el análisis generativo de Horizon. El script entregado compara reglas/Laya; la variante generativa y nDCG requieren el experimento adicional del plan.
- Configurar el origen persistente de despliegue de Dokploy con estos cambios antes de un próximo redespliegue automático desde GitHub. La carpeta de ejecución nueva no publica cambios al repositorio remoto.

Las metas del plan (85% de precisión, 90% de recuperación, etc.) permanecen como objetivos sin medir.
