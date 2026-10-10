// ESLint flat config (ESLint 9). Base: eslint-config-expo, the preset
// matched to Expo SDK 54. Lint only: no formatter, no autofix pass.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'node_modules/*',
      'dist/*',
      'web-build/*',
      'android/*',
      'ios/*',
      '.expo/*',
      // The vakana.mg static site: plain browser scripts sharing globals
      // across <script> tags, never bundled into the app.
      'web/*',
      // Agent worktrees (Claude Code) are full repo copies.
      '.claude/*',
    ],
  },
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: false }],
      // Quotes and apostrophes render literally inside RN <Text>; the
      // HTML-entity concern behind the default forbid list doesn't apply.
      // `>` and `}` still catch real JSX typos.
      'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }],
      // Trips on render-rule factories (react-native-markdown-display
      // `rules` callbacks), which are functions, not components.
      'react/display-name': 'warn',
    },
  },
  {
    // jest-expo test files: the Jest globals are injected by the runner.
    files: ['**/__tests__/**/*.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
]);
