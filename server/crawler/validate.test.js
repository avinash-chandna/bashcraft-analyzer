import test from "node:test";
import assert from "node:assert/strict";
import { InputError, validateScanPayload } from "./validate.js";

test("validateScanPayload coerces a bare domain and applies defaults", () => {
  const result = validateScanPayload({ url: "bashcraftclub.vercel.app" });
  assert.equal(result.startUrl, "https://bashcraftclub.vercel.app/");
  assert.equal(result.siteKey, "bashcraftclub.vercel.app");
  assert.deepEqual(result.options, {
    maxPages: 25,
    maxDepth: 3,
    renderJs: true,
    respectRobots: true,
    timeoutMs: 15000,
  });
});

test("validateScanPayload accepts explicit limits and booleans", () => {
  const result = validateScanPayload({
    url: "https://example.com/path/",
    maxPages: 50,
    maxDepth: 5,
    renderJs: false,
    respectRobots: false,
    timeoutMs: 30000,
  });
  assert.equal(result.startUrl, "https://example.com/path");
  assert.equal(result.options.maxPages, 50);
  assert.equal(result.options.maxDepth, 5);
  assert.equal(result.options.renderJs, false);
  assert.equal(result.options.respectRobots, false);
  assert.equal(result.options.timeoutMs, 30000);
});

test("validateScanPayload rejects missing, malformed, and credentialed URLs", () => {
  assert.throws(() => validateScanPayload({}), (error) => {
    assert.ok(error instanceof InputError);
    assert.equal(error.code, "URL_REQUIRED");
    return true;
  });
  assert.throws(() => validateScanPayload({ url: "ftp://example.com" }), (error) => {
    assert.equal(error.code, "INVALID_URL");
    return true;
  });
  assert.throws(
    () => validateScanPayload({ url: "https://user:pass@example.com/" }),
    (error) => {
      assert.equal(error.code, "URL_CREDENTIALS");
      return true;
    },
  );
});

test("validateScanPayload rejects out-of-range and non-boolean options", () => {
  assert.throws(
    () => validateScanPayload({ url: "https://example.com", maxPages: 0 }),
    (error) => {
      assert.equal(error.code, "INVALID_OPTION");
      return true;
    },
  );
  assert.throws(
    () => validateScanPayload({ url: "https://example.com", maxDepth: 9 }),
    (error) => {
      assert.equal(error.code, "INVALID_OPTION");
      return true;
    },
  );
  assert.throws(
    () => validateScanPayload({ url: "https://example.com", renderJs: "yes" }),
    (error) => {
      assert.equal(error.code, "INVALID_OPTION");
      return true;
    },
  );
  assert.throws(
    () => validateScanPayload({ url: "https://example.com", timeoutMs: 1000 }),
    (error) => {
      assert.equal(error.code, "INVALID_OPTION");
      return true;
    },
  );
});

test("very long URLs are rejected before any network request", () => {
  assert.throws(
    () => validateScanPayload({ url: `https://example.com/${"a".repeat(2100)}` }),
    (error) => {
      assert.equal(error.code, "URL_TOO_LONG");
      return true;
    },
  );
});
