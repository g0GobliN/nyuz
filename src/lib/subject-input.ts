/** Conservative junk checks, without a dictionary that excludes unfamiliar names. */
export function isJunkSubject(raw: string): boolean {
  const label = raw.normalize("NFKC").trim();
  if (/[\p{Cc}\p{Cf}]/u.test(label)) return true;
  const words = label.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  if (words.length === 0) return true;
  return words.every(
    (word) =>
      /^(.)\1{2,}$/u.test(word) || /^(?:asdf|asdfgh|qwerty|qwertyuiop|zxcv|zxcvbnm)$/.test(word),
  );
}
