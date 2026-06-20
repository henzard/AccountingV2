import { execSync } from 'child_process';

function fetchThreads(prNumber) {
  const query = `
    query {
      repository(owner: "henzard", name: "AccountingV2") {
        pullRequest(number: ${prNumber}) {
          number
          title
          reviewThreads(first: 100) {
            totalCount
            nodes {
              isResolved
              path
              line
              comments(last: 1) {
                nodes {
                  author { login }
                  body
                }
              }
            }
          }
        }
      }
    }
  `;
  const out = execSync(`gh api graphql -f query=${JSON.stringify(query)}`, {
    encoding: 'utf8',
  });
  return JSON.parse(out).data.repository.pullRequest;
}

for (const n of [39, 40, 106]) {
  const pr = fetchThreads(n);
  const nodes = pr.reviewThreads.nodes;
  const open = nodes.filter((t) => !t.isResolved);
  console.log(
    `PR #${n}: ${open.length} unresolved / ${nodes.length} total — ${pr.title}`,
  );
  for (const t of open) {
    const body = (t.comments.nodes[0]?.body ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 90);
    console.log(`  - ${t.path}:${t.line ?? '?'} ${body}`);
  }
}
