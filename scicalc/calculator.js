const functions = {
  sqrt: Math.sqrt,
  ln: Math.log,
  log: Math.log10,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan
};

export function calculate(expression, angleMode = 'rad') {
  if (angleMode !== 'rad' && angleMode !== 'deg') throw new Error('Invalid angle mode');
  if (expression.length > 1000) throw new Error('Expression is too long');
  const tokens = [];
  const tokenPattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:([eE][+-]?\d+))?|([a-zA-Z]+|π)|([()+\-*/^]))/gy;
  let position = 0;
  while (position < expression.length) {
    if (/^\s*$/.test(expression.slice(position))) break;
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(expression);
    if (!match) throw new Error('Invalid character');
    tokens.push(match[1] ? Number(match[1] + (match[2] || '')) : (match[3] || match[4]));
    position = tokenPattern.lastIndex;
  }
  let index = 0;
  const peek = () => tokens[index];
  const take = (token) => {
    if (peek() !== token) return false;
    index++;
    return true;
  };
  const primary = () => {
    const token = tokens[index++];
    if (typeof token === 'number') return token;
    if (token === '(') {
      const value = sum();
      if (!take(')')) throw new Error('Missing closing parenthesis');
      return value;
    }
    if (token === 'pi' || token === 'π') return Math.PI;
    if (token === 'e') return Math.E;
    if (Object.hasOwn(functions, token)) {
      if (!take('(')) throw new Error(`Use ${token}(...)`);
      let value = sum();
      if (!take(')')) throw new Error('Missing closing parenthesis');
      if (angleMode === 'deg' && ['sin', 'cos', 'tan'].includes(token)) value *= Math.PI / 180;
      value = functions[token](value);
      if (angleMode === 'deg' && ['asin', 'acos', 'atan'].includes(token)) value *= 180 / Math.PI;
      return value;
    }
    throw new Error('Expected a number, constant, or function');
  };
  const power = () => {
    const left = primary();
    return take('^') ? left ** unary() : left;
  };
  const unary = () => {
    if (take('+')) return unary();
    if (take('-')) return -unary();
    return power();
  };
  const product = () => {
    let value = unary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[index++];
      const right = unary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = () => {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[index++];
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };
  const result = sum();
  if (index !== tokens.length) throw new Error('Unexpected token');
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}
