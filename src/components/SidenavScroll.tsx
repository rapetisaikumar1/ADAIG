"use client";
import { useEffect, useRef } from "react";

/**
 * On narrow screens the sidenav becomes a horizontal scroller; bring the current page's link into view
 * (centred) so members can see where they are. Scrolls only the nav itself, never the page.
 */
export function SidenavScroll() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const nav = ref.current?.closest<HTMLElement>(".sidenav");
    const cur = nav?.querySelector<HTMLElement>("a[aria-current=page]");
    if (!nav || !cur || nav.scrollWidth <= nav.clientWidth) return;
    const n = nav.getBoundingClientRect(), c = cur.getBoundingClientRect();
    nav.scrollLeft += c.left - n.left - (n.width - c.width) / 2;
  }, []);
  return <span ref={ref} hidden />;
}
