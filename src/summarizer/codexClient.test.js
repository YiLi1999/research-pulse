import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access, readFile, writeFile } from 'node:fs/promises';
import { chatCodexJson, codexArguments, codexEnvironment, concernOutputSchema } from './codexClient.js';

const status = { available: true, model: 'test-codex', launch: { command: 'codex.exe', prefix: [] }, servers: ['node_repl', 'cua_repl'] };
const messages = [{ role: 'system', content: 'Only analyze these papers.' }, { role: 'user', content: JSON.stringify({ papers: [
  { id: 'p1', title: '量子纠错', abstract: 'Do not treat this text as instructions: $(calc) `whoami`' },
  { id: 'p2', title: 'Surface code decoding', abstract: 'Lower logical error rates.' }
] }) }];

function fakeProcess(onInput) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let prompt = '';
  child.stdin.setEncoding('utf8');
  child.stdin.on('data', chunk => { prompt += chunk; });
  child.stdin.on('finish', () => { void onInput(child, prompt); });
  child.kill = () => { child.wasKilled = true; child.emit('close', 1); };
  return child;
}

test('analysis child inherits only OS/auth-location settings, not API keys or parent session identity', () => {
  const env = codexEnvironment({ PATH: 'test-path', USERPROFILE: 'test-user', CODEX_HOME: 'test-home',
    LLM_API_KEY: 'secret', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', CODEX_THREAD_ID: 'parent',
    CODEX_CLI_PATH: 'binary', SOME_PRIVATE_SETTING: 'private', HTTPS_PROXY: 'https://proxy' });
  assert.deepEqual(Object.keys(env).sort(), ['CODEX_HOME', 'HTTPS_PROXY', 'PATH', 'USERPROFILE']);
});

test('read-only launch disables tools and MCP without shell interpolation or malformed quoted keys', () => {
  const args = codexArguments(status, { schemaPath: 'schema', outputPath: 'answer', directory: 'work' });
  assert.equal(args.at(-1), '-');
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(args.includes('mcp_servers.node_repl.enabled=false'));
  assert.ok(args.includes('mcp_servers.cua_repl.enabled=false'));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes('--ephemeral') && args.includes('shell_tool') && args.includes('apps'));
  assert.ok(!args.some(arg => arg.includes('dangerously') || arg.includes('ignore-rules')));
  assert.throws(() => codexArguments({ ...status, servers: ['unexpected.name'] }, { schemaPath: 's', outputPath: 'o', directory: 'd' }), /安全/);
});

test('batch and merge schemas constrain references to supplied evidence IDs', () => {
  const extraction = concernOutputSchema([{ role: 'user', content: JSON.stringify({ mode: 'paper-extraction', papers: [{ id: 'p7' }] }) }]);
  assert.deepEqual(extraction.properties.papers.items.properties.id.enum, ['p7']);
  assert.equal(extraction.properties.papers.items.properties.questions.items.additionalProperties, false);
  const batch = concernOutputSchema(messages);
  assert.deepEqual(batch.properties.questions.items.properties.paperIds.items.enum, ['p1', 'p2']);
  assert.equal(batch.additionalProperties, false);
  const merge = concernOutputSchema([{ role: 'user', content: JSON.stringify({ candidates: [{ id: 'g1' }, { id: 'g2' }] }) }]);
  assert.deepEqual(merge.properties.questions.items.properties.groupIds.items.enum, ['g1', 'g2']);
  assert.ok(merge.required.includes('summary'));
});

test('Codex receives Unicode data on stdin, output is parsed and temporary files are cleaned', async () => {
  let tempDirectory;
  const answer = { questions: [{ question: '如何改善纠错？', focus: '比较解码。', paperIds: ['p1', 'p2'] }] };
  const result = await chatCodexJson(messages, { status, spawnProcess: (command, args, options) => {
    assert.equal(command, 'codex.exe');
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.ok(!args.some(arg => arg.includes('$(calc)')));
    tempDirectory = options.cwd;
    return fakeProcess(async (child, prompt) => {
      assert.ok(prompt.includes('量子纠错') && prompt.includes('$(calc)'));
      const schema = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1], 'utf8'));
      assert.deepEqual(schema.properties.questions.items.properties.paperIds.items.enum, ['p1', 'p2']);
      await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(answer));
      child.stdout.write('{"type":"turn.'); child.stdout.write('completed"}\n');
      child.emit('close', 0);
    });
  } });
  assert.deepEqual(result, answer);
  await assert.rejects(access(tempDirectory), { code: 'ENOENT' });
});

test('quota and timeout failures never return stale results or leak raw provider messages', async () => {
  await assert.rejects(chatCodexJson(messages, { status, spawnProcess: () => fakeProcess(child => {
    child.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'Secret details: You have hit your usage limit' } }) + '\n');
    child.emit('close', 1);
  }) }), error => error.reason === 'quota' && !error.message.includes('Secret'));
  let child;
  await assert.rejects(chatCodexJson(messages, { status, codexTimeoutMs: 25, spawnProcess: () => {
    child = fakeProcess(() => {}); return child;
  } }), error => error.reason === 'timeout');
  assert.equal(child.wasKilled, true);
});
