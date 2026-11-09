import type { AnchorHTMLAttributes, ReactNode } from "react";

type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> & {
  href: string;
  variant?: "primary" | "secondary" | "inverse" | "ghost-inverse";
  size?: "default" | "large";
  block?: boolean;
  className?: string;
  children: ReactNode;
};

/** A navigation link styled as a button. Always a real link with a real destination. */
export function ButtonLink({
  href,
  variant = "primary",
  size = "default",
  block = false,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const classes = [
    "button",
    `button--${variant}`,
    size === "large" ? "button--large" : null,
    block ? "button--block" : null,
    className ?? null,
  ]
    .filter((value) => value !== null)
    .join(" ");

  return (
    <a href={href} className={classes} {...rest}>
      {children}
    </a>
  );
}
