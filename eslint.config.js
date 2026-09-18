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

      // Context files export their hook beside their provider (useAuth, useOrg,
      // useToast) — the idiomatic shape, and splitting each into two files buys
      // nothing but a slightly faster hot reload of a provider nobody edits.
      // DEPT_PALETTE is a constant two screens import from TeamHierarchy.
      'react-refresh/only-export-components': ['error', {
        allowConstantExport: true,
        allowExportNames: ['useAuth', 'useOrg', 'useToast', 'DEPT_PALETTE'],
      }],

      // These two come from the React Compiler rule set bundled into
      // eslint-plugin-react-hooks v7. This project does not run the compiler
      // (no babel-plugin-react-compiler; vite.config.js uses plain react()), so
      // they flag patterns that are correct here: every screen loads its data in
      // a mount effect that sets `loading` first. Replacing that pattern wholesale
      // is a data-fetching-library decision for Phase 2, not a lint fix, so they
      // stay visible as warnings rather than being "fixed" one effect at a time.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
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
