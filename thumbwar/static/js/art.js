// claude code's visual language, borrowed with love.
// the spinner frames are the real ones from the cli.

export const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽'];

export const VERBS = [
  'vibing', 'brewing', 'scheming', 'noodling', 'cooking', 'clauding',
  'pondering', 'wrangling', 'conjuring', 'percolating', 'moseying',
];

export const WORDMARK = String.raw`
▀█▀ █ █ █ █ █▄█ █▀▄ █ █ █▀█ █▀▄
 █  █▀█ █ █ █ █ █▀▄ ▀▄▀ █▀█ █▀▄
 ▀  ▀ ▀ ▀▀▀ ▀ ▀ ▀▀   ▀  ▀ ▀ ▀ ▀`;

export const GLYPH = {
  spark: '✻',
  tool: '⏺',
  result: '⎿',
  caret: '❯',
  prompt: '>',
};

export function spinnerFrame(t) {
  return SPINNER[Math.floor(t / 120) % SPINNER.length];
}

export function verbFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return VERBS[h % VERBS.length];
}
