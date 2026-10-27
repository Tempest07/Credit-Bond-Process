// Local development credentials must never be served as static assets.
const encodedCharacter = character => {
  const codes = [...new Set([character.toLowerCase(), character.toUpperCase()])]
    .map(value => value.charCodeAt(0).toString(16)).join('|');
  return `(?:${character === '.' ? '\\.' : character}|%(?:25)*(?:${codes}))`;
};
const privateNames = ['.dev.vars', '.env'].map(name => [...name].map(encodedCharacter).join('')).join('|');
const privateSegment = new RegExp(`(?:^|[\\\\/]|%(?:25)*(?:2f|5c))(?:${privateNames})`, 'i');

export function onRequest(context) {
  let path = new URL(context.request.url).pathname;
  // Also handle mixed escapes such as %25%32%65nv, without letting a malformed
  // percent escape prevent recognition of the valid ASCII parts of the path.
  for (let pass = 0; pass < 4; pass++) {
    const decoded = path.replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (decoded === path) break;
    path = decoded;
  }
  if (privateSegment.test(path)) {
    return new Response(null, { status: 404, headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  }
  return context.next();
}
