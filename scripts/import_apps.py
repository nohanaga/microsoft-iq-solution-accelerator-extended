import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IGNORED = {"node_modules", ".venv", "__pycache__", "dist", "build", "build-server", ".git", ".deployments", ".rayfin"}
SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".sql", ".py", ".md", ".txt", ".yaml", ".yml",
            ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ico"}


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def import_setup_assets(source_root):
    source = source_root / "workshops/Rayfin/micro-coffee-demo2/v3"
    mappings = {
        "data/predictions.json": "scenarios/micro-coffee/data/predictions.json",
        "rti/DatabaseSchema.kql": "infra/fabric/rti/DatabaseSchema.kql",
    }
    for path in sorted((source / "ml/data").iterdir()):
        if path.is_file() and path.suffix in {".csv", ".parquet", ".json"}:
            mappings[path.relative_to(source).as_posix()] = "scenarios/micro-coffee/ml-data/" + path.name
    records = []
    pending = {}
    for relative, destination in mappings.items():
        path = source / relative
        content = path.read_bytes()
        target = ROOT / destination
        if target.exists() and target.read_bytes() != content:
            raise ValueError(f"Refusing to overwrite changed setup asset: {destination}")
        digest = hashlib.sha256(content).hexdigest()
        pending[target] = content
        records.append({"source": path.relative_to(source_root).as_posix(), "target": destination,
                        "sourceSha256": digest, "targetSha256": digest, "transformed": False})
    lock_path = ROOT / "scenarios/micro-coffee/sources.lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    previous = {record["target"]: record for record in lock["records"]}
    for record in records:
        if record["target"] in previous and previous[record["target"]] != record:
            raise ValueError("Setup source differs from the recorded import")
        previous[record["target"]] = record
    for target, content in pending.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    lock["records"] = list(previous.values())
    lock_path.write_bytes(encode(lock))
    provenance = ROOT / "docs/provenance/setup-assets.json"
    provenance.write_bytes(encode({"schemaVersion": 1, "scope": "byte-preserving setup assets", "records": records}))
    print(f"Imported {len(records)} setup assets with source SHA256 provenance. No cloud calls were made.")


def main():
    parser = argparse.ArgumentParser(description="One-time import of both Micro Coffee applications; no cloud access.")
    parser.add_argument("--source-root", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--sync-only", action="store_true")
    mode.add_argument("--setup-only", action="store_true")
    args = parser.parse_args()
    source_root = args.source_root.resolve(strict=True)
    if args.setup_only:
        import_setup_assets(source_root)
        return
    if args.sync_only:
        source = source_root / "workshops/Rayfin/micro-coffee-demo2/scripts/sync-postgres-orders-to-rayfin.py"
        target = ROOT / "services/order-sync/sync.py"
        if target.exists():
            raise ValueError("Order sync is already imported")
        content = source.read_bytes()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        record = {"source": source.relative_to(source_root).as_posix(), "target": target.relative_to(ROOT).as_posix(),
                  "sourceSha256": hashlib.sha256(content).hexdigest(), "scope": "before portability edits"}
        (ROOT / "docs/provenance/order-sync-import.json").write_bytes(encode(record))
        print("Imported order synchronization source; no service calls were made.")
        return
    sources = {"storefront": source_root / "micro-coffee-ec-demo",
               "operations": source_root / "workshops/Rayfin/micro-coffee-demo2"}
    pending = {}
    records = []
    for app, source in sources.items():
        directories = ("src", "server", "agent", "data", "public", "postgres") if app == "storefront" else ("src", "server", "data", "public", "rayfin")
        files = [path for directory in directories for path in (source / directory).rglob("*") if path.is_file()]
        files.extend(path for pattern in ("package*.json", "tsconfig*.json", "vite.config.ts", "*.html") for path in source.glob(pattern))
        if app == "operations":
            files.extend(path for path in (source / "v3/data").rglob("*.json") if path.is_file())
            files.extend(path for path in (source / "v3/ontology").glob("*.json") if path.is_file())
            files.extend(path for path in (source / "v3/ontology").glob("*.ts") if path.is_file())
            files.extend(path for path in (source / "scripts").glob("export-data.mjs"))
        else:
            files.extend(path for path in (source / "scripts").glob("prepare-commerce.ts"))
            files.extend(path for path in (source / "scripts").glob("import-postgres.ts"))
        for path in sorted(set(files)):
            relative = path.relative_to(source)
            if any(part in IGNORED or part.startswith(".") for part in relative.parts) or path.suffix.lower() not in SUFFIXES:
                continue
            if path.name.endswith((".local.json", ".local.yml", ".local.yaml")) or path.name in ("package-lock.json", "fabric.config.json", "deployment.json"):
                continue
            original = path.read_bytes()
            content = original
            if relative.name == "package.json":
                package = json.loads(content)
                package["dependencies"].pop("ontology-quest", None)
                content = encode(package)
            target = ROOT / "apps" / app / relative
            if target.exists() and target.read_bytes() != content:
                raise ValueError(f"Refusing to overwrite modified target: {target.relative_to(ROOT)}")
            pending[target] = content
            records.append({"source": path.relative_to(source_root).as_posix(), "target": target.relative_to(ROOT).as_posix(),
                            "sourceSha256": hashlib.sha256(original).hexdigest(), "importedSha256": hashlib.sha256(content).hexdigest()})
        lock_path = source / "package-lock.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["packages"][""]["dependencies"].pop("ontology-quest", None)
        lock["packages"] = {key: value for key, value in lock["packages"].items()
                            if not key.startswith("..") and key != "node_modules/ontology-quest"}
        target = ROOT / "apps" / app / "package-lock.json"
        content = encode(lock)
        if target.exists() and target.read_bytes() != content:
            raise ValueError("Existing dependency lock differs; refusing overwrite")
        pending[target] = content
        records.append({"source": lock_path.relative_to(source_root).as_posix(), "target": target.relative_to(ROOT).as_posix(),
                        "sourceSha256": hashlib.sha256(lock_path.read_bytes()).hexdigest(), "importedSha256": hashlib.sha256(content).hexdigest()})
    manifest = ROOT / "docs/provenance/apps-import.json"
    if manifest.exists():
        previous = json.loads(manifest.read_text(encoding="utf-8"))["records"]
        current = {record["target"]: record for record in records}
        if any(current.get(record["target"]) != record for record in previous):
            raise ValueError("Original application import changed; use normal edits after migration")
    for target, content in pending.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_bytes(encode({"schemaVersion": 1, "scope": "initial application source import, before portability edits", "records": records}))
    print(f"Imported {len(records)} application files. No dependencies, credentials or deployment state were copied.")


if __name__ == "__main__":
    main()