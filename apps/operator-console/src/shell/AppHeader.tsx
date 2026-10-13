import { Menu } from "lucide-react";
import type { Ref } from "react";

import { IconButton } from "../design-system";
import { productIdentity } from "../productIdentity";
import styles from "./AppHeader.module.css";

export type AppHeaderNavigationControl = Readonly<{
  dialogId: string;
  isOpen: boolean;
  triggerRef: Ref<HTMLButtonElement>;
  onOpen: () => void;
}>;

export function AppHeader({ navigation }: Readonly<{ navigation: AppHeaderNavigationControl }>) {
  return (
    <header className={styles.header}>
      {/* Mobile/narrow trigger for the modal drawer; hidden at >= 64rem. */}
      <div className={styles.menuButton}>
        <IconButton
          ref={navigation.triggerRef}
          label="Open navigation"
          icon={Menu}
          aria-controls={navigation.dialogId}
          aria-expanded={navigation.isOpen}
          onClick={navigation.onOpen}
        />
      </div>
      <p className={styles.wordmark}>
        <span className={styles.productName}>{productIdentity.productName}</span>
        <span className={styles.consoleName}>{productIdentity.consoleName}</span>
      </p>
      <ul className={styles.badges} aria-label="Console mode">
        <li className={styles.badge}>Local</li>
        <li className={styles.badge}>Read-only</li>
      </ul>
    </header>
  );
}
