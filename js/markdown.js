/**
 * Fast, lightweight Markdown parser with safe HTML escaping
 * Handles headings, tables, code blocks, lists, bold/italic, callouts, and blockquotes
 */

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(markdownText) {
  if (!markdownText) return '';

  let html = markdownText;

  // Code blocks ```code```
  html = html.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre class="code-block"><code class="language-${escapeHtml(lang)}">${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code `code`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Tables
  html = html.replace(/((\|[^\n]+\|\r?\n)((?:\|:?[-]+:?)+\|)(\r?\n(?:\|[^\n]+\|\r?\n?)+))/g, (match) => {
    const lines = match.trim().split(/\r?\n/);
    if (lines.length < 2) return match;

    const headers = lines[0].split('|').slice(1, -1).map(h => `<th>${h.trim()}</th>`).join('');
    const thead = `<thead><tr>${headers}</tr></thead>`;

    const rows = lines.slice(2).map(line => {
      const cells = line.split('|').slice(1, -1).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    const tbody = `<tbody>${rows}</tbody>`;

    return `<div class="table-container"><table>${thead}${tbody}</table></div>`;
  });

  // Callouts & Blockquotes
  html = html.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/gim, (m, type, rest) => {
    return `<div class="alert alert-${type.toLowerCase()}"><strong>${type}</strong>: ${rest}</div>`;
  });

  html = html.replace(/^>\s*(.+)$/gm, '<blockquote>$1</blockquote>');

  // Headings
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Unordered lists
  html = html.replace(/^[\s]*[-*+]\s+(.*)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>(\r?\n)?)+/g, '<ul>$&</ul>');

  // Ordered lists
  html = html.replace(/^[\s]*\d+\.\s+(.*)$/gim, '<li class="ol-item">$1</li>');
  html = html.replace(/(<li class="ol-item">.*<\/li>(\r?\n)?)+/g, '<ol>$&</ol>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr/>');

  // Paragraphs
  const splitParagraphs = html.split(/\n\s*\n/);
  html = splitParagraphs.map(p => {
    p = p.trim();
    if (!p) return '';
    if (/^<(h[1-6]|ul|ol|pre|div|blockquote|table|hr)/i.test(p)) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');

  return html;
}
