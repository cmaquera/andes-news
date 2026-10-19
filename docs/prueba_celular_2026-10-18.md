# Prueba del celular — 18 de octubre de 2026

Dispositivo físico Motorola edge 60 fusion, Android, Andes **0.6.0 (6)**. Pruebas mediante ADB con el teléfono desbloqueado y contra el servidor Ubuntu existente. No se reinstaló el APK ni se borraron datos o credenciales.

## Problema observado y causa

El teléfono recibía **138 lecturas**, pero las novedades de Horizon seguían marcadas `ingestionShadow=true`. Es una restricción del piloto, no un fallo de conexión del APK. Actualizar la pantalla consulta resultados preparados; no dispara una recolección. La última captura habitual registrada era del 18/10 a las 15:48 de Bogotá y la siguiente estaba programada para las 17:48. Horizon tiene su propio ciclo de dos horas.

También se observaron candidatos ocultos ajenos al foco, incluido un artículo sobre vivienda, consumiendo resumen y traducción porque las reglas lo aceptaban aunque Laya lo dejara en revisión. Un resumen de HybridAgents afirmaba incorrectamente que no había información verificable, a pesar de haberse recuperado el abstract del preprint. Otros resúmenes antiguos mostraban afirmaciones o traducciones defectuosas: esta prueba no certifica su calidad.

## Correcciones desplegadas

- Aceptar un documento mediante la revisión privada ahora lo publica individualmente desde sombra y habilita su fuente en el catálogo. Los otros documentos siguen ocultos.
- Los documentos ocultos con decisión rechazada, incierta o fallida conservan su cuerpo y evaluación, pero no pasan a resumen/traducción. `filtered` es el estado de trabajo; el estado editorial conserva la diferencia entre rechazo, revisión y error.
- Se reformuló la instrucción del generador para tratar el contenido como datos, ignorar instrucciones incrustadas y evitar juicios inventados sobre fiabilidad. Una regeneración real de HybridAgents dejó de producir el rechazo injustificado; un caso no demuestra calidad general.
- Se revisaron y corrigieron manualmente los resúmenes de dos noticias antes de publicarlas. Se registró `summaryBasis=human_review`, fecha de revisión y aceptación editorial del operador. No se presentan como resúmenes automáticos validados.

Selección publicada:

| Noticia | ID | Resultado |
| --- | --- | --- |
| HybridAgents: razonamiento latente e interacción por texto | `ae6e49210029e41a672a7f639a040f26` | Preparada, revisada y visible; el resumen atribuye las métricas a sus autores y aclara que es un preprint |
| DeepSeek: APIs Search y Fetch para agentes y RAG | `4dc309c2f9cfbf220cd028d26e02715f` | Preparada, revisada y visible; límites y tarifas contrastados con el texto recuperado |

## Resultados verificados

| Prueba | Evidencia / resultado |
| --- | --- |
| Conexión del APK y carga inicial | Feed visible, 138 lecturas, sin error de conexión |
| Actualización tras publicación | API autenticada y pantalla del teléfono muestran **140 lecturas**; las dos novedades aparecen en «En tu radar» |
| Catálogo dinámico | API incorpora `horizon:hackernews:3d22975dead0`; el teléfono incluye sus noticias sin reinstalación |
| Lector habitual | Se abrió el abstract y la pestaña de artículo limpio con traducción al español |
| Lector de la novedad | HybridAgents muestra el resumen revisado, 9,8/10, «Selección revisada manualmente» y procedencia de Hacker News |
| Guardado | El control cambia a «Quitar de guardados» y la noticia aparece en la pestaña Guardados; se quitó al terminar para restaurar el estado previo |
| Reapertura | Tras detener y volver a abrir Andes, siguen visibles las 140 lecturas y ambas novedades; no se observaron excepciones de Flutter/AndroidRuntime en la muestra de log |
| Regresión del backend | **34/34 pruebas aprobadas**; incluye publicación individual sin exponer otros candidatos ocultos y ausencia de inferencia generativa para un candidato incierto oculto |
| Formato y diferencias | Prettier y `git diff --check` aprobados |
| Servicios tras despliegue | API y Laya saludables; Horizon en ejecución |
| Integridad de datos | `PRAGMA integrity_check` devuelve `ok` sobre la base en uso |

Capturas y volcados de la interfaz de prueba en `build/integration/`, excluidos de Git: `phone-feed-verified.png`, `phone-reader-verified.png`, `phone-after-ui.xml`, `phone-new-reader-ui.xml` y `phone-bookmark-ui.xml`. No contienen campos de credenciales.

## Límites vigentes

El sistema sigue en modo sombra. Estas dos publicaciones prueban captura, preparación, revisión, catálogo, descarga y lectura reales; **no activan la publicación automática general de Horizon**. Faltan la evaluación editorial independiente, corrección/auditoría de resúmenes antiguos y los datos de cuentas, canales, repositorios y empresas definidos en el plan. La app descarga hasta 200 artículos por consulta; no se validó paginación masiva ni funcionamiento sin red en el dispositivo físico.

Los cambios del servidor se aplicaron en `/home/maque/andes-intelligence`, conservando el proyecto Compose y el volumen existentes. El origen persistente de Dokploy/GitHub sigue pendiente de alinearse con esa carpeta antes de otro despliegue desde el origen anterior.
