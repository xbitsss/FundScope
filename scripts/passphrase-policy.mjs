const commonWords = new Set(['password', 'welcome', 'letmein', 'qwerty', 'admin', 'fundscope', 'iloveyou', 'correct', 'horse', 'battery', 'staple', 'secret', 'monkey', 'dragon', 'sunshine', 'football', 'trustnoone', 'changeme', 'finance', 'mutualfund']);

/** Conservative estimate for a generated or human-entered passphrase; not a password-strength proof. */
export function estimatePassphraseBits(value) {
  if (typeof value !== 'string') return 0;
  const compact = value.normalize('NFKC').replace(/[\s-]/g, '');
  if (!compact) return 0;
  const lower = /[a-z]/.test(compact), upper = /[A-Z]/.test(compact), digit = /[0-9]/.test(compact), symbol = /[^A-Za-z0-9]/.test(compact);
  const charset = (lower ? 26 : 0) + (upper ? 26 : 0) + (digit ? 10 : 0) + (symbol ? 32 : 0);
  if (!charset) return 0;
  let estimate = compact.length * Math.log2(charset);
  let repeatedRun = 1; let longestRun = 1; let ascending = 1; let descending = 1; let sequencePenalty = 0;
  for (let index = 1; index < compact.length; index++) {
    const before = compact.charCodeAt(index - 1), current = compact.charCodeAt(index);
    repeatedRun = current === before ? repeatedRun + 1 : 1;
    longestRun = Math.max(longestRun, repeatedRun);
    ascending = current === before + 1 ? ascending + 1 : 1;
    descending = current === before - 1 ? descending + 1 : 1;
    if (ascending === 4 || descending === 4) sequencePenalty += 12;
  }
  estimate -= Math.max(0, longestRun - 2) * 3 + sequencePenalty;
  const lowered = compact.toLowerCase();
  for (const word of commonWords) if (lowered.includes(word)) estimate -= 35;
  for (let period = 1; period <= Math.min(4, Math.floor(compact.length / 2)); period++) {
    const pattern = compact.slice(0, period);
    if (pattern.repeat(Math.ceil(compact.length / period)).slice(0, compact.length) === compact) { estimate -= (compact.length - period) * Math.log2(charset) * 0.8; break; }
  }
  return Math.max(0, estimate);
}

export function isPassphraseStrong(value, minimumBits = 80) {
  return typeof value === 'string' && value.length >= 16 && estimatePassphraseBits(value) >= minimumBits;
}
