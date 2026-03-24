import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  root: '.',
  
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'terser',
    sourcemap: false,
    assetsDir: 'assets',
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        entryFileNames: 'js/[name]-[hash].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(assetInfo.name)) {
            return 'img/[name]-[hash][extname]';
          }
          if (/\.(woff2?|eot|ttf|otf)$/i.test(assetInfo.name)) {
            return 'fonts/[name]-[hash][extname]';
          }
          if (ext === 'css') {
            return 'css/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    },
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      },
      format: {
        comments: false
      }
    }
  },
  
  server: {
    port: 3000,
    strictPort: false,
    host: true,
    https: false,
    cors: true,
    hmr: {
      overlay: true
    }
  },
  
  preview: {
    port: 4173,
    strictPort: false,
    host: true
  },
  
  esbuild: {
    target: 'es2020',
    legalComments: 'none'
  },
  
  css: {
    devSourcemap: false
  },
  
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
      '@app': resolve(__dirname, './app'),
      '@core': resolve(__dirname, './core'),
      '@mesh': resolve(__dirname, './mesh'),
      '@net': resolve(__dirname, './net'),
      '@stream': resolve(__dirname, './stream'),
      '@ui': resolve(__dirname, './ui'),
      '@fenix': resolve(__dirname, './fenix'),
      '@perf': resolve(__dirname, './perf')
    }
  },
  
  define: {
    __NEXO_VERSION__: JSON.stringify('9.0.0'),
    __IS_CAPACITOR__: JSON.stringify(true)
  }
});
