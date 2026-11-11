"use client";
import { useEffect } from "react";

/**
 * /legal "On this page": marks the section being read. The links stay plain anchors (they work without JS); this only sets
 * aria-current="location" on the link whose section heading most recently scrolled past the top of the reading area.
 * Renders nothing. Content is admin-editable HTML, so it looks the links up by their #hash targets instead of fixed ids.
 */
export function LegalTocSpy() {
  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".legal-toc a[href^='#']")];
    const targets = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter((el): el is HTMLElement => !!el);
    if (!targets.length) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      // the current section = the last heading above 35% of the viewport (or the first one before any is reached)
      const line = window.innerHeight * 0.35;
      let current = targets[0];
      for (const t of targets) if (t.getBoundingClientRect().top <= line) current = t;
      // at the very bottom of the page, the last section is the one being read
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = targets[targets.length - 1];
      for (const a of links) {
        if (a.hash.slice(1) === current.id) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      }
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("hashchange", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); window.removeEventListener("hashchange", onScroll); };
  }, []);
  return null;
}
