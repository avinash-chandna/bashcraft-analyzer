import dns from "node:dns/promises";
import net from "node:net";

function ipv4ToNumber(ip) {
  return ip.split(".").reduce((total, part) => (total << 8) + Number(part), 0) >>> 0;
}

function inIpv4Range(value, network, prefix) {
  const ip = ipv4ToNumber(value);
  const base = ipv4ToNumber(network);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (base & mask);
}

const PRIVATE_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function expandIpv6(ip) {
  const [leftRaw, rightRaw] = ip.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (!ip.includes("::")) {
    if (left.length !== 8) return null;
    return left;
  }
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return [...left, ...Array(fill).fill("0"), ...right];
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase().split("%")[0];

  const dottedMatch = lower.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMatch) return isPrivateIp(dottedMatch[1]);

  if (lower === "::1" || lower === "::") return true;

  const parts = expandIpv6(lower);
  if (!parts || parts.length !== 8) return false;
  const values = parts.map((part) => Number.parseInt(part || "0", 16));
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 0xffff)) {
    return false;
  }

  const first = values[0];
  // Unique local addresses (fc00::/7)
  if ((first & 0xfe00) === 0xfc00) return true;
  // Link-local (fe80::/10)
  if ((first & 0xffc0) === 0xfe80) return true;
  // Multicast (ff00::/8)
  if ((first & 0xff00) === 0xff00) return true;
  // Documentation range (2001:db8::/32)
  if (first === 0x2001 && values[1] === 0x0db8) return true;
  // Discard-only prefix (100::/64)
  if (first === 0x0100 && values.slice(1, 4).every((value) => value === 0)) return true;
  return false;
}

export function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    return PRIVATE_IPV4_RANGES.some(([network, prefix]) => inIpv4Range(ip, network, prefix));
  }
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

function isLocalHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  );
}

export function shouldAllowPrivateHosts() {
  return process.env.ALLOW_PRIVATE_HOSTS === "true";
}

/**
 * Resolve the host before crawling so the service cannot be trivially used as
 * a bridge to loopback, link-local, or private network services.
 */
export async function assertPublicDestination(url) {
  if (shouldAllowPrivateHosts()) return { allowed: true, addresses: [] };

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isLocalHostname(hostname)) {
    return {
      allowed: false,
      reason:
        "Private, loopback, and local network addresses are blocked. Set ALLOW_PRIVATE_HOSTS=true only on a trusted local machine if you need to inspect a local site.",
    };
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return {
        allowed: false,
        reason: "The URL points to a private or reserved network address, so it cannot be analyzed.",
      };
    }
    return { allowed: true, addresses: [hostname] };
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    return {
      allowed: false,
      reason: `Could not resolve "${hostname}". Check the domain name and try again.`,
      code: error.code || "DNS_LOOKUP_FAILED",
    };
  }

  if (!addresses.length) {
    return { allowed: false, reason: `Could not resolve "${hostname}".` };
  }

  const privateAddress = addresses.find((entry) => isPrivateIp(entry.address));
  if (privateAddress) {
    return {
      allowed: false,
      reason: "The hostname resolves to a private or reserved network address, so it cannot be analyzed.",
    };
  }

  return { allowed: true, addresses: addresses.map((entry) => entry.address) };
}
