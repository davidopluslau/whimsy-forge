const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** 128 random bits as 22 base64url characters. */
export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function isDesignId(id: string): boolean {
  return ID_PATTERN.test(id);
}
