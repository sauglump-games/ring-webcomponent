/**
 * Minimal jsdom test harness. Installs a DOM into globals so component modules
 * (which call `customElements.define` and `extends HTMLElement` at load) and
 * the GPX parser (which uses `DOMParser`) work under `node --test` with no
 * browser. Uses only jsdom.
 */
import { JSDOM } from 'jsdom';

const GLOBAL_KEYS = [
    'window',
    'document',
    'navigator',
    'Element',
    'Node',
    'HTMLElement',
    'SVGElement',
    'customElements',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'DOMParser',
    'getComputedStyle',
] as const;

export interface DomEnv {
    window: Window & typeof globalThis;
    document: Document;
    cleanup: () => void;
}

export function setupDom(): DomEnv {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'http://localhost/',
        pretendToBeVisual: true,
    });
    const win = dom.window as unknown as Window & typeof globalThis;
    const g = globalThis as unknown as Record<string, unknown>;
    const previous: Record<string, unknown> = {};

    // Some globals (e.g. `navigator` on modern Node) are read-only; assign
    // defensively so one un-writable key doesn't abort the whole setup.
    const assign = (key: string, value: unknown): void => {
        if (!(key in previous)) previous[key] = g[key];
        try {
            g[key] = value;
        } catch {
            try {
                Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
            } catch {
                /* leave Node's built-in in place */
            }
        }
    };

    for (const key of GLOBAL_KEYS) {
        const value = (win as unknown as Record<string, unknown>)[key];
        if (value !== undefined) assign(key, value);
    }

    return {
        window: win,
        document: win.document,
        cleanup() {
            for (const key of Object.keys(previous)) {
                try {
                    g[key] = previous[key];
                } catch {
                    /* read-only global; leave as-is */
                }
            }
            dom.window.close();
        },
    };
}

/** Dispatch a mouse event with controllable client coordinates. */
export function fireMouse(
    target: EventTarget,
    type: string,
    init: { clientX?: number; clientY?: number } = {}
): void {
    const win = (target as Node).ownerDocument!.defaultView!;
    target.dispatchEvent(
        new win.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: init.clientX ?? 0,
            clientY: init.clientY ?? 0,
        })
    );
}
