import { URL } from 'url';

/**
 * Validates if a URL is safe to make requests to.
 * Prevents SSRF by blocking:
 * - Localhost addresses
 * - Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Non-HTTP(S) protocols
 * - Cloud metadata endpoints
 */
export function isValidPublicUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return false;
    }

    // Block localhost variations
    const localhostVariants = ['localhost', '127.0.0.1', '[::1]'];
    if (localhostVariants.includes(parsedUrl.hostname.toLowerCase())) {
      return false;
    }

    // Block cloud metadata endpoints
    const metadataEndpoints = [
      'metadata.google.internal',
      '169.254.169.254', // AWS metadata
      'metadata.service', // Azure metadata
    ];
    if (metadataEndpoints.some((endpoint) => parsedUrl.hostname.includes(endpoint))) {
      return false;
    }

    // Check for private IP ranges
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Pattern.test(parsedUrl.hostname)) {
      const parts = parsedUrl.hostname.split('.').map(Number);
      // Check if valid IP
      if (parts.some((part) => part < 0 || part > 255)) {
        return false;
      }
      // Block private ranges
      if (
        parts[0] === 10 || // 10.0.0.0/8
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.0.0/12
        (parts[0] === 192 && parts[1] === 168) || // 192.168.0.0/16
        (parts[0] === 169 && parts[1] === 254) // 169.254.0.0/16 (APIPA)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
