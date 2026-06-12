/** Shared helpers for the component layer. */

/** Register a custom element once (idempotent across repeated module loads in tests). */
export function defineOnce(tag: string, ctor: CustomElementConstructor): void {
    if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
        customElements.define(tag, ctor);
    }
}

/** Dispatch a composed, bubbling CustomEvent with a typed detail. */
export function emit<T>(el: HTMLElement, type: string, detail: T): void {
    el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/** Whether a boolean attribute is present. */
export function boolAttr(el: Element, name: string): boolean {
    return el.hasAttribute(name);
}
