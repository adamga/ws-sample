import { performance } from 'node:perf_hooks';

function tokenizeLines(text) {
  const input = String(text ?? '');
  if (!input) return [];
  const lines = [];
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) === 10) {
      lines.push(input.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < input.length) lines.push(input.slice(start));
  return lines;
}

function pushChunk(chunks, value, added, removed, count) {
  if (!count) return;
  const prev = chunks.at(-1);
  if (prev && prev.added === added && prev.removed === removed) {
    prev.value += value;
    prev.count += count;
    return;
  }
  chunks.push({ value, count, added, removed });
}

// Myers O((N+M)D) shortest-edit-script line diff with prefix/suffix trimming and timeout guard.
export function diffLines(oldStr, newStr, options = {}) {
  if (oldStr === newStr) {
    const text = String(oldStr ?? '');
    if (!text) return [];
    const tokens = tokenizeLines(text);
    return [{ value: text, count: tokens.length, added: false, removed: false }];
  }

  const oldLines = tokenizeLines(oldStr);
  const newLines = tokenizeLines(newStr);
  const oldLen = oldLines.length;
  const newLen = newLines.length;

  let prefix = 0;
  const minLen = Math.min(oldLen, newLen);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

  let oldEnd = oldLen;
  let newEnd = newLen;
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const chunks = [];
  if (prefix > 0) {
    pushChunk(chunks, oldLines.slice(0, prefix).join(''), false, false, prefix);
  }

  const N = oldEnd - prefix;
  const M = newEnd - prefix;

  if (N === 0 && M > 0) {
    pushChunk(chunks, newLines.slice(prefix, newEnd).join(''), true, false, M);
  } else if (M === 0 && N > 0) {
    pushChunk(chunks, oldLines.slice(prefix, oldEnd).join(''), false, true, N);
  } else if (N > 0 && M > 0) {
    // Intern strings to integer IDs so inner Myers diagonals only compare 32-bit integers.
    const vocab = new Map();
    let nextId = 1;
    const a = new Int32Array(N);
    const b = new Int32Array(M);
    for (let i = 0; i < N; i++) {
      const line = oldLines[prefix + i];
      let id = vocab.get(line);
      if (id === undefined) { id = nextId++; vocab.set(line, id); }
      a[i] = id;
    }
    for (let j = 0; j < M; j++) {
      const line = newLines[prefix + j];
      let id = vocab.get(line);
      if (id === undefined) { id = nextId++; vocab.set(line, id); }
      b[j] = id;
    }

    const maxD = N + M;
    const offset = maxD + 1;
    const v = new Int32Array(2 * maxD + 3);
    v.fill(-1);
    v[offset + 1] = 0;
    const trace = [];
    const deadline = typeof options.timeout === 'number' && options.timeout > 0
      ? performance.now() + options.timeout
      : Infinity;

    let foundD = -1;
    for (let d = 0; d <= maxD; d++) {
      if ((d & 127) === 127 && performance.now() > deadline) {
        return undefined;
      }
      // Snapshot active window [-d - 1, d + 1] before mutating v for step d.
      const snap = new Int32Array(2 * d + 3);
      for (let k = -d - 1; k <= d + 1; k++) {
        snap[k + d + 1] = v[offset + k];
      }
      trace.push(snap);

      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
          x = v[offset + k + 1];
        } else {
          x = v[offset + k - 1] + 1;
        }
        let y = x - k;
        while (x < N && y < M && a[x] === b[y]) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= N && y >= M) {
          foundD = d;
          break;
        }
      }
      if (foundD >= 0) break;
    }

    if (foundD < 0) return undefined;

    // Backtrack edit script: 0 = equal, 1 = insert from newLines, -1 = delete from oldLines.
    const ops = [];
    let x = N;
    let y = M;
    for (let d = foundD; d > 0; d--) {
      const snap = trace[d];
      const getV = (diag) => snap[diag + d + 1];
      const k = x - y;
      let prevK;
      if (k === -d || (k !== d && getV(k - 1) < getV(k + 1))) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }
      const prevX = getV(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        ops.push(0);
        x--;
        y--;
      }
      if (x === prevX) {
        ops.push(1);
        y--;
      } else {
        ops.push(-1);
        x--;
      }
    }
    while (x > 0 && y > 0) {
      ops.push(0);
      x--;
      y--;
    }

    ops.reverse();

    // Emit contiguous hunks, ordering removals before additions within each changed block.
    let ai = prefix;
    let bi = prefix;
    let idx = 0;
    while (idx < ops.length) {
      if (ops[idx] === 0) {
        const eqStart = ai;
        let eqCount = 0;
        while (idx < ops.length && ops[idx] === 0) {
          ai++;
          bi++;
          eqCount++;
          idx++;
        }
        pushChunk(chunks, oldLines.slice(eqStart, ai).join(''), false, false, eqCount);
      } else {
        const removedBatch = [];
        const addedBatch = [];
        while (idx < ops.length && ops[idx] !== 0) {
          if (ops[idx] === -1) removedBatch.push(oldLines[ai++]);
          else addedBatch.push(newLines[bi++]);
          idx++;
        }
        if (removedBatch.length) pushChunk(chunks, removedBatch.join(''), false, true, removedBatch.length);
        if (addedBatch.length) pushChunk(chunks, addedBatch.join(''), true, false, addedBatch.length);
      }
    }
  }

  if (oldEnd < oldLen) {
    pushChunk(chunks, oldLines.slice(oldEnd).join(''), false, false, oldLen - oldEnd);
  }

  return chunks;
}
