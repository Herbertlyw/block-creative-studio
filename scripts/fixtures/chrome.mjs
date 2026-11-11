/** Optional local Chrome executable; no machine-specific paths are committed. */
export function chromeOptions() {
  return process.env.BCS_CHROME_PATH
    ? { executablePath: process.env.BCS_CHROME_PATH }
    : { channel: 'chrome' };
}
