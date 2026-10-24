// Web addresses in a note's text, so the popup can show them as links. A link
// is just text: this only finds where the addresses are.

const FULL = /https?:\/\/[^\s<>"]+/gi;

// Addresses typed without http(s)://, like nancypatel.me or www.apple.com/iphone.
// Only real web endings count, so Node.js, file.txt, v2.0 and emails never match.
const BARE =
  /(?<![\w@./:-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|co|me|ai|app|dev|so|gg|tv|ly|sh|fm|to|xyz|info|page|site|tech|blog|design|news|us|uk|ca|au|nz|ie|de|fr|es|it|nl|se|ch|eu|in|jp)(?:\/[^\s<>"]*)?(?![\w-])/gi;

/** [{ start, end, url }] for each address in the text, in order. */
export function findLinks(text) {
  const links = [];
  for (const pattern of [FULL, BARE]) {
    for (const match of text.matchAll(pattern)) {
      const written = match[0].replace(/[.,;:!?)\]}'"]+$/, ""); // punctuation after a link isn't part of it
      const start = match.index;
      const end = start + written.length;
      if (links.some((l) => start < l.end && end > l.start)) continue;
      links.push({ start, end, url: pattern === FULL ? written : `https://${written}` });
    }
  }
  return links.sort((a, b) => a.start - b.start);
}

/**
 * An address as a person would write it: arxiv.org/abs/1706.03762, not
 * https://www.arxiv.org/abs/1706.03762. Kept in full if the short form
 * wouldn't be recognised as a link (an unusual domain ending, say).
 */
export function shortAddress(url) {
  const short = url.replace(/^https:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  const [link] = findLinks(short);
  return link && link.start === 0 && link.end === short.length ? short : url;
}
