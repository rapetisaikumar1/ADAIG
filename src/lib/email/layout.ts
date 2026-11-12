import { ASSOCIATION_NAME, ASSOCIATION_SHORT, contactInbox, siteUrl } from "./config";
/**
 * The branded email layout (E5): table-based HTML, inline CSS, 600 px, ADAIG colours (src/styles/tokens.css), hosted PNG logo
 * (public/assets/email-logo.png, white plate so it stays legible when a mail app darkens the message), plus a plain-text version.
 * Every argument is PLAIN TEXT and is escaped here; never pass HTML. English only for now (`locale` kept for French later).
 */
const C = {
  navy: "#0B2545", teal: "#0F766E", frost: "#F4F7FA", ink: "#0F1B2D", body: "#344054", muted: "#475467", line: "#E4E7EC",
};
const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Newsreader,Georgia,'Times New Roman',serif";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape text for HTML element content and attribute values. */
export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}
/** Escaped text with line breaks kept ("\n" → <br>). Control characters other than \n are dropped. */
const textHtml = (s: string) => escapeHtml(String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")).replace(/\n/g, "<br>");
/** Only absolute http(s) URLs are used in links; anything else is dropped. */
const safeUrl = (u: string | undefined): string | null => {
  try { const x = new URL(String(u ?? "")); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null; } catch { return null; }
};
const plain = (s: string) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();

export type EmailFact = { label: string; value: string };
export type EmailCta = { label: string; url: string };
export type RenderEmailInput = {
  preheader: string; heading: string; paragraphs: string[];
  facts?: EmailFact[]; cta?: EmailCta; footerNote?: string; locale?: string;
};

const DEFAULT_FOOTER = `You received this email because of an action on your ${ASSOCIATION_SHORT} account or on the ${ASSOCIATION_SHORT} website.`;

export function renderEmail(p: RenderEmailInput): { html: string; text: string } {
  const home = siteUrl("/en");
  const logo = siteUrl("/assets/email-logo.png");
  const inbox = contactInbox();
  const ctaUrl = p.cta ? safeUrl(p.cta.url) : null;
  const facts = (p.facts ?? []).filter((f) => plain(f.label) || plain(f.value));
  const footerNote = plain(p.footerNote ?? "") || DEFAULT_FOOTER;
  const paragraphs = p.paragraphs.map(plain).filter(Boolean);

  /* ── plain text ── */
  const text = [
    `${ASSOCIATION_SHORT} | ${ASSOCIATION_NAME}`, "",
    plain(p.heading), "",
    ...paragraphs.flatMap((t) => [t, ""]),
    ...(facts.length ? [...facts.map((f) => `${plain(f.label)}: ${plain(f.value)}`), ""] : []),
    ...(p.cta && ctaUrl ? [`${plain(p.cta.label)}: ${ctaUrl}`, ""] : []),
    "--",
    `${ASSOCIATION_NAME} (${ASSOCIATION_SHORT})`,
    footerNote,
    ...(inbox ? [`Questions? Write to ${inbox}`] : []),
    home,
  ].join("\n");

  /* ── HTML ── */
  const para = (t: string) =>
    `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:26px;color:${C.body};">${textHtml(t)}</p>`;
  const factRows = facts.map((f, i) =>
    `<tr><td valign="top" style="padding:${i ? "10px" : "0"} 16px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};white-space:nowrap;">${textHtml(plain(f.label))}</td>` +
    `<td valign="top" class="fv" style="padding:${i ? "10px" : "0"} 0 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink};font-weight:600;word-break:break-word;">${textHtml(plain(f.value))}</td></tr>`).join("");
  const factsBlock = facts.length
    ? `<tr><td class="px" style="padding:4px 40px 20px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.frost};border-left:4px solid ${C.teal};border-radius:8px;">
<tr><td style="padding:16px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" class="facts">${factRows}</table></td></tr></table></td></tr>`
    : "";
  const ctaBlock = p.cta && ctaUrl
    ? `<tr><td class="px" style="padding:8px 40px 8px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${C.teal}" style="border-radius:8px;background:${C.teal};">
<a href="${escapeHtml(ctaUrl)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(plain(p.cta.label))}</a>
</td></tr></table>
<p style="margin:16px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(ctaUrl)}" target="_blank" style="color:${C.teal};text-decoration:underline;word-break:break-all;">${escapeHtml(ctaUrl)}</a></p>
</td></tr>`
    : "";
  const preheader = escapeHtml(plain(p.preheader));

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(plain(p.heading))}</title>
<style>
  body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
  a{color:${C.teal};}
  @media only screen and (max-width:620px){
    .outer{padding:12px 8px!important;}
    .px{padding-left:20px!important;padding-right:20px!important;}
    .h1{font-size:22px!important;line-height:30px!important;}
  }
  @media only screen and (max-width:480px){
    .facts td{display:block!important;white-space:normal!important;padding-right:0!important;}
    .facts td.fv{padding-top:2px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.frost};">
<div role="article" aria-roledescription="email" aria-label="${escapeHtml(plain(p.heading))}" lang="en" style="background:${C.frost};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.frost};opacity:0;">${preheader}&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;&#8202;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.frost}" style="background:${C.frost};">
<tr><td align="center" class="outer" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#FFFFFF;border:1px solid ${C.line};border-radius:12px;">
<tr><td style="height:6px;line-height:6px;font-size:0;background:${C.teal};border-radius:12px 12px 0 0;">&nbsp;</td></tr>
<tr><td class="px" style="padding:28px 40px 8px 40px;background:#FFFFFF;">
<a href="${escapeHtml(home)}" target="_blank" style="text-decoration:none;"><img src="${escapeHtml(logo)}" width="220" height="52" alt="${ASSOCIATION_SHORT} - ${ASSOCIATION_NAME}" style="display:block;width:220px;max-width:100%;height:auto;border:0;background:#FFFFFF;color:${C.navy};font-family:${FONT};font-size:18px;font-weight:700;"></a>
</td></tr>
<tr><td class="px" style="padding:20px 40px 4px 40px;">
<h1 class="h1" style="margin:0 0 16px 0;font-family:${SERIF};font-size:26px;line-height:34px;font-weight:600;color:${C.navy};">${textHtml(plain(p.heading))}</h1>
${paragraphs.map(para).join("\n")}
</td></tr>
${factsBlock}
${ctaBlock}
<tr><td class="px" style="padding:24px 40px 32px 40px;">
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body};">${ASSOCIATION_SHORT}<br><span style="color:${C.muted};">${ASSOCIATION_NAME}</span></p>
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td class="px" style="padding:20px 40px 8px 40px;font-family:${FONT};font-size:12px;line-height:19px;color:${C.muted};text-align:center;">
<p style="margin:0 0 8px 0;">${textHtml(footerNote)}</p>
${inbox ? `<p style="margin:0 0 8px 0;">Questions? Write to <a href="mailto:${escapeHtml(inbox)}" style="color:${C.teal};text-decoration:underline;">${escapeHtml(inbox)}</a></p>` : ""}
<p style="margin:0;"><a href="${escapeHtml(home)}" target="_blank" style="color:${C.teal};text-decoration:underline;">${escapeHtml(home.replace(/^https?:\/\//, "").replace(/\/en$/, ""))}</a> &middot; ${ASSOCIATION_NAME}</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
  return { html, text };
}
