'use client';
export function PrintButton() {
  return (
    <button className="btn btn-secondary no-print" type="button" onClick={() => window.print()}>
      Print
    </button>
  );
}
