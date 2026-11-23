import { usePagination } from './usePagination';
import Pager from './Pager';

// Pages a plain list (not a table): one page of items, then the page control.
// Nothing extra shows while everything fits on one page.
export default function PagedList({ items, render, size = 10, label = 'items' }) {
  const pg = usePagination(items, size);
  return (
    <>
      {pg.pageItems.map((item, i) => render(item, (pg.page - 1) * pg.pageSize + i))}
      {pg.total > pg.pageSize && <div className="pt-2"><Pager {...pg} label={label} /></div>}
    </>
  );
}
