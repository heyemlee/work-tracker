import { AnimatePresence, motion } from 'motion/react';
import { dismissToast, useToasts } from '../state/toasts';

/** Toasts stack just above whatever positioned container renders this (the composer). */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-full mb-3 flex flex-col items-center gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ y: 14, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, scale: 0.9, transition: { duration: 0.14 } }}
            transition={{ type: 'spring', bounce: 0.25, duration: 0.4 }}
            className="glass glass-strong pointer-events-auto flex max-w-full items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4 text-[13px]"
          >
            <span className="truncate">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  dismissToast(toast.id);
                }}
                className="shrink-0 rounded-full px-3 py-1 font-semibold text-accent transition-colors hover:bg-fill"
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
