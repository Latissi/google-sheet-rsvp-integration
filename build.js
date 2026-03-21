const { build } = require('esbuild');
const fs = require('fs');

const appScriptEntryPoints = [
  'doGet',
  'doPost',
  'runReminderDispatch',
  'runTrainerParticipationReportDispatch',
];

build({
  entryPoints: ['src/runtime/webapp.ts'],
  bundle: true,
  outfile: 'dist/Code.js',
  format: 'iife',
  globalName: '_app',
}).then(() => {
  const code = fs.readFileSync('dist/Code.js', 'utf8');

  const stubs = appScriptEntryPoints
    .map((fnName) => `function ${fnName}() { return _app.${fnName}.apply(this, arguments); }`)
    .join('\n');

  fs.writeFileSync('dist/Code.js', stubs + '\n' + code);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
