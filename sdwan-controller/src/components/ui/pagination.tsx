import { Button } from './button';
import { Select } from './select';

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  pageSizeId: string;
  itemLabel?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};
export function Pagination({
  page,
  pageSize,
  total,
  loading,
  pageSizeId,
  itemLabel = 'items',
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <label htmlFor={pageSizeId}>Rows per page</label>
        <Select
          id={pageSizeId}
          controlSize="sm"
          containerClassName="w-auto"
          className="min-w-16 font-medium"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {[10, 25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </div>
      <nav aria-label="Table pagination" className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </nav>
      <span className="w-full text-center tabular-nums sm:w-auto sm:text-right">
        Page {page} of {pageCount} · {total} {itemLabel}
      </span>
    </div>
  );
}
