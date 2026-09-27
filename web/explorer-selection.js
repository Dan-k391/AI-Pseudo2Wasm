export function selectExplorerFiles(order, selected, anchor, name, { shift = false, toggle = false } = {}) {
  if (!order.includes(name)) return { selected: order.filter(file => selected.includes(file)), anchor };
  if (shift) {
    const start = order.indexOf(order.includes(anchor) ? anchor : name);
    const end = order.indexOf(name);
    const range = order.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { selected: order.filter(file => range.includes(file) || (toggle && selected.includes(file))), anchor: order[start] };
  }
  if (toggle) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    return { selected: order.filter(file => next.has(file)), anchor: name };
  }
  return { selected: [name], anchor: name };
}

export function moveExplorerFiles(order, names, target = null, after = true) {
  const moving = order.filter(name => names.includes(name));
  if (!moving.length || (target && moving.includes(target))) return [...order];
  const remaining = order.filter(name => !moving.includes(name));
  const targetIndex = target ? remaining.indexOf(target) : -1;
  const index = targetIndex < 0 ? remaining.length : targetIndex + Number(after);
  remaining.splice(index, 0, ...moving);
  return remaining;
}
