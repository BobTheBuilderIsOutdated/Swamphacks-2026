import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';

export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function publicUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port))) throw new Error('Only public web pages can be researched.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      (ipaddr.isValid(host) && !publicAddress(host))) throw new Error('Private network URLs are not allowed.');
  return url;
}

export async function publicText(input, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects.');
  const url = publicUrl(input);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Private network address blocked.');
  // Pin a validated DNS result to the actual socket, preventing DNS rebinding.
  const chosen = addresses[0];
  const agent = new Agent({ connect: { lookup: (_host, options, callback) => {
    if (options.all) callback(null, [chosen]); else callback(null, chosen.address, chosen.family);
  } } });
  try {
    const response = await fetch(url, { dispatcher: agent, redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'NudgeResearch/0.2 (public professional research)', Accept: 'text/html,text/plain' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      return publicText(new URL(response.headers.get('location'), url).href, redirects + 1);
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Source unavailable (${response.status}).`); }
    if (!/text\/(html|plain)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); throw new Error('Source is not an HTML or text page.');
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2_000_000) throw new Error('Page exceeds the research download limit.');
      chunks.push(Buffer.from(chunk));
    }
    return { url: url.href, html: Buffer.concat(chunks).toString('utf8') };
  } finally { await agent.close(); }
}

export async function scrape(url) {
  const parsed = publicUrl(url);
  try {
    const robots = await publicText(`${parsed.origin}/robots.txt`);
    if (robotsParser(`${parsed.origin}/robots.txt`, robots.html).isDisallowed(parsed.href, 'NudgeResearch')) {
      throw new Error('This site disallows automated research.');
    }
  } catch (error) {
    // A missing robots.txt is normal; network/private-address failures are not bypassed.
    if (!error.message.includes('(404)')) throw error;
  }
  const result = await publicText(url), $ = load(result.html);
  $('script,style,noscript,svg,iframe,form').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const mailto = $('a[href^="mailto:"]').map((_i, el) => $(el).attr('href').slice(7).split('?')[0]).get();
  const emails = [...new Set([...mailto, ...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])].map(x => x.toLowerCase()))];
  return { url: result.url, title: $('title').text(), text: text.slice(0, 60000), emails };
}
