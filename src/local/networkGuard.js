export function installLocalNetworkGuard() {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) throw new Error('The local Express preview requires a loopback origin.');
  const allowed = (input) => {
    const value = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin) throw new Error(`Local Express preview blocked external request to ${url.hostname}.`);
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => { allowed(input); return originalFetch(input, init); };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) { allowed(String(url)); return originalOpen.call(this, method, url, ...args); };
  if (navigator.sendBeacon) navigator.sendBeacon = (url) => { allowed(String(url)); return false; };
}
