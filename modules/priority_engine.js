'use strict';

// Injecte les items "média prioritaire" dans la rotation normale, espacés régulièrement,
// au lieu de les laisser inertes à leur position d'origine (comportement précédent : le
// flag priority_* était transmis au player mais jamais exploité pour réordonner la séquence).
function interleavePriorityItems(items, getMeta) {
  const base = [];
  const priorityItems = [];
  for (const item of items) {
    const meta = getMeta(item);
    if (meta.isPriority) priorityItems.push({ item, meta });
    else base.push({ item, meta });
  }
  if (!priorityItems.length || !base.length) return items;

  const cycleSeconds = base.reduce((sum, b) => sum + (b.meta.playForever ? 0 : b.meta.durationSeconds), 0) || base.length;

  const insertions = [];
  for (const { item, meta } of priorityItems) {
    const intervalMinutes = meta.intervalMinutes > 0 ? meta.intervalMinutes : 1;
    const count = meta.count > 0 ? meta.count : 1;
    const spacingSeconds = (intervalMinutes * 60) / count;
    // Au moins 1 passage par cycle, au plus 1 par item de base (pas de state cross-cycle en v1).
    const occurrences = Math.max(1, Math.min(base.length, Math.round(cycleSeconds / spacingSeconds)));
    const step = base.length / occurrences;
    for (let k = 0; k < occurrences; k++) {
      insertions.push({ afterIndex: Math.min(base.length - 1, Math.round(k * step)), item });
    }
  }
  insertions.sort((a, b) => a.afterIndex - b.afterIndex);

  const result = [];
  let cursor = 0;
  base.forEach(({ item }, idx) => {
    result.push(item);
    while (cursor < insertions.length && insertions[cursor].afterIndex === idx) {
      result.push(insertions[cursor].item);
      cursor++;
    }
  });
  while (cursor < insertions.length) { result.push(insertions[cursor].item); cursor++; }

  return result;
}

module.exports = { interleavePriorityItems };
