import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { IconButton } from "../design-system";
import { DESKTOP_MEDIA_QUERY } from "./navigation";
import styles from "./NavigationDrawer.module.css";

// Native <dialog> navigation drawer (Step 992A section 3).
// - Opens only with showModal(); native modality provides the top layer,
//   background inertness and focus containment (no hand-written focus trap,
//   no global aria-hidden).
// - The dialog's native "close" event is the single source of truth for the
//   closed transition; every close path goes through requestClose(reason) or
//   the browser (Escape), so React state always mirrors dialog.open.
// - Background scrolling is locked through a data attribute on <html> for the
//   open lifetime and restored exactly on every close path and on unmount.

export type DrawerCloseReason = "button" | "escape" | "backdrop" | "navigation" | "viewport";

export const SCROLL_LOCK_ATTRIBUTE = "data-scroll-lock";
const SCROLL_LOCK_VALUE = "navigation-drawer";

export type NavigationDrawerController = Readonly<{
  dialogId: string;
  isOpen: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  open: () => void;
  requestClose: (reason: DrawerCloseReason) => void;
}>;

function isDesktopViewport(): boolean {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

export function useNavigationDrawer(
  desktopFocusFallbackRef: RefObject<HTMLElement | null>,
): NavigationDrawerController {
  const dialogId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeReasonRef = useRef<DrawerCloseReason | null>(null);
  // undefined = no lock held; null = lock held and the attribute was absent.
  const previousScrollLockRef = useRef<string | null | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);

  const acquireScrollLock = useCallback(() => {
    if (previousScrollLockRef.current !== undefined) {
      return;
    }

    const root = document.documentElement;
    previousScrollLockRef.current = root.getAttribute(SCROLL_LOCK_ATTRIBUTE);
    root.setAttribute(SCROLL_LOCK_ATTRIBUTE, SCROLL_LOCK_VALUE);
  }, []);

  const releaseScrollLock = useCallback(() => {
    const previous = previousScrollLockRef.current;

    if (previous === undefined) {
      return;
    }

    previousScrollLockRef.current = undefined;
    const root = document.documentElement;

    if (previous === null) {
      root.removeAttribute(SCROLL_LOCK_ATTRIBUTE);
    } else {
      root.setAttribute(SCROLL_LOCK_ATTRIBUTE, previous);
    }
  }, []);

  const open = useCallback(() => {
    const dialog = dialogRef.current;

    if (dialog === null || dialog.open) {
      return;
    }

    closeReasonRef.current = null;
    dialog.showModal();
    acquireScrollLock();
    setIsOpen(true);
    // Deliberate initial focus; never left to incidental DOM order.
    closeButtonRef.current?.focus();
  }, [acquireScrollLock]);

  const requestClose = useCallback((reason: DrawerCloseReason) => {
    const dialog = dialogRef.current;

    if (dialog === null || !dialog.open) {
      return;
    }

    closeReasonRef.current = reason;
    dialog.close();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog === null) {
      return undefined;
    }

    // Pending one-frame retry of the desktop focus transfer (0 = none).
    let pendingFrame = 0;

    // Focus is "lost" when it is nowhere, on <body>, still in the closed
    // dialog, or on the mobile trigger, which is not displayed at >= 64rem.
    function isFocusLost(): boolean {
      const active = document.activeElement;

      return (
        active === null ||
        active === document.body ||
        active === triggerRef.current ||
        (dialog !== null && dialog.contains(active))
      );
    }

    function focusDesktopFallback(): boolean {
      const fallback = desktopFocusFallbackRef.current;

      if (fallback === null || !fallback.isConnected) {
        return false;
      }

      if (isFocusLost()) {
        fallback.focus();
      }

      return document.activeElement === fallback || !isFocusLost();
    }

    function handleClose() {
      // A close without a recorded reason is the browser's own Escape path.
      const reason = closeReasonRef.current ?? "escape";
      closeReasonRef.current = null;
      setIsOpen(false);
      releaseScrollLock();

      if (reason === "viewport") {
        // Never focus the now-hidden mobile trigger. The browser's native
        // close() has already tried to restore focus to it, which at >= 64rem
        // leaves focus on the hidden trigger, in the dialog or on <body>.
        // Move lost focus to the visible desktop current-page link; if that
        // link is not focusable until the new-width style is applied, retry
        // exactly once on the next animation frame.
        if (!focusDesktopFallback()) {
          cancelAnimationFrame(pendingFrame);
          pendingFrame = requestAnimationFrame(() => {
            pendingFrame = 0;
            focusDesktopFallback();
          });
        }

        return;
      }

      const trigger = triggerRef.current;

      if (trigger !== null && trigger.isConnected && !isDesktopViewport()) {
        trigger.focus();
      }
    }

    dialog.addEventListener("close", handleClose);

    return () => {
      dialog.removeEventListener("close", handleClose);
      cancelAnimationFrame(pendingFrame);
    };
  }, [desktopFocusFallbackRef, releaseScrollLock]);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_MEDIA_QUERY);

    function handleChange() {
      if (query.matches) {
        requestClose("viewport");
      }
    }

    query.addEventListener("change", handleChange);

    return () => {
      query.removeEventListener("change", handleChange);
    };
  }, [requestClose]);

  // Unmount: never leave the document scroll-locked.
  useEffect(() => releaseScrollLock, [releaseScrollLock]);

  return {
    dialogId,
    isOpen,
    dialogRef,
    triggerRef,
    closeButtonRef,
    open,
    requestClose,
  };
}

export type NavigationDrawerProps = Readonly<{
  controller: NavigationDrawerController;
  children: ReactNode;
}>;

export function NavigationDrawer({ controller, children }: NavigationDrawerProps) {
  // Dismiss only when the interaction lands on the dialog itself (the area
  // outside the panel, i.e. the backdrop); panel clicks never bubble into a
  // dismissal.
  function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      controller.requestClose("backdrop");
    }
  }

  return (
    <dialog
      id={controller.dialogId}
      ref={controller.dialogRef}
      aria-label="Navigation"
      className={styles.dialog}
      onClick={handleDialogClick}
    >
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <IconButton
            ref={controller.closeButtonRef}
            label="Close navigation"
            icon={X}
            onClick={() => controller.requestClose("button")}
          />
        </div>
        {controller.isOpen ? children : null}
      </div>
    </dialog>
  );
}
