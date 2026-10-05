/** Path joins for script folders. The app runs on macOS and stores POSIX paths. */

export function joinPath(...parts: string[]): string {
  let result = "";
  for (const part of parts) {
    if (!part) continue;
    if (!result || part.startsWith("/")) {
      result = part;
      continue;
    }
    result = result.replace(/\/+$/, "") + "/" + part.replace(/^\/+/, "");
  }
  return result;
}
