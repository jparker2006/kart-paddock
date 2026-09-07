import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
 const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
 const base = env.BASE_PATH || '/';
 if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) throw new Error('BASE_PATH must begin and end with / and contain no ..');
 return { base, build: {outDir:'dist/client', emptyOutDir:true}, server:{host:'0.0.0.0',port:Number(env.CLIENT_PORT||5173),strictPort:true,watch:{ignored:['**/artifacts/**','**/.npm-cache/**']}}, preview:{host:'0.0.0.0',port:Number(env.PREVIEW_PORT||4173),strictPort:true} };
});
