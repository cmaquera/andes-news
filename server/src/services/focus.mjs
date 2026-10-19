// Editorial scope: software engineering and concrete AI advances/applications.
// A publisher's technology section or the word "AI" alone is not sufficient.
export const FOCUS_VERSION = 2;
const normalized = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const software =
  /\b(programacion|programming|programadores?|developers?|desarrolladores?|software engineering|ingenieria de software|desarrollo de software|desarrollo web|coding|code review|pull requests?|repositorios?|repositories|github|gitlab|python|javascript|typescript|rust|golang|java|kotlin|swift|flutter|react|angular|vue|svelte|django|fastapi|node\.js|npm|compiler|compilador|debugging|depuracion|unit tests?|pruebas unitarias|testing|devops|docker|kubernetes|backend|frontend|frameworks?|sdk|apis?|database|bases? de datos|sql|postgres|sqlite|redis|mongodb|ci\/cd|open source|codigo abierto)\b/;
const ai =
  /\b(ia|ai|llms?|gpt[\w.-]*|chatgpt|claude|gemini|qwen|ollama|deepseek|llama|inteligencia artificial|artificial intelligence|machine learning|aprendizaje automatico|modelos? de lenguaje|language models?|fine[ -]?tuning|lora|rag|embeddings?|redes neuronales|neural networks?|diffusion models?)\b/;
// Scope candidates, not publication approval. These cover software vocabulary
// without relying on publisher names or individual story titles.
const engineering =
  /\b(software|source code|codigo fuente|parsers?|combinators?|syntax|compilers?|text editors?|language server|tree-sitter|ipsec|sd-wan|linux|unix|astro|web performance|pagespeed|core web vitals)\b/;
const webEngineering =
  /\b(web|pagina|sitio)\b.{0,90}\b(rendimiento|carg\w*|performance|optimiza\w*)\b|\b(rendimiento|carg\w*|performance|optimiza\w*)\b.{0,90}\b(web|pagina|sitio)\b/;
const practicalAi =
  /\b(prompts?|prompting|resum\w*|summariz\w*|flujos? de trabajo|workflows?|plataforma|platform|startup)\b/;
const aiConcrete =
  /\b(modelos?|models?|razonamiento|reasoning|inferencia|inference|entrenamiento|training|fine[ -]?tuning|ajuste fino|rag|retrieval|embeddings?|agentes?|agents?|multimodal|cuantizacion|quantization|benchmarks?|evaluacion|evaluation|open[ -]?weights?|pesos abiertos|transformers?|arquitecturas?|architecture|investigacion|research|papers?|metodos?|methods?|algoritmos?|algorithms?|implementacion|implementation|automatizacion|automation|implementa|implementan|implemento|aplica|aplican|aplico|adopcion|adoption|despliegue|deployment|integracion|integration|deteccion|diagnostico|prediccion|agricultura|salud|educacion|fraude|logistica|productividad|productivity|copilot|codex)\b/;
const consumer =
  /\b(celular(?:es)?|smartphones?|telefonos?|iphone|galaxy|pixel \d|redmi|xiaomi|samsung|televisor(?:es)?|smart tv|auricular(?:es)?|headphones?|consolas?|playstation|xbox|descuentos?|cupones?|mejores? moviles?|mejores? celulares?|unboxing|gaming|videojuegos?)\b/;
const developerHardware =
  /\b(sdk|apis?|desarrolladores?|developers?|programacion|programming|inferencia|inference|on[ -]?device|en el dispositivo|modelos? locales|local models?|llms?|npu|arquitectura|architecture|benchmarks?|entrenamiento|training)\b/;
const unrelated =
  /\b(streaming|netflix|disney|peliculas?|series de television|loteria|horoscopo|astronomia|turismo|vacaciones|trabajo hibrido|trabajo remoto|return to office|vuelta a la oficina|boomer|millennials|fibra optica|planes? de internet)\b/;
const regions =
  /\b(peru|peruano[as]?|lima|arequipa|latinoamerica|latin america|latam|america latina|mexico|mexican[oa]s?|colombia|colombian[oa]s?|chile|chilen[oa]s?|argentina|argentin[oa]s?|brasil|brazil|brasilen[oa]s?|ecuador|bolivia|uruguay|paraguay|costa rica|panama|guatemala|honduras|el salvador|nicaragua|republica dominicana)\b/;

export function assessFocus(article, { full = false } = {}) {
  const headline = normalized(
    `${article.title} ${String(article.feedExcerpt ?? article.excerpt ?? '').slice(0, 500)}`,
  );
  // A generated summary cannot become evidence for its own editorial scope.
  const body = normalized(full ? (article.contentText ?? '') : '');
  const combined = `${headline} ${body}`;
  // Consumer exceptions must be evident in the headline/excerpt, not a stray
  // mention of an SDK in a long marketing article.
  // Generic words such as offers or price can describe jobs, API pricing or
  // acquisitions. Hardware/promotion context is required for this veto.
  const hasConsumer = consumer.test(headline),
    exception = developerHardware.test(headline) || webEngineering.test(headline);
  const dev =
    software.test(headline) ||
    engineering.test(headline) ||
    webEngineering.test(headline) ||
    ((!hasConsumer || exception) && full && (software.test(body) || engineering.test(body)));
  const hasAi = ai.test(headline) || ((!hasConsumer || exception) && full && ai.test(body));
  const concrete =
    aiConcrete.test(headline) ||
    practicalAi.test(headline) ||
    ((!hasConsumer || exception) && full && (aiConcrete.test(body) || practicalAi.test(body)));
  let accepted = false,
    reason = 'outside_focus';
  if (hasConsumer && !exception) reason = 'consumer_technology';
  else if (unrelated.test(headline) && !dev && !(hasAi && concrete)) reason = 'general_interest';
  else if (dev) {
    accepted = true;
    reason = hasAi ? 'software_and_ai' : 'software_development';
  } else if (hasAi && concrete) {
    accepted = true;
    reason = 'applied_ai';
  } else if (article.sourceId === 'github' && !hasConsumer) {
    accepted = true;
    reason = 'developer_source';
  } else if (hasAi) reason = 'ai_without_concrete_advance';
  const relevantRegion = regions.test(combined);
  const peru = /\b(peru|peruano[as]?|lima|arequipa)\b/.test(combined);
  const topic = accepted
    ? hasAi
      ? 'IA'
      : /\b(vulnerab\w*|seguridad|security|cve[ -]?\d+|supply chain)\b/.test(combined)
        ? 'Seguridad'
        : /\b(open source|codigo abierto)\b/.test(combined)
          ? 'Open source'
          : 'Programación'
    : 'Tecnología';
  return {
    accepted,
    reason,
    topic,
    priority: accepted
      ? (peru ? 30 : relevantRegion ? 20 : 0) + (hasAi && dev ? 6 : hasAi ? 5 : 4)
      : 0,
    regionalMention: accepted && relevantRegion,
    version: FOCUS_VERSION,
  };
}
