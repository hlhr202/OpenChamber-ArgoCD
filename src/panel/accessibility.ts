/** SDK fields already have native wrapping labels. Also expose explicit
 * names to hosts/assistive tooling that inspect sandbox controls directly. */
export function nameFields(root: HTMLElement): () => void {
  const annotate = (node: Element) => {
    const inputs = [...(node.matches('input,textarea') ? [node] : []), ...node.querySelectorAll('input,textarea')];
    for (const input of inputs) {
      if (input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby')) continue;
      const label = input.closest('label')?.textContent?.trim() || input.getAttribute('placeholder');
      if (label) input.setAttribute('aria-label', label);
    }
  };
  annotate(root);
  const Observer = root.ownerDocument.defaultView?.MutationObserver;
  if (!Observer) return () => {};
  const observer = new Observer((mutations) => { for (const mutation of mutations) for (const node of mutation.addedNodes) if (node.nodeType === 1) annotate(node as Element); });
  // SDK dropdown search inputs are portaled into the sandbox body.
  observer.observe(root.ownerDocument.body, { childList: true, subtree: true }); return () => observer.disconnect();
}
