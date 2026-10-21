export function shortHex(h: string, head = 6, tail = 4) {
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function isoTime(unixSeconds: bigint) {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
