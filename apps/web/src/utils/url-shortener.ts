/**
 * Shorten a URL using the is.gd service.
 * Falls back to the original URL if shortening fails.
 */
export async function shortenUrl(url: string): Promise<string> {
  try {
    const response = await fetch(
      `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`,
    );
    if (!response.ok) {
      console.warn("[URL Shortener] Service returned error:", response.status);
      return url;
    }
    const data = await response.json();
    if (data.shorturl) {
      return data.shorturl;
    }
    console.warn("[URL Shortener] No shorturl in response:", data);
    return url;
  } catch (error) {
    console.warn(
      "[URL Shortener] Failed to shorten URL, using original:",
      error,
    );
    return url;
  }
}
