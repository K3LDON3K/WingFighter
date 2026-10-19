/** Miniaturní pomocník pro tvorbu DOMu bez frameworku. */
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], "style" | "children">> & {
    class?: string;
    style?: string;
    onclick?: (ev: MouseEvent) => void;
    onchange?: (ev: Event) => void;
    oninput?: (ev: Event) => void;
    onkeydown?: (ev: KeyboardEvent) => void;
    dataset?: Record<string, string>;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on")) (el as unknown as Record<string, unknown>)[k] = v;
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
