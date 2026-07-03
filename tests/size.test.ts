import { describe, expect, it } from "vitest";
import { formatSize, parseSize } from "../src/utils/size.js";

describe("size utilities", () => {
  it("parses decimal and binary sizes", () => {
    expect(parseSize("2.5GB")).toBe(2_500_000_000);
    expect(parseSize("1 GiB")).toBe(1_073_741_824);
  });

  it("rejects malformed sizes", () => {
    expect(parseSize("huge")).toBeUndefined();
  });

  it("formats compact sizes", () => {
    expect(formatSize(2_500_000_000)).toBe("2.5 GB");
  });
});
