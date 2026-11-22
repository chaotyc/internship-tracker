/** Sort key for a card dropped at `index` among `orders` (already sorted, card itself excluded). */
export function orderAt(orders: number[], index: number): number {
  const i = Math.max(0, Math.min(index, orders.length))
  const prev = orders[i - 1]
  const next = orders[i]
  if (prev != null && next != null) return (prev + next) / 2
  if (prev != null) return prev + 1024
  if (next != null) return next - 1024
  return 1024
}
