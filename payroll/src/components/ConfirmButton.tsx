'use client';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/** Submit button that asks for confirmation and shows a busy state while the server works. */
export function ConfirmButton({
  children,
  confirm,
  className = 'btn',
  name,
  value,
}: {
  children: ReactNode;
  confirm?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
