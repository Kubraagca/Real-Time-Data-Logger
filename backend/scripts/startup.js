const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.env.DATABASE_URL) {
  console.log('DATABASE_URL detected, syncing Prisma schema with database...');
  run('npx', ['prisma', 'db', 'push', '--skip-generate']);
} else {
  console.log('DATABASE_URL not set, skipping Prisma db push.');
}

run('node', ['dist/server.js']);
