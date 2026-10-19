const $ = (id) => document.getElementById(id);
const names = {
  rejected: 'Descartada',
  review: 'Revisión / error',
  duplicate: 'Duplicado confirmado',
  candidate: 'Candidato a duplicado',
  shadow: 'Oculta en piloto',
  ready: 'Preparada para feed',
  filtered: 'Filtrada',
  pending: 'Pendiente',
};
const node = (tag, text, className) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = String(text);
  if (className) e.className = className;
  return e;
};
function link(url, text = 'Abrir original ↗') {
  const e = node('a', text);
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return node('span', 'Enlace no disponible');
    e.href = u.href;
    e.target = '_blank';
    e.rel = 'noopener noreferrer';
  } catch {
    return node('span', 'Enlace no disponible');
  }
  return e;
}
let data,
  selected,
  limit = 60,
  dirty = false;
const feedbackCurrent = (a) =>
  a.feedback &&
  a.feedback.fingerprint === a.fingerprint &&
  (!a.feedback.comparison ||
    data.articles.some(
      (other) =>
        other.id === a.feedback.comparison.id &&
        other.fingerprint === a.feedback.comparison.fingerprint,
    ));
function metric(value, label) {
  const e = node('div', null, 'metric');
  e.append(node('strong', value), node('span', label));
  return e;
}
function overview() {
  const current = data.articles.filter(feedbackCurrent);
  $('overview').replaceChildren(
    metric(data.articles.length, 'noticias en la captura'),
    metric(data.articles.filter((a) => a.category === 'rejected').length, 'descartadas'),
    metric(
      data.articles.filter((a) => ['duplicate', 'candidate'].includes(a.category)).length,
      'duplicados / candidatos',
    ),
    metric(current.filter((a) => a.feedback.verdict !== 'unrated').length, 'decisiones evaluadas'),
    metric(
      current.filter((a) => a.feedback.verdict === 'incorrect').length,
      'decisiones a corregir',
    ),
  );
}
function matches(a) {
  const term = $('search').value.toLowerCase();
  const cat = $('category').value;
  const f = $('feedback-filter').value;
  return (
    (!term ||
      [a.title, a.titleEs, a.url, JSON.stringify(a.selectionReasons), a.relevance?.reason]
        .join(' ')
        .toLowerCase()
        .includes(term)) &&
    (cat === 'all' ||
      (cat === 'duplicates'
        ? ['duplicate', 'candidate'].includes(a.category)
        : cat === a.category)) &&
    ($('source').value === 'all' || $('source').value === a.source) &&
    (f === 'all' ||
      (f === 'none'
        ? !feedbackCurrent(a) || a.feedback.verdict === 'unrated'
        : f === 'stale'
          ? a.feedback && !feedbackCurrent(a)
          : feedbackCurrent(a) && a.feedback.verdict === f))
  );
}
function list() {
  const rows = data.articles.filter(matches);
  $('list-count').textContent =
    `${rows.length} resultados · mostrando ${Math.min(limit, rows.length)}`;
  $('list').replaceChildren(
    ...rows.slice(0, limit).map((a) => {
      const e = node('button', null, `row${selected === a.id ? ' active' : ''}`);
      e.append(
        node('strong', a.titleEs || a.title || a.id),
        node('small', `${a.source} · ${names[a.category] ?? a.category}`),
      );
      if (a.feedback)
        e.append(
          node(
            'small',
            !feedbackCurrent(a)
              ? '↻ Feedback de una evaluación anterior'
              : {
                  correct: '✓ Decisión correcta',
                  incorrect: '✕ Decisión incorrecta',
                  unrated: 'Comentario guardado',
                }[a.feedback.verdict],
          ),
        );
      e.onclick = () => {
        if (dirty && !confirm('Tienes cambios sin guardar. ¿Quieres descartarlos?')) return;
        selected = a.id;
        dirty = false;
        list();
        detail(a);
      };
      return e;
    }),
  );
  $('more').hidden = rows.length <= limit;
}
function section(title, text, open = false) {
  const d = node('details');
  d.open = open;
  d.append(node('summary', title), node('div', text || 'No disponible en esta captura.', 'text'));
  return d;
}
function detail(a) {
  const root = $('detail');
  root.replaceChildren();
  root.append(
    node('span', names[a.category] ?? a.category, 'badge'),
    node('span', a.source, 'badge'),
    node('h2', a.titleEs || a.title || a.id),
  );
  if (a.titleEs && a.titleEs !== a.title) root.append(node('p', a.title, 'muted'));
  root.append(
    link(a.url),
    node(
      'p',
      `Estado técnico: ${a.state} · decisión editorial: ${a.editorialStatus ?? 'sin decisión registrada'} · puntuación: ${a.editorialScore ?? a.decision?.score ?? '—'}`,
      'muted',
    ),
  );
  if (a.ingestionShadow)
    root.append(
      node(
        'p',
        'Oculta por el piloto (shadow). Una evaluación aceptada no implica que se haya publicado.',
        'reason',
      ),
    );
  root.append(
    node(
      'p',
      `Motivos: ${[...(a.selectionReasons ?? []), a.relevance?.reason].filter(Boolean).join(' · ') || 'Sin motivo registrado'}`,
      'reason',
    ),
  );
  const summary = section(
    'Resumen y puntos clave',
    [
      a.abstract,
      ...(a.keyPoints ?? []).map((x) => (typeof x === 'string' ? `• ${x}` : JSON.stringify(x))),
    ]
      .filter(Boolean)
      .join('\n\n'),
    true,
  );
  root.append(summary);
  if (a.summaryScope || a.summaryBasis)
    root.append(
      node(
        'p',
        `Alcance del resumen: ${a.summaryScope ?? '—'} · base: ${typeof a.summaryBasis === 'object' ? JSON.stringify(a.summaryBasis) : (a.summaryBasis ?? '—')}`,
        'muted',
      ),
    );
  root.append(
    section(
      `Texto disponible para contrastar${a.bodyTruncated ? ' (extracto: primeros 16.000 caracteres)' : ''}`,
      a.excerpt,
    ),
  );
  const targetId =
    (feedbackCurrent(a) && a.feedback.comparison?.id) || a.duplicateOf || a.duplicateCandidateOf;
  root.append(node('h3', 'Contrastar con otra noticia'));
  const pairLabel = node('label', 'Noticia para comparar (opcional)');
  const pair = node('select');
  pair.id = 'comparison';
  pair.setAttribute('aria-label', 'Noticia para comparar (opcional)');
  const empty = node('option', 'Seleccionar otra noticia…');
  empty.value = '';
  pair.append(empty);
  for (const other of data.articles.filter((other) => other.id !== a.id)) {
    const option = node('option', `${other.titleEs || other.title} · ${other.source}`);
    option.value = other.id;
    pair.append(option);
  }
  pair.value = targetId ?? '';
  pairLabel.append(pair);
  root.append(pairLabel);
  const comparisonArea = node('div');
  root.append(comparisonArea);
  function renderPair() {
    comparisonArea.replaceChildren();
    if (!pair.value) {
      if (targetId && !data.articles.some((other) => other.id === targetId))
        comparisonArea.append(node('p', `La noticia ${targetId} no está en esta captura.`));
      return;
    }
    const compareId = pair.value;
    comparisonArea.append(
      node(
        'p',
        'Tu comparación es feedback humano. No modifica las agrupaciones automáticas.',
        'muted',
      ),
    );
    if (compareId === a.duplicateOf || compareId === a.duplicateCandidateOf)
      comparisonArea.append(
        node(
          'p',
          a.duplicateOf
            ? 'Duplicado confirmado por Andes'
            : 'Candidato de Andes: no es una fusión confirmada',
          'reason',
        ),
      );
    const grid = node('div', null, 'compare');
    const target = data.articles.find((x) => x.id === compareId);
    for (const item of [a, target]) {
      const e = node('div');
      if (!item) e.append(node('p', `La noticia ${compareId} no está en esta captura.`));
      else {
        e.append(
          node('strong', item.titleEs || item.title),
          node('p', item.source, 'muted'),
          link(item.url),
          section('Resumen / texto', item.abstract || item.excerpt, true),
        );
      }
      grid.append(e);
    }
    comparisonArea.append(
      grid,
      node('p', `Método automático: ${a.dedupMethod ?? 'sin registro'}`, 'muted'),
    );
  }
  renderPair();
  const provenance = node('details');
  provenance.append(
    node('summary', `Apariciones de esta URL: ${a.occurrences?.length ?? 0}`),
    node(
      'p',
      'Varias apariciones de una misma URL se agrupan en una noticia. No equivalen a dos artículos distintos.',
      'muted',
    ),
  );
  for (const o of a.occurrences ?? []) {
    const p = node('p', `${o.source} · ${o.externalId ?? ''} `);
    if (o.url) p.append(link(o.url, 'Ver fuente ↗'));
    provenance.append(p);
  }
  root.append(provenance);
  const technical = node('details');
  technical.append(
    node('summary', 'Registro automático / auditoría'),
    node(
      'pre',
      JSON.stringify(
        {
          id: a.id,
          fingerprint: a.fingerprint,
          decision: a.decision,
          relevance: a.relevance,
          publishedToFeedAt: a.publishedToFeedAt,
          editorialReviewed: a.editorialReviewed,
        },
        null,
        2,
      ),
    ),
  );
  root.append(technical);
  feedbackForm(a, root, pair);
  pair.onchange = () => {
    dirty = true;
    renderPair();
    const duplicate = root.querySelector('select[name="duplicate"]');
    duplicate.value = 'unspecified';
    duplicate.disabled = !pair.value;
    $('save-status').textContent = 'Comparación cambiada. Cambios sin guardar';
  };
}
function feedbackForm(a, root, pair) {
  const f = feedbackCurrent(a) ? a.feedback : {};
  const form = node('form', null, 'feedback');
  form.append(node('h3', 'Tu evaluación'));
  if (a.feedback && !feedbackCurrent(a))
    form.append(
      node(
        'p',
        'Hay feedback de una evaluación anterior. Se conserva en el historial; revisa esta versión de nuevo.',
        'reason',
      ),
    );
  const field = node('fieldset');
  field.append(node('legend', '¿La decisión de Andes es correcta?'));
  const choices = node('div', null, 'choices');
  for (const [value, label] of [
    ['correct', 'Está bien'],
    ['incorrect', 'Está mal'],
    ['unrated', 'Sin evaluar'],
  ]) {
    const l = node('label');
    const input = node('input');
    input.type = 'radio';
    input.name = 'verdict';
    input.value = value;
    input.checked = (f.verdict ?? 'unrated') === value;
    l.append(input, node('span', label));
    choices.append(l);
  }
  field.append(choices);
  form.append(field);
  const fields = node('div', null, 'fields');
  for (const [key, label, options] of [
    [
      'expected',
      '¿Qué debería hacer Andes?',
      [
        ['unspecified', 'Sin preferencia'],
        ['accept', 'Publicar'],
        ['reject', 'Descartar'],
        ['review', 'Enviar a revisión'],
      ],
    ],
    [
      'summary',
      '¿El resumen es fiel?',
      [
        ['unspecified', 'Sin evaluar'],
        ['faithful', 'Sí, es fiel'],
        ['errors', 'Tiene errores / falta información'],
      ],
    ],
    [
      'duplicate',
      '¿Son el mismo hecho?',
      [
        ['unspecified', 'Sin evaluar'],
        ['same', 'Sí, duplicados'],
        ['different', 'No, noticias distintas'],
      ],
    ],
  ]) {
    const l = node('label', label);
    const select = node('select');
    select.name = key;
    select.setAttribute('aria-label', label);
    if (key === 'duplicate') select.disabled = !pair.value;
    for (const [value, text] of options) {
      const o = node('option', text);
      o.value = value;
      select.append(o);
    }
    select.value = f[key] ?? 'unspecified';
    l.append(select);
    fields.append(l);
  }
  form.append(fields);
  const l = node('label', 'Comentario: qué corregir y por qué');
  const note = node('textarea');
  note.name = 'note';
  note.maxLength = 4000;
  note.value = f.note ?? '';
  note.placeholder =
    'Ej.: son noticias distintas: una anuncia el modelo y la otra compara sus resultados.';
  l.append(note);
  form.append(l);
  const button = node('button', 'Guardar feedback');
  button.id = 'save';
  button.type = 'submit';
  const status = node('span', '');
  status.id = 'save-status';
  status.setAttribute('role', 'status');
  form.append(
    button,
    status,
    node(
      'p',
      'Se guarda localmente con historial. No cambia el feed ni entrena automáticamente el modelo.',
      'muted',
    ),
  );
  form.oninput = () => {
    dirty = true;
    status.textContent = 'Cambios sin guardar';
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = 'Guardando…';
    try {
      const values = Object.fromEntries(new FormData(form));
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId: a.id,
          fingerprint: a.fingerprint,
          duplicate: 'unspecified',
          comparisonId: pair.value || undefined,
          comparisonFingerprint: data.articles.find((other) => other.id === pair.value)
            ?.fingerprint,
          ...values,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'No se pudo guardar');
      a.feedback = result.feedback;
      dirty = false;
      status.textContent = '✓ Guardado';
      overview();
      list();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  root.append(form);
}
try {
  const response = await fetch('/api/review');
  if (!response.ok) throw new Error('No se pudo cargar la captura');
  data = await response.json();
  for (const source of [...new Set(data.articles.map((a) => a.source))].sort()) {
    const o = node('option', source);
    o.value = source;
    $('source').append(o);
  }
  for (const id of ['search', 'category', 'source', 'feedback-filter'])
    $(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
      limit = 60;
      list();
    });
  $('more').onclick = () => {
    limit += 60;
    list();
  };
  $('snapshot').textContent =
    `Captura: ${new Date(data.capturedAt).toLocaleString('es')} · ${data.total} registros completos del inventario. El texto puede estar limitado a un extracto. Reinicia el panel tras actualizar la captura.`;
  overview();
  list();
} catch (error) {
  $('detail').textContent = error.message;
}
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
