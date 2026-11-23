import { calculate } from './calculator.js';

const expression = document.querySelector('#expression');
const result = document.querySelector('#result');
const angleMode = document.querySelector('#angle-mode');

function insert(text) {
  const start = expression.selectionStart;
  const end = expression.selectionEnd;
  expression.setRangeText(text, start, end, 'end');
  expression.focus();
}

document.querySelector('#keys').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.insert) insert(button.dataset.insert);
  if (button.dataset.action === 'clear') {
    expression.value = '';
    result.textContent = '0';
    expression.focus();
  }
});

document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    result.textContent = String(calculate(expression.value, angleMode.value));
  } catch (error) {
    result.textContent = `Error: ${error.message}`;
  }
});
