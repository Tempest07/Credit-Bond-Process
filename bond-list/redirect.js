// Keep saved links working under both /bond-centre/ and the local root.
const target = new URL('../', window.location.href);
target.search = window.location.search;
target.hash = 'bond-list';
window.location.replace(target.href);
