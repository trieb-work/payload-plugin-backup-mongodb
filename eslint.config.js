// @ts-check

import payloadEsLintConfig from '@payloadcms/eslint-config'

// Only TypeScript/TSX is hand-written in this repo. JS/MJS/CJS files are either
// generated (Next build output, payload importMap), config, or helper scripts
// that aren't worth type-aware linting. The `lint` script in package.json
// scopes ESLint to src/dev/tests TS(X), and the ignores below are a defensive
// second layer so running `eslint` without args doesn't accidentally crawl
// generated artifacts.
export const defaultESLintIgnores = [
  '**/.temp',
  '**/.*', // ignore all dotfiles
  '**/.git',
  '**/.hg',
  '**/.pnp.*',
  '**/.svn',
  '**/tsconfig.tsbuildinfo',
  '**/README.md',
  '**/payload-types.ts',
  'src/components/BackupDashboard/backupDashboardInlineCss.ts',
  '**/dist/',
  '**/.next/**',
  '**/.yarn/',
  '**/build/',
  '**/node_modules/',
  '**/temp/',
  '**/coverage/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/blob-report/**',
  '**/.playwright/**',
  '**/.playwright-mcp/**',
  '**/*.js',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.jsx',
]

export default [
  { ignores: defaultESLintIgnores },
  ...payloadEsLintConfig,
  {
    rules: {
      'no-restricted-exports': 'off',
    },
  },
  {
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
        projectService: {
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 40,
          allowDefaultProject: ['*.spec.ts', '*.d.ts', 'playwright.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests rely heavily on Vitest mock patterns that legitimately trip a few
    // strict rules: `async () => value` shorthand for resolved promises, the
    // `importOriginal<typeof import('...')>()` pattern for partial mocks, and
    // occasional `any` for loosely-typed fixtures. Keep these rules strict in
    // production code under src/ and dev/, but relax them here.
    files: ['tests/**/*.ts', 'tests/**/*.tsx', '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]
