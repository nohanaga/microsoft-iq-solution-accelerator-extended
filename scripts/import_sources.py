import argparse
import ast
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCENARIO = ROOT / "scenarios/micro-coffee"
DATA_FILES = (
    "operations.json", "development.json", "voice-sources.json",
    "ec-chat-history.json", "voice-sentiments.json", "voice-spike-demo.json",
    "events/review-published.json", "allocation.json", "geo.json",
)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def extract_module(content, names, preamble):
    text = content.decode("utf-8")
    tree = ast.parse(text)
    selected = []
    found = set()
    for node in tree.body:
        node_names = {node.name} if isinstance(node, (ast.FunctionDef, ast.ClassDef)) else set()
        if isinstance(node, ast.Assign):
            node_names = {target.id for target in node.targets if isinstance(target, ast.Name)}
        if node_names & names:
            selected.append(ast.get_source_segment(text, node))
            found.update(node_names & names)
    if found != names:
        raise ValueError(f"Source implementation changed: missing {sorted(names - found)}")
    return (preamble + "\n\n" + "\n\n\n".join(selected) + "\n").encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description="Import the reviewed Micro Coffee data sources without environment settings.")
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    source_root = args.source_root.resolve(strict=True)
    operations = source_root / "workshops/Rayfin/micro-coffee-demo2"
    storefront = source_root / "micro-coffee-ec-demo"
    pending = {}
    records = []

    def stage(source, target, transform=None):
        content = source.read_bytes()
        output = transform(content) if transform else content
        destination = ROOT / target
        if destination.exists() and destination.read_bytes() != output:
            raise ValueError(f"Refusing to overwrite changed destination: {target}")
        pending[destination] = output
        records.append({
            "source": source.relative_to(source_root).as_posix(),
            "sourceSha256": digest(content), "target": target,
            "targetSha256": digest(output), "transformed": transform is not None,
        })

    for name in DATA_FILES:
        stage(operations / "v3/data" / name, f"scenarios/micro-coffee/data/{name}")
    stage(storefront / "data/catalogue.json", "scenarios/micro-coffee/data/catalogue.json")
    for name in ("development", "supply"):
        stage(operations / f"v3/ontology/{name}.json", f"scenarios/micro-coffee/ontology/{name}.json")

    def schemas_only(content):
        package = json.loads(content)
        return encode({
            "version": 1,
            "description": "Explicit schemas imported from the existing data compiler; rows are rebuilt from canonical sources.",
            "tables": [{key: table[key] for key in ("name", "source", "table", "schema", "fields", "primaryKey")}
                       for table in package["tables"]],
        })

    stage(operations / "v3/live/tables.json", "scenarios/micro-coffee/table-schemas.json", schemas_only)
    for directory in ("foundry-iq", "work-iq"):
        for source in sorted((operations / "v3/data-copilot/data" / directory).glob("*.md")):
            stage(source, f"scenarios/micro-coffee/knowledge/{directory}/{source.name}")
    stage(operations / "v3/data-copilot/agent-instructions.txt", "scenarios/micro-coffee/prompts/agent-instructions.txt")
    stage(storefront / "postgres/001-schema.sql", "apps/storefront/postgres/001-schema.sql")
    stage(operations / "v3/ontology/prepare_fabric.py", "scripts/accelerator/ontology.py", lambda content: extract_module(
        content,
        {"ARROW_TYPES", "LOADER_TYPES", "encode", "save", "numeric_id", "guid", "cast", "prepare_model", "compile_model"},
        "import base64\nimport hashlib\nimport json\nimport math\nfrom datetime import datetime, timezone\nfrom uuid import NAMESPACE_URL, uuid5\nimport pyarrow as pa\nimport pyarrow.parquet as pq\nV3 = 'scenarios/micro-coffee'",
    ))
    stage(source_root / ".github/skills/fabric-ontology-deploy/assets/deploy_workshop_to_fabric.py",
          "scripts/accelerator/graph_definition.py", lambda content: extract_module(
              content,
              {"GRAPH_DATA_SOURCES_SCHEMA", "GRAPH_DEFINITION_SCHEMA", "GRAPH_TYPE_SCHEMA", "GRAPH_STYLING_SCHEMA",
               "DeployError", "base64_json", "graph_value_type", "graph_table_path", "build_graph_definition", "validate_graph_definition"},
              "import base64\nimport json\nfrom uuid import uuid4\n\ndef new_guid():\n    return str(uuid4())",
          ))
    stage(source_root / "LICENSE", "docs/provenance/source-repository-LICENSE.txt")
    manifest = {
        "schemaVersion": 1, "scenarioId": "micro-coffee", "dataOrigin": "synthetic",
        "originEvidence": "workshops/Rayfin/micro-coffee-demo2/v3/manifest.json#/dataOrigin",
        "releaseStatus": "rights-review-required",
        "sourceRepositoryLicense": "docs/provenance/source-repository-LICENSE.txt",
        "records": records,
    }
    manifest_path = SCENARIO / "sources.lock.json"
    manifest_content = encode(manifest)
    if manifest_path.exists() and manifest_path.read_bytes() != manifest_content:
        raise ValueError("Source inventory changed; review a new migration instead of replacing the source lock.")
    pending[manifest_path] = manifest_content
    if args.apply:
        for destination, content in pending.items():
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        print(f"Imported {len(records)} sources. No cloud operations were performed.")
    else:
        print(json.dumps({"files": records, "writes": False}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()