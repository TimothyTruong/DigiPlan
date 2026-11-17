/** Tiny, safe markdown → HTML (escape first, then format). Headings, lists, checkboxes, quotes, code, bold/italic, links. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
}

export function renderMarkdown(src: string): string {
  const lines = esc(src).split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let code = false
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  lines.forEach((line, idx) => {
    if (line.startsWith('```')) { closeList(); out.push(code ? '</code></pre>' : '<pre><code>'); code = !code; return }
    if (code) { out.push(line + '\n'); return }
    let m: RegExpMatchArray | null
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { closeList(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); return }
    if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/i))) {
      if (list !== 'ul') { closeList(); out.push('<ul class="md-tasks">'); list = 'ul' }
      out.push(`<li><input type="checkbox" data-line="${idx}" ${m[1].toLowerCase() === 'x' ? 'checked' : ''}/> <span>${inline(m[2])}</span></li>`)
      return
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' } out.push(`<li>${inline(m[1])}</li>`); return }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' } out.push(`<li>${inline(m[1])}</li>`); return }
    closeList()
    if ((m = line.match(/^&gt;\s?(.*)/))) { out.push(`<blockquote>${inline(m[1])}</blockquote>`); return }
    if (/^---+$/.test(line)) { out.push('<hr/>'); return }
    if (line.trim() === '') { out.push(''); return }
    out.push(`<p>${inline(line)}</p>`)
  })
  closeList()
  if (code) out.push('</code></pre>')
  return out.join('\n')
}

/** Toggle the checkbox on source line `idx`. */
export function toggleTaskLine(src: string, idx: number): string {
  const lines = src.split('\n')
  lines[idx] = lines[idx].replace(/\[( |x)\]/i, (_, c) => (c === ' ' ? '[x]' : '[ ]'))
  return lines.join('\n')
}
