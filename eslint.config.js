import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      // Only for jsx-uses-vars (below). Without it, no-unused-vars cannot see
      // that `<motion.div>` uses the `motion` import and reports every
      // lowercase JSX identifier as dead — which is exactly the kind of false
      // positive someone eventually "fixes" by deleting a live import.
      // Capitalised names were hidden from it by varsIgnorePattern, so the rule
      // looked almost right, which made it worse.
      react.configs.flat.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    settings: { react: { version: 'detect' } },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // argsIgnorePattern lets a parameter that exists only to hold a position —
      // a caught error nobody inspects, a prop kept for a caller's sake — be
      // named `_thing` instead of being deleted or silenced with a comment.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // FIX_PLAN item 1. documentStore.save() named its parameter `doc`, which
      // shadowed the Firestore `doc` import at the top of the file and turned
      // every call into "doc is not a function". The parameter is renamed, but
      // the class of bug is what needs catching — these two rules are what make
      // the next one a lint error instead of a runtime crash on a write path.
      'no-shadow': 'error',
      'no-shadow-restricted-names': 'error',

      // The rest of eslint-plugin-react's recommended set is not adopted here —
      // this project has its own conventions and turning on ~25 new rules at once
      // would bury the errors that matter. Only the two that make no-unused-vars
      // correct are kept on.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react/no-unescaped-entities': 'off',
      'react/no-unknown-property': 'off',
      'react/jsx-key': 'error',
    },
  },
  {
    // Serverless functions, migration scripts and the build config run in Node,
    // not the browser: process, Buffer and __dirname are all legitimate here.
    files: ['api/**/*.js', 'scripts/**/*.js', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
