// The answers of Google Fonts for the 2 fonts of the layout. Next reads this file when
// NEXT_FONT_GOOGLE_MOCKED_RESPONSES points at it, so the device tests never call the network.
// The browser falls back to a system font, which the tests do not care about.
const face = (family, weight) =>
  `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url(https://fonts.gstatic.com/s/${family.toLowerCase()}/v1/${weight}.woff2) format('woff2'); unicode-range: U+0000-00FF; }`;

module.exports = {
  'https://fonts.googleapis.com/css2?family=Syne:wght@600;700&display=swap': [face('Syne', 600), face('Syne', 700)].join('\n'),
  'https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600&display=swap': [face('Onest', 400), face('Onest', 500), face('Onest', 600)].join('\n'),
};
