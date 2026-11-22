import { useEffect, useState, type RefObject } from 'react'

/** Which ends of a horizontal scroller have more content past the edge, so CSS can fade them. */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, deps: unknown[]): { start: boolean; end: boolean } {
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!el) {
      setEdges({ start: false, end: false })
      return
    }
    const update = () => {
      const start = el.scrollLeft > 1
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((cur) => (cur.start === start && cur.end === end ? cur : { start, end }))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return edges
}
