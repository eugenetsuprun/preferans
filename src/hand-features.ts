// Suit canonicalization lets a small model share what it learns about the same
// rank pattern in different suits. Inputs contain only the player's own hand
// and private discard; no opponent identities are used.
export function handFeatures(
  hand: number[],
  trump: number,
  first: number,
  discarded: number[] = [],
): number[] {
  const masks = [0, 0, 0, 0],
    discards = [0, 0, 0, 0];
  for (const c of hand) masks[Math.floor(c / 8)] |= 1 << (c % 8);
  for (const c of discarded) discards[Math.floor(c / 8)] |= 1 << (c % 8);
  const count = (mask: number) =>
    Array.from({ length: 8 }, (_, r) => (mask >> r) & 1).reduce(
      (a, b) => a + b,
      0,
    );
  const order = [0, 1, 2, 3]
    .filter((s) => s !== trump)
    .sort(
      (a, b) =>
        count(masks[b]) - count(masks[a]) ||
        masks[b] - masks[a] ||
        discards[b] - discards[a],
    );
  if (trump < 4) order.unshift(trump);
  const features: number[] = [];
  for (const s of order) {
    const mask = masks[s];
    for (let r = 0; r < 8; r++) features.push((mask >> r) & 1);
    for (let r = 0; r < 8; r++) features.push((discards[s] >> r) & 1);
    let top = 0,
      low = 0;
    while (top < 8 && mask & (1 << (7 - top))) top++;
    while (low < 8 && mask & (1 << low)) low++;
    features.push(count(mask) / 8, top / 8, low / 8);
  }
  features.push(
    Number(trump === 4),
    Number(first === 0),
    Number(first === 1),
    Number(first === 2),
  );
  return features;
}
