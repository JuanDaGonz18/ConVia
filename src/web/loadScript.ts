/**
 * Web-only helpers to load browser libraries from a CDN at runtime instead of
 * bundling them with Metro (they ship WebAssembly and ES modules Metro can't
 * process). Only used by *.web.ts(x) files.
 */
const loaded = new Map<string, Promise<void>>();

/** Adds a <script> once and resolves when it has run. */
export function loadScript(src: string): Promise<void> {
  let promise = loaded.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => {
        loaded.delete(src);
        script.remove();
        reject(new Error(`No se pudo cargar ${src}`));
      };
      document.head.appendChild(script);
    });
    loaded.set(src, promise);
  }
  return promise;
}

/** Adds a stylesheet <link> once. */
export function loadStylesheet(href: string) {
  if (document.querySelector(`link[data-src="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.src = href;
  document.head.appendChild(link);
}

/**
 * Native dynamic import of an ES module by URL. Wrapped in Function so Metro
 * leaves it alone instead of trying to resolve the URL at build time.
 */
export const importUrl = new Function('url', 'return import(url)') as <T = unknown>(url: string) => Promise<T>;
