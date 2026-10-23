// RSS 2.0 / Atom 읽기. DTD·외부 엔티티를 해석하지 않는 정규식 방식이라 XML 폭탄의 영향을 받지 않는다.
import { getText } from '../http.mjs';
import { cleanText, decodeEntities, parseFeedDate, safeUrl } from '../util.mjs';

function unCdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function tagContent(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? unCdata(m[1]) : '';
}

function tagAttr(block, name, attr) {
  const re = new RegExp(`<${name}\\s[^>]*\\b${attr}=["']([^"']*)["'][^>]*>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]).trim() : '';
}

function blocks(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\s([^>]*)\/?>/gi)].map((m) => m[1]);
  for (const attrs of links) {
    const rel = /\brel=["']([^"']+)["']/i.exec(attrs)?.[1] || 'alternate';
    const href = /\bhref=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && rel === 'alternate') return decodeEntities(href).trim();
  }
  return '';
}

/**
 * @returns {Array<{title:string, link:string, published:Date|null, dateOnly:boolean,
 *   description:string, source:string, sourceUrl:string, categories:string[]}>}
 */
export function parseFeed(xml) {
  const text = String(xml ?? '');
  const head = text.slice(0, 3000);
  const isAtom = /<feed[\s>]/i.test(head) && !/<rss[\s>]/i.test(head);
  const items = isAtom ? blocks(text, 'entry') : blocks(text, 'item');
  const out = [];
  for (const b of items) {
    const title = cleanText(tagContent(b, 'title'));
    const rawLink = isAtom ? atomLink(b) || tagContent(b, 'id') : tagContent(b, 'link') || tagContent(b, 'guid');
    const link = safeUrl(decodeEntities(unCdata(rawLink)));
    if (!title || !link) continue;
    const when = parseFeedDate(
      tagContent(b, 'pubDate') || tagContent(b, 'dc:date') || tagContent(b, 'published') || tagContent(b, 'updated'),
    );
    const description = cleanText(
      tagContent(b, 'description') || tagContent(b, 'summary') || tagContent(b, 'content:encoded') || tagContent(b, 'content'),
    );
    out.push({
      title,
      link,
      published: when?.date ?? null,
      dateOnly: when?.dateOnly ?? false,
      description: description.slice(0, 600),
      source: cleanText(tagContent(b, 'source')),
      sourceUrl: tagAttr(b, 'source', 'url'),
      categories: blocks(b, 'category').map((c) => cleanText(unCdata(c))).filter(Boolean),
    });
  }
  return out;
}

/** 'Google 뉴스' 처럼 여러 언론사를 모은 피드의 제목에서 ' - 언론사' 를 떼어 낸다. */
export function splitAggregatorTitle(title, sourceName) {
  const t = String(title);
  if (sourceName && t.endsWith(` - ${sourceName}`)) return { title: t.slice(0, -(sourceName.length + 3)).trim(), outlet: sourceName };
  const i = t.lastIndexOf(' - ');
  if (i > 10 && t.length - i <= 25) return { title: t.slice(0, i).trim(), outlet: t.slice(i + 3).trim() };
  return { title: t, outlet: sourceName || '' };
}

export async function fetchFeed(feed, { timeoutMs = 30000 } = {}) {
  const xml = await getText(feed.url, {
    timeoutMs,
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' },
  });
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 5000))) {
    throw new Error('RSS 형식이 아님(주소가 바뀌었을 수 있음)');
  }
  return parseFeed(xml);
}
