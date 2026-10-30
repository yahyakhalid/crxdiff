import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/vendor/**', 'test/fixtures/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker, chrome: 'readonly' },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // These scripts pass functions into the browser with puppeteer's evaluate().
    files: ['scripts/screenshots.mjs', 'scripts/render-art.mjs', 'scripts/experiment/browser-run.mjs'],
    languageOptions: { globals: { chrome: 'readonly', document: 'readonly' } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent / the h() helper.' },
        { property: 'outerHTML', message: 'Use textContent / the h() helper.' },
        { property: 'insertAdjacentHTML', message: 'Use textContent / the h() helper.' },
      ],
      'no-restricted-syntax': ['error', { selector: "CallExpression[callee.property.name='write'][callee.object.name='document']", message: 'No document.write.' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
];
