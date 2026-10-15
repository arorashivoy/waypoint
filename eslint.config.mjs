import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const noChildProcess = {
  'no-restricted-imports': ['error', {
    paths: [
      { name: 'child_process', message: 'Start processes only through src/lib/exec.ts.' },
      { name: 'node:child_process', message: 'Start processes only through src/lib/exec.ts.' },
    ],
  }],
};

export default tseslint.config(
  { ignores: ['node_modules/**', '.next/**', 'tmp/**', 'design/**', '.claude/**', '.superpowers/**'] },
  // The react-hooks plugin is registered only so that the existing
  // eslint-disable comments name a known rule. No react-hooks rule is on.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.mjs', '**/*.js', '**/*.cjs'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'react-hooks': reactHooks },
    rules: noChildProcess,
  },
  { files: ['src/lib/exec.ts'], rules: { 'no-restricted-imports': 'off' } },
);
