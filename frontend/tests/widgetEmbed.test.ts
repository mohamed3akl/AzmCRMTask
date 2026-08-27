import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptSource = readFileSync(resolve(__dirname, '../public/widget-embed.js'), 'utf-8');

declare global {
  // eslint-disable-next-line no-var
  var __azmcrmWidget:
    | {
        getConfig: (el: HTMLScriptElement) => { origin: string; locale: string; containerId: string | null };
        createIframe: (config: { origin: string; locale: string }) => HTMLIFrameElement;
        mount: (el: HTMLScriptElement) => HTMLIFrameElement | null;
      }
    | undefined;
}

describe('widget-embed.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__azmcrmWidget;
    // eslint-disable-next-line no-new-func
    new Function(scriptSource)();
  });

  it('creates an iframe pointing at the configured origin and locale', () => {
    const scriptEl = document.createElement('script');
    scriptEl.setAttribute('data-origin', 'https://azmcrm.example.com');
    scriptEl.setAttribute('data-locale', 'ar');
    document.body.appendChild(scriptEl);

    const iframe = window.__azmcrmWidget!.mount(scriptEl)!;

    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toBe('https://azmcrm.example.com/widget/embed?locale=ar');
  });

  it('resizes the iframe when it receives a matching postMessage from the configured origin', () => {
    const scriptEl = document.createElement('script');
    scriptEl.setAttribute('data-origin', 'https://azmcrm.example.com');
    document.body.appendChild(scriptEl);

    const iframe = window.__azmcrmWidget!.mount(scriptEl)!;

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://azmcrm.example.com',
        data: { source: 'azmcrm-widget', height: 640 },
      })
    );

    expect(iframe.style.height).toBe('640px');
  });

  it('ignores a postMessage from an untrusted origin', () => {
    const scriptEl = document.createElement('script');
    scriptEl.setAttribute('data-origin', 'https://azmcrm.example.com');
    document.body.appendChild(scriptEl);

    const iframe = window.__azmcrmWidget!.mount(scriptEl)!;
    const initialHeight = iframe.style.height;

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example.com',
        data: { source: 'azmcrm-widget', height: 999 },
      })
    );

    expect(iframe.style.height).toBe(initialHeight);
  });

  it('logs an error and creates no iframe when data-origin is missing', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scriptEl = document.createElement('script');
    document.body.appendChild(scriptEl);

    const result = window.__azmcrmWidget!.mount(scriptEl);

    expect(result).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('data-origin'));
    consoleErrorSpy.mockRestore();
  });
});
