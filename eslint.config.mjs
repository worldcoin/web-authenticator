import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
	{
		ignores: [
			'node_modules/**',
			'.next/**',
			'dist/**',
			'out/**',
			'build/**',
			'demo/**',
			'src/server/**/target/**',
			'.codex-visualizations/**',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: { globals: { ...globals.browser, ...globals.node, Bun: 'readonly' } },
		plugins: { 'react-hooks': hooks },
		rules: {
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		},
	}
)
