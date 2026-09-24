import { AnimatePresence, motion } from 'motion/react';
import { dismissToast, useToasts } from '../state/toasts';

/** Toasts stack at the bottom of the window, centered on the content beside the sidebar. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(20px,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:pl-[280px]"
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
