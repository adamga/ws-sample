// Runs in a child process so a session that exhausts memory cannot take down the server or the desktop window.
import { loadSession, summarizeSession, buildCorpus } from './parser.js';

process.on('message', async ({ id, file }) => {
  try {
    const session = await loadSession(file);
    process.send({ id, summary: summarizeSession(session), corpus: buildCorpus(session) });
  } catch (error) {
    process.send({ id, error: error.message });
  }
});
process.send({ ready: true });
