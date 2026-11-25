'use strict';
// A fake company key helper for the tests: argv[2] says what it does. ok: prints argv[3] (a key) and a newline, exits 0;
// fail: progress, then a reason on stderr (argv[3], or a default), exits 1; signin: exits 2; sleep: never ends; empty:
// exits 0 printing nothing; big: prints far more than a key; stdin: exits 0 printing "closed" when stdin is at its end;
// bgok: leaves a `sleep 30` behind (holding its pipes), writes its pid to argv[4], prints argv[3] and exits 0; bgsleep:
// the same `sleep 30`, then never ends; env: prints the environment variable argv[3] (or 'unset') as its key.
const [mode, arg, pidFile] = process.argv.slice(2);
const background = (file) => {
  const c = require('child_process').spawn('sleep', ['30'], { stdio: 'inherit' });
  require('fs').writeFileSync(file, String(c.pid));
};
if (mode === 'bgok') { background(pidFile); process.stdout.write(`${arg}\n`); process.exit(0); }
if (mode === 'bgsleep') { background(arg); setInterval(() => {}, 1000); }
if (mode === 'ok') { process.stderr.write('signing in…\n'); process.stdout.write(`${arg}\n`); process.exit(0); }
if (mode === 'fail') { process.stderr.write('opening the key page\n\n' + (arg || 'You have reached the key limit.') + '\n\n'); process.exit(1); }
if (mode === 'signin') { process.stderr.write('the window was closed\n'); process.exit(2); }
if (mode === 'sleep') setInterval(() => {}, 1000);
if (mode === 'empty') process.exit(0);
if (mode === 'env') { process.stdout.write(`${process.env[arg] || 'unset'}\n`); process.exit(0); }
if (mode === 'big') { process.stdout.write('x'.repeat(1024 * 1024)); }
if (mode === 'stdin') {
  process.stdin.on('data', () => {});
  process.stdin.on('end', () => { process.stdout.write('closed'); process.exit(0); });
  process.stdin.on('error', () => { process.stdout.write('closed'); process.exit(0); });
}
