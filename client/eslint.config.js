// ESLint flat config — client (React + Vite, browser ESM). Real-bug rules error;
// React Hooks correctness is enforced; stylistic/noise rules are warnings.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'e2e/**', 'public/**', '*.config.js'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      // Enforce ONLY the critical classic hook rule as an error. The newer
      // react-compiler rules bundled in the plugin's "recommended" set are too
      // aggressive for this legacy codebase and would require a large rewrite —
      // they are intentionally NOT enabled here (revisit when splitting components).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
