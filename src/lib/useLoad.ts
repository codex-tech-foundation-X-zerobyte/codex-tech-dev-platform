import { useCallback, useEffect, useState } from 'react'

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  const reload = useCallback(() => {
    let live = true
    setLoading(true)
    run().then((d) => { if (live) { setData(d); setError('') } })
      .catch((e: Error) => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [run])
  useEffect(() => reload(), [reload])
  return { data, error, loading, reload }
}
