import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Text forms from longest to shortest: drops trailing parts, keeping the first even if it overflows. */
export function partCandidates(parts: Array<string | null | undefined | false>, sep = ' · '): string[] {
  const kept = parts.filter((p): p is string => !!p)
  return kept.map((_, i) => kept.slice(0, kept.length - i).join(sep))
}

/** Text forms from longest to shortest, cut after whole words with an ellipsis. */
export function wordCandidates(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const out = [words.join(' ')]
  for (let n = words.length - 1; n >= 1; n--) out.push(`${words.slice(0, n).join(' ').replace(/[\s,;:·–—-]+$/, '')}…`)
  return out
}

/**
 * Whether the text fits without clipping. Height uses scroll metrics (whole lines); width compares the
 * text's own fractional extent with the box, because Chromium rounds scrollWidth and hides the sub-pixel
 * overflow that still triggers an ellipsis. Single-line boxes must take their width from the container.
 */
function fits(el: HTMLElement): boolean {
  if (el.scrollHeight > el.clientHeight + 0.5) return false
  const range = document.createRange()
  range.selectNodeContents(el)
  const cs = getComputedStyle(el)
  const box = el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  return range.getBoundingClientRect().width <= box - 0.5
}

/**
 * Picks the longest candidate that fits its element without overflow, so text is never cut inside
 * a word or part. Measures in place before paint and re-measures when the container resizes.
 */
export function useFitText<T extends HTMLElement>(candidates: string[]): { ref: RefObject<T | null>; text: string } {
  const ref = useRef<T>(null)
  const key = candidates.join('\u0000')
  const [pick, setPick] = useState({ key, text: candidates[0] ?? '' })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !candidates.length) return
    const measure = () => {
      const before = el.textContent
      // Binary search for the first (longest) candidate that fits; fitting is monotonic in length.
      let lo = 0
      let hi = candidates.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        el.textContent = candidates[mid] ?? ''
        if (fits(el)) hi = mid
        else lo = mid + 1
      }
      el.textContent = before
      const text = candidates[lo] ?? ''
      setPick((cur) => (cur.key === key && cur.text === text ? cur : { key, text }))
    }
    measure()
    let live = true
    void document.fonts?.ready.then(() => live && measure())
    const box = el.parentElement ?? el
    let width = box.clientWidth
    const ro = new ResizeObserver(() => {
      if (box.clientWidth === width) return
      width = box.clientWidth
      measure()
    })
    ro.observe(box)
    return () => {
      live = false
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { ref, text: pick.key === key ? pick.text : (candidates[0] ?? '') }
}
