function computeNewContent(prefix, text, viewMode) {
  const startsWithWhitespace = text.length > 0 && /^\s/.test(text);
  const endsWithWhitespace = prefix.length > 0 && /\s$/.test(prefix);
  const needsTokenBoundary =
    prefix.length > 0 && !endsWithWhitespace && !startsWithWhitespace;

  const countTrailingNewlines = (s) => {
    let i = s.length - 1;
    let count = 0;
    while (i >= 0 && s[i] === '\n') {
      count++;
      i--;
    }
    return count;
  };
  const countLeadingNewlines = (s) => {
    let i = 0;
    let count = 0;
    while (i < s.length && s[i] === '\n') {
      count++;
      i++;
    }
    return count;
  };

  let separator = '';

  if (prefix.length === 0) {
    separator = '';
  } else if (viewMode === 'raw') {
    separator = needsTokenBoundary ? ' ' : '';
  } else {
    const preNewlines = countTrailingNewlines(prefix);
    const textNewlines = countLeadingNewlines(text);
    const totalBoundaryNewlines = preNewlines + textNewlines;

    if (totalBoundaryNewlines >= 2) {
      separator = '';
    } else if (preNewlines > 0 || textNewlines > 0) {
      separator = '\n'.repeat(Math.max(0, 2 - totalBoundaryNewlines));
    } else {
      separator = needsTokenBoundary ? ' ' : '\n\n';
    }
  }

  return { newContent: prefix + separator + text, separator };
}

const cases = [
  { name: 'startDocument', prefix: '', text: 'Hello world', mode: 'markdown' },
  { name: 'concatWords', prefix: 'Hello', text: 'world', mode: 'markdown' },
  { name: 'spaceBetween', prefix: 'Hello ', text: 'world', mode: 'markdown' },
  {
    name: 'prefixEndsWithNewline',
    prefix: 'Line\n',
    text: 'Continuation',
    mode: 'markdown',
  },
  {
    name: 'prefixEndsWithTwoNewlines',
    prefix: 'Para\n\n',
    text: 'NextPara',
    mode: 'markdown',
  },
  {
    name: 'textStartsWithNewline',
    prefix: 'Para',
    text: '\nNewLine',
    mode: 'markdown',
  },
  { name: 'raw_no_boundary', prefix: 'Hello', text: ' world', mode: 'raw' },
  { name: 'raw_need_space', prefix: 'Hello', text: 'world', mode: 'raw' },
  {
    name: 'preserve_model_whitespace',
    prefix: 'Hello',
    text: '\n\nModelProvided\n',
    mode: 'markdown',
  },
];

for (const c of cases) {
  const out = computeNewContent(c.prefix, c.text, c.mode);
  console.log(`--- ${c.name} (${c.mode})`);
  console.log('prefix:', JSON.stringify(c.prefix));
  console.log('text:', JSON.stringify(c.text));
  console.log('separator used:', JSON.stringify(out.separator));
  console.log('result:', JSON.stringify(out.newContent));
  console.log('');
}
