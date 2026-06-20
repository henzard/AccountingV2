import { execSync } from 'child_process';
import fs from 'fs';

const query = fs.readFileSync('scripts/cr-threads.graphql', 'utf8');

function fetchThreads(pr) {
  const payload = JSON.stringify({ query, variables: { pr } });
  const out = execSync('gh api graphql --input -', { input: payload, encoding: 'utf8' });
  return JSON.parse(out).data.repository.pullRequest;
}

for (const pr of [39, 40, 106]) {
  const data = fetchThreads(pr);
  const open = data.reviewThreads.nodes.filter((t) => !t.isResolved);
  console.log(`\n=== PR #${data.number}: ${open.length} open ===`);
  for (const t of open) {
    const c = t.comments.nodes[0];
    const body = (c?.body ?? '').replace(/\s+/g, ' ').slice(0, 200);
    console.log(JSON.stringify({ id: t.id, path: t.path, line: t.line, author: c?.author?.login, body }));
  }
}
