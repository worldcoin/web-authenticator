import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
			'@images': fileURLToPath(new URL('./public/images', import.meta.url)),
		},
	},
	// Keep worker-relative asset URLs in the installed WalletKit package intact.
	optimizeDeps: { exclude: ['@worldcoin/walletkit-web'] },
	worker: { format: 'es' },
	server: {
		host: 'localhost',
		port: 3100,
		strictPort: true,
		headers: { 'Referrer-Policy': 'no-referrer' },
		proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || '3101'}`, changeOrigin: false } },
	},
})
