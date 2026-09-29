import argparse
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit
import uuid


ROOT = Path(__file__).resolve().parent.parent
SCENARIO = ROOT / "scenarios/micro-coffee"
MASTERS = {
    "Origin": ("origins", "Origins"),
    "Supplier": ("suppliers", "Suppliers"),
    "Material": ("materials", "Materials"),
    "Facility": ("facilities", "Facilities"),
    "Product": ("products", "Products"),
    "Recipe": ("recipes", "Recipes"),
    "RecipeLine": ("recipeLines", "RecipeLines"),
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("Non-finite SQL number")
        return str(value)
    if isinstance(value, str) and "\x00" not in value:
        return "N'" + value.replace("'", "''") + "'"
    raise ValueError("Unsupported SQL value")


def master_rows(namespace):
    data = read_json(SCENARIO / "data/development.json")
    specifications = {
        spec["table"]: spec
        for spec in read_json(SCENARIO / "table-schemas.json")["tables"]
        if spec["source"] == "development"
    }
    tables = {}
    for entity, (collection, sql_table) in MASTERS.items():
        fields = specifications[collection]["fields"]
        rows = []
        for row in data[collection]:
            if set(row) != set(fields):
                raise ValueError(f"Unexpected source columns: {collection}")
            rows.append({
                "id": str(uuid.uuid5(namespace, entity + "/" + row["id"])),
                "businessId": row["id"],
                **{field: row[field] for field in fields if field != "id"},
            })
        if not rows or len({row["businessId"] for row in rows}) != len(rows):
            raise ValueError(f"Empty or duplicate source keys: {collection}")
        tables[sql_table] = rows
    return tables


def allocation_rows(namespace):
    source = read_json(SCENARIO / "data/allocation.json")
    if source["dataOrigin"] != "synthetic":
        raise ValueError("Only the bundled synthetic allocation scenario may be seeded")
    tables = {}
    for entity, collection in (
        ("AllocationCustomer", "customers"),
        ("AllocationOrder", "orders"),
        ("AllocationOrderLine", "orderLines"),
        ("AllocationStock", "stocks"),
    ):
        rows = [{
            "id": str(uuid.uuid5(namespace, entity + "/" + row["id"])),
            "businessId": row["id"],
            "scenarioId": source["datasetId"],
            **{field: value for field, value in row.items() if field != "id"},
        } for row in source[collection]]
        if not rows or len({row["businessId"] for row in rows}) != len(rows):
            raise ValueError(f"Empty or duplicate allocation keys: {collection}")
        tables[entity + "s"] = rows
    tables["AllocationScenarios"] = [{
        "id": str(uuid.uuid5(namespace, "AllocationScenario/" + source["datasetId"])),
        "businessId": source["datasetId"],
        **{field: source[field] for field in ("version", "asOf", "dataOrigin")},
    }]
    return tables


def check_sources():
    lock = read_json(SCENARIO / "sources.lock.json")
    for record in lock["records"]:
        if record["target"].startswith("scenarios/micro-coffee/"):
            path = (ROOT / record["target"]).resolve()
            if not path.is_relative_to(SCENARIO.resolve()):
                raise ValueError("Source path escapes the scenario")
            if hashlib.sha256(path.read_bytes()).hexdigest() != record["targetSha256"]:
                raise ValueError(f"Source differs from the imported version: {record['target']}")


def seed_sql(tables, database_name):
    statements = [
        "SET XACT_ABORT ON;",
        "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;",
        f"IF DB_NAME() <> {sql_value(database_name)} THROW 51000, 'Wrong target database', 1;",
        "BEGIN TRY",
        "BEGIN TRANSACTION;",
    ]
    for table in tables:
        statements.append(
            f"IF (SELECT COUNT_BIG(*) FROM [dbo].[{table}] WITH (TABLOCKX,HOLDLOCK)) <> 0 "
            f"THROW 51001, 'Initial seed requires an empty {table} table', 1;"
        )
    for table, rows in tables.items():
        columns = ", ".join(f"[{field}]" for field in rows[0])
        for row in rows:
            values = ", ".join(sql_value(value) for value in row.values())
            statements.append(f"INSERT INTO [dbo].[{table}] ({columns}) VALUES ({values});")
        statements.append(
            f"SELECT {sql_value(table)} AS [tableName], COUNT_BIG(*) AS [rowCount] FROM [dbo].[{table}];"
        )
    statements.extend([
        "COMMIT TRANSACTION;",
        "END TRY",
        "BEGIN CATCH",
        "IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;",
        "THROW;",
        "END CATCH;",
    ])
    return "\n".join(statements) + "\n"


def prepare_foundry(config_path, output):
    config = read_json(config_path)
    if re.search(r"<[^>]+>", json.dumps(config)):
        raise ValueError("Resolve all Foundry configuration placeholders first")
    endpoint = config["projectEndpoint"].rstrip("/")
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "https" or not (parsed.hostname or "").endswith(".services.ai.azure.com")
            or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port
            or not re.fullmatch(r"/api/projects/[A-Za-z0-9_.-]+", parsed.path)):
        raise ValueError("Expected a public Azure Foundry project endpoint")
    request = read_json(ROOT / "infra/foundry/agent-definition.example.json")
    request["name"] = config["agentName"]
    request["definition"]["model"] = config["modelDeployment"]
    request["definition"]["instructions"] = (SCENARIO / "prompts/agent-instructions.txt").read_text(encoding="utf-8")
    for tool in request["definition"]["tools"]:
        if tool["type"] == "work_iq_preview":
            tool["project_connection_id"] = config["workIqConnectionResourceId"]
        elif tool["type"] == "fabric_iq_preview":
            connection = config["fabricIq"][tool["server_label"].removeprefix("maikuro-")]
            tool["server_url"] = connection["serverUrl"]
            tool["project_connection_id"] = connection["connectionResourceId"]
        elif tool["type"] == "mcp":
            tool["server_url"] = config["knowledgeBase"]["mcpUrl"]
            tool["project_connection_id"] = config["knowledgeBase"]["connectionName"]
    if not request["name"] or not request["definition"]["model"]:
        raise ValueError("Agent name and deployed model name are required")
    for tool in request["definition"]["tools"]:
        if tool["type"] != "function" and not tool.get("project_connection_id"):
            raise ValueError("Every IQ tool requires a connection")
        if "server_url" in tool:
            parsed_tool = urlsplit(tool["server_url"])
            if parsed_tool.scheme != "https" or not parsed_tool.hostname or parsed_tool.username or parsed_tool.password:
                raise ValueError("IQ server URL must use HTTPS without embedded credentials")
    content = (json.dumps(request, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output.mkdir(parents=True)
    (output / "agent-request.json").write_bytes(content)
    (output / "manifest.json").write_text(json.dumps({
        "projectEndpoint": endpoint, "createUrl": endpoint + "/agents?api-version=v1",
        "agentName": request["name"], "requestSha256": hashlib.sha256(content).hexdigest(),
        "instructionsSha256": hashlib.sha256((SCENARIO / "prompts/agent-instructions.txt").read_bytes()).hexdigest(),
        "applied": False,
    }, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "agentName": request["name"], "applied": False}))


def main():
    parser = argparse.ArgumentParser(description="Prepare application seed files without cloud access.")
    parser.add_argument("--sql-database-id", type=uuid.UUID)
    parser.add_argument("--database-name")
    parser.add_argument("--foundry-config", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output directory already exists; choose a new directory")
    check_sources()
    if args.foundry_config:
        if args.sql_database_id or args.database_name:
            parser.error("Foundry and SQL preparation require separate invocations")
        prepare_foundry(args.foundry_config, args.output)
        return
    if not args.sql_database_id or args.sql_database_id.int == 0 or not (args.database_name or "").strip():
        parser.error("A real target SQL database ID and database name are required")
    tables = {**master_rows(args.sql_database_id), **allocation_rows(args.sql_database_id)}
    sql = seed_sql(tables, args.database_name)
    source_paths = [SCENARIO / "data/development.json", SCENARIO / "data/allocation.json",
                    SCENARIO / "table-schemas.json", SCENARIO / "sources.lock.json"]
    manifest = {
        "sqlDatabaseId": str(args.sql_database_id),
        "databaseName": args.database_name,
        "dataOrigin": "synthetic",
        "counts": {table: len(rows) for table, rows in tables.items()},
        "sources": {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in source_paths},
        "sqlSha256": hashlib.sha256(sql.encode("utf-8")).hexdigest(),
        "applied": False,
    }
    args.output.mkdir(parents=True)
    (args.output / "rayfin-seed.sql").write_bytes(sql.encode("utf-8"))
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "counts": manifest["counts"], "applied": False}))


if __name__ == "__main__":
    main()