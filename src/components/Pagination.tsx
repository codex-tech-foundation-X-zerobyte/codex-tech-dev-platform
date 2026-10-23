import { pageCount, rangeText } from '../lib/format'

type Props = { total: number; page: number; size: number; onPage: (p: number) => void }

export function Pagination({ total, page, size, onPage }: Props) {
  const pages = pageCount(total, size)
  return (
    <nav className="row between wrap pad" aria-label="Pagination">
      <span className="mu" aria-live="polite">{rangeText(total, page, size)}</span>
      <div className="row wrap">
        <button className="btn sm" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="btn sm" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </nav>
  )
}
