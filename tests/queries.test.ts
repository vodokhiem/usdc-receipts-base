import { beforeEach, describe, expect, it, vi } from "vitest";

// addWatched goes through getDb(); point it at an in-memory PGlite for the test.
vi.mock("@/db", async (orig) => {
  const mod = await orig<typeof import("@/db")>();
  let db: Promise<import("@/db").Db> | undefined;
  return { ...mod, getDb: () => (db ??= mod.openPglite()) };
});

import { addWatched } from "@/lib/queries";

describe("addWatched", () => {
  beforeEach(() => {
    process.env.MAX_WATCHED = "2";
  });
  it("checksums, dedupes, and caps the number of addresses", async () => {
    const a = await addWatched("0x1111111111111111111111111111111111111111");
    expect(a).toBe("0x1111111111111111111111111111111111111111");
    await addWatched("0x1111111111111111111111111111111111111111"); // duplicate: fine
    await addWatched("0x2222222222222222222222222222222222222222");
    await expect(addWatched("0x3333333333333333333333333333333333333333")).rejects.toThrow(/at most 2/);
    await expect(addWatched("nope")).rejects.toThrow(/valid EVM address/);
  });
});
