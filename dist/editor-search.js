function escapePattern(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function findMatches(source, query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  if (!query) return { matches: [], error: '' };
  let pattern;
  try { pattern = new RegExp(wholeWord ? `\\b(?:${regex ? query : escapePattern(query)})\\b` : regex ? query : escapePattern(query), `g${caseSensitive ? '' : 'i'}`); }
  catch (error) { return { matches: [], error: error.message }; }
  const matches = [];
  for (const match of source.matchAll(pattern)) {
    if (!match[0].length) continue;
    matches.push({ start: match.index, end: match.index + match[0].length, text: match[0], groups: match.slice(1) });
    if (matches.length >= 10000) break;
  }
  return { matches, error: '' };
}

export function replaceMatches(source, matches, replacement, { regex = false, all = false, current = 0 } = {}) {
  const targets = all ? matches : matches[current] ? [matches[current]] : [];
  if (!targets.length) return { source, count: 0, cursor: 0 };
  let result = '', offset = 0, cursor = targets[0].start;
  for (const match of targets) {
    let value = replacement;
    if (regex) value = replacement.replace(/\$(\$|&|\d+)/g, (_, token) => token === '$' ? '$' : token === '&' ? match.text : match.groups[Number(token) - 1] ?? '');
    result += source.slice(offset, match.start) + value;
    offset = match.end;
    cursor = result.length;
  }
  return { source: result + source.slice(offset), count: targets.length, cursor };
}
