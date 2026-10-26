"use client";

import React, { useEffect, useRef, useState } from "react";
import { decodeHtmlEntities, isRichHtml, normalizeRichHtml, stripRichHtml } from "./LinkifiedText";

interface RichDescriptionEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

const TEXT_COLORS = [
  { label: "Default", color: "#18181b", swatch: "bg-zinc-900 dark:bg-zinc-100" },
  { label: "Red", color: "#dc2626", swatch: "bg-red-600" },
  { label: "Blue", color: "#2563eb", swatch: "bg-blue-600" },
  { label: "Green", color: "#059669", swatch: "bg-emerald-600" },
  { label: "Orange", color: "#d97706", swatch: "bg-amber-600" },
  { label: "Purple", color: "#7c3aed", swatch: "bg-violet-600" },
  { label: "Pink", color: "#db2777", swatch: "bg-pink-600" },
  { label: "Gray", color: "#6b7280", swatch: "bg-zinc-500" },
];

const HIGHLIGHT_COLORS = [
  { label: "Yellow Highlight", color: "#fef08a", swatch: "bg-yellow-200 border-yellow-400" },
  { label: "Red Highlight", color: "#fecdd3", swatch: "bg-rose-200 border-rose-400" },
  { label: "Blue Highlight", color: "#bfdbfe", swatch: "bg-blue-200 border-blue-400" },
  { label: "Green Highlight", color: "#bbf7d0", swatch: "bg-emerald-200 border-emerald-400" },
  { label: "No Highlight", color: "transparent", swatch: "bg-white border-zinc-300" },
];

function plainTextToHtml(raw: string): string {
  if (!raw) return "";
  const cleaned = normalizeRichHtml(raw);
  if (isRichHtml(cleaned)) return cleaned;
  return decodeHtmlEntities(cleaned)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export default function RichDescriptionEditor({
  value,
  onChange,
  placeholder = "Write headline, paragraphs, bullet points, and colored notes…",
  minHeight = "110px",
  className = "",
}: RichDescriptionEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string>(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value !== lastEmittedRef.current) {
      el.innerHTML = plainTextToHtml(value);
      lastEmittedRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = plainTextToHtml(value);
    lastEmittedRef.current = value;
  }, []);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = normalizeRichHtml(el.innerHTML).replace(/&nbsp;/gi, " ");
    const stripped = stripRichHtml(html);
    const nextVal = stripped ? html : "";
    lastEmittedRef.current = nextVal;
    onChange(nextVal);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const plain = e.clipboardData.getData("text/plain");
    if (!plain) return;
    try {
      if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
        document.execCommand("insertText", false, plain);
        emitChange();
        return;
      }
    } catch {
      /* fallback below */
    }
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      selection.deleteFromDocument();
      const range = selection.getRangeAt(0);
      const frag = document.createDocumentFragment();
      const lines = plain.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (idx > 0) frag.appendChild(document.createElement("br"));
        frag.appendChild(document.createTextNode(line));
      });
      range.insertNode(frag);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    emitChange();
  };

  const exec = (command: string, arg?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand("styleWithCSS", false, "true");
    } catch {
      /* ignore */
    }
    document.execCommand(command, false, arg);
    emitChange();
  };

  const isEmpty = !stripRichHtml(value);

  return (
    <div
      className={`rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden transition-all ${
        isFocused ? "border-red-500 ring-2 ring-red-500/20" : ""
      } ${className}`}
    >
      {/* Formatting Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/80 px-2.5 py-1.5 text-[11px] select-none">
        {/* Headlines & Paragraph */}
        <div className="flex items-center gap-0.5 pr-1.5 border-r border-zinc-200 dark:border-zinc-700">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("formatBlock", "H1");
            }}
            title="Large Headline (H1)"
            className="px-1.5 py-1 rounded font-bold text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            H1
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("formatBlock", "H2");
            }}
            title="Section Headline (H2)"
            className="px-1.5 py-1 rounded font-bold text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            H2
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("formatBlock", "H3");
            }}
            title="Sub-headline (H3)"
            className="px-1.5 py-1 rounded font-bold text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            H3
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("formatBlock", "P");
            }}
            title="Normal Paragraph"
            className="px-1.5 py-1 rounded font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            ¶ P
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("formatBlock", "BLOCKQUOTE");
            }}
            title="Callout / Quote Block"
            className="px-1.5 py-1 rounded font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            ❝
          </button>
        </div>

        {/* Bold / Italic / Underline / Lists */}
        <div className="flex items-center gap-0.5 pr-1.5 border-r border-zinc-200 dark:border-zinc-700">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("bold");
            }}
            title="Bold"
            className="px-1.5 py-1 rounded font-extrabold text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            B
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("italic");
            }}
            title="Italic"
            className="px-1.5 py-1 rounded italic font-serif font-bold text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            I
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("underline");
            }}
            title="Underline"
            className="px-1.5 py-1 rounded underline font-bold text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            U
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("insertUnorderedList");
            }}
            title="Bullet List"
            className="px-1.5 py-1 rounded font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            • List
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("insertOrderedList");
            }}
            title="Numbered List"
            className="px-1.5 py-1 rounded font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            1. List
          </button>
        </div>

        {/* Text Colors */}
        <div className="flex items-center gap-1 pr-1.5 border-r border-zinc-200 dark:border-zinc-700">
          <span className="text-[10px] font-semibold text-zinc-500">Color:</span>
          {TEXT_COLORS.map((c) => (
            <button
              key={c.color}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                exec("foreColor", c.color);
              }}
              title={`Text Color: ${c.label}`}
              className={`w-4 h-4 rounded-full border border-white shadow-2xs transition-transform hover:scale-125 cursor-pointer ${c.swatch}`}
            />
          ))}
          <label
            title="Custom Text Color"
            className="relative w-4 h-4 rounded-full border border-zinc-400 bg-gradient-to-tr from-red-500 via-emerald-500 to-blue-500 cursor-pointer overflow-hidden hover:scale-110 transition-transform"
          >
            <input
              type="color"
              onChange={(e) => exec("foreColor", e.target.value)}
              className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
            />
          </label>
        </div>

        {/* Highlight Background Colors */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-zinc-500">Bg:</span>
          {HIGHLIGHT_COLORS.map((h) => (
            <button
              key={h.label}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                exec("hiliteColor", h.color);
              }}
              title={h.label}
              className={`w-4 h-4 rounded border transition-transform hover:scale-125 cursor-pointer ${h.swatch}`}
            />
          ))}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec("removeFormat");
              exec("formatBlock", "P");
            }}
            title="Clear Formatting"
            className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-zinc-500 hover:text-red-600 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Editable Rich Content Area */}
      <div className="relative">
        {isEmpty && !isFocused && (
          <div className="pointer-events-none absolute inset-x-3.5 top-2.5 text-xs text-zinc-400 select-none">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          dir="auto"
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            emitChange();
          }}
          onInput={emitChange}
          onPaste={handlePaste}
          style={{ minHeight }}
          className="w-full px-3.5 py-2.5 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed focus:outline-none overflow-y-auto max-h-64 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:my-1 [&_h2]:text-base [&_h2]:font-bold [&_h2]:my-1 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:my-0.5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-3 [&_blockquote]:border-red-500 [&_blockquote]:pl-3 [&_blockquote]:italic"
        />
      </div>

      {/* Subtle Footer Bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60 text-[10px] font-mono text-zinc-400 select-none">
        <span>Select text to apply H1–H3 headlines, paragraphs, or colors</span>
        <span>{stripRichHtml(value).length} chars</span>
      </div>
    </div>
  );
}
