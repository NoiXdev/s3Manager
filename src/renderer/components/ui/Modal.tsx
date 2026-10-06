import { useEffect, useRef, type ReactNode } from 'react';

type ModalRef = { current: HTMLElement | null };

// Open modals, bottom to top. Escape is handled by the top-most one only, so dismissing a
// nested dialog (e.g. a ConfirmDialog inside another Modal) leaves the dialog beneath it open.
const modalStack: ModalRef[] = [];

function pushModal(ref: ModalRef) {
  // Effects of a nested modal commit before its ancestor's. When both mount in the same commit,
  // keep the ancestor below the modal rendered inside it.
  const el = ref.current;
  const i = el ? modalStack.findIndex((m) => m.current !== null && m.current !== el && el.contains(m.current)) : -1;
  if (i === -1) modalStack.push(ref);
  else modalStack.splice(i, 0, ref);
}

function removeModal(ref: ModalRef) {
  const i = modalStack.indexOf(ref);
  if (i !== -1) modalStack.splice(i, 1);
}

export function Modal({
  onDismiss,
  className,
  children,
}: {
  onDismiss: () => void;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Registered once per mount: re-registering on every onDismiss change would move this modal
  // to the top of the stack.
  useEffect(() => {
    const ref = rootRef;
    pushModal(ref);
    return () => removeModal(ref);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === rootRef) onDismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className={className ?? 'rounded bg-white p-4 shadow-lg dark:bg-slate-900'}>{children}</div>
    </div>
  );
}
