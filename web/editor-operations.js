export function lineStartOffset(source, lineNumber) {
  let offset = 0;
  for (let line = 1; line < lineNumber; line++) {
    const next = source.indexOf('\n', offset);
    if (next < 0) return source.length;
    offset = next + 1;
  }
  return offset;
}

export function moveSelectedLines(source, selectionStart, selectionEnd, direction) {
  if (direction !== -1 && direction !== 1) return null;
  const first = source.lastIndexOf('\n', selectionStart - 1) + 1;
  // A selection ending just after a newline does not include the following line.
  const lastOffset = selectionEnd > selectionStart && source[selectionEnd - 1] === '\n'
    ? selectionEnd - 1 : selectionEnd;
  const newline = source.indexOf('\n', lastOffset);
  const last = newline < 0 ? source.length : newline;
  const block = source.slice(first, last);
  let text, shift;

  if (direction < 0) {
    if (first === 0) return null;
    const previousStart = source.lastIndexOf('\n', first - 2) + 1;
    const previous = source.slice(previousStart, first - 1);
    text = source.slice(0, previousStart) + block + '\n' + previous + source.slice(last);
    shift = -(previous.length + 1);
  } else {
    if (newline < 0) return null;
    const nextStart = newline + 1;
    const nextNewline = source.indexOf('\n', nextStart);
    const nextEnd = nextNewline < 0 ? source.length : nextNewline;
    const next = source.slice(nextStart, nextEnd);
    text = source.slice(0, first) + next + '\n' + block + source.slice(nextEnd);
    shift = next.length + 1;
  }

  return {
    text,
    start: Math.max(0, Math.min(text.length, selectionStart + shift)),
    end: Math.max(0, Math.min(text.length, selectionEnd + shift)),
  };
}
