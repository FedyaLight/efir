// Word indices must match across browsers, regardless of their ICU version.
// Han characters need no spaces; Hindi vowel marks stay within words.
export function wordChunks(text) {
  return text.split(/(\s+|[\p{Script=Han}])/u);
}

export function normWord(text) {
  const word = text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
    .replace(/[\u064b-\u0652\u0670]/g, '').replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  return /[\p{L}\p{N}]/u.test(word) ? word : '';
}
