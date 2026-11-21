const REVISION_PATTERN =
  /^[0-9a-f]{40}$/u;

const SHA256_PATTERN =
  /^[0-9a-f]{64}$/u;

export function portableReleaseInstallFailure(
  message: string,
  options?: ErrorOptions,
): Error {
  return new Error(
    `Portable release installation failed: ${message}`,
    options,
  );
}

export function isPortableReleaseRevision(
  value: string,
): boolean {
  return REVISION_PATTERN.test(
    value,
  );
}

export function requirePortableReleaseRevision(
  value: string,
): string {
  if (
    !isPortableReleaseRevision(
      value,
    )
  ) {
    throw portableReleaseInstallFailure(
      "Expected reviewed revision must be exactly 40 lowercase hexadecimal characters.",
    );
  }

  return value;
}
export function isPortableReleaseSha256(
  value: string,
): boolean {
  return SHA256_PATTERN.test(
    value,
  );
}

export function requirePortableReleaseSha256(
  value: string,
  label: string,
): string {
  if (
    !isPortableReleaseSha256(
      value,
    )
  ) {
    throw portableReleaseInstallFailure(
      `${label} must be exactly 64 lowercase hexadecimal characters.`,
    );
  }

  return value;
}
