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
      // Markdown link
      const label = match[1];
      const rawHref = match[2].trim();
      const href = /^https?:\/\//i.test(rawHref) ? rawHref : `https://${rawHref}`;
      result.push({
        type: "link",
        content: label,
        href,
      });
    } else if (match[3]) {
      // Raw URL
      let url = match[3];
      let trailing = "";

      // Strip common trailing punctuation
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
  if (!text) {
    if (placeholder !== undefined) {
      return typeof placeholder === "string" ? (
        <span className="italic text-zinc-400">{placeholder}</span>
      ) : (
        <>{placeholder}</>
      );
    }
    return null;
  }

  const tokens = parseTextWithLinks(text);

  return (
    <span className={className}>
      {tokens.map((token, idx) => {
        if (token.type === "link" && token.href) {
          return (
            <a
              key={idx}
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
        return <React.Fragment key={idx}>{token.content}</React.Fragment>;
      })}
    </span>
  );
}
