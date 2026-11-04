import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicDestination,
  isPrivateIp,
  shouldAllowPrivateHosts,
} from "./ssrf.js";

test("private IPv4 ranges are blocked", () => {
  for (const ip of [
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.5",
    "203.0.113.10",
    "224.0.0.1",
    "240.0.0.1",
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
});

test("public IPv4 addresses are allowed", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.32.0.1"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test("loopback, link-local, unique-local, and documentation IPv6 are blocked", () => {
  for (const ip of [
    "::1",
    "::",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "100::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
  assert.equal(isPrivateIp("2001:4860:4860::8888"), false);
});

test("invalid IP strings are not classified as private", () => {
  assert.equal(isPrivateIp("not-an-ip"), false);
  assert.equal(isPrivateIp(""), false);
});

test("destination checks block loopback, localhost, and cloud metadata", async () => {
  const cases = [
    "http://127.0.0.1:3000/",
    "http://localhost:8787/",
    "http://app.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
  ];
  for (const url of cases) {
    const result = await assertPublicDestination(new URL(url));
    assert.equal(result.allowed, false, url);
  }
});

test("destination checks allow public IP literals", async () => {
  const result = await assertPublicDestination(new URL("https://93.184.216.34/"));
  assert.equal(result.allowed, true);
});

test("ALLOW_PRIVATE_HOSTS overrides the private-network guard for local fixtures", async () => {
  const previous = process.env.ALLOW_PRIVATE_HOSTS;
  process.env.ALLOW_PRIVATE_HOSTS = "true";
  try {
    assert.equal(shouldAllowPrivateHosts(), true);
    const result = await assertPublicDestination(new URL("http://127.0.0.1:9876/"));
    assert.equal(result.allowed, true);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_PRIVATE_HOSTS;
    else process.env.ALLOW_PRIVATE_HOSTS = previous;
  }
});
