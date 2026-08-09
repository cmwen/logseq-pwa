import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const repositoryRoot = join(packageRoot, '../..');

async function bundle() {
  console.log('📦 Bundling CLI with Rolldown...\n');

  try {
    process.chdir(repositoryRoot);
    const build = await rolldown({
      input: 'packages/cli/dist/index.js',
      treeshake: false,
      external: [
        'commander',
        'express',
        '@loam/core',
        /^node:/,
        'preact',
        'zod',
        '@modelcontextprotocol/sdk/server/index.js',
        '@modelcontextprotocol/sdk/server/stdio.js',
        '@modelcontextprotocol/sdk/types.js',
      ],
    });

    const { output } = await build.generate({
      format: 'esm',
    });

    const bundledCode = output[0].code;
    const outputPath = join(packageRoot, 'dist/bundled.js');

    writeFileSync(outputPath, bundledCode, 'utf-8');

    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      const { chmodSync } = await import('node:fs');
      chmodSync(outputPath, 0o755);
    }

    console.log('✅ Bundle created: dist/bundled.js');

    const stats = readFileSync(join(packageRoot, 'dist/bundled.js'), 'utf-8');
    console.log(`📊 Size: ${(stats.length / 1024).toFixed(2)} KB\n`);
  } catch (error) {
    console.error('❌ Bundling failed:', error);
    process.exit(1);
  }
}

bundle();
