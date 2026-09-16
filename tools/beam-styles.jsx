import { useInsertionEffect } from 'react';

// The production CSP disallows inline <style> elements. Apply the library's
// generated rules through CSSOM without relaxing the site's security policy.
export function BeamStyles({ children }) {
  useInsertionEffect(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(children);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(value => value !== sheet);
    };
  }, [children]);
  return null;
}
