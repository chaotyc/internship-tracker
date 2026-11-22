import { useEffect, useState, type RefObject } from 'react'

/**
 * Which ends of a vertical scroller have more content past the edge, so CSS can fade them
 * (the vertical counterpart of search/useEdgeFade). `deps` should change when the content does.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, deps: unknown[]): { top: boolean; bottom: boolean } {
  const [edges, setEdges] = useState({ top: false, bottom: false })
  useEffect(() => {
    const el = ref.current
    if (!el) {
      setEdges({ top: false, bottom: false })
      return
    }
    const update = () => {
      const top = el.scrollTop > 1
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
      setEdges((cur) => (cur.top === top && cur.bottom === bottom ? cur : { top, bottom }))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    if (typeof ResizeObserver === 'undefined') return () => el.removeEventListener('scroll', update)
    // The scroller and its content: either growing changes whether there is more to scroll.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return edges
}
