const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const parseAllowedOrigins = (value: string): Set<string> => {
  return new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  );
};

export const isOriginAllowed = (
  origin: string,
  allowedOrigins: ReadonlySet<string>,
  allowLoopbackOrigins: boolean
): boolean => {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  if (!allowLoopbackOrigins) {
    return false;
  }

  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      loopbackHostnames.has(url.hostname)
    );
  } catch {
    return false;
  }
};
