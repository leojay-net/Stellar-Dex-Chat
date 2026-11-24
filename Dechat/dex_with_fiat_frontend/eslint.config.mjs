import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const testApi = '/^(it|test|describe|suite)$/';
const testModifier = '/^(only|skip|skipIf)$/';
const testFilter = `:matches([property.name=${testModifier}], [property.value=${testModifier}])`;

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // The codebase prefixes intentionally-unused bindings with `_`.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression${testFilter}:matches([object.name=${testApi}], [object.object.name=${testApi}])`,
          message:
            'Remove .only, .skip, or .skipIf so the full test suite runs.',
        },
        {
          selector:
            'CallExpression[callee.name=/^(fit|fdescribe|xit|xtest|xdescribe)$/]',
          message: 'Use the standard test API without focus or skip aliases.',
        },
      ],
    },
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
  },
];

export default eslintConfig;
