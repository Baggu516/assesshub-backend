function tokenizeWords(text) {
  return text.split(/\s+/).filter(Boolean);
}

function wordsToText(words) {
  return words.join(' ');
}

/** Fixed-size windows with word overlap. */
export function chunkFixed(text, chunkSize, overlap) {
  const words = tokenizeWords(text);
  if (!words.length) return [];
  const step = Math.max(1, chunkSize - overlap);
  const chunks = [];
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + chunkSize);
    if (!slice.length) break;
    chunks.push(wordsToText(slice));
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}

/** Split by paragraph → sentence → word until under chunkSize. */
export function chunkRecursive(text, chunkSize, overlap) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const separators = [/\n\n+/, /(?<=[.!?])\s+/, /\s+/];

  function splitRecursively(content, level) {
    const words = tokenizeWords(content);
    if (words.length <= chunkSize) return [content];

    if (level >= separators.length) {
      return chunkFixed(content, chunkSize, overlap);
    }

    const parts = content.split(separators[level]).map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) {
      return splitRecursively(content, level + 1);
    }

    const out = [];
    let buf = '';
    for (const part of parts) {
      const candidate = buf ? `${buf}\n\n${part}` : part;
      if (tokenizeWords(candidate).length <= chunkSize) {
        buf = candidate;
      } else {
        if (buf) out.push(...splitRecursively(buf, level + 1));
        buf = part;
      }
    }
    if (buf) out.push(...splitRecursively(buf, level + 1));
    return out;
  }

  const raw = splitRecursively(normalized, 0);
  if (!overlap || raw.length <= 1) return raw;

  const merged = [];
  for (let i = 0; i < raw.length; i++) {
    if (i === 0) {
      merged.push(raw[i]);
      continue;
    }
    const prevWords = tokenizeWords(raw[i - 1]);
    const tail = prevWords.slice(-overlap);
    const cur = tokenizeWords(raw[i]);
    merged.push(wordsToText([...tail, ...cur]));
  }
  return merged;
}

/**
 * Semantic-ish chunking: sentence boundaries, then greedy merge by length.
 * Oversized sentences fall back to fixed windows with overlap.
 * When a merge flush occurs, the next chunk starts with `overlap` words from the prior chunk.
 */
export function chunkSemanticBySentences(text, chunkSize, overlap = 0) {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return [];

  const ov = Math.max(0, Math.min(overlap, Math.floor(chunkSize / 2)));
  const chunks = [];
  let buf = [];
  let count = 0;

  const flush = () => {
    if (!buf.length) return;
    const piece = buf.join(' ');
    chunks.push(piece);
    if (ov > 0) {
      const tail = tokenizeWords(piece).slice(-ov);
      buf = tail.length ? [wordsToText(tail)] : [];
      count = tail.length;
    } else {
      buf = [];
      count = 0;
    }
  };

  for (const sentence of sentences) {
    const w = tokenizeWords(sentence).length;
    if (w > chunkSize) {
      flush();
      chunks.push(...chunkFixed(sentence, chunkSize, ov));
      if (ov > 0 && chunks.length) {
        const tail = tokenizeWords(chunks[chunks.length - 1]).slice(-ov);
        buf = tail.length ? [wordsToText(tail)] : [];
        count = tail.length;
      }
      continue;
    }
    if (count + w > chunkSize && buf.length) {
      flush();
      // After flush, buf may hold overlap; append sentence if it still fits
      if (count + w > chunkSize && buf.length) {
        chunks.push(buf.join(' '));
        buf = [sentence];
        count = w;
      } else {
        buf.push(sentence);
        count += w;
      }
    } else {
      buf.push(sentence);
      count += w;
    }
  }
  if (buf.length) {
    const piece = buf.join(' ');
    // Avoid emitting a tiny overlap-only remnant as a final chunk when empty of new content
    if (chunks.length && tokenizeWords(piece).length <= ov) {
      // merge remnant into previous
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${piece}`.trim();
    } else {
      chunks.push(piece);
    }
  }
  return chunks;
}

/**
 * Original / source-only chunking: preserve paragraphs; apply fixed-size windows
 * (with overlap) when a paragraph exceeds the chunk size budget.
 */
export function chunkSourceOnly(text, chunkSize = 500, overlap = 0) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  let paras = normalized.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) {
    paras = normalized.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  }

  const size = Math.max(100, chunkSize);
  const ov = Math.max(0, Math.min(overlap, Math.floor(size / 2)));
  const out = [];

  for (const p of paras) {
    if (tokenizeWords(p).length <= size) {
      out.push(p);
    } else {
      out.push(...chunkFixed(p, size, ov));
    }
  }

  return out;
}

/** Approximate words from token budget (~0.75 words per token). */
export function tokensToWords(tokens) {
  return Math.max(50, Math.round(Number(tokens) * 0.75));
}

export function chunkText(text, strategy, chunkSize, overlap) {
  const size = Math.max(100, chunkSize);
  const ov = Math.min(overlap, Math.floor(size / 2));

  switch (strategy) {
    case 'source':
    case 'original':
      return chunkSourceOnly(text, size, ov);
    case 'fixed':
      return chunkFixed(text, size, ov);
    case 'semantic':
      return chunkSemanticBySentences(text, size, ov);
    case 'recursive':
    default:
      return chunkRecursive(text, size, ov);
  }
}
