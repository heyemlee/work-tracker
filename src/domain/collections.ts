export function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export function indexBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T> {
  return new Map(items.map((item) => [keyOf(item), item]));
}
