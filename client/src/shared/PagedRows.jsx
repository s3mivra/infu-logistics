import { usePagination } from './usePagination';
import Pager from './Pager';

// Pages a long table body in place: <tbody>{<PagedRows items={rows} render={...} />}</tbody>.
// Draws one page of rows, then a last row holding the page control, so the
// table itself needs no other change and no hook in its parent. Nothing extra
// shows while everything fits on one page. Totals rows the table has (tfoot)
// stay totals of everything, not of the page.
export default function PagedRows({ items, render, size = 25, label = 'rows' }) {
  const pg = usePagination(items, size);
  return (
    <>
      {pg.pageItems.map((item, i) => render(item, (pg.page - 1) * pg.pageSize + i))}
      {pg.total > pg.pageSize && (
        <tr className="pager-row">
          <td colSpan={99} className="px-3 pb-2"><Pager {...pg} label={label} /></td>
        </tr>
      )}
    </>
  );
}
