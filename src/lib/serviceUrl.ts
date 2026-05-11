export function normalizeServiceUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "0.0.0.0" || url.hostname === "::" || url.hostname === "[::]") {
      url.hostname = "localhost";
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function extractServiceUrl(line: string) {
  if (!/server is listening/i.test(line)) {
    return null;
  }

  const match = line.match(/https?:\/\/[^\s'"<>）)]+/i);
  return match ? normalizeServiceUrl(match[0]) : null;
}
