
## Graphify

A queryable knowledge graph of this project is indexed at `/usr/local/devel/sure-master/graphify-out/merged-graph.json` (merged across all sure-* projects).

Query via OpenCode: `/graphify /path/to/project` or `graphify query "your question" --graph /path/to/graph.json`

Rebuild index: `graphify extract /path/to/project --code-only --out /tmp/graphify-out`
