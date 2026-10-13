import styles from "./PageHeader.module.css";

export type PageHeaderProps = Readonly<{
  title: string;
  description?: string;
}>;

// The single h1 of a view.
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className={styles.pageHeader}>
      <h1 className={styles.title}>{title}</h1>
      {description === undefined ? null : <p className={styles.description}>{description}</p>}
    </div>
  );
}
