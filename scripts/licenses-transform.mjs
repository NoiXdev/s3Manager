/**
 * Convert license-checker-rseidelsohn's verbose output
 * ({ "name@version": { licenses, repository, ... } }) into a compact,
 * name-then-version sorted array of { name, version, license, repository }.
 */
export function transform(raw) {
  return Object.entries(raw)
    .map(([key, info]) => {
      const at = key.lastIndexOf('@');
      const name = key.slice(0, at);
      const version = key.slice(at + 1);
      const licenses = info.licenses;
      const license = Array.isArray(licenses)
        ? licenses.join(' OR ')
        : (licenses || 'UNKNOWN');
      const repository = typeof info.repository === 'string' ? info.repository : null;
      return { name, version, license, repository };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
