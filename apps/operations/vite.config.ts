import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [react()], base: './', server: { host: '127.0.0.1', port: 4186, fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] } },
	build: { rollupOptions: { input: {
		main: fileURLToPath(new URL('./index.html', import.meta.url)),
		auth: fileURLToPath(new URL('./auth.html', import.meta.url)),
		popupRelay: fileURLToPath(new URL('./popup-relay.html', import.meta.url)),
	} } },
});