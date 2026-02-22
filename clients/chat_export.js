// ─────────────────────────────────────────────────────────────────────────
//  FIXED CONVERTER CORE  (replaces the four functions in the v12 script)
//  Paste these in place of the corresponding v12 functions.
//  Everything else in the file is unchanged.
// ─────────────────────────────────────────────────────────────────────────

  // ── renderTeX unchanged ──────────────────────────────────────────────────
  function renderTeX(tex, disp) {
    if (window.katex) try { return katex.renderToString(tex, { throwOnError: false, displayMode: !!disp }); } catch {}
    return disp
      ? `<div style="text-align:center;margin:6px 0"><code>${E(tex)}</code></div>`
      : `<code>${E(tex)}</code>`;
  }

  // ── FIX #5: protectTeX — improved $$...$$ context detection ─────────────
  //   Old approach: checked raw[o-1] char neighbor — fragile after earlier
  //   replacements polluted the string with %% placeholders.
  //   New approach: line-position regex (matches v2.1.0 deployment logic).
  function protectTeX(raw, arr) {
    // \[...\]  → always display
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g,
      (_, t) => (arr.push(renderTeX(t.trim(), true)),  `%%TX${arr.length - 1}%%`));
    // \(...\)  → always inline
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g,
      (_, t) => (arr.push(renderTeX(t.trim(), false)), `%%TX${arr.length - 1}%%`));
    // $$...$$ on its own line (with optional leading whitespace / > blockquote marker)
    // → display. Content pattern avoids crossing another $$ pair.
    raw = raw.replace(
      /((?:^|\n)[ \t>]*)\$\$((?:[^$]|\$(?!\$))*?)\$\$([ \t]*(?=\n|$))/g,
      (_, before, t, after) => {
        arr.push(renderTeX(t.trim(), true));
        return `${before}%%TX${arr.length - 1}%%${after}`;
      }
    );
    // remaining $$...$$ → inline
    raw = raw.replace(/\$\$((?:[^$]|\$(?!\$))*?)\$\$/g,
      (_, t) => (arr.push(renderTeX(t.trim(), false)), `%%TX${arr.length - 1}%%`));
    return raw;
  }

  // ── FIX #2 #3 #6: Icell — added italic, strikethrough; regex restore ────
  function Icell(raw) {
    if (!raw) return ""; let h = String(raw);

    // Protect inline code  (1-indexed: %%ic1%%, %%ic2%%,…)
    const ic = [];
    h = h.replace(/`([^`\n]+)`/g,
      (_, c) => (ic.push(`<code>${E(c)}</code>`), `%%ic${ic.length}%%`));

    // Protect math  (1-indexed: %%tx1%%, %%tx2%%,…)
    const tx = [];
    h = h.replace(/\\\[([\s\S]+?)\\\]/g,
      (_, t) => (tx.push(renderTeX(t.trim(), false)), `%%tx${tx.length}%%`));
    h = h.replace(/\\\(([\s\S]+?)\\\)/g,
      (_, t) => (tx.push(renderTeX(t.trim(), false)), `%%tx${tx.length}%%`));
    // $$...$$ inside a cell → always inline
    // (display math in a table cell is uncommon and visually impractical)
    h = h.replace(/\$\$((?:[^$]|\$(?!\$))*?)\$\$/g,
      (_, t) => (tx.push(renderTeX(t.trim(), false)), `%%tx${tx.length}%%`));

    // Sanitize remaining text (removes scripts, on* attributes)
    h = SH(h);

    // Inline formatting — order: complex/longer patterns first to avoid partial hits
    h = h.replace(/\*\*\*(.+?)\*\*\*/g,   "<strong><em>$1</em></strong>");
    h = h.replace(/\*\*(.+?)\*\*/g,       "<strong>$1</strong>");
    h = h.replace(/~~(.+?)~~/g,           "<del>$1</del>");         // FIX #2: strikethrough
    h = h.replace(/\*([^*\n<>]+)\*/g,     "<em>$1</em>");           // FIX #3: *italic*
    h = h.replace(/_([^_\n<>]+)_/g,       "<em>$1</em>");           // FIX #3: _italic_

    // Images (before links — otherwise the () in image URLs could be swallowed)
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
      `<img src="$2" alt="$1" loading="lazy" style="max-height:1.2em;vertical-align:middle">`);
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      `<a href="$2" target="_blank" rel="noopener">$1</a>`);

    // Restore — FIX #6: use RegExp (not string) to replace ALL occurrences
    for (let i = 1; i <= ic.length; i++) h = h.replace(new RegExp(`%%ic${i}%%`, "g"), ic[i - 1]);
    for (let i = 1; i <= tx.length; i++) h = h.replace(new RegExp(`%%tx${i}%%`, "g"), tx[i - 1]);
    return h;
  }

  // ── parseMdTables — unchanged logic, but now called at the right time ────
  function parseMdTables(text) {
    const lines = String(text || "").split("\n"), out = []; let i = 0;
    while (i < lines.length) {
      const ln = lines[i].trim();
      if (ln.startsWith("|") && ln.endsWith("|")) {
        const tl = [];
        while (i < lines.length) {
          const cl = lines[i].trim();
          if (cl.startsWith("|") && cl.endsWith("|")) { tl.push(cl); i++; } else break;
        }
        if (tl.length >= 3 &&
            tl[1].split("|").slice(1, -1).every((c) => /^[\s:=-]+$/.test(c.trim()))) {
          let h = "<table><thead><tr>";
          tl[0].split("|").slice(1, -1).forEach((c) => (h += `<th>${Icell(c.trim())}</th>`));
          h += "</tr></thead><tbody>";
          for (let r = 2; r < tl.length; r++) {
            h += "<tr>";
            tl[r].split("|").slice(1, -1).forEach((c) => (h += `<td>${Icell(c.trim())}</td>`));
            h += "</tr>";
          }
          h += "</tbody></table>";
          out.push(h);
        } else {
          out.push(...tl);
        }
      } else { out.push(lines[i]); i++; }
    }
    return out.join("\n");
  }

  // ── FIX #1 #2 #3 #4 #6 #7: Mblock — reordered + full improvements ───────
  function Mblock(raw) {
    if (!raw) return ""; let h = String(raw);

    // ╔══ Stage 1: fenced code blocks ═════════════════════════════════════╗
    // Multi-line, highest priority. Must run before any single-backtick pass.
    const cb = [];
    h = h.replace(/```(\w*)\s*\n([\s\S]*?)\n```/g,
      (_, _l, c) => (cb.push(`<pre><code>${E(c)}</code></pre>`), `\n%%CB${cb.length - 1}%%\n`));

    // ╔══ Stage 2: markdown tables — CRITICAL: before inline-code extraction ╗
    // WHY: if inline code were extracted first (old order), backticks inside
    // table cells would become %%IC0%% placeholders. parseMdTables/Icell would
    // then receive %%IC0%% and pass it through as plain text. The table HTML
    // is later captured in %%HB%%, entombing the %%IC%% inside it. When %%IC%%
    // restoration runs, it searches h — but the placeholder is inside %%HB%%,
    // not in h. Result: browser renders the literal text "%%IC0%%".
    // FIX: run parseMdTables first. Icell() handles backticks independently.
    h = parseMdTables(h);

    // ╔══ Stage 3: protect generated table HTML immediately ════════════════╗
    // Cells now contain resolved <code>, <strong>, <em> etc. Lock them away
    // before any further transformations can see or corrupt them.
    const hb = [];
    h = h.replace(/(<table[\s\S]*?<\/table>)/gi,
      (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`));

    // ╔══ Stage 4: inline code in non-table, non-code-block text ══════════╗
    const ic = [];
    h = h.replace(/`([^`\n]+)`/g,
      (_, c) => (ic.push(`<code>${E(c)}</code>`), `%%IC${ic.length - 1}%%`));

    // ╔══ Stage 5: math in remaining text ═════════════════════════════════╗
    const tx = [];
    h = protectTeX(h, tx);

    // ╔══ Stage 6: sanitize user-supplied raw HTML in non-protected text ═══╗
    h = SH(h);

    // ╔══ Stage 7: protect pre-existing HTML block elements ════════════════╗
    // FIX #7: `table` deliberately excluded — tables already captured above.
    h = h.replace(
      /(<(?:div|details|figure|section|article|style)[\s\S]*?<\/(?:div|details|figure|section|article|style)>)/gi,
      (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`));
    h = h.replace(/(<iframe[\s\S]*?<\/iframe>)/gi,
      (m) => (hb.push(m), `\n%%HB${hb.length - 1}%%\n`));

    // ╔══ Stage 8: markdown transformations on plain text ══════════════════╗

    // Headings (block-level, must match at line start)
    h = h.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
    h = h.replace(/^###\s+(.+)$/gm,  "<h3>$1</h3>");
    h = h.replace(/^##\s+(.+)$/gm,   "<h2>$1</h2>");
    h = h.replace(/^#\s+(.+)$/gm,    "<h1>$1</h1>");

    // Inline text — longer/complex patterns before shorter ones
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    h = h.replace(/\*\*(.+?)\*\*/g,     "<strong>$1</strong>");
    h = h.replace(/~~(.+?)~~/g,         "<del>$1</del>");      // FIX #2: strikethrough
    h = h.replace(/\*([^*\n<>]+)\*/g,   "<em>$1</em>");        // FIX #3: *italic*
    h = h.replace(/_([^_\n<>]+)_/g,     "<em>$1</em>");        // FIX #3: _italic_

    // Images before links
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
      `<img src="$2" alt="$1" loading="lazy">`);
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      `<a href="$2" target="_blank" rel="noopener">$1</a>`);

    // Blockquotes (handle both raw ">" and SH-encoded "&gt;")
    h = h.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");
    h = h.replace(/^>\s+(.+)$/gm,    "<blockquote>$1</blockquote>");

    // FIX #4: Lists — group consecutive items into proper <ul>/<ol> wrappers
    // Match a block of 1+ consecutive list lines (with optional \n between them)
    h = h.replace(/((?:^[-*]\s+.+(?:\n|$))+)/gm, (block) =>
      `<ul>${block.replace(/^[-*]\s+(.+)(\n|$)/gm, "<li>$1</li>")}</ul>`);
    h = h.replace(/((?:^\d+\.\s+.+(?:\n|$))+)/gm, (block) =>
      `<ol>${block.replace(/^\d+\.\s+(.+)(\n|$)/gm, "<li>$1</li>")}</ol>`);

    // Horizontal rule
    h = h.replace(/^---+$/gm, "<hr>");

    // Paragraph / line breaks (last — after all block-level transforms)
    h = h.replace(/\n\n/g, "</p><p>");
    h = h.replace(/\n/g,   "<br>");

    // ╔══ Stage 9: restore all protected content ═══════════════════════════╗
    // FIX #6: use RegExp (not string) for global replace of all occurrences
    for (let i = 0; i < cb.length; i++) h = h.replace(new RegExp(`%%CB${i}%%`, "g"), cb[i]);
    for (let i = 0; i < ic.length; i++) h = h.replace(new RegExp(`%%IC${i}%%`, "g"), ic[i]);
    for (let i = 0; i < tx.length; i++) h = h.replace(new RegExp(`%%TX${i}%%`, "g"), tx[i]);
    for (let i = 0; i < hb.length; i++) h = h.replace(new RegExp(`%%HB${i}%%`, "g"), hb[i]);

    return `<p>${h}</p>`;
  }
