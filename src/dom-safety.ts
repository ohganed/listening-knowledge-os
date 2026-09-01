const BLOCKED_TAGS = new Set([
  "SCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "STYLE",
  "LINK",
  "META",
  "BASE",
  "FORM",
]);

function sanitizeElement(element: Element) {
  if (BLOCKED_TAGS.has(element.tagName)) {
    element.replaceWith(document.createTextNode(element.textContent ?? ""));
    return;
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim().toLowerCase();
    if (name.startsWith("on")) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if ((name === "href" || name === "src" || name === "xlink:href") && value.startsWith("javascript:")) {
      element.removeAttribute(attribute.name);
    }
  }
}

function sanitizeTree(root: Node) {
  if (root instanceof Element) sanitizeElement(root);
  if (!(root instanceof Element || root instanceof DocumentFragment)) return;
  root.querySelectorAll("*").forEach(sanitizeElement);
}

const appRoot = document.querySelector("#app");
if (appRoot) {
  sanitizeTree(appRoot);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(sanitizeTree);
    }
  });
  observer.observe(appRoot, { childList: true, subtree: true });
}
