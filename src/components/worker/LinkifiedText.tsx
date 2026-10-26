"use client";

import React from "react";

export function parseTextWithLinks(text: string): Array<{
  type: "text" | "link";
  content: string;
  href?: string;
}> {
  if (!text) return [];

  // Match markdown links [label](url) OR raw URLs (http://, https://, www.)
  const regex = /\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>"{}|\^~`\\]+)/gi;

  const result: Array<{ type: "text" | "link"; content: string; href?: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    if (match[1] && match[2]) {
      const label = match[1];
      const rawHref = match[2].trim();
      const href = /^https?:\/\//i.test(rawHref) ? rawHref : `https://${rawHref}`;
      result.push({
        type: "link",
        content: label,
        href,
      });
    } else if (match[3]) {
      let url = match[3];
      let trailing = "";

      while (/[.,;:!?)>]$/.test(url)) {
        if (url.endsWith(")")) {
          const opens = (url.match(/\(/g) || []).length;
          const closes = (url.match(/\)/g) || []).length;
          if (opens >= closes) break;
        }
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }

      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      result.push({
        type: "link",
        content: url,
        href,
      });

      if (trailing) {
        result.push({
          type: "text",
          content: trailing,
        });
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  return result;
}

const RICH_HTML_TAG_RE = /<\/?[a-z][a-z0-9:_-]*\b[^>]*>/i;

export function decodeHtmlEntities(input?: string | null): string {
  if (!input) return "";
  let s = String(input);
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
      .replace(/&quot;|&#34;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;|&#60;/gi, "<")
      .replace(/&gt;|&#62;/gi, ">")
      .replace(/&#(\d+);/g, (_, dec) => {
        const code = Number(dec);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : _;
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : _;
      })
      .replace(/&amp;|&#38;/gi, "&");
  }
  return s.replace(/\u00a0/g, " ");
}

export function normalizeRichHtml(raw?: string | null): string {
  if (!raw) return "";
  let s = String(raw);

  // 1. Unescape double-escaped HTML entities (e.g. &amp;nbsp; -> &nbsp;, &amp;lt; -> &lt;)
  for (let i = 0; i < 2; i++) {
    if (/&amp;(?:nbsp|lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/i.test(s)) {
      s = s.replace(/&amp;((?:nbsp|lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);)/gi, "&$1");
    }
  }

  // 2. If the string contains escaped HTML tags (e.g. &lt;p&gt;, &lt;div, &lt;span, &lt;br), unescape them so they parse as rich HTML instead of showing raw code
  if (
    /&lt;\s*\/?\s*(?:h[1-6]|p|div|span|strong|b|em|i|u|s|strike|ul|ol|li|blockquote|br|font|mark|a|style|script|meta|link|xml|o:p|table|tr|td|th|pre|code|hr|article|section|header|footer)\b[\s\S]*?&gt;/i.test(
      s,
    )
  ) {
    s = s
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");
  }

  // 3. Remove HTML comments, Word conditional comments, and non-content blocks (<style>, <script>, <xml>, <meta>, <o:p>, etc.)
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[[\s\S]*?\]>/g, "")
    .replace(/<(style|script|xml|head|title|svg|noscript|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(meta|link|base|o:p|w:[a-z0-9_-]+|m:[a-z0-9_-]+|v:[a-z0-9_-]+)\b[^>]*\/?>/gi, "");

  return s;
}

export function isRichHtml(text?: string | null): boolean {
  if (!text) return false;
  const cleaned = normalizeRichHtml(text);
  return RICH_HTML_TAG_RE.test(cleaned);
}

export function stripRichHtml(text?: string | null): string {
  if (!text) return "";
  const cleaned = normalizeRichHtml(text);
  return decodeHtmlEntities(
    cleaned
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/blockquote|\/tr|hr)\b[^>]*\/?>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseSafeInlineStyle(styleAttr: string | null): React.CSSProperties {
  if (!styleAttr) return {};
  const out: React.CSSProperties = {};
  const parts = styleAttr.split(";");
  for (const part of parts) {
    const [rawProp, ...rawValParts] = part.split(":");
    if (!rawProp || rawValParts.length === 0) continue;
    const prop = rawProp.trim().toLowerCase();
    const val = rawValParts.join(":").trim();
    if (!val || /url\s*\(|expression\s*\(|javascript:/i.test(val)) continue;
    if (prop === "color") out.color = val;
    else if (prop === "background-color" || prop === "background") out.backgroundColor = val;
    else if (prop === "font-weight") out.fontWeight = val as React.CSSProperties["fontWeight"];
    else if (prop === "font-style") out.fontStyle = val as React.CSSProperties["fontStyle"];
    else if (prop === "text-decoration") out.textDecoration = val;
    else if (prop === "text-align") out.textAlign = val as React.CSSProperties["textAlign"];
  }
  return out;
}

function renderLinkTokens(
  text: string,
  linkClassName?: string,
  keyPrefix = "t",
): React.ReactNode[] {
  const tokens = parseTextWithLinks(text);
  return tokens.map((token, idx) => {
    if (token.type === "link" && token.href) {
      return (
        <a
          key={`${keyPrefix}-${idx}`}
          href={token.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={
            linkClassName ||
            "text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline decoration-blue-400 dark:decoration-blue-500 font-semibold break-all inline-flex items-center gap-0.5 transition-colors cursor-pointer"
          }
          title={`Open ${token.href}`}
        >
          <span>{token.content}</span>
          <svg
            className="w-3 h-3 inline-block shrink-0 opacity-70"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      );
    }
    return <React.Fragment key={`${keyPrefix}-${idx}`}>{token.content}</React.Fragment>;
  });
}

function renderDomNode(
  node: ChildNode,
  key: string,
  linkClassName?: string,
): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const content = (node.textContent || "").replace(/\u00a0/g, " ");
    if (!content) return null;
    return <React.Fragment key={key}>{renderLinkTokens(content, linkClassName, key)}</React.Fragment>;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (
    tag === "style" ||
    tag === "script" ||
    tag === "xml" ||
    tag === "head" ||
    tag === "title" ||
    tag === "meta" ||
    tag === "link" ||
    tag === "base" ||
    tag === "svg" ||
    tag === "noscript" ||
    tag === "iframe" ||
    tag === "object" ||
    tag === "embed" ||
    tag === "o:p"
  ) {
    return null;
  }
  const style = parseSafeInlineStyle(el.getAttribute("style"));
  const colorAttr = el.getAttribute("color");
  if (colorAttr && !style.color) {
    style.color = colorAttr;
  }

  const children = Array.from(el.childNodes).map((child, i) =>
    renderDomNode(child, `${key}-${i}`, linkClassName),
  );

  switch (tag) {
    case "h1":
      return (
        <h1 key={key} style={style} className="text-base sm:text-lg font-bold tracking-tight text-zinc-900 dark:text-white mt-2 mb-1 first:mt-0 leading-snug">
          {children}
        </h1>
      );
    case "h2":
      return (
        <h2 key={key} style={style} className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 mt-1.5 mb-1 first:mt-0 leading-snug">
          {children}
        </h2>
      );
    case "h3":
    case "h4":
      return (
        <h3 key={key} style={style} className="text-xs sm:text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-1 mb-0.5 first:mt-0 leading-snug">
          {children}
        </h3>
      );
    case "p":
      return (
        <p key={key} style={style} className="my-1 first:mt-0 last:mb-0 leading-relaxed">
          {children}
        </p>
      );
    case "div":
      return (
        <div key={key} style={style} className="my-0.5 leading-relaxed">
          {children}
        </div>
      );
    case "span":
    case "font":
      return (
        <span key={key} style={style}>
          {children}
        </span>
      );
    case "mark":
      return (
        <mark key={key} style={style} className="rounded px-1 py-0.5 bg-yellow-200/80 text-zinc-900">
          {children}
        </mark>
      );
    case "strong":
    case "b":
      return (
        <strong key={key} style={style} className="font-bold">
          {children}
        </strong>
      );
    case "em":
    case "i":
      return (
        <em key={key} style={style} className="italic">
          {children}
        </em>
      );
    case "u":
      return (
        <u key={key} style={style} className="underline">
          {children}
        </u>
      );
    case "s":
    case "strike":
      return (
        <s key={key} style={style} className="line-through">
          {children}
        </s>
      );
    case "ul":
      return (
        <ul key={key} style={style} className="list-disc pl-5 my-1 space-y-0.5">
          {children}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} style={style} className="list-decimal pl-5 my-1 space-y-0.5">
          {children}
        </ol>
      );
    case "li":
      return (
        <li key={key} style={style} className="leading-relaxed">
          {children}
        </li>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          style={style}
          className="border-l-3 border-red-500 pl-3 py-0.5 my-1.5 italic text-zinc-700 dark:text-zinc-300 bg-zinc-100/60 dark:bg-zinc-800/40 rounded-r"
        >
          {children}
        </blockquote>
      );
    case "br":
      return <br key={key} />;
    case "a": {
      const rawHref = el.getAttribute("href") || "";
      const href = /^https?:\/\//i.test(rawHref.trim()) ? rawHref.trim() : `https://${rawHref.trim()}`;
      return (
        <a
          key={key}
          href={href}
          style={style}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={
            linkClassName ||
            "text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline decoration-blue-400 dark:decoration-blue-500 font-semibold break-all inline-flex items-center gap-0.5 transition-colors cursor-pointer"
          }
        >
          {children}
        </a>
      );
    }
    default:
      return (
        <span key={key} style={style}>
          {children}
        </span>
      );
  }
}

interface LinkifiedTextProps {
  text?: string | null;
  className?: string;
  linkClassName?: string;
  placeholder?: React.ReactNode;
}

export default function LinkifiedText({
  text,
  className = "",
  linkClassName,
  placeholder,
}: LinkifiedTextProps) {
  const plainStripped = stripRichHtml(text);
  if (!text || !plainStripped) {
    if (placeholder !== undefined) {
      return typeof placeholder === "string" ? (
        <span className="italic text-zinc-400">{placeholder}</span>
      ) : (
        <>{placeholder}</>
      );
    }
    return null;
  }

  const normalized = normalizeRichHtml(text);

  if (isRichHtml(normalized) && typeof window !== "undefined" && typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalized, "text/html");
    const nodes = Array.from(doc.body.childNodes).map((node, idx) =>
      renderDomNode(node, `rich-${idx}`, linkClassName),
    );
    return (
      <div dir="auto" className={`space-y-1 whitespace-normal ${className}`}>
        {nodes}
      </div>
    );
  }

  const cleanText = isRichHtml(normalized) ? plainStripped : decodeHtmlEntities(normalized);

  return (
    <span dir="auto" className={className}>
      {renderLinkTokens(cleanText, linkClassName, "plain")}
    </span>
  );
}
