// Test-only preload for group-commit-server.test.ts; never installed by the application.
// SIGKILLs the process inside the first transaction that is about to insert its FLOW_TEST_KILL_AT_ROW-th command row:
// the state row and earlier command rows are already written but uncommitted, and no ACK of the batch has been sent.
const sqlite=require('node:sqlite'),limit=Number(process.env.FLOW_TEST_KILL_AT_ROW);let rows=0;
const exec=sqlite.DatabaseSync.prototype.exec;sqlite.DatabaseSync.prototype.exec=function(sql){if(/^\s*BEGIN/i.test(sql))rows=0;return exec.call(this,sql);};
const run=sqlite.StatementSync.prototype.run;sqlite.StatementSync.prototype.run=function(...args){if(this.sourceSQL.startsWith('INSERT INTO commands')&&++rows===limit)process.kill(process.pid,'SIGKILL');return run.apply(this,args);};
