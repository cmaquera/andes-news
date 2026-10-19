# Documentos científicos de múltiples fuentes — Andes 0.6.3

La función identifica documentos y sus formatos, sin depender de que estén alojados en arXiv. Si una noticia cita una investigación, conserva el texto y el resumen de la noticia y ofrece los documentos citados por separado. Si la URL corresponde al propio paper, ofrece su ficha y los formatos publicados. El HTML se muestra como formato completo solo cuando la publicación lo anuncia o tiene señales de cuerpo completo; una ficha de resumen no se convierte en HTML completo por el mero hecho de ser una página web.

## Detección y recorrido

- Metadatos Highwire/BE Press/PRISM, Dublin Core con tipo académico y JSON-LD de `ScholarlyArticle`, tesis o informe identifican la publicación. Las fuentes técnicas de referencia son las [directrices de Google Scholar](https://scholar.google.com/intl/en/scholar/inclusion.html) y [Schema.org](https://schema.org/ScholarlyArticle).
- Los metadatos y enlaces explícitos del documento aportan HTML y PDF. Se excluyen anexos y enlaces de navegación/referencias cuando se busca el formato principal. El adaptador arXiv conserva su validación del identificador y versión.
- En noticias se buscan DOI, citas estructuradas y enlaces explícitos a estudios/papers. También se considera la frase que rodea al enlace, para reconocer citas cuyo texto es solo el nombre de la revista. Se consultan como máximo tres destinos distintos, sin seguir recursivamente sus bibliografías. Un documento repetido por DOI se presenta una sola vez.
- Los mensajes nativos también pueden resolver referencias científicas cuando conservan una URL en su texto. No se reconstruyen enlaces que el proveedor haya eliminado.
- Un fallo de un destino no impide leer la noticia. Se mantienen las restricciones de URL pública, DNS, redirecciones, robots, tamaño y tiempo del cliente HTTP existente. No se ejecuta JavaScript ni se atraviesan controles de acceso.

## Lectura y persistencia

La API añade `papers`, una lista con título, fuente, relación (`document` o `reference`) y los enlaces disponibles. `paper` sigue admitiéndose para lecturas anteriores. Flutter conserva los enlaces en su caché y muestra «Ver HTML», «Ver PDF» y la ficha del documento cuando corresponden. Cada documento citado conserva su propio título.

Para noticias ya procesadas, abrir el lector inicia una consulta de formatos en segundo plano. Su resultado se almacena en una caché independiente: no modifica el cuerpo, resumen ni decisión editorial de la noticia. El lector consulta el resultado cada dos segundos, hasta diez veces, sin bloquear la lectura; al cerrarlo cancela las consultas. Si tarda más, se puede actualizar la lectura después. La API limita la exploración a dos trabajos simultáneos y veinte pendientes; los resultados completos caducan a las 24 horas y los fallos se reintentan tras diez minutos.

Cuando la publicación es el propio paper, Andes muestra un resumen en español y los enlaces originales HTML/PDF/ficha. El extractor usa únicamente el resumen publicado por los autores (metadatos o sección de abstract), con alcance `paper_abstract`, para preparar una explicación de objetivo, enfoque, aportación y resultados atribuidos a los autores. No sigue el HTML alternativo para reconstruir el documento ni traduce su cuerpo, fórmulas, tablas o apéndices. Si la ficha es a la vez el HTML completo, se utiliza solo su sección de abstract. Si no se encuentra ese texto, conserva los enlaces sin inventar un resumen desde el titular.

El lector de papers no ofrece «Artículo limpio» ni «Leer dentro de Andes». Esta política también se aplica a papers guardados con cuerpos reconstruidos de versiones anteriores: la API omite sus bloques y traducciones, y Flutter los oculta incluso desde su caché anterior. Los resúmenes existentes se conservan. Las noticias normales —incluidas las que citan investigaciones— mantienen el lector limpio y su traducción; sus documentos citados se abren por separado.

Un PDF directo queda accesible como original sin descargar todo su cuerpo para inferencia ni fabricar un resumen de texto no leído. Los enlaces PDF se abren en el visor externo del dispositivo; esta versión no incorpora conversión PDF a texto ni descarga de PDFs para lectura sin conexión.

## Validación

Se aprobaron 65 pruebas de backend y 28 de Flutter, con análisis estático sin incidencias. Además de la detección y consulta de formatos, se comprueba que los papers no solicitan el HTML completo, no reconstruyen tablas ni traducen el cuerpo; que la preparación usa el abstract de autor con instrucciones en español; y que las lecturas antiguas ocultan sus cuerpos sin modificar el resumen o registro original. Las pruebas de noticias normales y noticias con referencias siguen pasando.

Pruebas reales de lectura, sin modificar noticias almacenadas:

| Destino | Resultado observado |
| --- | --- |
| [ACL Anthology](https://aclanthology.org/2023.emnlp-main.1/) | Resumen de autor de 192 palabras y PDF anunciado. |
| [DOI de esa publicación](https://doi.org/10.18653/v1/2023.emnlp-main.1) | Resuelve a ACL y obtiene el mismo PDF. |
| [PLOS One, KerSpecGen](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0338821) | Detecta HTML/PDF y usa 205 palabras del abstract de autor, frente a las 10.086 palabras reconstruidas en 0.6.2. |

Las comprobaciones de ACL/PLOS también se ejecutaron desde el contenedor desplegado en Ubuntu. La consulta del PDF de ACL devolvió HTTP 200 y tipo PDF sin conservar bytes del cuerpo en la respuesta del extractor. Una consulta de documentos sobre una noticia existente respondió inicialmente como pendiente en 6 ms y terminó con estado completo; su registro original permaneció idéntico y la integridad SQLite devolvió `ok`. Es una medición puntual, no un benchmark de rendimiento. El APK 0.6.2+8 quedó instalado en el teléfono y mostró los controles genéricos «Ver HTML», «Ver PDF» y «Ficha del documento».

Estos casos verifican mecanismos y formatos, no cobertura universal. Páginas sin metadatos, abstract ni enlaces reconocibles, contenido exclusivamente dinámico, destinos bloqueados, suscripciones y formatos mal anunciados pueden impedir la detección. Las fórmulas, gráficos, referencias y apéndices se consultan en el HTML/PDF original, que conserva su composición.
